/**
 * Project X Quoter integration for profit-to-HYPE swaps
 * Queries the best fee tier for loanToken → WHYPE swaps
 * 
 * Note: Project X uses QuoterV2 interface with struct params
 */

const { parseAbi, encodeFunctionData, decodeFunctionResult } = require('viem');

// Project X contract addresses on HyperEVM
const PRJX_QUOTER_ADDRESS = '0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258';
const PRJX_ROUTER_ADDRESS = '0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B';
const WHYPE_ADDRESS = '0x5555555555555555555555555555555555555555';

// Common fee tiers in Uniswap V3 style (basis points * 100)
const FEE_TIERS = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

// QuoterV2 ABI (Project X uses struct-based interface)
const QUOTER_V2_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);

// Multicall3 ABI
const MULTICALL3_ABI = parseAbi([
  'struct Call { address target; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function tryAggregate(bool requireSuccess, Call[] calls) returns (Result[] returnData)',
]);

/**
 * Quote profit swap from loanToken to WHYPE
 * Tries all fee tiers and returns the best one
 * 
 * @param {Object} publicClient - Viem public client
 * @param {string} loanToken - Token to swap from
 * @param {bigint} amountIn - Amount of loan token to swap
 * @param {Object} config - Config with addresses
 * @returns {Promise<Object|null>} Best quote or null if no route found
 */
async function quoteProfitToHype(publicClient, loanToken, amountIn, config) {
  // Skip if loanToken is WHYPE (no swap needed)
  const whypeAddress = config.whypeAddress || WHYPE_ADDRESS;
  if (loanToken.toLowerCase() === whypeAddress.toLowerCase()) {
    return {
      skipSwap: true,
      feeTier: 0,
      expectedOut: amountIn, // 1:1 for WHYPE
      minOut: amountIn,
      router: null,
    };
  }

  // Skip if amount is 0
  if (amountIn === 0n) {
    return null;
  }

  const quoterAddress = config.prjxQuoterAddress || PRJX_QUOTER_ADDRESS;
  const routerAddress = config.prjxRouterAddress || PRJX_ROUTER_ADDRESS;

  try {
    // Query each fee tier using simulateContract (QuoterV2 requires state simulation)
    const quotes = await Promise.all(
      FEE_TIERS.map(async (fee) => {
        try {
          const result = await publicClient.simulateContract({
            address: quoterAddress,
            abi: QUOTER_V2_ABI,
            functionName: 'quoteExactInputSingle',
            args: [{
              tokenIn: loanToken,
              tokenOut: whypeAddress,
              amountIn: amountIn,
              fee: fee,
              sqrtPriceLimitX96: 0n,
            }],
          });
          // QuoterV2 returns (amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate)
          return { fee, amountOut: result.result[0] };
        } catch (e) {
          return { fee, amountOut: 0n };
        }
      })
    );

    // Find best quote
    const best = quotes.reduce((a, b) => (b.amountOut > a.amountOut ? b : a));

    if (best.amountOut === 0n) {
      return null;
    }

    // Apply slippage to get minOut
    const slippageBps = config.profitSlippageBps || 100; // 1% default
    const minOut = best.amountOut - (best.amountOut * BigInt(slippageBps)) / 10000n;

    return {
      skipSwap: false,
      feeTier: best.fee,
      expectedOut: best.amountOut,
      minOut,
      router: routerAddress,
    };

  } catch (error) {
    console.warn(`[PRJX] Quote failed for ${loanToken} → WHYPE: ${error.message}`);
    return null;
  }
}

/**
 * Quote profit swap with fallback for when primary quote fails
 * Uses sequential queries instead of parallel
 * 
 * @param {Object} publicClient - Viem public client
 * @param {string} loanToken - Token to swap from
 * @param {bigint} amountIn - Amount of loan token to swap
 * @param {Object} config - Config with addresses
 * @returns {Promise<Object|null>} Best quote or null if no route found
 */
async function quoteProfitToHypeFallback(publicClient, loanToken, amountIn, config) {
  const whypeAddress = config.whypeAddress || WHYPE_ADDRESS;
  if (loanToken.toLowerCase() === whypeAddress.toLowerCase()) {
    return {
      skipSwap: true,
      feeTier: 0,
      expectedOut: amountIn,
      minOut: amountIn,
      router: null,
    };
  }

  if (amountIn === 0n) {
    return null;
  }

  const quoterAddress = config.prjxQuoterAddress || PRJX_QUOTER_ADDRESS;
  const routerAddress = config.prjxRouterAddress || PRJX_ROUTER_ADDRESS;

  // Try each fee tier sequentially
  let bestQuote = null;
  let bestOut = 0n;

  for (const fee of FEE_TIERS) {
    try {
      const result = await publicClient.simulateContract({
        address: quoterAddress,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn: loanToken,
          tokenOut: whypeAddress,
          amountIn: amountIn,
          fee: fee,
          sqrtPriceLimitX96: 0n,
        }],
      });
      const amountOut = result.result[0];
      if (amountOut > bestOut) {
        bestOut = amountOut;
        bestQuote = { fee, amountOut };
      }
    } catch (e) {
      // Pool doesn't exist or insufficient liquidity for this fee tier
    }
  }

  if (!bestQuote) {
    return null;
  }

  const slippageBps = config.profitSlippageBps || 100;
  const minOut = bestQuote.amountOut - (bestQuote.amountOut * BigInt(slippageBps)) / 10000n;

  return {
    skipSwap: false,
    feeTier: bestQuote.fee,
    expectedOut: bestQuote.amountOut,
    minOut,
    router: routerAddress,
  };
}

module.exports = {
  quoteProfitToHype,
  quoteProfitToHypeFallback,
  PRJX_QUOTER_ADDRESS,
  PRJX_ROUTER_ADDRESS,
  WHYPE_ADDRESS,
  FEE_TIERS,
};
