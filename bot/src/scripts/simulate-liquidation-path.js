require("dotenv").config();
const { ethers } = require("ethers");
const CONTRACT_ABI_JSON = require("../../../contracts/artifacts/contracts/IsolatedLiquidator.sol/IsolatedLiquidator.json");
const { HyperlendPair__factory } = require("../vendor/hyperlend-isolated-sdk/types/factories");
const { ROUTER_ABI } = require("../utils/prjxAbis");
const { selector, decodeRevert, formatRevert } = require("../utils/revertDecode");

// Extract ABI from Pair factory (includes all errors)
const PAIR_ABI = HyperlendPair__factory.abi || [];
const CONTRACT_ABI = CONTRACT_ABI_JSON.abi;

// Known addresses
const PAIR_ADDRESS = '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd';
const PRJX_ROUTER = '0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B';
const XHYPE_ADDRESS = '0xAc962FA04BF91B7fd0DC0c5C32414E0Ce3C51E03';
const USDC_ADDRESS = '0xb88339CB7199b77E23DB6E890353E22632Ba630f';
const PRJX_FEE = 100;

// Configuration from environment
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
if (!CONTRACT_ADDRESS) {
    console.error("Error: CONTRACT_ADDRESS environment variable is required");
    process.exit(1);
}

// Test parameters
const borrower = process.env.TEST_BORROWER || process.env.SDK_SAMPLE_BORROWER || "0x00845073402E19E26F68f4Fc868DF4f8eC2deECd";
const sharesToLiquidate = process.env.TEST_SHARES ? BigInt(process.env.TEST_SHARES) : 1n;
const minUsdcOut = process.env.TEST_MIN_USDC_OUT ? BigInt(process.env.TEST_MIN_USDC_OUT) : 0n;
const deadline = process.env.TEST_DEADLINE ? BigInt(process.env.TEST_DEADLINE) : BigInt(Math.floor(Date.now() / 1000) + 60);
const SIM_MODE = process.env.SIM_MODE || "FULL"; // FULL, PAIR_ONLY, SWAP_ONLY

// Pool ABI - minimal for flashLoanSimple (errors from Aave)
const POOL_ABI = [
    "function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16 referralCode) external",
    // Common Aave errors (minimal set)
    "error FlashLoanReceiverInvalid()",
    "error FlashLoanCallbackFailed()",
];

async function main() {
    console.log("=== Liquidation Path Simulation ===\n");
    
    console.log("Configuration:");
    console.log(`  Contract: ${CONTRACT_ADDRESS}`);
    console.log(`  Borrower: ${borrower}`);
    console.log(`  Shares: ${sharesToLiquidate.toString()}`);
    console.log(`  Min USDC Out: ${minUsdcOut.toString()}`);
    console.log(`  Deadline: ${deadline.toString()} (${new Date(Number(deadline) * 1000).toISOString()})`);
    console.log(`  Simulation Mode: ${SIM_MODE}`);
    console.log("");
    
    const rpcUrl = process.env.RPC_URL || process.env.RPC;
    if (!rpcUrl) {
        throw new Error("RPC_URL or RPC environment variable is required");
    }
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    
    // Build interfaces for error decoding
    const contractIface = new ethers.Interface(CONTRACT_ABI);
    const pairIface = new ethers.Interface(PAIR_ABI);
    const routerIface = new ethers.Interface(ROUTER_ABI);
    const poolIface = new ethers.Interface(POOL_ABI);
    
    const allABIs = [CONTRACT_ABI, PAIR_ABI, ROUTER_ABI, POOL_ABI];
    
    if (SIM_MODE === "FULL" || SIM_MODE === "PAIR_ONLY" || SIM_MODE === "SWAP_ONLY") {
        // FULL: Simulate full liquidation path
        if (SIM_MODE === "FULL") {
            console.log("=== Mode: FULL (IsolatedLiquidator.run) ===\n");
            
            try {
                const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
                
                console.log("Simulating IsolatedLiquidator.run...");
                const result = await contract.run.staticCall(
                    borrower,
                    sharesToLiquidate,
                    minUsdcOut,
                    deadline,
                    { from: CONTRACT_ADDRESS } // Note: staticCall doesn't support from, but we log it
                );
                
                console.log("✓ Simulation succeeded (no revert)");
                console.log(`  Result: ${result}`);
            } catch (error) {
                console.log("✗ Simulation failed (reverted)");
                console.log(`  Error message: ${error.message}`);
                
                // Extract revert data
                let revertData = null;
                if (error.data) {
                    revertData = error.data;
                } else if (error.reason?.data) {
                    revertData = error.reason.data;
                } else if (error.reason) {
                    revertData = error.reason;
                }
                
                if (revertData) {
                    const decoded = decodeRevert(revertData, allABIs);
                    console.log(`  Revert info: ${formatRevert(decoded)}`);
                    if (decoded?.selector) {
                        console.log(`  Selector: ${decoded.selector}`);
                    }
                } else {
                    console.log("  Could not extract revert data");
                }
                
                console.log("\nProceeding to direct path simulations...\n");
            }
        }
        
        // PAIR_ONLY: Simulate pair.liquidate directly
        if (SIM_MODE === "PAIR_ONLY" || SIM_MODE === "FULL") {
            console.log("=== Mode: PAIR_ONLY (pair.liquidate) ===\n");
            
            try {
                const pair = new ethers.Contract(PAIR_ADDRESS, PAIR_ABI, provider);
                
                console.log("Simulating pair.liquidate...");
                console.log(`  From: ${CONTRACT_ADDRESS} (liquidator contract)`);
                
                // Use provider.call with from set to contract address
                const liquidateCalldata = pairIface.encodeFunctionData("liquidate", [
                    sharesToLiquidate,
                    deadline,
                    borrower
                ]);
                
                const result = await provider.call({
                    to: PAIR_ADDRESS,
                    data: liquidateCalldata,
                    from: CONTRACT_ADDRESS
                });
                
                console.log("✓ Pair liquidation simulation succeeded");
                console.log(`  Result: ${result}`);
                
                // Decode result (returns uint256 collateralForLiquidator)
                if (result && result !== "0x") {
                    const decoded = pairIface.decodeFunctionResult("liquidate", result);
                    console.log(`  Decoded collateral: ${decoded[0].toString()}`);
                }
            } catch (error) {
                console.log("✗ Pair liquidation simulation failed");
                console.log(`  Error message: ${error.message}`);
                
                let revertData = null;
                if (error.data) revertData = error.data;
                else if (error.reason?.data) revertData = error.reason.data;
                else if (error.reason) revertData = error.reason;
                
                if (revertData) {
                    const decoded = decodeRevert(revertData, allABIs);
                    console.log(`  Revert info: ${formatRevert(decoded)}`);
                    if (decoded?.selector) {
                        console.log(`  Selector: ${decoded.selector}`);
                    }
                }
            }
            
            console.log("");
        }
        
        // SWAP_ONLY: Simulate router.exactInputSingle
        if (SIM_MODE === "SWAP_ONLY" || SIM_MODE === "FULL") {
            console.log("=== Mode: SWAP_ONLY (router.exactInputSingle) ===\n");
            
            try {
                const router = new ethers.Contract(PRJX_ROUTER, ROUTER_ABI, provider);
                
                // Use a small amount for testing (without approval, should revert with transfer error)
                const testAmountIn = ethers.parseUnits("0.001", 18); // Small xHYPE amount
                
                console.log("Simulating router.exactInputSingle...");
                console.log(`  From: ${CONTRACT_ADDRESS} (liquidator contract)`);
                console.log(`  Amount In: ${testAmountIn.toString()} (${ethers.formatUnits(testAmountIn, 18)} xHYPE)`);
                
                const paramsStruct = {
                    tokenIn: XHYPE_ADDRESS,
                    tokenOut: USDC_ADDRESS,
                    fee: PRJX_FEE,
                    recipient: CONTRACT_ADDRESS,
                    deadline: deadline,
                    amountIn: testAmountIn,
                    amountOutMinimum: minUsdcOut,
                    sqrtPriceLimitX96: 0n
                };
                
                // Encode and call - handle ambiguous function signatures
                // Use getFunction with full signature to disambiguate
                let swapCalldata;
                try {
                    // Try tuple-style signature first (SwapRouter02 style)
                    const tupleFunc = routerIface.getFunction("exactInputSingle(tuple(address,address,uint24,address,uint256,uint256,uint256,uint160))");
                    swapCalldata = routerIface.encodeFunctionData(tupleFunc, [paramsStruct]);
                } catch (e) {
                    // Fall back to flat-args signature
                    try {
                        const flatFunc = routerIface.getFunction("exactInputSingle(address,address,uint24,address,uint256,uint256,uint256,uint160)");
                        swapCalldata = routerIface.encodeFunctionData(flatFunc, [
                            paramsStruct.tokenIn,
                            paramsStruct.tokenOut,
                            paramsStruct.fee,
                            paramsStruct.recipient,
                            paramsStruct.deadline,
                            paramsStruct.amountIn,
                            paramsStruct.amountOutMinimum,
                            paramsStruct.sqrtPriceLimitX96
                        ]);
                    } catch (e2) {
                        throw new Error(`Failed to encode exactInputSingle: ${e.message}, ${e2.message}`);
                    }
                }
                
                const result = await provider.call({
                    to: PRJX_ROUTER,
                    data: swapCalldata,
                    from: CONTRACT_ADDRESS
                });
                
                console.log("✓ Swap simulation succeeded (unexpected - should revert without approval)");
                console.log(`  Result: ${result}`);
                
                if (result && result !== "0x") {
                    const decoded = routerIface.decodeFunctionResult("exactInputSingle", result);
                    console.log(`  Decoded amountOut: ${decoded[0].toString()}`);
                }
            } catch (error) {
                console.log("✗ Swap simulation failed (expected if no approval/balance)");
                console.log(`  Error message: ${error.message}`);
                
                let revertData = null;
                if (error.data) revertData = error.data;
                else if (error.reason?.data) revertData = error.reason.data;
                else if (error.reason) revertData = error.reason;
                
                if (revertData) {
                    const decoded = decodeRevert(revertData, allABIs);
                    console.log(`  Revert info: ${formatRevert(decoded)}`);
                    if (decoded?.selector) {
                        console.log(`  Selector: ${decoded.selector}`);
                    }
                }
            }
            
            console.log("");
        }
    } else {
        console.error(`Unknown SIM_MODE: ${SIM_MODE}. Use FULL, PAIR_ONLY, or SWAP_ONLY`);
        process.exit(1);
    }
    
    console.log("=== Simulation Complete ===");
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});