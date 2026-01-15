/**
 * Candidate discovery via Morpho Blue API (GraphQL)
 * Fetches markets and positions that may be liquidatable
 */

const { retry } = require('./retry');

/**
 * Fetch markets for whitelisted vaults from Morpho API
 * Simplified: just fetch all markets for the chain since vault allocation structure is complex
 * @param {string} apiUrl - Morpho API URL
 * @param {number} chainId - Chain ID
 * @param {Array<string>} vaultAddresses - Vault addresses (not used in simplified approach)
 * @returns {Promise<Array>} Market objects with id and metadata
 */
async function fetchMarketsForVaults(apiUrl, chainId, vaultAddresses) {
  const url = `${apiUrl}/graphql`;
  
  // Simplified: Fetch all markets for the chain
  // In practice, you could filter by vault allocations if needed
  const query = `
    query GetMarkets($chainId: Int!) {
      markets(
        where: { chainId_in: [$chainId] },
        first: 100
      ) {
        items {
          uniqueKey
          loanAsset {
            address
            symbol
            decimals
          }
          collateralAsset {
            address
            symbol
            decimals
          }
          lltv
          oracle {
            address
          }
          irmAddress
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
    
    if (!data || !data.data || !data.data.markets) {
      throw new Error('Invalid response from Morpho API');
    }
    
    const markets = data.data.markets.items || [];
    
    // Normalize to market format
    return markets
      .filter(m => m.loanAsset && m.collateralAsset) // Filter out invalid markets
      .map(m => ({
        id: m.uniqueKey,
        loanToken: m.loanAsset.address,
        collateralToken: m.collateralAsset.address,
        loanSymbol: m.loanAsset.symbol,
        collateralSymbol: m.collateralAsset.symbol,
        loanDecimals: m.loanAsset.decimals || 18,
        collateralDecimals: m.collateralAsset.decimals || 18,
        lltv: m.lltv,
        oracle: m.oracle?.address,
        irm: m.irmAddress,
      }));
  }, {
    maxRetries: 3,
    delayMs: 1000,
    description: 'fetch markets for vaults',
  });
}

/**
 * Fetch candidate positions from Morpho API
 * Positions with active borrows that might be liquidatable
 * @param {string} apiUrl - Morpho API URL
 * @param {number} chainId - Chain ID
 * @param {Array<string>} marketIds - Market unique keys
 * @param {number} maxCandidates - Maximum candidates to fetch
 * @returns {Promise<Array>} Candidate position objects
 */
async function fetchCandidatePositions(apiUrl, chainId, marketIds, maxCandidates = 200) {
  const url = `${apiUrl}/graphql`;
  
  // Query for market positions with borrows
  // We fetch positions ordered by borrow amount
  const query = `
    query GetPositions($chainId: Int!, $marketIds: [String!]!, $first: Int!) {
      marketPositions(
        where: {
          chainId_in: [$chainId],
          marketUniqueKey_in: $marketIds,
          borrowShares_gte: "1"
        },
        first: $first
      ) {
        items {
          user {
            address
          }
          market {
            uniqueKey
            loanAsset {
              address
              symbol
              decimals
            }
            collateralAsset {
              address
              symbol
              decimals
            }
            lltv
            oracle {
              address
            }
            irmAddress
          }
          supplyShares
          borrowShares
          collateral
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
        variables: {
          chainId,
          marketIds,
          first: Math.min(maxCandidates, 500), // API limit
        },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Morpho API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data || !data.data || !data.data.marketPositions) {
      throw new Error('Invalid response from Morpho API');
    }
    
    const positions = data.data.marketPositions.items || [];
    
    // Normalize to candidate format
    return positions.map(pos => ({
      marketId: pos.market.uniqueKey,
      user: pos.user.address,
      loanToken: pos.market.loanAsset?.address,
      collateralToken: pos.market.collateralAsset?.address,
      loanSymbol: pos.market.loanAsset?.symbol,
      collateralSymbol: pos.market.collateralAsset?.symbol,
      loanDecimals: pos.market.loanAsset?.decimals || 18,
      collateralDecimals: pos.market.collateralAsset?.decimals || 18,
      lltv: pos.market.lltv,
      oracle: pos.market.oracle?.address,
      irm: pos.market.irmAddress,
      supplyShares: pos.supplyShares,
      borrowShares: pos.borrowShares,
      collateral: pos.collateral,
    }));
  }, {
    maxRetries: 3,
    delayMs: 1000,
    description: 'fetch candidate positions',
  });
}

module.exports = {
  fetchMarketsForVaults,
  fetchCandidatePositions,
};
