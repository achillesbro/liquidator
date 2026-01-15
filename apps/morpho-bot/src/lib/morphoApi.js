/**
 * Morpho API client for fetching whitelisted vaults
 */

const { retry } = require('./retry');

/**
 * Fetch whitelisted MetaMorpho vaults from Morpho API (GraphQL)
 * @param {string} apiUrl - Base URL for Morpho API
 * @param {number} chainId - Chain ID to filter by
 * @returns {Promise<Array>} Array of vault objects
 */
async function fetchWhitelistedVaults(apiUrl, chainId) {
  const url = `${apiUrl}/graphql`;
  
  // GraphQL query for vaults filtered by chainId and listed=true
  const query = `
    query GetVaults($chainId: Int!) {
      vaults(where: { chainId_in: [$chainId], listed: true }) {
        items {
          address
          name
          symbol
        }
      }
    }
  `;
  
  return retry(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { chainId },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Morpho API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate response structure
    if (!data || !data.data || !data.data.vaults || !Array.isArray(data.data.vaults.items)) {
      throw new Error('Invalid response from Morpho API: expected { data: { vaults: { items: [] } } }');
    }
    
    return data.data.vaults.items;
  }, {
    maxRetries: 3,
    delayMs: 1000,
    description: 'fetch whitelisted vaults',
  });
}

module.exports = { fetchWhitelistedVaults };
