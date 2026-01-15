/**
 * Ponder indexer client for fetching market and position data
 */

const { retry } = require('./retry');

/**
 * Fetch markets for a list of vaults from Ponder withdraw-queue-set endpoint
 * @param {string} ponderUrl - Base URL for Ponder service
 * @param {number} chainId - Chain ID
 * @param {Array<string>} vaultAddresses - Array of vault addresses
 * @returns {Promise<Array<string>>} Array of market IDs (hex strings)
 */
async function fetchMarketsForVaults(ponderUrl, chainId, vaultAddresses) {
  const url = `${ponderUrl}/chain/${chainId}/withdraw-queue-set`;
  
  return retry(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ vaults: vaultAddresses }),
    });
    
    if (!response.ok) {
      throw new Error(`Ponder API error (withdraw-queue-set): ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Response should be an array of market IDs
    if (!Array.isArray(data)) {
      throw new Error('Invalid response from Ponder withdraw-queue-set: expected array of market IDs');
    }
    
    return data;
  }, {
    maxRetries: 3,
    delayMs: 1000,
    description: 'fetch markets from Ponder',
  });
}

/**
 * Fetch liquidatable positions for a list of markets from Ponder
 * @param {string} ponderUrl - Base URL for Ponder service
 * @param {number} chainId - Chain ID
 * @param {Array<string>} marketIds - Array of market IDs (hex strings)
 * @returns {Promise<Array>} Array of liquidatable position objects
 */
async function fetchLiquidatablePositions(ponderUrl, chainId, marketIds) {
  const url = `${ponderUrl}/chain/${chainId}/liquidatable-positions`;
  
  return retry(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ marketIds }),
    });
    
    if (!response.ok) {
      throw new Error(`Ponder API error (liquidatable-positions): ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate response structure
    if (!data || !Array.isArray(data.results)) {
      throw new Error('Invalid response from Ponder liquidatable-positions: expected { results: [], warnings: [] }');
    }
    
    // Log warnings if present
    if (data.warnings && data.warnings.length > 0) {
      console.warn('Ponder warnings:', data.warnings);
    }
    
    return data.results;
  }, {
    maxRetries: 3,
    delayMs: 1000,
    description: 'fetch liquidatable positions from Ponder',
  });
}

module.exports = {
  fetchMarketsForVaults,
  fetchLiquidatablePositions,
};
