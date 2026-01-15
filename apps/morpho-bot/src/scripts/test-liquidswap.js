/**
 * Test script to debug LiquidSwap API calls
 * 
 * Usage: node src/scripts/test-liquidswap.js
 */

const { getConfig } = require('../lib/env');

// Known working pairs on HyperEVM
const TEST_PAIRS = [
  {
    name: 'WHYPE -> USDC',
    tokenIn: '0x5555555555555555555555555555555555555555', // WHYPE
    tokenOut: '0xbB5270FB5bA0F769e2484c83818c20d6b6528393', // USDC (check address)
    amountIn: '1000000000000000000', // 1 WHYPE
  },
  {
    name: 'sUSDe -> USDe',
    tokenIn: '0x4989B5e5F2B78c6a1D4e83f3b7b1b1b9b9b9b9b9', // sUSDe (placeholder)
    tokenOut: '0x4989B5e5F2B78c6a1D4e83f3b7b1b1b9b9b9b9b9', // USDe (placeholder)
    amountIn: '1000000000000000000',
  },
];

async function testRoute(apiUrl, chainId, tokenIn, tokenOut, amountIn, recipient, name) {
  const url = `${apiUrl}/v2/route`;
  
  const params = new URLSearchParams({
    chainId: chainId.toString(),
    tokenIn,
    tokenOut,
    amountIn,
    recipient,
    slippage: '0.5', // 0.5% slippage (percentage, not basis points)
    multiHop: 'true', // Enable multi-hop routing
  });
  
  const fullUrl = `${url}?${params}`;
  
  console.log(`\n--- ${name} ---`);
  console.log(`URL: ${fullUrl}`);
  
  try {
    const response = await fetch(fullUrl);
    
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}`);
    
    const text = await response.text();
    console.log(`Body: ${text.slice(0, 500)}${text.length > 500 ? '...' : ''}`);
    
    if (response.ok) {
      try {
        const data = JSON.parse(text);
        console.log(`\nParsed response:`);
        console.log(`  execution.to: ${data.execution?.to}`);
        console.log(`  expectedAmountOut: ${data.expectedAmountOut}`);
        console.log(`  minAmountOut: ${data.minAmountOut}`);
      } catch (e) {
        console.log(`Failed to parse JSON: ${e.message}`);
      }
    }
    
    return response.ok;
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('LIQUIDSWAP API DEBUG');
  console.log('='.repeat(70));
  
  const config = getConfig();
  
  console.log(`\nAPI URL: ${config.liquidSwapApiUrl}`);
  console.log(`Chain ID: ${config.chainId}`);
  console.log(`Recipient: ${config.executorAddress || config.treasuryAddress}`);
  
  const recipient = config.executorAddress || config.treasuryAddress;
  
  // First, let's fetch real market data to get actual token addresses
  console.log('\n--- Fetching real market data ---');
  
  const { fetchWhitelistedVaults } = require('../lib/morphoApi');
  const { fetchMarketsForVaults } = require('../lib/candidateSource');
  
  const vaults = await fetchWhitelistedVaults(config.morphoApiUrl, config.chainId);
  const markets = await fetchMarketsForVaults(config.morphoApiUrl, config.chainId, vaults.slice(0, 5).map(v => v.address));
  
  console.log(`Found ${markets.length} markets`);
  
  // Test a few real pairs
  const testPairs = markets.slice(0, 5).map(m => ({
    name: `${m.collateralSymbol} -> ${m.loanSymbol}`,
    tokenIn: m.collateralToken,
    tokenOut: m.loanToken,
    amountIn: '1000000000000000000', // 1 token
  }));
  
  console.log('\n--- Testing real market pairs ---');
  
  for (const pair of testPairs) {
    await testRoute(
      config.liquidSwapApiUrl,
      config.chainId,
      pair.tokenIn,
      pair.tokenOut,
      pair.amountIn,
      recipient,
      pair.name
    );
    
    // Small delay
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Also test with smaller amounts (in case amount is the issue)
  console.log('\n--- Testing with smaller amounts ---');
  
  const smallPair = testPairs[0];
  if (smallPair) {
    await testRoute(
      config.liquidSwapApiUrl,
      config.chainId,
      smallPair.tokenIn,
      smallPair.tokenOut,
      '1000000', // Very small amount
      recipient,
      `${smallPair.name} (small amount)`
    );
  }
  
  // Test what the bot was trying - sUSDe -> USDe from the logs
  console.log('\n--- Testing pairs from error logs ---');
  
  // Find sUSDe and USDe markets
  const susdeMarket = markets.find(m => m.collateralSymbol === 'sUSDe');
  const usdeMarket = markets.find(m => m.loanSymbol === 'USDe');
  
  if (susdeMarket && usdeMarket) {
    console.log(`\nFound sUSDe: ${susdeMarket.collateralToken}`);
    console.log(`Found USDe: ${usdeMarket.loanToken || 'not found'}`);
    
    // Find a market with sUSDe collateral and USDe loan
    const susdeUsdeMarket = markets.find(m => m.collateralSymbol === 'sUSDe' && m.loanSymbol === 'USDe');
    if (susdeUsdeMarket) {
      await testRoute(
        config.liquidSwapApiUrl,
        config.chainId,
        susdeUsdeMarket.collateralToken,
        susdeUsdeMarket.loanToken,
        '1000000000000000000',
        recipient,
        'sUSDe -> USDe (real addresses)'
      );
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('DEBUG COMPLETE');
  console.log('='.repeat(70));
}

main().catch(console.error);
