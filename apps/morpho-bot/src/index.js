/**
 * Morpho Blue Liquidation Bot - Milestone 4
 * 
 * Candidate discovery via Morpho API, real-time confirmation using SDK,
 * swap routing via LiquidSwap, simulation + execution via Executor contract.
 * 
 * Supports two execution modes:
 * - prefund: Uses pre-funded executor (Milestone 3)
 * - flashloan: Uses Morpho flashloan for atomic execution (Milestone 4)
 * 
 * Now includes scheduler with adaptive cadence, caching, and backlog management.
 */

const { formatUnits } = require('viem');
const { getConfig, getActiveExecutorAddress } = require('./lib/env');
const { fetchWhitelistedVaults } = require('./lib/morphoApi');
const { fetchMarketsForVaults, fetchCandidatePositions } = require('./lib/candidateSource');
const { createClient, batchConfirm } = require('./lib/sdkConfirm');
const { fetchSwapRoute } = require('./lib/routeLiquidSwap');
const { 
  buildLiquidationPlan, 
  buildExecutionPlan,
} = require('./lib/encodePlan');
const { batchSimulate, isProfitable } = require('./lib/simulate');
const {
  createExecutionClients,
  verifyExecutorOwnership,
  verifyFlashloanExecutor,
  dispatchSimulation,
  dispatchExecution,
  calculateActualProfit,
} = require('./lib/execute');
const {
  isBotPaused,
  checkCooldownByType,
  addToCooldown,
  clearCooldown,
  checkRepayCap,
  checkSlippage,
} = require('./lib/operations');
const { createTelegramClient } = require('./lib/telegram');
const { formatSuccess, formatSent, formatFail } = require('./lib/telegramFormat');
const cache = require('./lib/cache');
const { CandidateBacklog } = require('./lib/backlog');
const { Scheduler } = require('./lib/scheduler');
const { createHealthServer, updateHealthState } = require('./lib/health');

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
 * Print startup banner
 */
function printStartupBanner(config) {
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
  console.log(`Baseline Cadence: ${config.tickBaseSeconds}s`);
  console.log(`Fast Mode Cadence: ${config.tickFastSeconds}s`);
  console.log(`Jitter: ±${config.jitterPct}%`);
  console.log(`Candidates Per Tick: ${config.candidatesPerTick}`);
  console.log(`Max Confirmations Per Tick: ${config.maxConfirmationsPerTick}`);
  console.log(`Max Simulations Per Tick: ${config.maxSimulationsPerTick}`);
  console.log(`Max TX Per Tick: ${config.maxTxPerTick}`);
  console.log(`Slippage: ${config.slippageBps} bps`);
  console.log(`Min Repay: ${config.minRepayAssets} (raw)`);
  if (config.allowUnprofitable) {
    console.log(`⚠️  ALLOW_UNPROFITABLE=1 (testing mode)`);
  }
  
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
  
  console.log('='.repeat(70));
}

/**
 * Run a single tick - the main processing pipeline
 * @param {Object} ctx - Context object with config, executionClients, backlog
 * @returns {Promise<Object>} Tick metrics
 */
async function runTick(ctx) {
  const { config, executionClients, backlog } = ctx;
  const metrics = {
    fetchedVaults: 0,
    fetchedMarkets: 0,
    fetchedCandidates: 0,
    confirmedCount: 0,
    liquidatableCount: 0,
    simulatedCount: 0,
    simSuccessCount: 0,
    profitOkCount: 0,
    executedCount: 0,
    execSuccessCount: 0,
    errorsCount: 0,
    triggers: {
      hasLiquidatable: false,
      hasExec: false,
      hasNearMiss: false,
    },
  };

  try {
    const isPaused = isBotPaused(config);

    // Step 1: Fetch whitelisted vaults (cached)
    const vaults = await cache.getOrSet(
      `vaults:${config.chainId}`,
      config.vaultsTtlMinutes * 60 * 1000,
      async () => {
        return await fetchWhitelistedVaults(config.morphoApiUrl, config.chainId);
      }
    );
    metrics.fetchedVaults = vaults.length;

    if (vaults.length === 0) {
      return metrics;
    }

    const vaultAddresses = vaults.map(v => v.address);

    // Step 2: Fetch markets (cached)
    const markets = await cache.getOrSet(
      `markets:${config.chainId}:${vaultAddresses.join(',')}`,
      config.marketsTtlMinutes * 60 * 1000,
      async () => {
        return await fetchMarketsForVaults(config.morphoApiUrl, config.chainId, vaultAddresses);
      }
    );
    metrics.fetchedMarkets = markets.length;

    if (markets.length === 0) {
      return metrics;
    }

    const marketIds = markets.map(m => m.id);

    // Step 3: Get candidates from backlog (refill if needed)
    const candidatesToFetch = Math.min(
      config.candidatesPerTick,
      config.candidatesPerTick - backlog.queue.length
    );

    if (candidatesToFetch > 0 || backlog.shouldRefetch()) {
      const fetched = await backlog.refillIfLow(
        async (targetSize) => {
          return await fetchCandidatePositions(
            config.morphoApiUrl,
            config.chainId,
            marketIds,
            targetSize
          );
        },
        Math.floor(config.candidatesPerTick * 0.5), // Refill when below 50%
        config.candidatesPerTick
      );
      metrics.fetchedCandidates = fetched;
    }

    // Get batch from backlog (respecting cooldowns)
    const candidates = backlog.getBatch(config.candidatesPerTick, {
      solventCooldownMinutes: config.solventCooldownMinutes,
      failCooldownMinutes: config.failCooldownMinutes,
      execFailCooldownMinutes: config.execFailCooldownMinutes,
    });

    if (candidates.length === 0) {
      return metrics;
    }

    // Step 4: Confirm liquidatable positions (capped)
    const candidatesToConfirm = candidates.slice(0, config.maxConfirmationsPerTick);
    const confirmed = await batchConfirm(
      config.rpcUrl,
      config.morphoBlueAddress,
      candidatesToConfirm,
      config.maxConfirmationsPerTick,
      config
    );
    metrics.confirmedCount = confirmed.length;

    // Sort confirmed by repayAssets descending (largest first = most profitable)
    confirmed.sort((a, b) => {
      const aRepay = a.repayAssets || 0n;
      const bRepay = b.repayAssets || 0n;
      if (bRepay > aRepay) return 1;
      if (bRepay < aRepay) return -1;
      return 0;
    });

    // Filter confirmed by cooldown, caps, and dust threshold
    const filtered = [];
    let skippedCooldown = 0;
    let skippedCap = 0;
    let skippedDust = 0;
    
    console.log(`\n[Filter] Filtering ${confirmed.length} confirmed positions (sorted by size desc)...`);
    
    for (const liquidation of confirmed) {
      const pair = `${liquidation.collateralSymbol}→${liquidation.loanSymbol}`;
      const userShort = liquidation.user;
      
      // Check cooldown with type-specific durations
      const cooldownCheck = checkCooldownByType(
        liquidation.marketId,
        liquidation.user,
        {
          solventCooldownMinutes: config.solventCooldownMinutes,
          failCooldownMinutes: config.failCooldownMinutes,
          execFailCooldownMinutes: config.execFailCooldownMinutes,
        }
      );

      if (cooldownCheck.inCooldown) {
        console.log(`  [COOLDOWN] ${userShort} ${pair}: ${cooldownCheck.remainingMinutes}m remaining (${cooldownCheck.reason})`);
        skippedCooldown++;
        continue;
      }

      // Check repay cap (max)
      const capCheck = checkRepayCap(liquidation.repayAssets, config.maxRepayLoanAssets);
      if (capCheck.exceeds) {
        console.log(`  [CAP] ${userShort} ${pair}: repay exceeds cap`);
        skippedCap++;
        continue;
      }

      // Check dust threshold (min) - skip positions too small to be profitable
      if (config.minRepayAssets && liquidation.repayAssets < config.minRepayAssets) {
        console.log(`  [DUST] ${userShort} ${pair}: repay=${formatAmount(liquidation.repayAssets, liquidation.loanDecimals)} < min ${formatAmount(config.minRepayAssets, liquidation.loanDecimals)}`);
        skippedDust++;
        // Add to cooldown so we don't keep checking it
        addToCooldown(liquidation.marketId, liquidation.user, 'Dust position', 'solvent');
        continue;
      }

      console.log(`  [PASS] ${userShort} ${pair}: repay=${formatAmount(liquidation.repayAssets, liquidation.loanDecimals)} seize=${formatAmount(liquidation.seizeAssets, liquidation.collateralDecimals)}`);
      filtered.push(liquidation);
    }

    console.log(`[Filter] Summary: ${filtered.length} passed, ${skippedCooldown} cooldown, ${skippedCap} cap, ${skippedDust} dust`);

    metrics.liquidatableCount = filtered.length;

    if (filtered.length === 0) {
      return metrics;
    }

    // Step 5: Fetch swap routes
    const activeExecutor = config.executionEnabled 
      ? getActiveExecutorAddress(config) 
      : config.morphoBlueAddress;

    const plans = [];
    let routeErrors = 0;
    let skippedPriceImpact = 0;
    let skippedSlippage = 0;
    let skippedNoRoute = 0;

    console.log(`\n[Routes] Fetching routes for ${filtered.length} liquidatable positions...`);

    for (const liquidation of filtered) {
      const pair = `${liquidation.collateralSymbol}→${liquidation.loanSymbol}`;
      const userShort = liquidation.user;
      
      try {
        const route = await fetchSwapRoute(
          config.liquidSwapApiUrl,
          config.chainId,
          liquidation.marketParams.collateralToken,
          liquidation.marketParams.loanToken,
          liquidation.seizeAssets,
          activeExecutor,
          liquidation.collateralDecimals
        );

        if (route) {
          // Check price impact
          const maxPriceImpact = config.maxPriceImpactPct || 10;
          if (route.priceImpact > maxPriceImpact) {
            console.log(`  [SKIP] ${userShort}... ${pair}: price impact ${route.priceImpact}% > ${maxPriceImpact}%`);
            skippedPriceImpact++;
            continue;
          }

          // Check slippage
          const slippageCheck = checkSlippage(
            route.expectedOut,
            route.minAmountOut,
            config.slippageBps
          );

          if (!slippageCheck.acceptable) {
            console.log(`  [SKIP] ${userShort}... ${pair}: slippage ${slippageCheck.actualSlippageBps}bps > ${config.slippageBps}bps`);
            skippedSlippage++;
            continue;
          }
          
          console.log(`  [ROUTE] ${userShort}... ${pair}: impact=${route.priceImpact}%, out=${formatAmount(route.expectedOut, liquidation.loanDecimals)}`);
        } else if (config.requireRoute) {
          console.log(`  [SKIP] ${userShort}... ${pair}: no route found (REQUIRE_ROUTE=1)`);
          skippedNoRoute++;
          continue;
        } else {
          console.log(`  [WARN] ${userShort}... ${pair}: no route, proceeding anyway`);
        }

        // Build plan
        if (config.executionEnabled) {
          const plan = buildExecutionPlan(config, liquidation, route);
          plans.push(plan);
          console.log(`  [PLAN] ${userShort}... ${pair}: repay=${formatAmount(liquidation.repayAssets, liquidation.loanDecimals)} seize=${formatAmount(liquidation.seizeAssets, liquidation.collateralDecimals)}`);
        } else {
          const plan = buildLiquidationPlan(config, liquidation, route);
          plans.push(plan);
        }
      } catch (error) {
        routeErrors++;
        console.log(`  [ERROR] ${userShort}... ${pair}: ${error.message}`);
      }
    }

    console.log(`[Routes] Summary: ${plans.length} plans, ${skippedPriceImpact} price-impact, ${skippedSlippage} slippage, ${skippedNoRoute} no-route, ${routeErrors} errors`);

    if (plans.length === 0) {
      console.log('[Routes] No executable plans created');
      return metrics;
    }

    // Step 6: Simulate (capped) - skip if paused
    if (isPaused) {
      console.log('⏸ Bot is PAUSED (BOT_PAUSED=true). Skipping simulation/execution.');
      return metrics;
    }

    const plansToSimulate = plans.slice(0, config.maxSimulationsPerTick);
    metrics.simulatedCount = plansToSimulate.length;

    console.log(`\n[Simulate] Simulating ${plansToSimulate.length} plans (mode: ${config.executionMode})...`);

    if (config.executionEnabled && executionClients) {
      for (const plan of plansToSimulate) {
        const { liquidation } = plan;
        const pair = `${liquidation.collateralSymbol}→${liquidation.loanSymbol}`;
        const userShort = liquidation.user;
        
        try {
          console.log(`  [SIM] ${userShort}... ${pair}: starting simulation...`);
          console.log(`    flashloanToken: ${plan.flashloanToken}`);
          console.log(`    flashloanAssets: ${plan.flashloanAssets}`);
          console.log(`    repayAssets: ${plan.liquidation?.repayAssets}`);
          console.log(`    seizeAssets: ${plan.liquidation?.seizeAssets}`);
          console.log(`    estimatedProfit: ${plan.estimatedProfit}`);
          console.log(`    calls: ${plan.calls?.length || 0}`);
          if (plan.calls) {
            plan.calls.forEach((c, i) => {
              console.log(`      [${i}] ${c.description || c.target}`);
              console.log(`          target: ${c.target}`);
              console.log(`          data: ${c.data?.slice(0, 74)}...`);
            });
          }
          if (plan.route?.debug) {
            console.log(`    route debug:`);
            console.log(`      amountInSent: ${plan.route.debug.amountInSent}`);
            console.log(`      amountOutFromApi: ${plan.route.debug.amountOutFromApi}`);
            console.log(`      detailsAmountOut: ${plan.route.debug.detailsAmountOut}`);
          }
          
          const simResult = await dispatchSimulation(
            executionClients.publicClient,
            plan,
            config
          );

          if (simResult.success) {
            metrics.simSuccessCount++;
            plan.simulationResult = simResult;
            console.log(`  [SIM_OK] ${userShort}... ${pair}: gas=${simResult.gasEstimate}`);

            // Check profitability (or skip check if ALLOW_UNPROFITABLE=1)
            if (config.allowUnprofitable) {
              metrics.profitOkCount++;
              plan.profitable = true;
              console.log(`  [PROFIT_OK] ${userShort}... profitable=true (ALLOW_UNPROFITABLE=1)`);
            } else if (config.executionMode === 'flashloan') {
              const estimatedProfit = plan.estimatedProfit || 0n;
              const minProfit = plan.minProfit || 0n;
              console.log(`  [PROFIT] ${userShort}... estimated=${estimatedProfit}, min=${minProfit}, allowBadDebt=${config.allowBadDebt}`);
              
              if (estimatedProfit >= minProfit) {
                metrics.profitOkCount++;
                plan.profitable = true;
                console.log(`  [PROFIT_OK] ${userShort}... profitable=true`);
              } else if (config.allowBadDebt) {
                metrics.profitOkCount++;
                plan.profitable = true;
                console.log(`  [PROFIT_OK] ${userShort}... profitable=true (allowBadDebt)`);
              } else {
                console.log(`  [PROFIT_FAIL] ${userShort}... not profitable and allowBadDebt=false`);
              }
            } else {
              const { route } = plan;
              if (route) {
                const expectedOut = route.expectedOut;
                const repayAssets = liquidation.repayAssets;
                console.log(`  [PROFIT] ${userShort}... expectedOut=${expectedOut}, repay=${repayAssets}`);
                
                if (expectedOut > repayAssets) {
                  metrics.profitOkCount++;
                  plan.profitable = true;
                  console.log(`  [PROFIT_OK] ${userShort}... profitable=true`);
                } else if (config.allowBadDebt) {
                  metrics.profitOkCount++;
                  plan.profitable = true;
                  console.log(`  [PROFIT_OK] ${userShort}... profitable=true (allowBadDebt)`);
                } else {
                  console.log(`  [PROFIT_FAIL] ${userShort}... not profitable and allowBadDebt=false`);
                }
              } else {
                console.log(`  [PROFIT_FAIL] ${userShort}... no route`);
              }
            }
          } else {
            console.log(`  [SIM_FAIL] ${userShort}... ${pair}: ${simResult.error}`);
            addToCooldown(plan.liquidation.marketId, plan.liquidation.user, `Sim failed: ${simResult.error}`, 'fail');
          }
        } catch (error) {
          metrics.errorsCount++;
          console.log(`  [SIM_ERROR] ${userShort}... ${pair}: ${error.message}`);
          addToCooldown(plan.liquidation.marketId, plan.liquidation.user, `Sim error: ${error.message}`, 'fail');
        }
      }
    } else {
      const client = createClient(config.rpcUrl);
      const simulations = await batchSimulate(
        client,
        plansToSimulate,
        config.treasuryAddress,
        config.maxSimulationsPerTick
      );

      for (let i = 0; i < simulations.length; i++) {
        const sim = simulations[i];
        plansToSimulate[i].simulationResult = sim;

        if (sim.planValid) {
          metrics.simSuccessCount++;
          if (isProfitable(sim, config.minProfitUsd)) {
            metrics.profitOkCount++;
            plansToSimulate[i].profitable = true;
          }
        }
      }
    }

    console.log(`[Simulate] Summary: ${metrics.simSuccessCount}/${metrics.simulatedCount} succeeded, ${metrics.profitOkCount} profitable`);

    // Check for liquidatable trigger
    if (metrics.liquidatableCount > 0) {
      metrics.triggers.hasLiquidatable = true;
    }

    // Step 7: Execute (if enabled)
    if (config.executionEnabled && executionClients) {
      const toExecute = plansToSimulate
        .filter(p => p.simulationResult?.success && p.profitable)
        .slice(0, config.maxTxPerTick);

      metrics.executedCount = toExecute.length;

      for (const plan of toExecute) {
        const { liquidation } = plan;

        try {
          // Get balance before
          const balanceBefore = await executionClients.publicClient.readContract({
            address: plan.loanToken,
            abi: require('./lib/encodePlan').ERC20_ABI,
            functionName: 'balanceOf',
            args: [config.treasuryAddress],
          });

          // Get Telegram client from context
          const telegramClient = ctx.telegramClient;

          // Execute with onSent callback for Telegram
          let txHash = null;
          const onSent = config.telegramSendOnSent && telegramClient
            ? async (hash) => {
                txHash = hash;
                const mode = config.executionMode === 'flashloan' ? 'FLASHLOAN' : 'PREFUND';
                const message = formatSent({
                  chainId: config.chainId,
                  mode,
                  marketId: liquidation.marketId,
                  user: liquidation.user,
                  loanToken: liquidation.loanSymbol,
                  collateralToken: liquidation.collateralSymbol,
                  txHash: hash,
                });
                await telegramClient.send(hash, message, { dedupeKey: hash });
              }
            : undefined;

          const result = await dispatchExecution(
            executionClients.walletClient,
            executionClients.publicClient,
            plan,
            config,
            plan.simulationResult,
            onSent
          );

          if (result.success) {
            metrics.execSuccessCount++;
            metrics.triggers.hasExec = true;
            clearCooldown(liquidation.marketId, liquidation.user);

            // Calculate profit
            const profitInfo = await calculateActualProfit(
              executionClients.publicClient,
              config.treasuryAddress,
              plan.loanToken,
              balanceBefore
            );

            const okTag = config.executionMode === 'flashloan' ? 'FLASH_OK' : 'EXEC_OK';
            console.log(`  [${okTag}] ${liquidation.user} TX: ${result.hash}`);

            // Telegram success notification
            if (telegramClient) {
              const mode = config.executionMode === 'flashloan' ? 'FLASHLOAN' : 'PREFUND';
              const message = formatSuccess({
                chainId: config.chainId,
                mode,
                marketId: liquidation.marketId,
                user: liquidation.user,
                loanToken: liquidation.loanSymbol,
                collateralToken: liquidation.collateralSymbol,
                repayAssets: liquidation.repayAssets,
                loanDecimals: liquidation.loanDecimals,
                profitAssets: profitInfo,
                txHash: result.hash,
              });
              await telegramClient.send(result.hash, message, { dedupeKey: result.hash });
            }
          } else {
            metrics.errorsCount++;
            addToCooldown(liquidation.marketId, liquidation.user, `Exec failed: ${result.error}`, 'execFail');

            const failTag = config.executionMode === 'flashloan' ? 'FLASH_FAIL' : 'EXEC_FAIL';
            console.log(`  [${failTag}] ${liquidation.user} ${result.error}`);

            // Telegram failure notification
            if (telegramClient) {
              const dedupeKey = result.hash || `${liquidation.marketId}:${liquidation.user}:${Math.floor(Date.now() / 60000)}`; // Per-minute bucket
              const mode = config.executionMode === 'flashloan' ? 'FLASHLOAN' : 'PREFUND';
              const message = formatFail({
                reason: result.error || 'Unknown error',
                txHash: result.hash,
                marketId: liquidation.marketId,
                user: liquidation.user,
                mode,
                chainId: config.chainId,
                loanToken: liquidation.loanSymbol,
                collateralToken: liquidation.collateralSymbol,
              });
              await telegramClient.send(dedupeKey, message, { dedupeKey });
            }
          }
        } catch (error) {
          metrics.errorsCount++;
          addToCooldown(liquidation.marketId, liquidation.user, `Exec error: ${error.message}`, 'execFail');
        }
      }
    }

    return metrics;

  } catch (error) {
    console.error(`Tick error: ${error.message}`);
    metrics.errorsCount++;
    return metrics;
  }
}

/**
 * Initialize Telegram client
 * @param {Object} config - Configuration
 * @returns {Object|null} Telegram client or null
 */
function initializeTelegramClient(config) {
  if (!config.telegramEnabled || !config.telegramToken || !config.telegramChatId) {
    return null;
  }

  return createTelegramClient({
    token: config.telegramToken,
    chatId: config.telegramChatId,
    enabled: config.telegramEnabled,
    rateLimitSeconds: config.telegramRateLimitSeconds,
    maxPerHour: config.telegramMaxPerHour,
  });
}

/**
 * Initialize execution clients and verify setup
 */
async function initializeExecutionClients(config) {
  if (!config.executionEnabled) {
    return null;
  }

  console.log('\nInitializing execution clients...');
  const executionClients = createExecutionClients(config);
  const activeExecutor = getActiveExecutorAddress(config);

  if (config.executionMode === 'flashloan') {
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

  return executionClients;
}

/**
 * Main entry point
 */
async function main() {
  try {
    // Load configuration
    const config = getConfig();

    // Print startup banner
    printStartupBanner(config);

    // Start health server
    const healthServer = createHealthServer(config.healthPort);
    updateHealthState({
      executionEnabled: config.executionEnabled,
      mode: 'BASE',
      tickBaseSeconds: config.tickBaseSeconds,
    });

    // Initialize execution clients if needed
    const executionClients = await initializeExecutionClients(config);

    // Initialize Telegram client
    const telegramClient = initializeTelegramClient(config);

    // Initialize backlog
    const backlog = new CandidateBacklog(config);

    // Create context
    const ctx = {
      config,
      executionClients,
      backlog,
      telegramClient,
    };

    // Send startup notification
    if (telegramClient) {
      await telegramClient.send('bot_start', '🤖 BOT START', { force: true });
    }

    // Run once or start scheduler
    if (config.runOnce) {
      console.log('\n[RUN_ONCE=1] Running single tick...\n');
      const metrics = await runTick(ctx);
      console.log('\n✓ Single tick complete');
      console.log(`  Candidates: ${metrics.fetchedCandidates}, Confirmed: ${metrics.confirmedCount}, Liquidatable: ${metrics.liquidatableCount}`);
      console.log(`  Simulated: ${metrics.simSuccessCount}/${metrics.simulatedCount}, Executed: ${metrics.execSuccessCount}/${metrics.executedCount}`);
      process.exit(0);
    } else {
      // Start scheduler with cleanup callback
      const scheduler = new Scheduler(config);
      
      const onShutdown = async () => {
        if (telegramClient) {
          await telegramClient.send('bot_stop', '🛑 BOT STOP', { force: true });
          telegramClient.cleanup();
        }
      };
      
      await scheduler.runScheduler(runTick, ctx, onShutdown);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);

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
