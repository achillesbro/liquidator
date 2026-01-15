/**
 * Morpho Blue Liquidation Bot - Milestone 4
 * 
 * Candidate discovery via Morpho API, real-time confirmation using SDK,
 * swap routing via LiquidSwap, simulation + execution via Executor contract.
 * 
 * Supports two execution modes:
 * - prefund: Uses pre-funded executor (Milestone 3)
 * - flashloan: Uses Morpho flashloan for atomic execution (Milestone 4)
 */

const { formatUnits } = require('viem');
const { getConfig, getActiveExecutorAddress } = require('./lib/env');
const { fetchWhitelistedVaults } = require('./lib/morphoApi');
const { fetchMarketsForVaults, fetchCandidatePositions } = require('./lib/candidateSource');
const { createClient, batchConfirm } = require('./lib/sdkConfirm');
const { fetchSwapRoute } = require('./lib/routeLiquidSwap');
const { 
  buildLiquidationPlan, 
  buildCallsForExecutor, 
  buildCallsForFlashloan,
  buildExecutionPlan,
  checkExecutorBalance 
} = require('./lib/encodePlan');
const { batchSimulate, isProfitable } = require('./lib/simulate');
const {
  createExecutionClients,
  verifyExecutorOwnership,
  verifyFlashloanExecutor,
  simulateExecutorCall,
  simulateFlashloanCall,
  dispatchSimulation,
  executeViaExecutor,
  executeViaFlashloan,
  dispatchExecution,
  calculateActualProfit,
  formatExecutionResult,
} = require('./lib/execute');
const {
  isBotPaused,
  checkCooldown,
  addToCooldown,
  clearCooldown,
  checkRepayCap,
  checkSlippage,
  sendTelegramNotification,
  formatSuccessNotification,
  formatFailureNotification,
  RunStats,
} = require('./lib/operations');

/**
 * Format bigint for display
 */
function formatAmount(amount, decimals = 18) {
  if (!amount) return '0';
  const str = amount.toString();
  if (str.length <= decimals) {
    return '0.' + '0'.repeat(decimals - str.length) + str;
  }
  const intPart = str.slice(0, str.length - decimals);
  const decPart = str.slice(str.length - decimals, str.length - decimals + 4);
  return `${intPart}.${decPart}`;
}

/**
 * Print liquidation details
 */
function printLiquidations(simulations, maxPrint = 50) {
  if (simulations.length === 0) {
    console.log('\n✓ No liquidatable positions found.');
    return;
  }
  
  console.log('\nLiquidatable Positions (Simulated):');
  console.log('-'.repeat(70));
  
  const toPrint = simulations.slice(0, maxPrint);
  
  toPrint.forEach((sim, idx) => {
    const { liquidation, route, planValid, profitEstimate } = sim;
    const status = planValid ? '✓' : '✗';
    const profitStr = profitEstimate && profitEstimate.grossProfit > 0n
      ? `+${formatAmount(profitEstimate.grossProfit, liquidation.loanDecimals)} ${liquidation.loanSymbol}`
      : 'N/A';
    
    console.log(`[${idx + 1}] ${status} Market: ${liquidation.marketId.slice(0, 10)}...`);
    console.log(`    User: ${liquidation.user}`);
    console.log(`    Pair: ${liquidation.collateralSymbol} → ${liquidation.loanSymbol}`);
    console.log(`    Repay: ${formatAmount(liquidation.repayAssets, liquidation.loanDecimals)} ${liquidation.loanSymbol}`);
    console.log(`    Seize: ${formatAmount(liquidation.seizeAssets, liquidation.collateralDecimals)} ${liquidation.collateralSymbol}`);
    if (route) {
      console.log(`    Swap out: ${formatAmount(route.expectedOut, liquidation.loanDecimals)} ${liquidation.loanSymbol}`);
    }
    console.log(`    Estimated profit: ${profitStr}`);
    console.log(`    Gas estimate: ${sim.totalGasEstimate?.toLocaleString() || 'N/A'}`);
    console.log('');
  });
  
  if (simulations.length > maxPrint) {
    console.log(`(+${simulations.length - maxPrint} more positions not shown)`);
  }
  
  console.log('-'.repeat(70));
}

/**
 * Main entry point
 */
async function main() {
  const startTime = Date.now();
  const stats = new RunStats();
  
  try {
    // Load configuration
    const config = getConfig();
    
    // Check kill switch
    if (isBotPaused(config)) {
      console.log('\n⏸ Bot is PAUSED (BOT_PAUSED=true). Exiting.');
      process.exit(0);
    }
    
    const mode = config.executionEnabled ? 'EXECUTION' : 'SIMULATION';
    const execMode = config.executionMode.toUpperCase();
    console.log('\n' + '='.repeat(70));
    console.log(`Morpho Bot - Milestone 4 - ${mode} MODE (${execMode})`);
    console.log('='.repeat(70));
    console.log(`Chain ID: ${config.chainId}`);
    console.log(`RPC URL: ${config.rpcUrl}`);
    console.log(`Morpho API: ${config.morphoApiUrl}`);
    console.log(`Execution Enabled: ${config.executionEnabled}`);
    console.log(`Execution Mode: ${config.executionMode}`);
    console.log(`Max Candidates: ${config.maxCandidates}`);
    console.log(`Max Simulations: ${config.maxSimulations}`);
    console.log(`Max TX Per Run: ${config.maxTxPerRun}`);
    console.log(`Slippage: ${config.slippageBps} bps`);
    console.log(`Cooldown: ${config.cooldownMinutes} minutes`);
    
    if (config.executionEnabled) {
      const activeExecutor = getActiveExecutorAddress(config);
      console.log(`Executor: ${activeExecutor}`);
      console.log(`Treasury: ${config.treasuryAddress}`);
      
      if (config.executionMode === 'flashloan') {
        console.log(`Flashloan Buffer: ${config.flashloanBufferBps} bps`);
        if (config.maxFlashloanAssets) {
          console.log(`Max Flashloan: ${config.maxFlashloanAssets}`);
        }
        if (config.minFlashloanProfit > 0n) {
          console.log(`Min Flashloan Profit: ${config.minFlashloanProfit}`);
        }
      }
    }
    
    if (config.testMode) {
      console.log(`\n🧪 TEST MODE ENABLED: LLTV multiplier = ${config.testLltvMultiplier * 100}%`);
    }
    
    // Initialize execution clients if needed
    let executionClients = null;
    if (config.executionEnabled) {
      console.log('\nInitializing execution clients...');
      executionClients = createExecutionClients(config);
      
      const activeExecutor = getActiveExecutorAddress(config);
      
      if (config.executionMode === 'flashloan') {
        // Verify flashloan executor
        const verification = await verifyFlashloanExecutor(
          executionClients.publicClient,
          activeExecutor,
          executionClients.account.address,
          config.morphoBlueAddress
        );
        
        if (!verification.valid) {
          console.error(`\n❌ Flashloan executor verification failed:`);
          verification.errors.forEach(e => console.error(`  - ${e}`));
          process.exit(1);
        }
        console.log(`✓ Flashloan executor verified. Owner: ${verification.owner}, Morpho: ${verification.morpho}`);
      } else {
        // Verify prefund executor ownership
        const isOwner = await verifyExecutorOwnership(
          executionClients.publicClient,
          activeExecutor,
          executionClients.account.address
        );
        
        if (!isOwner) {
          console.error(`\n❌ Bot account ${executionClients.account.address} is not owner of executor ${activeExecutor}`);
          process.exit(1);
        }
        console.log(`✓ Executor ownership verified. Bot: ${executionClients.account.address}`);
      }
    }
    
    // Step 1: Fetch whitelisted vaults
    console.log('\n[1/8] Fetching whitelisted vaults from Morpho API...');
    const vaults = await fetchWhitelistedVaults(config.morphoApiUrl, config.chainId);
    console.log(`✓ Found ${vaults.length} whitelisted vaults`);
    
    if (vaults.length === 0) {
      console.log('\n✓ No whitelisted vaults found. Exiting.');
      stats.printSummary(config);
      return;
    }
    
    const vaultAddresses = vaults.map(v => v.address);
    
    // Step 2: Fetch markets for vaults
    console.log('\n[2/8] Fetching markets from Morpho API...');
    const markets = await fetchMarketsForVaults(config.morphoApiUrl, config.chainId, vaultAddresses);
    console.log(`✓ Found ${markets.length} unique markets`);
    
    if (markets.length === 0) {
      console.log('\n✓ No markets found. Exiting.');
      stats.printSummary(config);
      return;
    }
    
    const marketIds = markets.map(m => m.id);
    
    // Step 3: Fetch candidate positions
    console.log('\n[3/8] Fetching candidate positions from Morpho API...');
    const candidates = await fetchCandidatePositions(
      config.morphoApiUrl,
      config.chainId,
      marketIds,
      config.maxCandidates
    );
    stats.candidates = candidates.length;
    console.log(`✓ Found ${candidates.length} candidate positions`);
    
    if (candidates.length === 0) {
      console.log('\n✓ No candidates found. Exiting.');
      stats.printSummary(config);
      return;
    }
    
    // Step 4: Confirm liquidatable positions onchain
    console.log(`\n[4/8] Confirming ${config.testMode ? 'at-risk' : 'liquidatable'} positions onchain...`);
    const confirmed = await batchConfirm(
      config.rpcUrl,
      config.morphoBlueAddress,
      candidates,
      config.maxSimulations,
      config
    );
    stats.confirmed = confirmed.length;
    console.log(`✓ Confirmed ${confirmed.length} ${config.testMode ? 'at-risk' : 'liquidatable'} positions`);
    
    if (confirmed.length === 0) {
      console.log('\n✓ No confirmed liquidatable positions. Exiting.');
      stats.printSummary(config);
      return;
    }
    
    // Step 5: Filter by cooldown and caps
    console.log('\n[5/8] Applying operational filters...');
    const filtered = [];
    
    for (const liquidation of confirmed) {
      // Check cooldown
      const cooldownCheck = checkCooldown(
        liquidation.marketId,
        liquidation.user,
        config.cooldownMinutes
      );
      if (cooldownCheck.inCooldown) {
        console.log(`  [COOLDOWN] ${liquidation.user.slice(0, 10)}... (${cooldownCheck.remainingMinutes}m remaining)`);
        stats.skippedCooldown++;
        continue;
      }
      
      // Check repay cap
      const capCheck = checkRepayCap(liquidation.repayAssets, config.maxRepayLoanAssets);
      if (capCheck.exceeds) {
        console.log(`  [CAP] ${liquidation.user.slice(0, 10)}... repay ${capCheck.original} > cap ${capCheck.capped}`);
        stats.skippedCap++;
        continue;
      }
      
      filtered.push(liquidation);
    }
    
    console.log(`✓ ${filtered.length} positions passed filters`);
    
    if (filtered.length === 0) {
      console.log('\n✓ All positions filtered. Exiting.');
      stats.printSummary(config);
      return;
    }
    
    // Step 6: Fetch swap routes
    console.log('\n[6/8] Fetching swap routes from LiquidSwap...');
    console.log(`  Processing ${filtered.length} positions...`);
    const plans = [];
    let routeErrors = 0;
    let skippedNoRoute = 0;
    
    // Determine recipient based on mode
    const activeExecutor = config.executionEnabled 
      ? getActiveExecutorAddress(config) 
      : config.morphoBlueAddress;
    
    for (let i = 0; i < filtered.length; i++) {
      const liquidation = filtered[i];
      let route = null;
      
      // Progress indicator every 10 positions
      if ((i + 1) % 10 === 0 || i === filtered.length - 1) {
        process.stdout.write(`\r  Progress: ${i + 1}/${filtered.length} (${stats.routesFound} routes, ${routeErrors} errors)`);
      }
      
      try {
        route = await fetchSwapRoute(
          config.liquidSwapApiUrl,
          config.chainId,
          liquidation.marketParams.collateralToken,
          liquidation.marketParams.loanToken,
          liquidation.seizeAssets,
          activeExecutor,
          liquidation.collateralDecimals // Pass token decimals for proper formatting
        );
        
        if (route) {
          // Debug: log route info
          if (config.testMode) {
            console.log(`\n    Route found: ${liquidation.collateralSymbol} -> ${liquidation.loanSymbol}`);
            console.log(`      expectedOut: ${route.expectedOut}, minAmountOut: ${route.minAmountOut}`);
            console.log(`      priceImpact: ${route.priceImpact}%`);
          }
          
          // Check price impact (reject routes with > 10% price impact)
          const maxPriceImpact = config.maxPriceImpactPct || 10;
          if (route.priceImpact > maxPriceImpact) {
            if (config.testMode) {
              console.log(`      [PRICE_IMPACT_FAIL] ${route.priceImpact}% > ${maxPriceImpact}% limit`);
            }
            continue;
          }
          
          // Check slippage
          const slippageCheck = checkSlippage(
            route.expectedOut,
            route.minAmountOut,
            config.slippageBps
          );
          
          if (!slippageCheck.acceptable) {
            if (config.testMode) {
              console.log(`      [SLIPPAGE_FAIL] actual: ${slippageCheck.actualSlippageBps}bps > limit: ${config.slippageBps}bps`);
            }
            continue;
          }
          
          stats.routesFound++;
        } else if (config.requireRoute) {
          // In flashloan mode with REQUIRE_ROUTE=1, skip positions without routes
          skippedNoRoute++;
          if (config.testMode) {
            console.log(`\n    [SKIP] No route for ${liquidation.collateralSymbol} -> ${liquidation.loanSymbol}`);
          }
          continue;
        }
        
        // Build appropriate plan based on execution mode
        if (config.executionEnabled) {
          const plan = buildExecutionPlan(config, liquidation, route);
          plans.push(plan);
        } else {
          const plan = buildLiquidationPlan(config, liquidation, route);
          plans.push(plan);
        }
        
      } catch (error) {
        routeErrors++;
        // Only log first few errors to reduce noise
        if (routeErrors <= 3) {
          console.warn(`\n  Route error for ${liquidation.user.slice(0, 10)}...: ${error.message}`);
        }
      }
      
      // Debug: if no route found
      if (!route && config.testMode) {
        console.log(`\n    No route: ${liquidation.collateralSymbol} -> ${liquidation.loanSymbol}`);
      }
    }
    
    console.log(`\n✓ Found ${stats.routesFound} swap routes (${routeErrors} errors, ${skippedNoRoute} skipped no-route)`);
    
    if (plans.length === 0) {
      console.log('\n✓ No executable plans (missing routes). Exiting.');
      stats.printSummary(config);
      return;
    }
    
    // Step 7: Simulate execution plans
    console.log('\n[7/8] Simulating liquidation plans...');
    console.log(`  Execution mode: ${config.executionMode}`);
    
    if (config.executionEnabled && executionClients) {
      // Use appropriate simulation based on mode
      for (const plan of plans) {
        const simResult = await dispatchSimulation(
          executionClients.publicClient,
          plan,
          config
        );
        
        if (simResult.success) {
          stats.simulatedOk++;
          plan.simulationResult = simResult;
          
          // Check profitability based on mode
          if (config.executionMode === 'flashloan') {
            // For flashloan, check estimated profit
            const estimatedProfit = plan.estimatedProfit || 0n;
            if (estimatedProfit >= (plan.minProfit || 0n)) {
              stats.profitable++;
              plan.profitable = true;
            } else if (config.allowBadDebt) {
              stats.profitable++;
              plan.profitable = true;
            }
          } else {
            // For prefund mode, check route output vs repay
            const { route, liquidation } = plan;
            if (route && route.expectedOut > liquidation.repayAssets) {
              stats.profitable++;
              plan.profitable = true;
            } else if (config.allowBadDebt) {
              stats.profitable++;
              plan.profitable = true;
            }
          }
          
          const modeTag = config.executionMode === 'flashloan' ? 'FLASH_SIM_OK' : 'SIM_OK';
          console.log(`  [${modeTag}] ${plan.liquidation.user.slice(0, 10)}... gas: ${simResult.gasEstimate}`);
        } else {
          const modeTag = config.executionMode === 'flashloan' ? 'FLASH_SIM_FAIL' : 'SIM_FAIL';
          console.log(`  [${modeTag}] ${plan.liquidation.user.slice(0, 10)}... ${simResult.error}`);
          addToCooldown(plan.liquidation.marketId, plan.liquidation.user, `Sim failed: ${simResult.error}`);
        }
      }
    } else {
      // Use Milestone 2 style simulation
      const client = createClient(config.rpcUrl);
      const simulations = await batchSimulate(
        client,
        plans,
        config.treasuryAddress,
        config.maxSimulations
      );
      
      for (let i = 0; i < simulations.length; i++) {
        const sim = simulations[i];
        plans[i].simulationResult = sim;
        
        if (sim.planValid) {
          stats.simulatedOk++;
          if (isProfitable(sim, config.minProfitUsd)) {
            stats.profitable++;
            plans[i].profitable = true;
          }
        }
      }
    }
    
    console.log(`✓ ${stats.simulatedOk} simulations successful`);
    console.log(`✓ ${stats.profitable} potentially profitable`);
    
    // Step 8: Execute (if enabled)
    if (config.executionEnabled && executionClients) {
      const execModeLabel = config.executionMode === 'flashloan' ? 'FLASHLOAN' : 'PREFUND';
      console.log(`\n[8/8] Executing liquidations (${execModeLabel} mode)...`);
      
      const toExecute = plans
        .filter(p => p.simulationResult?.success && p.profitable)
        .slice(0, config.maxTxPerRun);
      
      if (toExecute.length === 0) {
        console.log('✓ No profitable positions to execute.');
      } else {
        console.log(`Executing ${toExecute.length} liquidations (max: ${config.maxTxPerRun})...`);
        
        const activeExecutor = getActiveExecutorAddress(config);
        
        for (const plan of toExecute) {
          const { liquidation } = plan;
          
          const execTag = config.executionMode === 'flashloan' ? 'FLASH_START' : 'EXEC_START';
          console.log(`\n[${execTag}] ${liquidation.loanSymbol}/${liquidation.collateralSymbol} - ${liquidation.user.slice(0, 10)}...`);
          
          if (config.executionMode === 'flashloan') {
            console.log(`  Flashloan: ${plan.flashloanAssets} ${liquidation.loanSymbol}`);
            console.log(`  Est. profit: ${plan.estimatedProfit} ${liquidation.loanSymbol}`);
          }
          
          // Get balance before (for profit tracking)
          const balanceBefore = await executionClients.publicClient.readContract({
            address: plan.loanToken,
            abi: require('./lib/encodePlan').ERC20_ABI,
            functionName: 'balanceOf',
            args: [config.treasuryAddress], // Track treasury balance for flashloan mode
          });
          
          // Execute using appropriate method
          const result = await dispatchExecution(
            executionClients.walletClient,
            executionClients.publicClient,
            plan,
            config,
            plan.simulationResult
          );
          
          if (result.success) {
            stats.executed++;
            clearCooldown(liquidation.marketId, liquidation.user);
            
            // Calculate actual profit (treasury balance delta)
            const profitInfo = await calculateActualProfit(
              executionClients.publicClient,
              config.treasuryAddress,
              plan.loanToken,
              balanceBefore
            );
            
            if (profitInfo.profit && profitInfo.profit > 0n) {
              stats.totalProfit += profitInfo.profit;
            }
            
            const okTag = config.executionMode === 'flashloan' ? 'FLASH_OK' : 'EXEC_OK';
            console.log(`[${okTag}] TX: ${result.hash}`);
            console.log(`  Gas used: ${result.gasUsed?.toLocaleString()}`);
            console.log(`  Block: ${result.blockNumber}`);
            if (profitInfo.profit !== undefined) {
              console.log(`  Profit: ${formatUnits(profitInfo.profit, liquidation.loanDecimals)} ${liquidation.loanSymbol}`);
            }
            
            // Telegram notification
            if (config.telegramToken && config.telegramChatId) {
              await sendTelegramNotification(
                config.telegramToken,
                config.telegramChatId,
                formatSuccessNotification(result, plan, profitInfo)
              );
            }
            
          } else {
            stats.failed++;
            addToCooldown(liquidation.marketId, liquidation.user, `Exec failed: ${result.error}`);
            
            const failTag = config.executionMode === 'flashloan' ? 'FLASH_FAIL' : 'EXEC_FAIL';
            console.log(`[${failTag}] ${result.error}`);
            stats.errors.push(`${liquidation.user.slice(0, 10)}...: ${result.error}`);
            
            // Telegram notification
            if (config.telegramToken && config.telegramChatId) {
              await sendTelegramNotification(
                config.telegramToken,
                config.telegramChatId,
                formatFailureNotification(result, plan, config.executionMode)
              );
            }
          }
        }
      }
    } else {
      console.log('\n[8/8] Execution disabled (EXECUTION_ENABLED=0)');
      
      // Print simulation results
      const simulated = plans.filter(p => p.simulationResult?.planValid || p.simulationResult?.success);
      printLiquidations(simulated.map(p => ({
        liquidation: p.liquidation,
        route: p.route,
        planValid: true,
        profitEstimate: p.route ? {
          grossProfit: p.route.expectedOut > p.liquidation.repayAssets 
            ? p.route.expectedOut - p.liquidation.repayAssets 
            : 0n,
        } : null,
        totalGasEstimate: p.estimatedGas,
      })), config.maxPositionsPrint);
    }
    
    // Print summary
    stats.printSummary(config);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✓ Milestone 4 run complete in ${elapsed}s`);
    console.log(`✓ Execution mode: ${config.executionMode}`);
    
    if (config.executionEnabled) {
      console.log(`✓ Executed: ${stats.executed}, Failed: ${stats.failed}`);
      if (stats.totalProfit > 0n) {
        console.log(`✓ Total profit: ${stats.totalProfit.toString()} (raw)`);
      }
    } else {
      console.log('✓ No transactions sent (EXECUTION_ENABLED=0)\n');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    
    stats.errors.push(error.message);
    
    if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
      console.error('\n💡 Network error: check RPC and API connectivity.');
    }
    
    if (error.message.includes('EXECUTOR_ADDRESS') || error.message.includes('PRIVATE_KEY')) {
      console.error('\n💡 Configuration error: check required env vars for execution mode.');
    }
    
    process.exit(1);
  }
}

// Run the bot
main();
