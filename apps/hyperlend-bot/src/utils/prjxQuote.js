// TODO: UNUSED - Quoter dependency removed for safety
// Bot now computes minOut based on repayAmount + MIN_PROFIT_USDC
// This file kept for reference but is not imported by index.js

const { ethers } = require("ethers");

const PRJX_QUOTER = '0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258';
const PRJX_FEE = 100; // 0.01%

const QUOTER_ABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

/**
 * Quote xHYPE → USDC swap via ProjectX Quoter
 * @deprecated UNUSED - Bot no longer uses quoter. Kept for reference only.
 * @param {string} xHypeAddress - xHYPE token address
 * @param {string} usdcAddress - USDC token address
 * @param {BigInt} amountIn - Amount of xHYPE to swap (in wei)
 * @param {number} slippageBps - Slippage in basis points (e.g. 50 for 0.5%)
 * @returns {Object} { amountOut: BigInt, minOut: BigInt }
 */
async function quoteSwap(xHypeAddress, usdcAddress, amountIn, slippageBps = 50) {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.RPC);
    const quoter = new ethers.Contract(PRJX_QUOTER, QUOTER_ABI, provider);
    
    try {
        const amountOut = await quoter.quoteExactInputSingle.staticCall(
            xHypeAddress,
            usdcAddress,
            PRJX_FEE,
            amountIn,
            0 // sqrtPriceLimitX96 = 0 means no limit
        );
        
        // Apply slippage: minOut = amountOut * (10000 - slippageBps) / 10000
        const minOut = (amountOut * BigInt(10000 - slippageBps)) / BigInt(10000);
        
        return {
            amountOut: amountOut,
            minOut: minOut
        };
    } catch (error) {
        console.error("Quoter error:", error.message);
        throw error;
    }
}

/**
 * Get spot price of xHYPE in USDC using ProjectX Quoter
 * @param {string} xHypeAddress - xHYPE token address
 * @param {string} usdcAddress - USDC token address
 * @returns {Promise<Object>} Spot price and amount out
 */
async function getSpotPriceXHypeInUsdc(xHypeAddress, usdcAddress) {
    const { ethers } = require("ethers");
    
    const QUOTER_ADDRESS = '0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258';
    const POOL_FEE = 100; // 0.01%
    
    const QUOTER_ABI = [
        "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
    ];
    
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.RPC);
    const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);
    
    // Quote 1 xHYPE (18 decimals) = 1e18
    const amountIn = ethers.parseUnits("1", 18);
    
    try {
        const amountOut = await quoter.quoteExactInputSingle.staticCall(
            xHypeAddress,
            usdcAddress,
            POOL_FEE,
            amountIn,
            0 // sqrtPriceLimitX96 = 0 means no limit
        );
        
        // Convert amountOut (USDC, 6 decimals) to floating point
        const amountOutFloat = Number(ethers.formatUnits(amountOut, 6));
        const spotPrice = amountOutFloat; // 1 xHYPE = amountOutFloat USDC
        
        return {
            spotPrice: spotPrice,
            amountOut: amountOut
        };
    } catch (error) {
        throw new Error(`Failed to get spot price: ${error.message}`);
    }
}

module.exports = {
    quoteSwap,
    getSpotPriceXHypeInUsdc
};
