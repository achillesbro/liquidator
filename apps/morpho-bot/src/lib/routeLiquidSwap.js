/**
 * LiquidSwap routing for collateral -> loan token swaps
 * Uses LiquidSwap API to get swap routes with pre-encoded calldata
 * API docs: https://docs.liqd.ag/liquidswap-integration/route-finding
 * 
 * IMPORTANT: LiquidSwap API expects human-readable amounts, NOT raw wei values.
 * Example: For 1000 WHYPE (18 decimals), pass amountIn=1000, not 1000000000000000000000
 */

const { retry } = require('./retry');

/**
 * Convert raw amount (wei) to human-readable string for LiquidSwap API
 * @param {bigint} rawAmount - Amount in smallest unit (wei)
 * @param {number} decimals - Token decimals
 * @returns {string} Human-readable amount string
 */
function formatAmountForApi(rawAmount, decimals) {
  if (!rawAmount || rawAmount === 0n) return '0';
  
  const str = rawAmount.toString().padStart(decimals + 1, '0');
  const intPart = str.slice(0, -decimals) || '0';
  const decPart = str.slice(-decimals);
  
  // Trim trailing zeros from decimal part but keep significant digits
  const trimmedDec = decPart.replace(/0+$/, '');
  
  if (trimmedDec.length === 0) {
    return intPart;
  }
  
  return `${intPart}.${trimmedDec}`;
}

/**
 * Parse human-readable amount string to BigInt (raw wei)
 * @param {string} amountStr - Amount like "7922.659256055699010854"
 * @param {number} decimals - Token decimals
 * @returns {bigint} Amount in raw units (wei)
 */
function parseAmountString(amountStr, decimals) {
  if (!amountStr) return 0n;
  
  // Handle scientific notation or pure numbers
  const str = String(amountStr);
  
  const [intPart, decPart = ''] = str.split('.');
  const paddedDec = decPart.padEnd(decimals, '0').slice(0, decimals);
  const fullStr = intPart + paddedDec;
  
  return BigInt(fullStr);
}

/**
 * Fetch swap route from LiquidSwap API
 * No rate limits per docs: https://docs.liqd.ag/liquidswap-integration/route-finding
 * 
 * @param {string} apiUrl - LiquidSwap API URL
 * @param {number} chainId - Chain ID
 * @param {string} tokenIn - Token to swap from (collateral)
 * @param {string} tokenOut - Token to swap to (loan token)
 * @param {bigint} amountInRaw - Amount to swap in raw units (wei)
 * @param {string} recipient - Recipient address (executor)
 * @param {number} tokenInDecimals - Decimals for input token (default 18)
 * @returns {Promise<Object|null>} Route object with execution calldata or null if no route
 */
async function fetchSwapRoute(apiUrl, chainId, tokenIn, tokenOut, amountInRaw, recipient, tokenInDecimals = 18) {
  // LiquidSwap API v2 endpoint
  const url = `${apiUrl}/v2/route`;
  
  // IMPORTANT: Convert raw wei amount to human-readable for API
  // API expects "1000" for 1000 tokens, not "1000000000000000000000"
  const amountInHuman = formatAmountForApi(amountInRaw, tokenInDecimals);
  
  const params = new URLSearchParams({
    chainId: chainId.toString(),
    tokenIn,
    tokenOut,
    amountIn: amountInHuman,
    recipient,
    slippage: '0.5', // 0.5% slippage
    multiHop: 'true', // Enable multi-hop routing
  });
  
  return retry(async () => {
    const response = await fetch(`${url}?${params}`);
    
    // Handle non-OK responses
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      if (response.status === 429) {
        throw new Error(`LiquidSwap API rate limited (429)`);
      }
      
      // Try to parse error body for 500 errors
      if (response.status === 500) {
        try {
          const errorData = await response.json();
          // "No viable pools" or "No viable paths" = no liquidity, not retryable
          if (errorData.message?.includes('No viable')) {
            return null;
          }
        } catch (e) {
          // Couldn't parse error, treat as generic 500
        }
      }
      
      throw new Error(`LiquidSwap API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate response structure
    if (!data || !data.success || !data.execution) {
      return null;
    }
    
    // Get token decimals from response
    const tokenOutDecimals = data.tokens?.tokenOut?.decimals || 18;
    const tokenInDecimalsFromApi = data.tokens?.tokenIn?.decimals || tokenInDecimals;
    
    // Extract amounts - prefer execution.details which has raw values
    const details = data.execution.details || {};
    let expectedOutRaw, minOutRaw;
    
    if (details.amountOut && details.minAmountOut) {
      // Use raw bigint values from details (these are already in wei)
      expectedOutRaw = BigInt(details.amountOut);
      minOutRaw = BigInt(details.minAmountOut);
    } else if (data.amountOut) {
      // Parse from human-readable string (e.g., "7922.659256055699010854")
      expectedOutRaw = parseAmountString(data.amountOut, tokenOutDecimals);
      // Apply slippage for minOut if not provided
      minOutRaw = expectedOutRaw - (expectedOutRaw * 50n / 10000n); // 0.5% slippage
    } else {
      return null;
    }
    
    return {
      execution: {
        to: data.execution.to,
        calldata: data.execution.calldata,
        value: data.execution.value || '0',
      },
      // Return raw wei values for internal use
      expectedOut: expectedOutRaw,
      minAmountOut: minOutRaw,
      // Price impact
      priceImpact: parseFloat(data.averagePriceImpact?.replace('%', '') || '0'),
      gas: data.estimatedGas || 200000,
      warnings: data.warnings || [],
      // Token info for debugging
      tokenIn: data.tokens?.tokenIn,
      tokenOut: data.tokens?.tokenOut,
      // Debug: include what we sent vs what API used
      debug: {
        amountInSent: amountInHuman,
        amountInFromApi: data.amountIn,
        amountOutFromApi: data.amountOut,
        detailsAmountIn: details.amountIn,
        detailsAmountOut: details.amountOut,
      },
    };
  }, {
    maxRetries: 2,
    delayMs: 300,
    description: 'fetch LiquidSwap route',
  });
}

/**
 * Get quote for swap (estimation without calldata)
 * @param {string} apiUrl - LiquidSwap API URL
 * @param {number} chainId - Chain ID
 * @param {string} tokenIn - Token to swap from
 * @param {string} tokenOut - Token to swap to
 * @param {bigint} amountInRaw - Amount to swap in raw units (wei)
 * @param {number} tokenInDecimals - Decimals for input token (default 18)
 * @returns {Promise<Object|null>} Quote object or null
 */
async function fetchSwapQuote(apiUrl, chainId, tokenIn, tokenOut, amountInRaw, tokenInDecimals = 18) {
  const url = `${apiUrl}/v2/quote`;
  
  // Convert to human-readable for API
  const amountInHuman = formatAmountForApi(amountInRaw, tokenInDecimals);
  
  const params = new URLSearchParams({
    chainId: chainId.toString(),
    tokenIn,
    tokenOut,
    amountIn: amountInHuman,
  });
  
  try {
    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    // Parse output amount
    const tokenOutDecimals = data.tokens?.tokenOut?.decimals || 18;
    const expectedOut = parseAmountString(data.amountOut || '0', tokenOutDecimals);
    
    return {
      expectedOut,
      priceImpact: parseFloat(data.priceImpact?.replace('%', '') || '0'),
    };
  } catch (error) {
    console.warn(`LiquidSwap quote error: ${error.message}`);
    return null;
  }
}

module.exports = {
  fetchSwapRoute,
  fetchSwapQuote,
  formatAmountForApi,
  parseAmountString,
};
