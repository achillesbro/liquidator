require("dotenv").config();
const cron = require('node-cron');
const { ethers } = require("ethers");

const { getCandidates, getBorrowShares, isLiquidatableWithOracle } = require("./utils/positions");
const { sdkGetAccountState } = require("./utils/hyperlendIsolatedSdk");
const { getOracleBandUsdcPerXHype } = require("./utils/hyperlendOracle");

// Configuration
const MAX_REPAY_USDC = process.env.MAX_REPAY_USDC ? BigInt(process.env.MAX_REPAY_USDC) : BigInt(2000 * 1e6); // 2000 USDC (6 decimals)
const MIN_PROFIT_USDC = process.env.MIN_PROFIT_USDC ? BigInt(process.env.MIN_PROFIT_USDC) : 0n; // Minimum profit in USDC (6 decimals)
const PAIR_ADDRESS = '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd';
const USDC_ADDRESS = '0xb88339CB7199b77E23DB6E890353E22632Ba630f';
const XHYPE_ADDRESS = '0xAc962FA04BF91B7fd0DC0c5C32414E0Ce3C51E03';

const PAIR_ABI = [
    "function toBorrowShares(uint256 amount, bool roundUp, bool previewInterest) view returns (uint256)",
    "function toBorrowAmount(uint256 shares, bool roundUp, bool previewInterest) view returns (uint256)"
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

cron.schedule('* * * * *', async () => {
    run();
});

async function run() {
    if (process.env.BOT_PAUSED === 'true') {
        console.log("Bot is paused");
        return;
    }
    
    // Fetch oracle price band once per run
    let oracleHighPrice = null;
    try {
        const oracle = await getOracleBandUsdcPerXHype();
        if (oracle.isBadData) {
            console.log(`Oracle bad data detected, falling back to simulation-only mode`);
            oracleHighPrice = null;
        } else {
            oracleHighPrice = oracle.high;
            console.log(`Oracle band: low=${oracle.lowStr}, high=${oracle.highStr}, badData=false`);
        }
    } catch (error) {
        console.log(`Failed to fetch oracle band: ${error.message}, falling back to simulation-only mode`);
        oracleHighPrice = null;
    }
    
    const candidates = await getCandidates();
    console.log(`Found ${candidates.length} candidates`);

    for (let candidate of candidates) {
        const borrower = ethers.getAddress(candidate);
        
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
            // Get borrower's position
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.RPC);
            const { userBorrowShares } = await getBorrowShares(borrower);
            
            if (userBorrowShares === 0n) {
                console.log(`Skipping ${borrower}: no borrow shares`);
                continue;
            }

            // SDK pre-filter: Check if borrower is liquidatable (using cached oracle price)
            const liquidatableResult = await isLiquidatableWithOracle(borrower, oracleHighPrice);
            
            if (liquidatableResult.ok && liquidatableResult.liquidatable === false) {
                // SDK says not liquidatable - mark as solvent with cooldown
                solventCooldown[borrower] = Date.now();
                const oracleStr = liquidatableResult.oracleHighPrice?.toFixed(6) || 'N/A';
                const liqStr = liquidatableResult.liquidationPrice?.toFixed(6) || 'N/A';
                console.log(`SDK prefilter: solvent ${borrower} (oracle=${oracleStr}, liq=${liqStr})`);
                continue;
            } else if (liquidatableResult.ok && liquidatableResult.liquidatable === true) {
                // SDK says liquidatable - proceed to simulation
                const oracleStr = liquidatableResult.oracleHighPrice?.toFixed(6) || 'N/A';
                const liqStr = liquidatableResult.liquidationPrice?.toFixed(6) || 'N/A';
                console.log(`SDK prefilter: LIQUIDATABLE ${borrower} (oracle=${oracleStr}, liq=${liqStr})`);
                // Continue to simulation gate below
            } else if (!liquidatableResult.ok) {
                // SDK failed - fall back to existing simulation gate
                console.log(`SDK prefilter failed for ${borrower} (${liquidatableResult.error || 'unknown error'}), falling back to simulation`);
                // Continue to simulation gate below
            }

            // Check solvent cooldown cache
            if (solventCooldown[borrower]) {
                const cooldownAge = Date.now() - solventCooldown[borrower];
                if (cooldownAge < SOLVENT_COOLDOWN_MS) {
                    console.log(`Skipping ${borrower}: in solvent cooldown (${Math.floor((SOLVENT_COOLDOWN_MS - cooldownAge) / 1000 / 60)}min remaining)`);
                    continue;
                } else {
                    // Cooldown expired, remove from cache
                    delete solventCooldown[borrower];
                }
            }

            console.log(`Processing liquidation for ${borrower}`);
            console.log(`  Borrow shares: ${userBorrowShares.toString()}`);

            // Calculate shares to liquidate with cap
            const pair = new ethers.Contract(PAIR_ADDRESS, PAIR_ABI, provider);
            
            // Convert MAX_REPAY_USDC to shares
            const capShares = await pair.toBorrowShares.staticCall(MAX_REPAY_USDC, false, true);
            const sharesToLiquidate = userBorrowShares < capShares ? userBorrowShares : capShares;
            
            // Convert shares to repayAmount
            const repayAmount = await pair.toBorrowAmount.staticCall(sharesToLiquidate, true, true);
            
            console.log(`  Shares to liquidate: ${sharesToLiquidate.toString()}`);
            console.log(`  Repay amount: ${repayAmount.toString()}`);

            // Compute minOut based on repay requirement + minimum profit
            const minOut = repayAmount + MIN_PROFIT_USDC;
            console.log(`  Min USDC out: ${minOut.toString()}`);

            // Prepare deadline (30 seconds)
            const deadline = Math.floor(Date.now() / 1000) + 30;

            // Create signer and contract instance (use signer for both simulation and execution)
            const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, signer);
            
            // Encoding invariants debug (when BOT_DEBUG=1)
            if (process.env.BOT_DEBUG === '1') {
                try {
                    const calldata = contract.interface.encodeFunctionData("run", [
                        borrower,
                        sharesToLiquidate,
                        minOut,
                        deadline
                    ]);
                    console.log(`  [DEBUG] Encoded calldata length: ${calldata.length} chars (${(calldata.length - 2) / 2} bytes)`);
                    
                    // Decode back and verify
                    const decoded = contract.interface.decodeFunctionData("run", calldata);
                    const borrowerMatch = ethers.getAddress(decoded[0]) === ethers.getAddress(borrower);
                    const sharesMatch = decoded[1] === sharesToLiquidate;
                    const minOutMatch = decoded[2] === minOut;
                    const deadlineMatch = decoded[3] === BigInt(deadline);
                    
                    if (borrowerMatch && sharesMatch && minOutMatch && deadlineMatch) {
                        console.log(`  [DEBUG] Encoding roundtrip verified: all values match`);
                    } else {
                        console.warn(`  [DEBUG] Encoding roundtrip mismatch detected!`);
                        if (!borrowerMatch) console.warn(`    Borrower: expected ${borrower}, got ${decoded[0]}`);
                        if (!sharesMatch) console.warn(`    Shares: expected ${sharesToLiquidate.toString()}, got ${decoded[1].toString()}`);
                        if (!minOutMatch) console.warn(`    MinOut: expected ${minOut.toString()}, got ${decoded[2].toString()}`);
                        if (!deadlineMatch) console.warn(`    Deadline: expected ${deadline}, got ${decoded[3].toString()}`);
                    }
                } catch (debugError) {
                    console.warn(`  [DEBUG] Encoding verification failed: ${debugError.message}`);
                }
            }
            
            // Simulate transaction via eth_call (using signer so from = owner address)
            try {
                await contract.run.staticCall(
                    borrower,
                    sharesToLiquidate,
                    minOut,
                    deadline
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

            // Send transaction (using same contract instance)
            const tx = await contract.run(
                borrower,
                sharesToLiquidate,
                minOut,
                deadline
            );
            
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

                // Send Telegram notification if configured
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

            // Reset attempts on success
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

