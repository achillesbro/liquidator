/**
 * SDK-based confirmation of liquidatable positions
 * Uses Morpho Blue SDK for proper liquidation math
 * Uses Multicall3 for efficient batched RPC calls
 */

const { createPublicClient, http, parseAbi, encodeFunctionData, decodeFunctionResult } = require('viem');
const { Market, MarketConfig, AccrualPosition, MarketUtils, MathLib } = require('@morpho-org/blue-sdk');

/**
 * Format BigInt for display
 */
function formatBigInt(value, decimals = 18, precision = 4) {
  const str = value.toString();
  if (str.length <= decimals) {
    return '0.' + '0'.repeat(decimals - str.length) + str.slice(0, precision);
  }
  const intPart = str.slice(0, str.length - decimals);
  const decPart = str.slice(str.length - decimals, str.length - decimals + precision);
  return `${intPart}.${decPart}`;
}

// Morpho Blue ABI - essential functions for liquidation
const MORPHO_BLUE_ABI = parseAbi([
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
  'function accrueInterest((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)',
]);

// Oracle ABI for price fetching
const ORACLE_ABI = parseAbi([
  'function price() view returns (uint256)',
]);

// Multicall3 ABI
const MULTICALL3_ABI = parseAbi([
  'struct Call { address target; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate(Call[] calls) returns (uint256 blockNumber, bytes[] returnData)',
  'function tryAggregate(bool requireSuccess, Call[] calls) returns (Result[] returnData)',
]);

/**
 * Create viem public client for HyperEVM
 * @param {string} rpcUrl - RPC URL
 * @returns {Object} Viem public client
 */
function createClient(rpcUrl) {
  return createPublicClient({
    transport: http(rpcUrl),
  });
}

/**
 * Batch fetch multiple positions using Multicall3
 * @param {Object} client - Viem client
 * @param {string} multicallAddress - Multicall3 address
 * @param {string} morphoBlueAddress - Morpho Blue address
 * @param {Array} candidates - Array of candidates
 * @returns {Promise<Array>} Array of position data
 */
async function batchFetchPositions(client, multicallAddress, morphoBlueAddress, candidates) {
  // Build multicall for each candidate: marketParams, market, position, oracle price
  const calls = [];
  
  for (const candidate of candidates) {
    const marketId = candidate.marketId;
    
    // Call 1: idToMarketParams
    calls.push({
      target: morphoBlueAddress,
      callData: encodeFunctionData({
        abi: MORPHO_BLUE_ABI,
        functionName: 'idToMarketParams',
        args: [marketId],
      }),
    });
    
    // Call 2: market
    calls.push({
      target: morphoBlueAddress,
      callData: encodeFunctionData({
        abi: MORPHO_BLUE_ABI,
        functionName: 'market',
        args: [marketId],
      }),
    });
    
    // Call 3: position
    calls.push({
      target: morphoBlueAddress,
      callData: encodeFunctionData({
        abi: MORPHO_BLUE_ABI,
        functionName: 'position',
        args: [marketId, candidate.user],
      }),
    });
  }
  
  // Execute multicall (without oracle prices first)
  const results = await client.readContract({
    address: multicallAddress,
    abi: MULTICALL3_ABI,
    functionName: 'tryAggregate',
    args: [false, calls], // Don't revert on failure
  });
  
  // Parse results and fetch oracle prices (in batch)
  const positionData = [];
  const oracleCalls = [];
  
  for (let i = 0; i < candidates.length; i++) {
    const offset = i * 3;
    const marketParamsResult = results[offset];
    const marketResult = results[offset + 1];
    const positionResult = results[offset + 2];
    
    if (!marketParamsResult.success || !marketResult.success || !positionResult.success) {
      positionData.push(null);
      continue;
    }
    
    try {
      const marketParams = decodeFunctionResult({
        abi: MORPHO_BLUE_ABI,
        functionName: 'idToMarketParams',
        data: marketParamsResult.returnData,
      });
      
      const market = decodeFunctionResult({
        abi: MORPHO_BLUE_ABI,
        functionName: 'market',
        data: marketResult.returnData,
      });
      
      const position = decodeFunctionResult({
        abi: MORPHO_BLUE_ABI,
        functionName: 'position',
        data: positionResult.returnData,
      });
      
      positionData.push({
        marketParams,
        market,
        position,
        candidate: candidates[i],
      });
      
      // Add oracle call
      oracleCalls.push({
        target: marketParams[2], // oracle address
        callData: encodeFunctionData({
          abi: ORACLE_ABI,
          functionName: 'price',
        }),
      });
    } catch (e) {
      positionData.push(null);
    }
  }
  
  // Fetch all oracle prices in one multicall
  if (oracleCalls.length > 0) {
    const oracleResults = await client.readContract({
      address: multicallAddress,
      abi: MULTICALL3_ABI,
      functionName: 'tryAggregate',
      args: [false, oracleCalls],
    });
    
    // Add oracle prices to position data
    let oracleIdx = 0;
    for (let i = 0; i < positionData.length; i++) {
      if (positionData[i]) {
        const oracleResult = oracleResults[oracleIdx++];
        if (oracleResult.success) {
          try {
            const price = decodeFunctionResult({
              abi: ORACLE_ABI,
              functionName: 'price',
              data: oracleResult.returnData,
            });
            positionData[i].oraclePrice = price;
          } catch (e) {
            positionData[i] = null;
          }
        } else {
          positionData[i] = null;
        }
      }
    }
  }
  
  return positionData;
}

/**
 * Confirm if a position is liquidatable onchain
 * @param {Object} client - Viem public client
 * @param {string} morphoBlueAddress - Morpho Blue contract address
 * @param {Object} candidate - Candidate position from API
 * @param {Object} config - Configuration with test mode settings
 * @returns {Promise<Object|null>} Confirmed liquidation details or null if not liquidatable
 */
async function confirmLiquidatable(client, morphoBlueAddress, candidate, config = {}) {
  try {
    const marketId = candidate.marketId;
    
    // Fetch market params and state
    const [marketParams, marketState, position] = await Promise.all([
      client.readContract({
        address: morphoBlueAddress,
        abi: MORPHO_BLUE_ABI,
        functionName: 'idToMarketParams',
        args: [marketId],
      }),
      client.readContract({
        address: morphoBlueAddress,
        abi: MORPHO_BLUE_ABI,
        functionName: 'market',
        args: [marketId],
      }),
      client.readContract({
        address: morphoBlueAddress,
        abi: MORPHO_BLUE_ABI,
        functionName: 'position',
        args: [marketId, candidate.user],
      }),
    ]);
    
    const [loanToken, collateralToken, oracle, irm, lltv] = marketParams;
    const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] = marketState;
    const [supplyShares, borrowShares, collateral] = position;
    
    // Check if position has debt
    if (borrowShares === 0n) {
      // Position was closed or has no debt
      return null;
    }
    
    // Fetch oracle price
    let oraclePrice;
    try {
      oraclePrice = await client.readContract({
        address: oracle,
        abi: ORACLE_ABI,
        functionName: 'price',
      });
      
      if (!oraclePrice || oraclePrice === 0n) {
        console.warn(`  ⚠ Zero oracle price for ${candidate.loanSymbol}/${candidate.collateralSymbol}`);
        return null;
      }
    } catch (e) {
      console.warn(`  ⚠ Oracle error for ${candidate.loanSymbol}/${candidate.collateralSymbol}: ${e.shortMessage || e.message}`);
      return null;
    }
    
    // Calculate borrow assets from shares
    // borrowAssets = borrowShares * totalBorrowAssets / totalBorrowShares
    const borrowAssets = totalBorrowShares > 0n
      ? (borrowShares * totalBorrowAssets) / totalBorrowShares
      : 0n;
    
    // Oracle price format in Morpho Blue:
    // price = collateralAsset / loanAsset in fixed point with 36 decimals
    // maxBorrow = collateral * price * lltv / 10^36 / 10^18
    // Simplified: maxBorrow = collateral * price * lltv / 10^54
    const ORACLE_PRICE_SCALE = 10n ** 36n;
    const collateralValue = (collateral * oraclePrice) / ORACLE_PRICE_SCALE; // In loan token units
    
    // Apply test mode if enabled (artificially lower LLTV to find at-risk positions)
    let effectiveLltv = lltv;
    if (config.testMode && config.testLltvMultiplier) {
      const multiplierBigInt = BigInt(Math.floor(config.testLltvMultiplier * 1e18));
      effectiveLltv = (lltv * multiplierBigInt) / (10n ** 18n);
    }
    
    const maxBorrow = (collateralValue * effectiveLltv) / (10n ** 18n); // Apply LLTV
    
    // Check if position is underwater (borrowed > maxBorrow)
    const isLiquidatable = borrowAssets > maxBorrow;
    
    // Debug logging for test mode
    if (config.testMode && isLiquidatable) {
      console.log(`\n  🔍 At-risk position found (TEST MODE):`);
      console.log(`    Market: ${candidate.loanSymbol}/${candidate.collateralSymbol}`);
      console.log(`    User: ${candidate.user}`);
      console.log(`    Borrow: ${borrowAssets} (${formatBigInt(borrowAssets, 18, 4)} ${candidate.loanSymbol})`);
      console.log(`    Max allowed: ${maxBorrow} (${formatBigInt(maxBorrow, 18, 4)})`);
      console.log(`    Health factor: ${borrowAssets > 0n ? Number((maxBorrow * 10000n) / borrowAssets) / 100 : 'N/A'}%`);
      console.log(`    Effective LLTV: ${effectiveLltv} (test: ${config.testLltvMultiplier * 100}% of ${lltv})\n`);
    }
    
    if (!isLiquidatable) {
      return null;
    }
    
    // Calculate liquidation amounts
    // Morpho Blue allows liquidating up to the amount that brings position back to healthy
    // For simplicity, we calculate max seizable collateral and corresponding repay
    
    // Close factor: typically can liquidate up to 100% if severely underwater
    // For this implementation, we'll use a conservative 50% or full if needed
    const excessDebt = borrowAssets - maxBorrow;
    const liquidationIncentive = 10n ** 17n; // 10% incentive (0.1 in 18 decimals)
    
    // Repay amount: min(borrowAssets, excessDebt * 2) to be conservative
    const repayShares = borrowShares / 2n; // Liquidate up to 50%
    const repayAssets = (repayShares * totalBorrowAssets) / totalBorrowShares;
    
    // Seizable collateral = repayAssets * (1 + incentive) / price
    // To convert loan tokens to collateral: collateral = loanTokens * ORACLE_PRICE_SCALE / oraclePrice
    const repayValue = repayAssets;
    const seizeValue = repayValue + (repayValue * liquidationIncentive) / (10n ** 18n);
    const seizeAssets = (seizeValue * ORACLE_PRICE_SCALE) / oraclePrice;
    
    // Cap seize amount to available collateral
    let finalSeizeAssets = seizeAssets > collateral ? collateral : seizeAssets;
    
    // Apply seize buffer to avoid rounding/timing issues
    // seizeBufferBps is passed via config (default 5 bps = 0.05%)
    const seizeBufferBps = config?.seizeBufferBps || 5;
    if (seizeBufferBps > 0) {
      finalSeizeAssets = finalSeizeAssets - (finalSeizeAssets * BigInt(seizeBufferBps)) / 10000n;
    }
    
    return {
      marketId,
      marketParams: {
        loanToken,
        collateralToken,
        oracle,
        irm,
        lltv,
      },
      user: candidate.user,
      borrowShares,
      borrowAssets,
      collateral,
      oraclePrice,
      maxBorrow,
      isLiquidatable: true,
      repayShares,
      repayAssets,
      seizeAssets: finalSeizeAssets,
      loanSymbol: candidate.loanSymbol,
      collateralSymbol: candidate.collateralSymbol,
      loanDecimals: candidate.loanDecimals,
      collateralDecimals: candidate.collateralDecimals,
    };
    
  } catch (error) {
    console.warn(`Error confirming position for ${candidate.user}: ${error.message}`);
    return null;
  }
}

/**
 * Batch confirm multiple candidates using Multicall3 for efficiency
 * @param {string} rpcUrl - RPC URL
 * @param {string} morphoBlueAddress - Morpho Blue address
 * @param {Array} candidates - Array of candidate positions
 * @param {number} maxToConfirm - Maximum positions to confirm
 * @param {Object} config - Configuration object
 * @returns {Promise<Array>} Array of confirmed liquidatable positions
 */
async function batchConfirm(rpcUrl, morphoBlueAddress, candidates, maxToConfirm = 100, config = {}) {
  const client = createClient(rpcUrl);
  const confirmed = [];
  
  const toConfirm = candidates.slice(0, maxToConfirm);
  
  if (config.testMode) {
    console.log(`\n🧪 TEST MODE: Using ${config.testLltvMultiplier * 100}% of actual LLTV to find at-risk positions`);
  }
  console.log(`\nChecking ${toConfirm.length} candidates onchain (with Multicall3)...`);
  
  let checked = 0;
  let healthy = 0;
  let rpcErrors = 0;
  const startTime = Date.now();
  
  // Process in batches using Multicall3
  const batchSize = 50; // Larger batches with multicall
  for (let i = 0; i < toConfirm.length; i += batchSize) {
    const batch = toConfirm.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(toConfirm.length / batchSize);
    
    console.log(`  Batch ${batchNum}/${totalBatches} (${batch.length} positions)...`);
    
    try {
      // Fetch all position data in one multicall
      const positionDataArray = await batchFetchPositions(
        client,
        config.multicall3Address,
        morphoBlueAddress,
        batch
      );
      
      // Process results
      for (let j = 0; j < batch.length; j++) {
        const posData = positionDataArray[j];
        const candidate = batch[j];
        checked++;
        
        if (!posData || !posData.oraclePrice) {
          healthy++;
          continue;
        }
        
        // Check if liquidatable using Morpho SDK classes (like production bot)
        const [loanToken, collateralToken, oracle, irm, lltv] = posData.marketParams;
        const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] = posData.market;
        const [supplyShares, borrowShares, collateral] = posData.position;
        const oraclePrice = posData.oraclePrice;
        
        if (borrowShares === 0n) {
          healthy++;
          continue;
        }
        
        // Apply test mode if enabled (artificially lower LLTV)
        let effectiveLltv = lltv;
        if (config.testMode && config.testLltvMultiplier) {
          effectiveLltv = MathLib.wMulDown(lltv, BigInt(Math.floor(config.testLltvMultiplier * 1e18)));
        }
        
        // Create MarketConfig (like production bot)
        const marketConfig = new MarketConfig({
          loanToken,
          collateralToken,
          oracle,
          irm,
          lltv: effectiveLltv,
        });
        
        // Create Market and accrue interest to current timestamp (like production bot)
        const now = BigInt(Math.floor(Date.now() / 1000));
        const market = new Market({
          config: marketConfig,
          totalSupplyAssets,
          totalSupplyShares,
          totalBorrowAssets,
          totalBorrowShares,
          lastUpdate,
          fee,
          price: oraclePrice,
        }).accrueInterest(now);
        
        // Create AccrualPosition and check seizableCollateral (canonical liquidatability check)
        const accrualPosition = new AccrualPosition({
          supplyShares,
          borrowShares,
          collateral,
        }, market);
        
        const seizableCollateral = accrualPosition.seizableCollateral ?? 0n;
        const isLiquidatable = seizableCollateral > 0n;
        
        if (config.testMode && isLiquidatable) {
          const borrowAssets = totalBorrowShares > 0n
            ? (borrowShares * totalBorrowAssets) / totalBorrowShares
            : 0n;
          const collateralValue = MarketUtils.getCollateralValue(collateral, { price: oraclePrice });
          const maxBorrow = MarketUtils.getCollateralPower(collateralValue, { lltv: effectiveLltv });
          
          console.log(`\n  🔍 At-risk position found (TEST MODE):`);
          console.log(`    Market: ${candidate.loanSymbol}/${candidate.collateralSymbol}`);
          console.log(`    User: ${candidate.user}`);
          console.log(`    Borrow: ${borrowAssets} (${formatBigInt(borrowAssets, 18, 4)} ${candidate.loanSymbol})`);
          console.log(`    Max allowed: ${maxBorrow} (${formatBigInt(maxBorrow, 18, 4)})`);
          console.log(`    Seizable collateral: ${seizableCollateral} (${formatBigInt(seizableCollateral, candidate.collateralDecimals, 4)} ${candidate.collateralSymbol})`);
          console.log(`    Health factor: ${borrowAssets > 0n ? Number((maxBorrow * 10000n) / borrowAssets) / 100 : 'N/A'}%`);
          console.log(`    Effective LLTV: ${effectiveLltv} (test: ${config.testLltvMultiplier * 100}% of ${lltv})\n`);
        }
        
        if (isLiquidatable) {
          // Calculate liquidation amounts
          // Liquidate up to 50% of the position
          const repayShares = borrowShares / 2n;
          const repayAssets = totalBorrowShares > 0n
            ? (repayShares * totalBorrowAssets) / totalBorrowShares
            : 0n;
          
          // Calculate seizeAssets from repayAssets (must be consistent!)
          // seizeAssets = repayAssets * (1 + liquidationIncentive) * ORACLE_PRICE_SCALE / oraclePrice
          // liquidationIncentive = 1 / LLTV - 1 (standard Morpho formula)
          const ORACLE_PRICE_SCALE = 10n ** 36n;
          const WAD = 10n ** 18n;
          const liquidationIncentiveFactor = WAD + MathLib.wDivDown(WAD - lltv, lltv); // 1 + (1-lltv)/lltv = 1/lltv
          const seizeValue = MathLib.wMulDown(repayAssets, liquidationIncentiveFactor);
          let calculatedSeizeAssets = (seizeValue * ORACLE_PRICE_SCALE) / oraclePrice;
          
          // Cap to available collateral and seizableCollateral
          let finalSeizeAssets = MathLib.min(calculatedSeizeAssets, MathLib.min(seizableCollateral, collateral));
          
          // Apply seize buffer to avoid rounding/timing issues
          // seizeBufferBps is passed via config (default 5 bps = 0.05%)
          const seizeBufferBps = config?.seizeBufferBps || 5;
          if (seizeBufferBps > 0 && finalSeizeAssets > 0n) {
            finalSeizeAssets = finalSeizeAssets - (finalSeizeAssets * BigInt(seizeBufferBps)) / 10000n;
          }
          
          confirmed.push({
            marketId: candidate.marketId,
            marketParams: { loanToken, collateralToken, oracle, irm, lltv },
            user: candidate.user,
            borrowShares,
            borrowAssets: totalBorrowShares > 0n
              ? (borrowShares * totalBorrowAssets) / totalBorrowShares
              : 0n,
            collateral,
            oraclePrice,
            maxBorrow: MarketUtils.getCollateralPower(
              MarketUtils.getCollateralValue(collateral, { price: oraclePrice }),
              { lltv: effectiveLltv }
            ),
            isLiquidatable: true,
            repayShares,
            repayAssets,
            seizeAssets: finalSeizeAssets,
            loanSymbol: candidate.loanSymbol,
            collateralSymbol: candidate.collateralSymbol,
            loanDecimals: candidate.loanDecimals,
            collateralDecimals: candidate.collateralDecimals,
          });
          
          if (!config.testMode) {
            console.log(`    ✓ Liquidatable: ${candidate.user} ${candidate.loanSymbol}/${candidate.collateralSymbol}`);
          }
        } else {
          healthy++;
        }
      }
    } catch (error) {
      rpcErrors += batch.length;
      console.warn(`    ✗ Batch error: ${error.shortMessage || error.message}`);
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log(`\n${config.testMode ? '🧪 Test mode' : ''} Confirmation summary:`);
  console.log(`  Checked: ${checked}/${toConfirm.length} in ${elapsed}s (${(checked / parseFloat(elapsed)).toFixed(1)} pos/s)`);
  console.log(`  ${config.testMode ? 'At-risk' : 'Liquidatable'}: ${confirmed.length}`);
  console.log(`  Healthy: ${healthy}`);
  console.log(`  Errors: ${rpcErrors}`);
  
  return confirmed;
}

module.exports = {
  createClient,
  confirmLiquidatable,
  batchConfirm,
};
