require("dotenv").config();
const cron = require('node-cron');
const { ethers } = require("ethers");

const { getCandidates, getSnapshots, getBorrowAmountsFromShares, getPairStaticParams, isLiquidatableWithOracle } = require("./utils/positions");
const { sdkGetAccountState } = require("./utils/hyperlendIsolatedSdk");
const { getOracleBandUsdcPerXHype } = require("./utils/hyperlendOracle");
const { withRetry } = require("./utils/retry");

// Configuration
const MAX_REPAY_USDC = process.env.MAX_REPAY_USDC ? BigInt(process.env.MAX_REPAY_USDC) : BigInt(2000 * 1e6); // 2000 USDC (6 decimals)
const MIN_PROFIT_USDC = process.env.MIN_PROFIT_USDC ? BigInt(process.env.MIN_PROFIT_USDC) : 0n; // Minimum profit in USDC (6 decimals)
const SDK_PREFILTER_ENABLED = process.env.SDK_PREFILTER_ENABLED === '1';
const PAIR_ADDRESS = '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd';
const USDC_ADDRESS = '0xb88339CB7199b77E23DB6E890353E22632Ba630f';
const XHYPE_ADDRESS = '0xAc962FA04BF91B7fd0DC0c5C32414E0Ce3C51E03';

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

let attempts = {};
// Solvent cooldown cache: borrower -> timestamp (24 hour TTL)
let solventCooldown = {};

const SOLVENT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

run();

// Self-test: Check SDK with sample borrower if provided
if (process.env.SDK_SAMPLE_BORROWER) {
    (async () => {
        try {
            console.log(`[SDK Self-Test] Checking borrower: ${process.env.SDK_SAMPLE_BORROWER}`);
            const state = await sdkGetAccountState(PAIR_ADDRESS, process.env.SDK_SAMPLE_BORROWER);
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

async function run() {
    if (process.env.BOT_PAUSED === 'true') {
        console.log("Bot is paused");
        return;
    }
    
    const DEBUG = process.env.BOT_DEBUG === '1';
    
    // Fetch oracle price band once per run (with retry)
    let oracleData = null;
    try {
        const oracle = await withRetry(
            () => getOracleBandUsdcPerXHype(),
            { retries: 3, baseMs: 200, jitterMs: 200 }
        );
        if (oracle.isBadData) {
            console.log(`Oracle bad data detected, falling back to simulation-only mode`);
            oracleData = null;
        } else {
            oracleData = oracle;
            console.log(`Oracle band: low=${oracle.lowStr}, high=${oracle.highStr}, badData=false`);
        }
    } catch (error) {
        console.log(`Failed to fetch oracle band: ${error.message}, falling back to simulation-only mode`);
        oracleData = null;
    }
    
    // Get candidates
    const candidates = await getCandidates();
    console.log(`Found ${candidates.length} candidates`);

    // Batch fetch all snapshots in one multicall
    const snapshots = await getSnapshots(candidates);
    console.log(`Fetched ${snapshots.size} snapshots`);

    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.RPC);
    const pair = new ethers.Contract(PAIR_ADDRESS, PAIR_ABI, provider);

    // Get pair static params (maxLTV, LTV_PRECISION) with caching
    const pairParams = await getPairStaticParams(PAIR_ADDRESS, provider);
    const { maxLTV, LTV_PRECISION: ltvPrecision } = pairParams;

    // Build borrowSharesMap from snapshots (only those with borrowShares>0 and collateral>0)
    const borrowSharesMap = new Map();
    for (const [borrower, snapshot] of snapshots.entries()) {
        if (snapshot && snapshot.userBorrowShares > 0n && snapshot.userCollateralBalance > 0n) {
            borrowSharesMap.set(borrower, snapshot.userBorrowShares);
        }
    }

    // Batch fetch borrow amounts via multicall
    const borrowAmounts = await getBorrowAmountsFromShares(PAIR_ADDRESS, borrowSharesMap, provider);
    console.log(`Computed ${borrowAmounts.size} borrowAmounts via multicall`);

    // Compute liquidatability for each borrower using batched data
    const liqBufferBps = parseInt(process.env.LIQ_BUFFER_BPS || '50');
    const ONE_MILLION = 1_000_000n;
    const ONE_E18 = 10n ** 18n;
    
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

            // Calculate collateral value in USDC (6 decimals)
            // Formula: collateralValueUSDC_6 = collateralBalance(1e18) * oracleHighRaw(oraclePrecision) / oraclePrecision / 1e18 * 1e6
            const collateralValueUSDC_6 = (snapshot.userCollateralBalance * oracleData.highRaw * ONE_MILLION) / oracleData.oraclePrecision / ONE_E18;

            // Calculate max borrow allowed
            const maxBorrowAllowed = (collateralValueUSDC_6 * maxLTV) / ltvPrecision;

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

    console.log(`Shortlist ${liquidatableShortlist.length} liquidatable`);

    let sdkCallsCount = 0;

    for (let candidate of candidates) {
        const borrower = ethers.getAddress(candidate);
        
        // Only process borrowers in liquidatable shortlist
        if (!liquidatableShortlist.includes(borrower)) {
            continue;
        }
        
        // Reset attempts after 15 failures
        if (attempts[borrower] && attempts[borrower] > 15) {
            attempts[borrower] = 0;
        }
        
        // Skip if too many recent attempts
        if (attempts[borrower] && attempts[borrower] > 3) {
            attempts[borrower] += 1;
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
                const liquidatableResult = await isLiquidatableWithOracle(borrower, oracleData.high);
                
                if (liquidatableResult.ok && liquidatableResult.liquidatable === false) {
                    solventCooldown[borrower] = Date.now();
                    if (DEBUG) {
                        const oracleStr = liquidatableResult.oracleHighPrice?.toFixed(6) || 'N/A';
                        const liqStr = liquidatableResult.liquidationPrice?.toFixed(6) || 'N/A';
                        debugLogs.push(`SDK prefilter: solvent ${borrower} (oracle=${oracleStr}, liq=${liqStr})`);
                    }
                    continue;
                }
                
                await sleep(50 + Math.floor(Math.random() * 50));
            }

            // Check solvent cooldown cache
            if (solventCooldown[borrower]) {
                const cooldownAge = Date.now() - solventCooldown[borrower];
                if (cooldownAge < SOLVENT_COOLDOWN_MS) {
                    if (DEBUG) {
                        debugLogs.push(`Skipping ${borrower}: in solvent cooldown (${Math.floor((SOLVENT_COOLDOWN_MS - cooldownAge) / 1000 / 60)}min remaining)`);
                    }
                    continue;
                } else {
                    delete solventCooldown[borrower];
                }
            }

            console.log(`Processing liquidation for ${borrower}`);
            console.log(`  Borrow shares: ${snapshot.userBorrowShares.toString()}`);

            // Calculate shares to liquidate with cap (with retry)
            const capShares = await withRetry(
                () => pair.toBorrowShares.staticCall(MAX_REPAY_USDC, false, true),
                { retries: 3, baseMs: 200, jitterMs: 200 }
            );
            const sharesToLiquidate = snapshot.userBorrowShares < capShares ? snapshot.userBorrowShares : capShares;
            
            // Convert shares to repayAmount (with retry)
            const repayAmount = await withRetry(
                () => pair.toBorrowAmount.staticCall(sharesToLiquidate, true, true),
                { retries: 3, baseMs: 200, jitterMs: 200 }
            );
            
            await sleep(50 + Math.floor(Math.random() * 50));
            
            console.log(`  Shares to liquidate: ${sharesToLiquidate.toString()}`);
            console.log(`  Repay amount: ${repayAmount.toString()}`);

            // Compute minOut based on repay requirement + minimum profit
            const minOut = repayAmount + MIN_PROFIT_USDC;
            console.log(`  Min USDC out: ${minOut.toString()}`);

            // Prepare deadline (30 seconds)
            const deadline = Math.floor(Date.now() / 1000) + 30;

            // Create signer and contract instance
            const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            
            if (DEBUG) {
                try {
                    const calldata = contract.interface.encodeFunctionData("run", [
                        borrower,
                        sharesToLiquidate,
                        minOut,
                        deadline
                    ]);
                    console.log(`  [DEBUG] Encoded calldata length: ${calldata.length} chars (${(calldata.length - 2) / 2} bytes)`);
                    
                    const decoded = contract.interface.decodeFunctionData("run", calldata);
                    const borrowerMatch = ethers.getAddress(decoded[0]) === ethers.getAddress(borrower);
                    const sharesMatch = decoded[1] === sharesToLiquidate;
                    const minOutMatch = decoded[2] === minOut;
                    const deadlineMatch = decoded[3] === BigInt(deadline);
                    
                    if (borrowerMatch && sharesMatch && minOutMatch && deadlineMatch) {
                        console.log(`  [DEBUG] Encoding roundtrip verified: all values match`);
                    } else {
                        console.warn(`  [DEBUG] Encoding roundtrip mismatch detected!`);
                    }
                } catch (debugError) {
                    console.warn(`  [DEBUG] Encoding verification failed: ${debugError.message}`);
                }
            }
            
            // Simulate transaction (with retry)
            try {
                await withRetry(
                    () => contract.run.staticCall(borrower, sharesToLiquidate, minOut, deadline),
                    { retries: 3, baseMs: 200, jitterMs: 200 }
                );
                console.log(`  Simulation successful`);
            } catch (simError) {
                console.log(`  Simulation failed: ${simError.message}`);
                if (attempts[borrower]) {
                    attempts[borrower] += 1;
                } else {
                    attempts[borrower] = 1;
                }
                continue;
            }

            // Send transaction
            const tx = await contract.run(borrower, sharesToLiquidate, minOut, deadline);
            
            console.log(`Tx sent: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`Tx confirmed in block ${receipt.blockNumber}`);

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
                console.log(`  Profit: ${ethers.formatUnits(profitUsdc, 6)} USDC`);

                if (process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID) {
                    await sendTelegramNotification(
                        borrower,
                        sharesToLiquidate.toString(),
                        ethers.formatUnits(repayAmount, 6),
                        ethers.formatUnits(parsed.args.premium, 6),
                        ethers.formatUnits(profitUsdc, 6)
                    );
                }
            }

            // Rescue profit
            if (process.env.PROFIT_RECEIVER) {
                const rescueTx = await contract.rescueTokens(USDC_ADDRESS, 0, true, process.env.PROFIT_RECEIVER);
                console.log(`Rescue tx: ${rescueTx.hash}`);
                await rescueTx.wait();
            }

            attempts[borrower] = 0;

        } catch (error) {
            console.error(`Error processing ${borrower}:`, error.message);
            if (attempts[borrower]) {
                attempts[borrower] += 1;
            } else {
                attempts[borrower] = 1;
            }
        }
    }

    // Print summary per tick
    console.log(`[Tick Summary] candidates=${candidates.length}, snapshots=${snapshots.size}, checked=${checkedCount}, liquidatable=${liquidatableShortlist.length}, skipped_empty=${skippedEmpty}, skipped_not_liq=${skippedNotLiquidatable}`);
    
    if (DEBUG && debugLogs.length > 0) {
        console.log(`[DEBUG Logs]`);
        debugLogs.forEach(log => console.log(`  ${log}`));
    }
}

async function sendTelegramNotification(borrower, shares, repayAmount, premium, profit) {
    try {
        const axios = require('axios');
        const message = `
✅ Liquidation Executed

Borrower: ${borrower}
Shares Liquidated: ${shares}
Repay Amount: ${repayAmount} USDC
Premium: ${premium} USDC
Profit: ${profit} USDC
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

