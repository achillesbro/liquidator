require("dotenv").config();
const cron = require('node-cron');
const { ethers } = require("ethers");

const { MARKETS } = require("./markets");
const { getCandidates, getSnapshots, getBorrowAmountsFromShares, getPairStaticParams, isLiquidatableWithOracle } = require("./utils/positions");
const { sdkGetAccountState } = require("./utils/hyperlendIsolatedSdk");
const { fetchOracleBand, liquidationPriceToFP, PRICE_SCALE } = require("./utils/hyperlendOracle");
const { quoteExactInputSingle } = require("./utils/univ3Quote");
const { withRetry } = require("./utils/retry");

// Configuration
const MIN_PROFIT_USDC = process.env.MIN_PROFIT_USDC ? BigInt(process.env.MIN_PROFIT_USDC) : 0n; // Minimum profit in asset token (6 decimals)
const SDK_PREFILTER_ENABLED = process.env.SDK_PREFILTER_ENABLED === '1';

const PAIR_ABI = [
    "function toBorrowShares(uint256 amount, bool roundUp, bool previewInterest) view returns (uint256)",
    "function toBorrowAmount(uint256 shares, bool roundUp, bool previewInterest) view returns (uint256)",
    "function maxLTV() view returns (uint256)",
    "function getConstants() pure returns (uint256 _LTV_PRECISION, uint256 _LIQ_PRECISION, uint256 _UTIL_PREC, uint256 _FEE_PRECISION, uint256 _EXCHANGE_PRECISION, uint256 _DEVIATION_PRECISION, uint256 _RATE_PRECISION, uint256 _MAX_PROTOCOL_FEE)"
];

const CONTRACT_ABI = [
    "function run(address borrower, uint128 sharesToLiquidate, uint256 minUsdcOut, uint256 deadline) external",
    "function rescueTokens(address _token, uint256 _amount, bool _max, address _to) external",
    "event LiquidationExecuted(address indexed borrower, uint128 sharesToLiquidate, uint256 repayAmount, uint256 premium, uint256 seizedXHype, uint256 usdcOut, uint256 profitUsdc)"
];

// Per-market attempts tracking: marketId -> borrower -> count
let attempts = {};
// Solvent cooldown cache: marketId -> borrower -> timestamp (24 hour TTL)
let solventCooldown = {};

const SOLVENT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

run();

// Self-test: Check SDK with sample borrower if provided
if (process.env.SDK_SAMPLE_BORROWER && process.env.SDK_SAMPLE_PAIR) {
    (async () => {
        try {
            console.log(`[SDK Self-Test] Checking borrower: ${process.env.SDK_SAMPLE_BORROWER} on pair: ${process.env.SDK_SAMPLE_PAIR}`);
            const state = await sdkGetAccountState(process.env.SDK_SAMPLE_PAIR, process.env.SDK_SAMPLE_BORROWER);
            console.log(`[SDK Self-Test] Result:`, JSON.stringify(state, (key, value) => 
                typeof value === 'bigint' ? value.toString() : value, 2));
        } catch (error) {
            console.error(`[SDK Self-Test] Error:`, error.message);
        }
    })();
}

cron.schedule('*/10 * * * * *', async () => {
    run();
});

// Helper function for random delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Process a single market
 */
async function processMarket(market) {
    const DEBUG = process.env.BOT_DEBUG === '1';
    const marketId = market.id;
    
    console.log(`\n[${marketId}] Starting market tick`);
    
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.RPC);
    
    // Get market-specific config
    const contractAddress = process.env[`CONTRACT_ADDRESS_${marketId}`];
    if (!contractAddress) {
        console.log(`[${marketId}] No CONTRACT_ADDRESS_${marketId} set, skipping market`);
        return;
    }
    
    const maxRepayAsset = process.env[`MAX_REPAY_${marketId}`] 
        ? BigInt(process.env[`MAX_REPAY_${marketId}`]) 
        : 2000n * (10n ** BigInt(market.assetDecimals)); // Default 2000 asset tokens
    const liqBufferBps = parseInt(process.env[`LIQ_BUFFER_BPS_${marketId}`] || process.env.LIQ_BUFFER_BPS || '50');
    const slippageBps = parseInt(process.env[`SLIPPAGE_BPS_${marketId}`] || process.env.SLIPPAGE_BPS || '50');
    
    // Fetch oracle price band for this market (with retry)
    let oracleData = null;
    try {
        // Get token addresses (read from pair if not provided in config)
        let collateralToken = market.collateralAddress;
        let assetToken = market.assetAddress;
        
        if (!collateralToken || !assetToken) {
            const pair = new ethers.Contract(market.pairAddress, [
                "function collateralContract() view returns (address)",
                "function asset() view returns (address)"
            ], provider);
            if (!collateralToken) {
                collateralToken = await pair.collateralContract();
            }
            if (!assetToken) {
                assetToken = await pair.asset();
            }
        }
        
        const oracle = await withRetry(
            () => fetchOracleBand(market.oracleAddress, collateralToken, assetToken),
            { retries: 3, baseMs: 200, jitterMs: 200 }
        );
        if (oracle.badData || oracle.isBadData) {
            console.log(`[${marketId}] Oracle bad data detected, falling back to simulation-only mode`);
            oracleData = null;
        } else {
            oracleData = oracle;
            const orientation = oracle.inverted ? " (inverted)" : "";
            console.log(`[${marketId}] Oracle band: low=${oracle.lowStr}, high=${oracle.highStr}, badData=false${orientation}`);
        }
    } catch (error) {
        console.log(`[${marketId}] Failed to fetch oracle band: ${error.message}, falling back to simulation-only mode`);
        oracleData = null;
    }
    
    // Get candidates for this market
    const candidates = await getCandidates(marketId);
    console.log(`[${marketId}] Found ${candidates.length} candidates`);

    // Batch fetch all snapshots in one multicall
    const snapshots = await getSnapshots(candidates, market.pairAddress);
    console.log(`[${marketId}] Fetched ${snapshots.size} snapshots`);

    const pair = new ethers.Contract(market.pairAddress, PAIR_ABI, provider);

    // Get pair static params (maxLTV, LTV_PRECISION) with caching
    const pairParams = await getPairStaticParams(market.pairAddress, provider);
    const { maxLTV, LTV_PRECISION: ltvPrecision } = pairParams;

    // Build borrowSharesMap from snapshots (only those with borrowShares>0 and collateral>0)
    const borrowSharesMap = new Map();
    for (const [borrower, snapshot] of snapshots.entries()) {
        if (snapshot && snapshot.userBorrowShares > 0n && snapshot.userCollateralBalance > 0n) {
            borrowSharesMap.set(borrower, snapshot.userBorrowShares);
        }
    }

    // Batch fetch borrow amounts via multicall
    const borrowAmounts = await getBorrowAmountsFromShares(market.pairAddress, borrowSharesMap, provider);
    console.log(`[${marketId}] Computed ${borrowAmounts.size} borrowAmounts via multicall`);

    // Compute liquidatability for each borrower using batched data
    const ONE_MILLION = 1_000_000n;
    const ONE_E18 = 10n ** 18n;
    const ONE_ASSET = 10n ** BigInt(market.assetDecimals);
    const ONE_COLLATERAL = 10n ** BigInt(market.collateralDecimals);
    
    const liquidatableShortlist = [];
    let checkedCount = 0;
    let skippedEmpty = 0;
    let skippedNotLiquidatable = 0;
    const debugLogs = [];

    for (const [borrower, snapshot] of snapshots.entries()) {
        // Skip if snapshot missing or empty position
        if (!snapshot || snapshot.userBorrowShares === 0n || snapshot.userCollateralBalance === 0n) {
            skippedEmpty++;
            if (DEBUG) {
                if (!snapshot) {
                    debugLogs.push(`Skipping ${borrower}: snapshot missing`);
                } else if (snapshot.userBorrowShares === 0n) {
                    debugLogs.push(`Skipping ${borrower}: no borrow shares`);
                } else {
                    debugLogs.push(`Skipping ${borrower}: no collateral balance`);
                }
            }
            continue;
        }

        // On-chain prefilter: check if likely liquidatable
        if (oracleData && maxLTV !== 0n) {
            checkedCount++;
            
            // Get borrow amount from batched results
            const borrowAmount = borrowAmounts.get(borrower) || 0n;
            if (borrowAmount === 0n) {
                if (DEBUG) {
                    debugLogs.push(`Skipping ${borrower}: borrowAmount is zero or failed to fetch`);
                }
                continue;
            }

            // Calculate collateral value in asset token (with market decimals)
            // Formula: collateralValueAsset = collateralBalance * priceHighFP / PRICE_SCALE * ONE_ASSET / ONE_COLLATERAL
            // priceHighFP is already in fixed-point (PRICE_SCALE = 1), so divide by PRICE_SCALE to get the ratio
            const collateralValueAsset = (snapshot.userCollateralBalance * oracleData.priceHighFP * ONE_ASSET) / PRICE_SCALE / ONE_COLLATERAL;

            // Calculate max borrow allowed
            const maxBorrowAllowed = (collateralValueAsset * maxLTV) / ltvPrecision;

            // Apply buffer: liquidatable if borrowAmount > maxBorrowAllowed * (10000 + liqBufferBps) / 10000
            const bufferMultiplier = 10000n + BigInt(liqBufferBps);
            const threshold = (maxBorrowAllowed * bufferMultiplier) / 10000n;

            const liquidatable = borrowAmount > threshold;

            if (!liquidatable) {
                skippedNotLiquidatable++;
                if (DEBUG) {
                    debugLogs.push(`Skipping ${borrower}: not liquidatable (borrow=${borrowAmount.toString()}, max=${maxBorrowAllowed.toString()}, threshold=${threshold.toString()})`);
                }
                continue;
            }

            // Passed on-chain prefilter - add to shortlist
            liquidatableShortlist.push(borrower);
        } else {
            // No oracle data or maxLTV - add to shortlist for simulation
            liquidatableShortlist.push(borrower);
        }
    }

    console.log(`[${marketId}] Shortlist ${liquidatableShortlist.length} liquidatable`);

    // Initialize per-market tracking if needed
    if (!attempts[marketId]) {
        attempts[marketId] = {};
    }
    if (!solventCooldown[marketId]) {
        solventCooldown[marketId] = {};
    }

    let sdkCallsCount = 0;

    for (let candidate of candidates) {
        const borrower = ethers.getAddress(candidate);
        
        // Only process borrowers in liquidatable shortlist
        if (!liquidatableShortlist.includes(borrower)) {
            continue;
        }
        
        // Reset attempts after 15 failures
        if (attempts[marketId][borrower] && attempts[marketId][borrower] > 15) {
            attempts[marketId][borrower] = 0;
        }
        
        // Skip if too many recent attempts
        if (attempts[marketId][borrower] && attempts[marketId][borrower] > 3) {
            attempts[marketId][borrower] += 1;
            continue;
        }

        try {
            // Get snapshot from batched results
            const snapshot = snapshots.get(borrower);
            if (!snapshot) {
                continue;
            }

            // Optional SDK prefilter (only if enabled, at most 3 per tick)
            if (SDK_PREFILTER_ENABLED && sdkCallsCount < 3 && oracleData) {
                sdkCallsCount++;
                const liquidatableResult = await isLiquidatableWithOracle(market.pairAddress, borrower, oracleData.priceHighFP);
                
                if (liquidatableResult.ok && liquidatableResult.liquidatable === false) {
                    solventCooldown[marketId][borrower] = Date.now();
                    if (DEBUG) {
                        const oracleStr = liquidatableResult.oracleHighPriceFP ? (Number(liquidatableResult.oracleHighPriceFP) / Number(PRICE_SCALE)).toFixed(6) : 'N/A';
                        const liqStr = liquidatableResult.liquidationPriceFP ? (Number(liquidatableResult.liquidationPriceFP) / Number(PRICE_SCALE)).toFixed(6) : 'N/A';
                        debugLogs.push(`SDK prefilter: solvent ${borrower} (oracle=${oracleStr}, liq=${liqStr})`);
                    }
                    continue;
                }
                
                await sleep(50 + Math.floor(Math.random() * 50));
            }

            // Check solvent cooldown cache
            if (solventCooldown[marketId][borrower]) {
                const cooldownAge = Date.now() - solventCooldown[marketId][borrower];
                if (cooldownAge < SOLVENT_COOLDOWN_MS) {
                    if (DEBUG) {
                        debugLogs.push(`Skipping ${borrower}: in solvent cooldown (${Math.floor((SOLVENT_COOLDOWN_MS - cooldownAge) / 1000 / 60)}min remaining)`);
                    }
                    continue;
                } else {
                    delete solventCooldown[marketId][borrower];
                }
            }

            console.log(`[${marketId}] Processing liquidation for ${borrower}`);
            console.log(`[${marketId}]   Borrow shares: ${snapshot.userBorrowShares.toString()}`);

            // Calculate shares to liquidate with cap (with retry)
            const capShares = await withRetry(
                () => pair.toBorrowShares.staticCall(maxRepayAsset, false, true),
                { retries: 3, baseMs: 200, jitterMs: 200 }
            );
            const sharesToLiquidate = snapshot.userBorrowShares < capShares ? snapshot.userBorrowShares : capShares;
            
            // Convert shares to repayAmount (with retry)
            const repayAmount = await withRetry(
                () => pair.toBorrowAmount.staticCall(sharesToLiquidate, true, true),
                { retries: 3, baseMs: 200, jitterMs: 200 }
            );
            
            await sleep(50 + Math.floor(Math.random() * 50));
            
            console.log(`[${marketId}]   Shares to liquidate: ${sharesToLiquidate.toString()}`);
            console.log(`[${marketId}]   Repay amount: ${repayAmount.toString()}`);

            // Compute minOut based on repay requirement + minimum profit
            const minOut = repayAmount + MIN_PROFIT_USDC;
            console.log(`[${marketId}]   Min asset out: ${minOut.toString()}`);

            // Prepare deadline (30 seconds)
            const deadline = Math.floor(Date.now() / 1000) + 30;

            // Create signer and contract instance
            const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);
            
            if (DEBUG) {
                try {
                    const calldata = contract.interface.encodeFunctionData("run", [
                        borrower,
                        sharesToLiquidate,
                        minOut,
                        deadline
                    ]);
                    console.log(`[${marketId}]   [DEBUG] Encoded calldata length: ${calldata.length} chars (${(calldata.length - 2) / 2} bytes)`);
                    
                    const decoded = contract.interface.decodeFunctionData("run", calldata);
                    const borrowerMatch = ethers.getAddress(decoded[0]) === ethers.getAddress(borrower);
                    const sharesMatch = decoded[1] === sharesToLiquidate;
                    const minOutMatch = decoded[2] === minOut;
                    const deadlineMatch = decoded[3] === BigInt(deadline);
                    
                    if (borrowerMatch && sharesMatch && minOutMatch && deadlineMatch) {
                        console.log(`[${marketId}]   [DEBUG] Encoding roundtrip verified: all values match`);
                    } else {
                        console.warn(`[${marketId}]   [DEBUG] Encoding roundtrip mismatch detected!`);
                    }
                } catch (debugError) {
                    console.warn(`[${marketId}]   [DEBUG] Encoding verification failed: ${debugError.message}`);
                }
            }
            
            // Simulate transaction (with retry)
            try {
                await withRetry(
                    () => contract.run.staticCall(borrower, sharesToLiquidate, minOut, deadline),
                    { retries: 3, baseMs: 200, jitterMs: 200 }
                );
                console.log(`[${marketId}]   Simulation successful`);
            } catch (simError) {
                console.log(`[${marketId}]   Simulation failed: ${simError.message}`);
                if (attempts[marketId][borrower]) {
                    attempts[marketId][borrower] += 1;
                } else {
                    attempts[marketId][borrower] = 1;
                }
                continue;
            }

            // Send transaction
            const tx = await contract.run(borrower, sharesToLiquidate, minOut, deadline);
            
            console.log(`[${marketId}] Tx sent: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`[${marketId}] Tx confirmed in block ${receipt.blockNumber}`);

            // Parse events to get profit
            const event = receipt.logs.find(log => {
                try {
                    const parsed = contract.interface.parseLog(log);
                    return parsed && parsed.name === 'LiquidationExecuted';
                } catch {
                    return false;
                }
            });

            if (event) {
                const parsed = contract.interface.parseLog(event);
                const profitUsdc = parsed.args.profitUsdc;
                console.log(`[${marketId}]   Profit: ${ethers.formatUnits(profitUsdc, market.assetDecimals)} asset tokens`);

                if (process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID) {
                    await sendTelegramNotification(
                        marketId,
                        borrower,
                        sharesToLiquidate.toString(),
                        ethers.formatUnits(repayAmount, market.assetDecimals),
                        ethers.formatUnits(parsed.args.premium, market.assetDecimals),
                        ethers.formatUnits(profitUsdc, market.assetDecimals)
                    );
                }
            }

            // Rescue profit
            if (process.env.PROFIT_RECEIVER) {
                const assetAddress = market.assetAddress || await pair.asset();
                const rescueTx = await contract.rescueTokens(assetAddress, 0, true, process.env.PROFIT_RECEIVER);
                console.log(`[${marketId}] Rescue tx: ${rescueTx.hash}`);
                await rescueTx.wait();
            }

            attempts[marketId][borrower] = 0;

        } catch (error) {
            console.error(`[${marketId}] Error processing ${borrower}:`, error.message);
            if (attempts[marketId][borrower]) {
                attempts[marketId][borrower] += 1;
            } else {
                attempts[marketId][borrower] = 1;
            }
        }
    }

    // Print summary per market
    console.log(`[${marketId}] [Tick Summary] candidates=${candidates.length}, snapshots=${snapshots.size}, checked=${checkedCount}, liquidatable=${liquidatableShortlist.length}, skipped_empty=${skippedEmpty}, skipped_not_liq=${skippedNotLiquidatable}`);
    
    if (DEBUG && debugLogs.length > 0) {
        console.log(`[${marketId}] [DEBUG Logs]`);
        debugLogs.forEach(log => console.log(`[${marketId}]   ${log}`));
    }
}

async function run() {
    if (process.env.BOT_PAUSED === 'true') {
        console.log("Bot is paused");
        return;
    }
    
    console.log(`\n=== Starting liquidation tick at ${new Date().toISOString()} ===`);
    
    // Process each market
    for (const market of MARKETS) {
        try {
            await processMarket(market);
        } catch (error) {
            console.error(`[${market.id}] Fatal error processing market:`, error.message);
            console.error(error.stack);
        }
    }
    
    console.log(`=== Finished liquidation tick ===\n`);
}

async function sendTelegramNotification(marketId, borrower, shares, repayAmount, premium, profit) {
    try {
        const axios = require('axios');
        const message = `
✅ Liquidation Executed

Market: ${marketId}
Borrower: ${borrower}
Shares Liquidated: ${shares}
Repay Amount: ${repayAmount}
Premium: ${premium}
Profit: ${profit}
`;
        
        await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error("Failed to send Telegram notification:", error.message);
    }
}
