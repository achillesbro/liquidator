const { ethers } = require("ethers");

const QUOTER_ABI = [
    "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

/**
 * Quote exact input single swap via UniV3-compatible quoter (ProjectX or HyperSwap)
 * @param {string} quoterAddress - Quoter contract address
 * @param {string} tokenIn - Input token address
 * @param {string} tokenOut - Output token address
 * @param {number} fee - Fee tier (e.g. 100 for 0.01%)
 * @param {bigint} amountIn - Amount of input token to swap
 * @param {number} slippageBps - Slippage in basis points (e.g. 50 for 0.5%)
 * @returns {Promise<Object>} { amountOut: BigInt, minOut: BigInt }
 */
async function quoteExactInputSingle(quoterAddress, tokenIn, tokenOut, fee, amountIn, slippageBps = 50) {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.RPC);
    const quoter = new ethers.Contract(quoterAddress, QUOTER_ABI, provider);
    
    try {
        const amountOut = await quoter.quoteExactInputSingle.staticCall(
            tokenIn,
            tokenOut,
            fee,
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
        console.error(`Quoter error (${quoterAddress}):`, error.message);
        throw error;
    }
}

module.exports = {
    quoteExactInputSingle
};
