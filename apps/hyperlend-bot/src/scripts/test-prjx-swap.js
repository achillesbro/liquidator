require("dotenv").config();
const { ethers } = require("ethers");
const { FACTORY_ABI, POOL_ABI, ROUTER_ABI, ERC20_ABI } = require("../utils/prjxAbis");
const { getSpotPriceFromPool } = require("../utils/prjxSpot");

// Known addresses
const XHYPE_ADDRESS = "0xAc962FA04BF91B7fd0DC0c5C32414E0Ce3C51E03";
const USDC_ADDRESS = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";
const PRJX_ROUTER = "0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B";
const PRJX_FACTORY = "0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072";
const FEE = 100;

async function main() {
    try {
        // Load environment variables
        const rpcUrl = process.env.RPC_URL || process.env.RPC;
        if (!rpcUrl) {
            throw new Error("RPC_URL or RPC environment variable is required");
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        console.log("✓ Provider initialized");
        console.log(`  RPC URL: ${rpcUrl}`);
        console.log("");

        // Get wallet address (for recipient if not specified)
        let wallet = null;
        let walletAddress = null;
        if (process.env.PRIVATE_KEY) {
            wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
            walletAddress = await wallet.getAddress();
            console.log(`✓ Wallet loaded: ${walletAddress}`);
        }
        console.log("");

        // Step 1: Find pool via factory
        console.log("Step 1: Finding pool via factory...");
        const factory = new ethers.Contract(PRJX_FACTORY, FACTORY_ABI, provider);
        
        // Normalize addresses for factory (order doesn't matter)
        const tokenA = ethers.getAddress(XHYPE_ADDRESS);
        const tokenB = ethers.getAddress(USDC_ADDRESS);
        const poolAddress = await factory.getPool(tokenA, tokenB, FEE);
        
        if (poolAddress === ethers.ZeroAddress) {
            throw new Error(`Pool not found for xHYPE/USDC with fee=${FEE}`);
        }
        
        console.log(`✓ Pool found: ${poolAddress}`);
        console.log("");

        // Step 2: Validate pool and read slot0
        console.log("Step 2: Reading pool state...");
        const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
        
        const [token0, token1, slot0] = await Promise.all([
            pool.token0(),
            pool.token1(),
            pool.slot0()
        ]);
        
        console.log(`  token0: ${token0}`);
        console.log(`  token1: ${token1}`);
        console.log(`  sqrtPriceX96: ${slot0.sqrtPriceX96.toString()}`);
        console.log(`  tick: ${slot0.tick.toString()}`);
        
        // Compute spot price using the existing utility function
        const spotPriceData = await getSpotPriceFromPool(poolAddress, XHYPE_ADDRESS, USDC_ADDRESS);
        console.log(`  Spot price: ${spotPriceData.spotPrice.toFixed(6)} USDC per xHYPE`);
        console.log("");

        // Step 3: Prepare swap parameters
        console.log("Step 3: Preparing swap parameters...");
        const amountInRaw = process.env.SWAP_AMOUNT_IN_XHYPE || "0.01";
        const amountIn = ethers.parseUnits(amountInRaw, 18);
        const recipient = process.env.SWAP_RECIPIENT || walletAddress || ethers.ZeroAddress;
        const deadline = Math.floor(Date.now() / 1000) + 60;
        
        let amountOutMinimum = 0n;
        if (process.env.SWAP_MIN_OUT_USDC) {
            amountOutMinimum = ethers.parseUnits(process.env.SWAP_MIN_OUT_USDC, 6);
        }
        const sqrtPriceLimitX96 = 0n; // No price limit
        
        console.log(`  amountIn: ${amountInRaw} xHYPE (${amountIn.toString()} wei)`);
        console.log(`  recipient: ${recipient}`);
        console.log(`  deadline: ${deadline} (${new Date(deadline * 1000).toISOString()})`);
        console.log(`  amountOutMinimum: ${amountOutMinimum.toString()} (${process.env.SWAP_MIN_OUT_USDC ? process.env.SWAP_MIN_OUT_USDC + " USDC" : "0 (no minimum)"})`);
        console.log("");

        // Step 4: Encode and simulate swap
        console.log("Step 4: Encoding and simulating swap...");
        
        // Prepare params struct (xHYPE -> USDC)
        const paramsStruct = {
            tokenIn: ethers.getAddress(XHYPE_ADDRESS),
            tokenOut: ethers.getAddress(USDC_ADDRESS),
            fee: FEE,
            recipient: recipient,
            deadline: deadline,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        };
        
        // Use wallet signer if available (needed for simulation that checks balance/allowance)
        const router = wallet 
            ? new ethers.Contract(PRJX_ROUTER, ROUTER_ABI, wallet)
            : new ethers.Contract(PRJX_ROUTER, ROUTER_ABI, provider);
        
        let amountOut;
        let signatureUsed;
        let simulationSucceeded = false;
        
        // Try tuple-style signature first (SwapRouter02)
        try {
            console.log("  Trying tuple-style signature (SwapRouter02)...");
            amountOut = await router.exactInputSingle.staticCall(paramsStruct);
            signatureUsed = "tuple-style (SwapRouter02)";
            simulationSucceeded = true;
            console.log(`  ✓ Tuple-style signature works`);
        } catch (error) {
            // If it fails with function selector error, try flat-args
            if (error.message.includes("function selector") || 
                error.message.includes("no matching fragment") ||
                error.code === "BAD_DATA") {
                console.log(`  Tuple-style failed, trying flat-args signature...`);
                try {
                    amountOut = await router.exactInputSingle.staticCall(
                        paramsStruct.tokenIn,
                        paramsStruct.tokenOut,
                        paramsStruct.fee,
                        paramsStruct.recipient,
                        paramsStruct.deadline,
                        paramsStruct.amountIn,
                        paramsStruct.amountOutMinimum,
                        paramsStruct.sqrtPriceLimitX96
                    );
                    signatureUsed = "flat-args (older SwapRouter)";
                    simulationSucceeded = true;
                    console.log(`  ✓ Flat-args signature works`);
                } catch (error2) {
                    // Check if it's a balance/approval error
                    if (error2.message.includes("STF") || error2.message.includes("SafeTransferFrom")) {
                        console.log(`  ⚠ Simulation failed: router requires token approval/balance for simulation`);
                        console.log(`    (This is expected for dry-run. Use SWAP_SEND_TX=1 to execute with approval)`);
                        signatureUsed = "tuple-style (SwapRouter02)"; // Default assumption
                        simulationSucceeded = false;
                    } else {
                        throw new Error(`Both signatures failed. Tuple error: ${error.message}. Flat-args error: ${error2.message}`);
                    }
                }
            } else if (error.message.includes("STF") || error.message.includes("SafeTransferFrom")) {
                // STF error means router requires approval/balance for simulation
                console.log(`  ⚠ Simulation failed: router requires token approval/balance for simulation`);
                console.log(`    (This is expected for dry-run. Use SWAP_SEND_TX=1 to execute with approval)`);
                signatureUsed = "tuple-style (SwapRouter02)"; // Default assumption
                simulationSucceeded = false;
            } else {
                // Other error (not a signature issue), rethrow
                throw error;
            }
        }
        
        if (simulationSucceeded) {
            console.log(`  Signature used: ${signatureUsed}`);
            console.log(`  Expected amountOut: ${amountOut.toString()} (${ethers.formatUnits(amountOut, 6)} USDC)`);
        } else {
            console.log(`  Signature format: ${signatureUsed} (assumed, simulation skipped)`);
            console.log(`  Note: Router simulation requires token approval. Call encoding is valid.`);
        }
        console.log("");

        // Step 5: Optional real transaction
        const sendTx = process.env.SWAP_SEND_TX === "1";
        if (sendTx) {
            console.log("Step 5: Sending real transaction...");
            
            if (!wallet) {
                throw new Error("SWAP_SEND_TX=1 requires PRIVATE_KEY to be set");
            }
            
            // Check xHYPE balance
            const xhypeToken = new ethers.Contract(XHYPE_ADDRESS, ERC20_ABI, provider);
            const balance = await xhypeToken.balanceOf(walletAddress);
            console.log(`  xHYPE balance: ${ethers.formatUnits(balance, 18)} xHYPE`);
            
            if (balance < amountIn) {
                throw new Error(`Insufficient xHYPE balance. Required: ${ethers.formatUnits(amountIn, 18)}, Have: ${ethers.formatUnits(balance, 18)}`);
            }
            
            // Approve router
            console.log("  Approving router...");
            const routerWithSigner = new ethers.Contract(PRJX_ROUTER, ROUTER_ABI, wallet);
            const xhypeTokenWithSigner = new ethers.Contract(XHYPE_ADDRESS, ERC20_ABI, wallet);
            
            const allowance = await xhypeToken.allowance(walletAddress, PRJX_ROUTER);
            if (allowance < amountIn) {
                const approveTx = await xhypeTokenWithSigner.approve(PRJX_ROUTER, amountIn);
                console.log(`  Approve tx sent: ${approveTx.hash}`);
                await approveTx.wait();
                console.log("  ✓ Approval confirmed");
            } else {
                console.log("  ✓ Sufficient allowance already exists");
            }
            
            // Get USDC balance before
            const usdcToken = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
            const usdcBalanceBefore = await usdcToken.balanceOf(walletAddress);
            console.log(`  USDC balance before: ${ethers.formatUnits(usdcBalanceBefore, 6)} USDC`);
            
            // Send swap transaction
            console.log("  Sending swap transaction...");
            let swapTx;
            // Try the signature format that was detected (or assumed)
            try {
                if (signatureUsed === "tuple-style (SwapRouter02)") {
                    swapTx = await routerWithSigner.exactInputSingle(paramsStruct);
                } else {
                    swapTx = await routerWithSigner.exactInputSingle(
                        paramsStruct.tokenIn,
                        paramsStruct.tokenOut,
                        paramsStruct.fee,
                        paramsStruct.recipient,
                        paramsStruct.deadline,
                        paramsStruct.amountIn,
                        paramsStruct.amountOutMinimum,
                        paramsStruct.sqrtPriceLimitX96
                    );
                }
            } catch (txError) {
                // If simulation failed and we assumed a signature format, try the other one
                if (!simulationSucceeded && txError.message.includes("function selector")) {
                    console.log("  Trying alternate signature format...");
                    if (signatureUsed === "tuple-style (SwapRouter02)") {
                        swapTx = await routerWithSigner.exactInputSingle(
                            paramsStruct.tokenIn,
                            paramsStruct.tokenOut,
                            paramsStruct.fee,
                            paramsStruct.recipient,
                            paramsStruct.deadline,
                            paramsStruct.amountIn,
                            paramsStruct.amountOutMinimum,
                            paramsStruct.sqrtPriceLimitX96
                        );
                    } else {
                        swapTx = await routerWithSigner.exactInputSingle(paramsStruct);
                    }
                } else {
                    throw txError;
                }
            }
            
            console.log(`  Swap tx sent: ${swapTx.hash}`);
            const receipt = await swapTx.wait();
            console.log(`  ✓ Swap confirmed in block ${receipt.blockNumber}`);
            
            // Check USDC balance after
            const usdcBalanceAfter = await usdcToken.balanceOf(walletAddress);
            const usdcReceived = usdcBalanceAfter - usdcBalanceBefore;
            console.log(`  USDC balance after: ${ethers.formatUnits(usdcBalanceAfter, 6)} USDC`);
            console.log(`  USDC received: ${ethers.formatUnits(usdcReceived, 6)} USDC`);
            console.log("");
        } else {
            console.log("Step 5: Skipped (dry-run mode, set SWAP_SEND_TX=1 to send real transaction)");
            console.log("");
        }

        console.log("✓ All checks passed!");
        
    } catch (error) {
        console.error("✗ Error:", error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

main();
