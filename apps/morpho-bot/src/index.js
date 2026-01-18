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

const { formatUnits, parseUnits } = require('viem');
const { getConfig, getActiveExecutorAddress } = require('./lib/env');
const { fetchWhitelistedVaults } = require('./lib/morphoApi');
const { fetchMarketsForVaults, fetchCandidatePositions } = require('./lib/candidateSource');
const { createClient, batchConfirm } = require('./lib/sdkConfirm');
const { fetchSwapRoute } = require('./lib/routeLiquidSwap');
const { quoteProfitToHype } = require('./lib/prjxQuoter');
const { 
  buildLiquidationPlan, 
  buildExecutionPlan,
} = require('./lib/encodePlan');
const { batchSimulate, isProfitable } = require('./lib/simulate');
const {
  createExecutionClients,
  verifyExecutorOwnership,
  verifyFlashloanExecutor,
  verifyFlashloanExecutorV2,
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
const { createErrorDigest } = require('./lib/errorDigest');
const cache = require('./lib/cache');
const { CandidateBacklog } = require('./lib/backlog');
const { Scheduler } = require('./lib/scheduler');
const { createHealthServer, updateHealthState } = require('./lib/health');
const { isJsonlEnabled, emitEvent, log, logError } = require('./lib/logger');
const fs = require('fs');
const path = require('path');

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
 * Truncate string to max length
 */
function truncate(str, maxLen = 160) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Get package version if available
 */
function getPackageVersion() {
  try {
    const pkgPath = path.join(__dirname, '../../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version;
    }
  } catch (e) {
    // Ignore
  }
  return undefined;
}

/**
 * Get git commit hash if available
 */
function getGitCommit() {
  try {
    const gitPath = path.join(__dirname, '../../.git/HEAD');
    if (fs.existsSync(gitPath)) {
      const head = fs.readFileSync(gitPath, 'utf8').trim();
      if (head.startsWith('ref: ')) {
        const refPath = path.join(__dirname, '../../.git', head.slice(5));
        if (fs.existsSync(refPath)) {
          return fs.readFileSync(refPath, 'utf8').trim().slice(0, 7);
        }
      } else {
        return head.slice(0, 7);
      }
    }
  } catch (e) {
    // Ignore
  }
  return undefined;
}

/**
 * Build explorer URL for transaction
 */
function buildExplorerUrl(chainId, txHash) {
  if (chainId === 999) {
    return `https://hyperevmscan.com/tx/${txHash}`;
  }
  return undefined;
}

/**
 * Process a single liquidation through the full pipeline: filter → route → plan → simulate → execute
 * Used for streaming execution when liquidatable positions are found during scanning.
 * 
 * @param {Object} liquidation - Confirmed liquidatable position
 * @param {Object} ctx - Context with config, executionClients, telegramClient
 * @param {Object} streamingState - Shared state for metrics tracking
 * @param {Object} executionCounter - Shared counter for enforcing maxTxPerTick { sent: number }
 * @returns {Promise<Object>} Result with status and details
 */
async function processAndExecuteLiquidation(liquidation, ctx, streamingState, executionCounter = { sent: 0 }) {
  const { config, executionClients, telegramClient } = ctx;
  const { tickId, mode, tickStats, metrics } = streamingState;
  
  const pair = `${liquidation.collateralSymbol}→${liquidation.loanSymbol}`;
  const userShort = liquidation.user;
  
  try {
    // Step 1: Apply filters (cooldown, cap, dust)
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
      log(config, `  [STREAM-COOLDOWN] ${userShort} ${pair}: ${cooldownCheck.remainingMinutes}m remaining`);
      streamingState.filteredCooldown++;
      return { status: 'filtered', reason: 'cooldown' };
    }

    const capCheck = checkRepayCap(liquidation.repayAssets, config.maxRepayLoanAssets);
    if (capCheck.exceeds) {
      log(config, `  [STREAM-CAP] ${userShort} ${pair}: repay exceeds cap`);
      streamingState.filteredCap++;
      return { status: 'filtered', reason: 'cap' };
    }

    log(config, `  [STREAM-PASS] ${userShort} ${pair}: starting pipeline...`);
    streamingState.filterPassed++;

    // Step 2: Fetch swap route
    const activeExecutor = getActiveExecutorAddress(config);
    streamingState.liquidSwapCalls++;
    
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
        log(config, `  [STREAM-SKIP] ${userShort} ${pair}: price impact ${route.priceImpact}% > ${maxPriceImpact}%`);
        return { status: 'filtered', reason: 'price_impact' };
      }

      // Check slippage
      const slippageCheck = checkSlippage(
        route.expectedOut,
        route.minAmountOut,
        config.slippageBps
      );

      if (!slippageCheck.acceptable) {
        log(config, `  [STREAM-SKIP] ${userShort} ${pair}: slippage too high`);
        return { status: 'filtered', reason: 'slippage' };
      }
      
      log(config, `  [STREAM-ROUTE] ${userShort} ${pair}: impact=${route.priceImpact}%`);
    } else if (config.requireRoute) {
      log(config, `  [STREAM-SKIP] ${userShort} ${pair}: no route found`);
      return { status: 'filtered', reason: 'no_route' };
    }

    // Step 3: Build plan (with optional profit route for V2)
    let profitRoute = null;
    let plan;
    
    if (config.useExecutorV2 && config.executionMode === 'flashloan') {
      // V2 executor: need to fetch profit route (loanToken -> WHYPE)
      // Estimate profit in loan token first
      const estimatedLoanProfit = route ? 
        (route.expectedOut > liquidation.repayAssets ? route.expectedOut - liquidation.repayAssets : 0n) : 0n;
      
      if (estimatedLoanProfit > 0n) {
        profitRoute = await quoteProfitToHype(
          executionClients.publicClient,
          liquidation.marketParams.loanToken,
          estimatedLoanProfit,
          config
        );
        
        if (profitRoute) {
          if (profitRoute.skipSwap) {
            log(config, `  [STREAM-PROFIT_ROUTE] ${userShort} ${pair}: loanToken is WHYPE, no swap needed`);
          } else {
            log(config, `  [STREAM-PROFIT_ROUTE] ${userShort} ${pair}: fee=${profitRoute.feeTier} expectedHype=${profitRoute.expectedOut}`);
          }
        } else {
          // No HYPE route found - use default fee tier, contract will try and may fail
          log(config, `  [STREAM-PROFIT_ROUTE] ${userShort} ${pair}: no HYPE route found, using default (3000 fee tier)`);
          profitRoute = {
            skipSwap: false,
            feeTier: 3000, // 0.3% - most common tier
            expectedOut: 0n, // Unknown
            minOut: 0n, // No slippage protection when route unknown
            router: config.prjxRouterAddress,
          };
        }
      } else {
        // No profit expected, still use V2 but skip the swap
        profitRoute = {
          skipSwap: true,
          feeTier: 0,
          expectedOut: 0n,
          minOut: 0n,
          router: null,
        };
      }
      
      // Always build V2 plan when useExecutorV2 is enabled
      plan = buildExecutionPlan(config, liquidation, route, profitRoute);
    } else {
      // V1 executor or prefund mode
      plan = buildExecutionPlan(config, liquidation, route);
    }
    
    streamingState.plansBuilt++;
    log(config, `  [STREAM-PLAN] ${userShort} ${pair}: plan built (mode=${plan.mode})`);

    // Step 4: Simulate
    if (!isJsonlEnabled(config)) {
      console.log(`  [STREAM-SIM] ${userShort} ${pair}: simulating...`);
    }
    
    const simResult = await dispatchSimulation(
      executionClients.publicClient,
      plan,
      config
    );

    if (!simResult.success) {
      // Record error for daily digest
      if (ctx.errorDigest) {
        ctx.errorDigest.recordError({
          errorType: simResult.errorType || 'sim_failed',
          message: simResult.error,
          marketId: liquidation.marketId,
          user: liquidation.user,
          pair,
          route: route?.venue,
          amount: liquidation.repayAssets,
          selector: simResult.rawSelector,
          extra: {
            hypeActual: simResult.hypeActual?.toString(),
            hypeMinimum: simResult.hypeMinimum?.toString(),
            profitActual: simResult.profitActual?.toString(),
            profitRequired: simResult.profitRequired?.toString(),
            callIndex: simResult.callIndex,
          },
        });
      }
      
      // Check if this is an InsufficientProfit error (contract-level profit check)
      if (simResult.errorType === 'insufficient_profit') {
        log(config, `  [STREAM-UNPROFITABLE] ${userShort} ${pair}: ${simResult.error}`);
        streamingState.unprofitable++;
        // Don't add to cooldown - price may change
        return { status: 'unprofitable', reason: simResult.error, profitActual: simResult.profitActual, profitRequired: simResult.profitRequired };
      }
      
      // Check for V2-specific insufficient HYPE profit error
      if (simResult.errorType === 'insufficient_hype_profit') {
        log(config, `  [STREAM-UNPROFITABLE_HYPE] ${userShort} ${pair}: ${simResult.error}`);
        streamingState.unprofitable++;
        return { status: 'unprofitable', reason: simResult.error, hypeActual: simResult.hypeActual, hypeMinimum: simResult.hypeMinimum };
      }
      
      log(config, `  [STREAM-SIM_FAIL] ${userShort} ${pair}: ${simResult.error}`);
      addToCooldown(liquidation.marketId, liquidation.user, `Sim failed: ${simResult.error}`, 'fail');
      streamingState.simFailed++;
      return { status: 'sim_failed', reason: simResult.error };
    }

    streamingState.simSuccess++;
    log(config, `  [STREAM-SIM_OK] ${userShort} ${pair}: gas=${simResult.gasEstimate}`);

    // Step 5: Check profitability
    let profitable = false;
    if (config.allowUnprofitable) {
      // Testing flag: skip profitability check entirely
      profitable = true;
      log(config, `  [STREAM-PROFIT] ${userShort} ${pair}: ALLOW_UNPROFITABLE enabled, skipping profit check`);
    } else if (plan.mode === 'flashloanV2') {
      // V2 executor: compare estimated HYPE profit vs gas cost in HYPE
      const estimatedHypeProfit = plan.estimatedHypeProfit || 0n;
      const gasEstimate = BigInt(simResult.gasEstimate || plan.estimatedGas || 0);
      
      // Get current gas price and calculate gas cost in HYPE
      const gasPrice = await executionClients.publicClient.getGasPrice();
      const gasCostHype = gasEstimate * gasPrice;
      
      // Profitable if HYPE profit > gas cost (both in wei)
      profitable = estimatedHypeProfit > gasCostHype || config.allowBadDebt;
      
      if (!profitable) {
        log(config, `  [STREAM-PROFIT_FAIL] ${userShort} ${pair}: hypeProfit=${formatUnits(estimatedHypeProfit, 18)} < gasCost=${formatUnits(gasCostHype, 18)} HYPE`);
      } else {
        const netProfit = estimatedHypeProfit - gasCostHype;
        log(config, `  [STREAM-PROFIT_OK] ${userShort} ${pair}: netHype=${formatUnits(netProfit, 18)} HYPE`);
      }
    } else if (config.executionMode === 'flashloan') {
      // V1 flashloan: use estimated loan token profit
      const estimatedProfit = plan.estimatedProfit || 0n;
      const minProfit = plan.minProfit || 0n;
      profitable = estimatedProfit >= minProfit || config.allowBadDebt;
    } else {
      // Prefund mode: compare swap output vs repay
      if (route) {
        profitable = route.expectedOut > liquidation.repayAssets || config.allowBadDebt;
      }
    }

    if (!profitable) {
      log(config, `  [STREAM-PROFIT_FAIL] ${userShort} ${pair}: not profitable`);
      streamingState.unprofitable++;
      return { status: 'unprofitable' };
    }

    streamingState.profitOk++;
    log(config, `  [STREAM-PROFIT_OK] ${userShort} ${pair}: ready to execute`);

    // Step 6: Execute (with maxTxPerTick enforcement)
    // Check if we've already sent enough TXs this tick
    if (executionCounter.sent >= config.maxTxPerTick) {
      log(config, `  [STREAM-TX_CAP] ${userShort} ${pair}: maxTxPerTick (${config.maxTxPerTick}) reached, skipping execution`);
      return { status: 'tx_capped', plan };
    }
    
    // Increment counter before executing (optimistic - prevents race conditions)
    executionCounter.sent++;
    log(config, `  [STREAM-EXEC] ${userShort} ${pair}: executing (TX ${executionCounter.sent}/${config.maxTxPerTick})...`);
    
    // Get balance before
    const balanceBefore = await executionClients.publicClient.readContract({
      address: plan.loanToken,
      abi: require('./lib/encodePlan').ERC20_ABI,
      functionName: 'balanceOf',
      args: [config.treasuryAddress],
    });

    // Execute with onSent callback for Telegram
    let txHash = null;
    const onSent = config.telegramSendOnSent && telegramClient
      ? async (hash) => {
          txHash = hash;
          const modeStr = config.executionMode === 'flashloan' ? 'FLASHLOAN' : 'PREFUND';
          const message = formatSent({
            chainId: config.chainId,
            mode: modeStr,
            marketId: liquidation.marketId,
            user: liquidation.user,
            loanToken: liquidation.loanSymbol,
            collateralToken: liquidation.collateralSymbol,
            txHash: hash,
          });
          await telegramClient.send(hash, message, { dedupeKey: hash });
        }
      : undefined;

    plan.tickId = tickId;
    plan.simulationResult = simResult;
    
    const result = await dispatchExecution(
      executionClients.walletClient,
      executionClients.publicClient,
      plan,
      config,
      simResult,
      onSent
    );

    if (result.success) {
      streamingState.execSuccess++;
      clearCooldown(liquidation.marketId, liquidation.user);

      // Calculate profit
      const profitInfo = await calculateActualProfit(
        executionClients.publicClient,
        config.treasuryAddress,
        plan.loanToken,
        balanceBefore
      );

      log(config, `  [STREAM-EXEC_OK] ${userShort} ${pair}: TX ${result.hash}`);

      // Telegram success notification
      if (telegramClient) {
        const modeStr = config.executionMode === 'flashloan' ? 'FLASHLOAN' : 'PREFUND';
        const message = formatSuccess({
          chainId: config.chainId,
          mode: modeStr,
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

      return { 
        status: 'executed', 
        success: true, 
        hash: result.hash, 
        profitInfo,
        liquidation,
        plan,
      };
    } else {
      streamingState.execFailed++;
      addToCooldown(liquidation.marketId, liquidation.user, `Exec failed: ${result.error}`, 'execFail');
      log(config, `  [STREAM-EXEC_FAIL] ${userShort} ${pair}: ${result.error}`);

      // Record execution error for daily digest
      if (ctx.errorDigest) {
        ctx.errorDigest.recordError({
          errorType: 'exec_failed',
          message: result.error || 'Unknown error',
          marketId: liquidation.marketId,
          user: liquidation.user,
          pair,
          route: route?.venue,
          amount: liquidation.repayAssets,
          extra: { txHash: result.hash },
        });
      }

      // Telegram failure notification
      if (telegramClient) {
        const dedupeKey = result.hash || `${liquidation.marketId}:${liquidation.user}:${Math.floor(Date.now() / 60000)}`;
        const modeStr = config.executionMode === 'flashloan' ? 'FLASHLOAN' : 'PREFUND';
        const message = formatFail({
          reason: result.error || 'Unknown error',
          txHash: result.hash,
          marketId: liquidation.marketId,
          user: liquidation.user,
          mode: modeStr,
          chainId: config.chainId,
          loanToken: liquidation.loanSymbol,
          collateralToken: liquidation.collateralSymbol,
        });
        await telegramClient.send(dedupeKey, message, { dedupeKey });
      }

      return { status: 'executed', success: false, error: result.error };
    }

  } catch (error) {
    streamingState.errors++;
    logError(config, `[STREAM-ERROR] ${userShort} ${pair}: ${error.message}`, error);
    addToCooldown(liquidation.marketId, liquidation.user, `Error: ${error.message}`, 'fail');
    
    // Record general error for daily digest
    if (ctx.errorDigest) {
      ctx.errorDigest.recordError({
        errorType: 'unknown',
        message: error.message,
        marketId: liquidation.marketId,
        user: liquidation.user,
        pair,
      });
    }
    
    return { status: 'error', error: error.message };
  }
}

/**
 * Print startup banner
 */
function printStartupBanner(config) {
  if (isJsonlEnabled(config)) {
    // Suppress banner in jsonl mode
    return;
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
  const tickStartTime = Date.now();
  // Get tickId from scheduler if available, otherwise use a counter or default
  let tickId = 'T?';
  if (ctx.scheduler && ctx.scheduler.tickNumber) {
    tickId = `T${ctx.scheduler.tickNumber}`;
  } else if (ctx._tickCounter !== undefined) {
    tickId = `T${ctx._tickCounter}`;
  }
  const mode = config.executionMode === 'flashloan' ? 'FLASHLOAN' : (config.executionMode === 'prefund' ? 'PREFUND' : 'BASE');
  
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
    filteredCooldown: 0,
    filteredCap: 0,
    filteredDust: 0,
    confirmedHealthy: 0,
    confirmedErrors: 0,
    triggers: {
      hasLiquidatable: false,
      hasExec: false,
      hasNearMiss: false,
    },
  };

  // Initialize tickStats accumulator for JSONL enrichment
  const tickStats = {
    candidates: {
      requested: 0,
      received: 0,
      unique: 0,
      sources: {
        apiCandidates: 0,
        sdkConfirmed: 0,
        onchainConfirmed: 0,
      },
    },
    confirmation: {
      checked: 0,
      liquidatable: 0,
      healthy: 0,
      errors: 0,
      durationMs: 0,
      throughputPosPerSec: 0,
      perMarket: {
        marketsTouched: 0,
        topMarketId: null,
        topPair: null,
      },
    },
    filtering: {
      input: 0,
      passed: 0,
      cooldown: 0,
      cap: 0,
      dust: 0,
      requireRouteDropped: 0,
    },
    planning: {
      plansBuilt: 0,
      plansSimulated: 0,
      plansProfitable: 0,
      dropped: {
        unprofitable: 0,
        simulateFail: 0,
        missingRoute: 0,
        minProfitFail: 0,
      },
    },
    execution: {
      sent: 0,
      confirmed: 0,
      success: 0,
      fail: 0,
      mode: mode,
    },
    economics: {
      totalProfitAsset: null,
      totalProfitUsd: null,
      totalGasUsed: 0,
      totalGasUsd: null,
    },
    rates: {
      morphoApiRequestsThisTick: 0,
      liquidSwapCallsThisTick: 0,
      rpcCallsThisTick: 0,
      multicallBatches: 0,
    },
    liquidatableUsers: [],
    droppedExamples: [],
    // Phase timings for frontend dashboard
    phases: {
      candidatesMs: 0,
      confirmationMs: 0,
      filteringMs: 0,
      planningMs: 0,
      simulationMs: 0,
      executionMs: 0,
    },
  };
  
  // Track phase start times
  const phaseTimings = {
    candidatesStart: tickStartTime,
    confirmationStart: null,
    filteringStart: null,
    planningStart: null,
    simulationStart: null,
    executionStart: null,
  };

  // Emit tick_start event with enriched data
  const tickStartEvent = {
    type: 'tick_start',
    tickId,
    mode,
    config: {
      intervalSec: config.tickBaseSeconds,
      batchSize: config.candidatesPerTick,
      mode: config.executionMode,
      executionEnabled: config.executionEnabled,
      useExecutorV2: config.useExecutorV2,
    },
  };

  // Add cache TTLs if applicable
  if (config.vaultsTtlMinutes || config.marketsTtlMinutes) {
    tickStartEvent.cache = {};
    if (config.vaultsTtlMinutes) {
      tickStartEvent.cache.vaultsTtlSec = config.vaultsTtlMinutes * 60;
    }
    if (config.marketsTtlMinutes) {
      tickStartEvent.cache.marketsTtlSec = config.marketsTtlMinutes * 60;
    }
  }

  // Add versions if available
  const pkgVersion = getPackageVersion();
  const commit = getGitCommit();
  if (pkgVersion || commit) {
    tickStartEvent.versions = {};
    if (pkgVersion) tickStartEvent.versions.pkgVersion = pkgVersion;
    if (commit) tickStartEvent.versions.commit = commit;
  }

  emitEvent(config, tickStartEvent);

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
      const durationMs = Date.now() - tickStartTime;
      const backlogState = backlog ? backlog.getStats() : null;
      emitEvent(config, {
        type: 'tick_skip',
        tickId,
        mode,
        durationMs,
        reasonCode: 'NO_VAULTS',
        reason: 'no vaults found',
        counts: {
          candidates: 0,
          confirmedLiquidatable: 0,
          passed: 0,
        },
        summary: {
          phases: { candidatesMs: tickStats.phases.candidatesMs },
          status: 'no_vaults',
          ...(backlogState && { backlog: backlogState }),
        },
      });
      return { ...metrics, durationMs };
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
      const durationMs = Date.now() - tickStartTime;
      const backlogState = backlog ? backlog.getStats() : null;
      emitEvent(config, {
        type: 'tick_skip',
        tickId,
        mode,
        durationMs,
        reasonCode: 'NO_MARKETS',
        reason: 'no markets found',
        counts: {
          candidates: 0,
          confirmedLiquidatable: 0,
          passed: 0,
        },
        summary: {
          phases: { candidatesMs: tickStats.phases.candidatesMs },
          status: 'no_markets',
          ...(backlogState && { backlog: backlogState }),
        },
      });
      return { ...metrics, durationMs };
    }

    const marketIds = markets.map(m => m.id);

    // Step 3: Get candidates from backlog (refill if needed)
    const candidatesToFetch = Math.min(
      config.candidatesPerTick,
      config.candidatesPerTick - backlog.queue.length
    );

    tickStats.candidates.requested = config.candidatesPerTick;

    if (candidatesToFetch > 0 || backlog.shouldRefetch()) {
      const fetched = await backlog.refillIfLow(
        async (targetSize) => {
          tickStats.rates.morphoApiRequestsThisTick++;
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
      tickStats.candidates.received = fetched;
      tickStats.candidates.sources.apiCandidates = fetched;
    }

    // Get batch from backlog (respecting cooldowns)
    const candidates = backlog.getBatch(config.candidatesPerTick, {
      solventCooldownMinutes: config.solventCooldownMinutes,
      failCooldownMinutes: config.failCooldownMinutes,
      execFailCooldownMinutes: config.execFailCooldownMinutes,
    });

    tickStats.candidates.unique = candidates.length;

    if (candidates.length === 0) {
      const durationMs = Date.now() - tickStartTime;
      const backlogState = backlog ? backlog.getStats() : null;
      emitEvent(config, {
        type: 'tick_skip',
        tickId,
        mode,
        durationMs,
        reasonCode: 'NO_CANDIDATES',
        reason: 'no candidates available',
        counts: {
          candidates: 0,
          confirmedLiquidatable: 0,
          passed: 0,
        },
        summary: {
          candidates: {
            requested: tickStats.candidates.requested,
            received: tickStats.candidates.received,
            unique: tickStats.candidates.unique,
          },
          phases: { candidatesMs: tickStats.phases.candidatesMs },
          status: 'no_candidates',
          ...(backlogState && { backlog: backlogState }),
        },
      });
      return { ...metrics, durationMs };
    }

    // Step 4: Confirm liquidatable positions with streaming execution
    // When execution is enabled, we process liquidations immediately as they're found
    // instead of waiting for the entire scan to complete
    const candidatesToConfirm = candidates.slice(0, config.maxConfirmationsPerTick);
    phaseTimings.candidatesEnd = Date.now();
    tickStats.phases.candidatesMs = phaseTimings.candidatesEnd - phaseTimings.candidatesStart;
    phaseTimings.confirmationStart = Date.now();
    const confirmStartTime = phaseTimings.confirmationStart;

    // Streaming execution state (shared across callback invocations)
    const streamingState = {
      tickId,
      mode,
      tickStats,
      metrics,
      // Counters for streaming pipeline
      filteredCooldown: 0,
      filteredCap: 0,
      filteredDust: 0,
      filterPassed: 0,
      liquidSwapCalls: 0,
      plansBuilt: 0,
      simSuccess: 0,
      simFailed: 0,
      profitOk: 0,
      unprofitable: 0,
      execSuccess: 0,
      execFailed: 0,
      errors: 0,
    };

    // Track processed positions to avoid duplicates
    const processedUsers = new Set();
    const pendingExecutions = [];
    let pipelinesStarted = 0;
    
    // Shared execution counter - tracks actual successful TX sends (not filtered/failed sims)
    // This is used inside processAndExecuteLiquidation to enforce maxTxPerTick
    const executionCounter = { sent: 0 };

    // Streaming callback - called immediately when liquidatable positions are found
    const onLiquidatableFound = config.executionEnabled && executionClients && !isPaused
      ? (batchLiquidatable) => {
          for (const liquidation of batchLiquidatable) {
            const key = `${liquidation.marketId}:${liquidation.user}`;
            
            // Skip if already processing
            if (processedUsers.has(key)) continue;
            
            // Cap pipelines by maxSimulationsPerTick (broader limit for starting work)
            if (pipelinesStarted >= config.maxSimulationsPerTick) continue;
            
            processedUsers.add(key);
            pipelinesStarted++;
            
            log(config, `  [STREAM] Found liquidatable: ${liquidation.user} ${liquidation.collateralSymbol}→${liquidation.loanSymbol}, starting pipeline...`);
            
            // Fire and forget - collect the promise for later await
            // Pass executionCounter so the pipeline can check/enforce maxTxPerTick before executing
            const promise = processAndExecuteLiquidation(liquidation, ctx, streamingState, executionCounter)
              .catch(err => ({ status: 'error', error: err.message }));
            
            pendingExecutions.push(promise);
          }
        }
      : null;

    // Run batchConfirm with streaming callback
    const confirmed = await batchConfirm(
      config.rpcUrl,
      config.morphoBlueAddress,
      candidatesToConfirm,
      config.maxConfirmationsPerTick,
      config,
      onLiquidatableFound
    );

    const confirmDurationMs = Date.now() - confirmStartTime;
    phaseTimings.confirmationEnd = Date.now();
    tickStats.phases.confirmationMs = confirmDurationMs;
    metrics.confirmedCount = confirmed.length;
    
    tickStats.confirmation.checked = candidatesToConfirm.length;
    tickStats.confirmation.durationMs = confirmDurationMs;
    if (confirmDurationMs > 0 && candidatesToConfirm.length > 0) {
      tickStats.confirmation.throughputPosPerSec = (candidatesToConfirm.length / (confirmDurationMs / 1000)).toFixed(2);
    }
    tickStats.candidates.sources.sdkConfirmed = confirmed.length;

    // Wait for all streaming executions to complete
    let streamingResults = [];
    if (pendingExecutions.length > 0) {
      log(config, `\n[STREAM] Waiting for ${pendingExecutions.length} streaming executions to complete...`);
      streamingResults = await Promise.all(pendingExecutions);
      
      // Update metrics from streaming results
      for (const result of streamingResults) {
        if (result.status === 'executed' && result.success) {
          metrics.execSuccessCount++;
          metrics.triggers.hasExec = true;
          tickStats.execution.success++;
          tickStats.execution.confirmed++;
          
          // Update economics
          if (result.profitInfo && result.profitInfo.profit !== undefined) {
            if (tickStats.economics.totalProfitAsset === null) {
              tickStats.economics.totalProfitAsset = 0n;
            }
            tickStats.economics.totalProfitAsset += result.profitInfo.profit;
          }
          
          // Add to liquidatableUsers
          if (result.liquidation && tickStats.liquidatableUsers.length < 5) {
            tickStats.liquidatableUsers.push({
              user: truncate(result.liquidation.user, 42),
              marketId: truncate(result.liquidation.marketId, 66),
              pair: truncate(`${result.liquidation.collateralSymbol}→${result.liquidation.loanSymbol}`, 20),
              repayAssets: result.liquidation.repayAssets.toString(),
              repaySymbol: result.liquidation.loanSymbol,
            });
          }
        } else if (result.status === 'executed' && !result.success) {
          metrics.errorsCount++;
          tickStats.execution.fail++;
          tickStats.execution.confirmed++;
        }
      }
      
      const successCount = streamingResults.filter(r => r.status === 'executed' && r.success).length;
      const failedCount = streamingResults.filter(r => r.status === 'executed' && !r.success).length;
      const filteredCount = streamingResults.filter(r => r.status === 'filtered').length;
      const txCappedCount = streamingResults.filter(r => r.status === 'tx_capped').length;
      const simFailedCount = streamingResults.filter(r => r.status === 'sim_failed').length;
      const unprofitableCount = streamingResults.filter(r => r.status === 'unprofitable').length;
      
      log(config, `[STREAM] Completed: ${successCount} success, ${failedCount} exec_failed, ${filteredCount} filtered, ${simFailedCount} sim_failed, ${unprofitableCount} unprofitable, ${txCappedCount} tx_capped`);
    }

    // Update metrics from streaming state
    metrics.filteredCooldown += streamingState.filteredCooldown;
    metrics.filteredCap += streamingState.filteredCap;
    metrics.filteredDust += streamingState.filteredDust;
    metrics.liquidatableCount = confirmed.length;
    metrics.simulatedCount = streamingState.simSuccess + streamingState.simFailed;
    metrics.simSuccessCount = streamingState.simSuccess;
    metrics.profitOkCount = streamingState.profitOk;
    metrics.executedCount = executionCounter.sent;
    
    tickStats.filtering.input = confirmed.length;
    tickStats.filtering.passed = streamingState.filterPassed;
    tickStats.filtering.cooldown += streamingState.filteredCooldown;
    tickStats.filtering.cap += streamingState.filteredCap;
    tickStats.filtering.dust += streamingState.filteredDust;
    tickStats.confirmation.liquidatable = confirmed.length;
    tickStats.rates.liquidSwapCallsThisTick += streamingState.liquidSwapCalls;
    tickStats.planning.plansBuilt = streamingState.plansBuilt;
    tickStats.planning.plansSimulated = streamingState.simSuccess;
    tickStats.planning.plansProfitable = streamingState.profitOk;
    tickStats.execution.sent = executionCounter.sent;

    // Check for liquidatable trigger
    if (confirmed.length > 0) {
      metrics.triggers.hasLiquidatable = true;
    }

    // If execution was disabled or paused, fall back to sequential processing for simulation-only mode
    if (!config.executionEnabled || !executionClients || isPaused) {
      // Sort confirmed by repayAssets descending (largest first = most profitable)
      confirmed.sort((a, b) => {
        const aRepay = a.repayAssets || 0n;
        const bRepay = b.repayAssets || 0n;
        if (bRepay > aRepay) return 1;
        if (bRepay < aRepay) return -1;
        return 0;
      });

      // Filter confirmed by cooldown, caps, and dust threshold
      phaseTimings.filteringStart = Date.now();
      const filtered = [];
      
      tickStats.filtering.input = confirmed.length;
      
      // Track market usage for perMarket stats
      const marketUsage = new Map();
      
      log(config, `\n[Filter] Filtering ${confirmed.length} confirmed positions (sorted by size desc)...`);
      
      for (const liquidation of confirmed) {
        const pair = `${liquidation.collateralSymbol}→${liquidation.loanSymbol}`;
        const userShort = liquidation.user;
        
        // Track market usage
        const marketKey = liquidation.marketId;
        if (!marketUsage.has(marketKey)) {
          marketUsage.set(marketKey, { count: 0, pair });
        }
        marketUsage.get(marketKey).count++;
        
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
          log(config, `  [COOLDOWN] ${userShort} ${pair}: ${cooldownCheck.remainingMinutes}m remaining (${cooldownCheck.reason})`);
          metrics.filteredCooldown++;
          tickStats.filtering.cooldown++;
          continue;
        }

        // Check repay cap (max)
        const capCheck = checkRepayCap(liquidation.repayAssets, config.maxRepayLoanAssets);
        if (capCheck.exceeds) {
          log(config, `  [CAP] ${userShort} ${pair}: repay exceeds cap`);
          metrics.filteredCap++;
          tickStats.filtering.cap++;
          continue;
        }

        log(config, `  [PASS] ${userShort} ${pair}: repay=${formatAmount(liquidation.repayAssets, liquidation.loanDecimals)}`);
        filtered.push(liquidation);
      }

      log(config, `[Filter] Summary: ${filtered.length} passed, ${metrics.filteredCooldown} cooldown, ${metrics.filteredCap} cap`);

      phaseTimings.filteringEnd = Date.now();
      tickStats.phases.filteringMs = phaseTimings.filteringEnd - phaseTimings.filteringStart;
      
      metrics.liquidatableCount = filtered.length;
      tickStats.filtering.passed = filtered.length;
      tickStats.confirmation.liquidatable = filtered.length;
      tickStats.confirmation.healthy = Math.max(0, confirmed.length - filtered.length);
      
      // Update perMarket stats
      tickStats.confirmation.perMarket.marketsTouched = marketUsage.size;
      if (marketUsage.size > 0) {
        const topMarket = Array.from(marketUsage.entries())
          .sort((a, b) => b[1].count - a[1].count)[0];
        tickStats.confirmation.perMarket.topMarketId = truncate(topMarket[0], 66);
        tickStats.confirmation.perMarket.topPair = truncate(topMarket[1].pair, 20);
      }

      if (filtered.length === 0) {
        const durationMs = Date.now() - tickStartTime;
        const backlogState = backlog ? backlog.getStats() : null;
        
        emitEvent(config, {
          type: 'tick_skip',
          tickId,
          mode,
          durationMs,
          reasonCode: confirmed.length > 0 ? 'ALL_FILTERED' : 'NO_LIQUIDATABLE',
          reason: confirmed.length > 0 ? 'all filtered (cooldown/cap)' : 'no liquidatable positions',
          counts: {
            candidates: candidates.length,
            confirmedLiquidatable: confirmed.length,
            passed: 0,
          },
          summary: {
            candidates: tickStats.candidates,
            confirmation: tickStats.confirmation,
            filtering: tickStats.filtering,
            phases: tickStats.phases,
            status: confirmed.length > 0 ? 'all_filtered' : 'no_liquidatable',
            ...(backlogState && { backlog: backlogState }),
          },
        });
        return { ...metrics, durationMs };
      }

      // Simulation-only mode: fetch routes and simulate without executing
      const activeExecutor = config.morphoBlueAddress;
      phaseTimings.planningStart = Date.now();
      const plans = [];

      log(config, `\n[Routes] Fetching routes for ${filtered.length} liquidatable positions...`);

      for (const liquidation of filtered) {
        try {
          tickStats.rates.liquidSwapCallsThisTick++;
          const route = await fetchSwapRoute(
            config.liquidSwapApiUrl,
            config.chainId,
            liquidation.marketParams.collateralToken,
            liquidation.marketParams.loanToken,
            liquidation.seizeAssets,
            activeExecutor,
            liquidation.collateralDecimals
          );

          if (!route && config.requireRoute) continue;

          const plan = buildLiquidationPlan(config, liquidation, route);
          plans.push(plan);
          tickStats.planning.plansBuilt++;
        } catch (error) {
          log(config, `  [ERROR] Route fetch failed: ${error.message}`);
        }
      }

      phaseTimings.planningEnd = Date.now();
      tickStats.phases.planningMs = phaseTimings.planningEnd - phaseTimings.planningStart;

      if (plans.length > 0) {
        phaseTimings.simulationStart = Date.now();
        const client = createClient(config.rpcUrl);
        const simulations = await batchSimulate(
          client,
          plans.slice(0, config.maxSimulationsPerTick),
          config.treasuryAddress,
          config.maxSimulationsPerTick
        );

        for (let i = 0; i < simulations.length; i++) {
          const sim = simulations[i];
          if (sim.planValid) {
            metrics.simSuccessCount++;
            tickStats.planning.plansSimulated++;
            if (isProfitable(sim, config.minProfitUsd)) {
              metrics.profitOkCount++;
              tickStats.planning.plansProfitable++;
            }
          }
        }

        phaseTimings.simulationEnd = Date.now();
        tickStats.phases.simulationMs = phaseTimings.simulationEnd - phaseTimings.simulationStart;
      }
    }

    // Emit tick_end event with comprehensive summary
    const durationMs = Date.now() - tickStartTime;
    
    // Update execution stats
    tickStats.execution.sent = metrics.executedCount;
    
    // Format economics (convert BigInt to string for JSON)
    const economics = { ...tickStats.economics };
    if (economics.totalProfitAsset !== null) {
      economics.totalProfitAsset = economics.totalProfitAsset.toString();
    }
    
    // Calculate success rates for frontend
    const successRates = {
      filterPassRate: tickStats.filtering.input > 0 
        ? ((tickStats.filtering.passed / tickStats.filtering.input) * 100).toFixed(1)
        : undefined,
      simSuccessRate: tickStats.planning.plansSimulated > 0
        ? ((tickStats.planning.plansProfitable / tickStats.planning.plansSimulated) * 100).toFixed(1)
        : undefined,
      execSuccessRate: tickStats.execution.confirmed > 0
        ? ((tickStats.execution.success / tickStats.execution.confirmed) * 100).toFixed(1)
        : undefined,
    };
    
    // Determine overall tick status
    let tickStatus = 'completed';
    if (tickStats.execution.success > 0) {
      tickStatus = 'success';
    } else if (tickStats.execution.fail > 0) {
      tickStatus = 'partial';
    } else if (tickStats.filtering.passed === 0 && tickStats.confirmation.liquidatable > 0) {
      tickStatus = 'all_filtered';
    } else if (tickStats.confirmation.liquidatable === 0 && tickStats.confirmation.checked > 0) {
      tickStatus = 'no_liquidatable';
    }
    
    // Get backlog state
    const backlogState = backlog ? backlog.getStats() : null;
    
    // Build comprehensive summary
    const summary = {
      candidates: {
        requested: tickStats.candidates.requested,
        received: tickStats.candidates.received,
        unique: tickStats.candidates.unique,
        sources: tickStats.candidates.sources,
      },
      confirmation: {
        checked: tickStats.confirmation.checked,
        liquidatable: tickStats.confirmation.liquidatable,
        healthy: tickStats.confirmation.healthy,
        errors: tickStats.confirmation.errors,
        durationMs: tickStats.confirmation.durationMs,
        throughputPosPerSec: tickStats.confirmation.throughputPosPerSec ? parseFloat(tickStats.confirmation.throughputPosPerSec) : undefined,
        perMarket: tickStats.confirmation.perMarket.marketsTouched > 0 ? tickStats.confirmation.perMarket : undefined,
      },
      filtering: {
        input: tickStats.filtering.input,
        passed: tickStats.filtering.passed,
        cooldown: tickStats.filtering.cooldown,
        cap: tickStats.filtering.cap,
        dust: tickStats.filtering.dust,
        ...(tickStats.filtering.requireRouteDropped > 0 && { requireRouteDropped: tickStats.filtering.requireRouteDropped }),
      },
      planning: {
        plansBuilt: tickStats.planning.plansBuilt,
        plansSimulated: tickStats.planning.plansSimulated,
        plansProfitable: tickStats.planning.plansProfitable,
        dropped: tickStats.planning.dropped,
      },
      execution: {
        sent: tickStats.execution.sent,
        confirmed: tickStats.execution.confirmed,
        success: tickStats.execution.success,
        fail: tickStats.execution.fail,
        mode: tickStats.execution.mode,
      },
      ...(economics.totalProfitAsset !== null || economics.totalGasUsed > 0 ? { economics } : {}),
      rates: {
        morphoApiRequestsThisTick: tickStats.rates.morphoApiRequestsThisTick,
        liquidSwapCallsThisTick: tickStats.rates.liquidSwapCallsThisTick,
        ...(tickStats.rates.rpcCallsThisTick > 0 && { rpcCallsThisTick: tickStats.rates.rpcCallsThisTick }),
        ...(tickStats.rates.multicallBatches > 0 && { multicallBatches: tickStats.rates.multicallBatches }),
      },
      ...(tickStats.liquidatableUsers.length > 0 && { liquidatableUsers: tickStats.liquidatableUsers }),
      ...(tickStats.droppedExamples.length > 0 && { droppedExamples: tickStats.droppedExamples }),
      // Frontend-friendly additions
      phases: tickStats.phases,
      successRates: Object.keys(successRates).some(k => successRates[k] !== undefined) ? successRates : undefined,
      status: tickStatus,
      ...(backlogState && { backlog: backlogState }),
    };
    
    emitEvent(config, {
      type: 'tick_end',
      tickId,
      mode,
      durationMs,
      summary,
    });

    return { ...metrics, durationMs };

  } catch (error) {
    const durationMs = Date.now() - tickStartTime;
    logError(config, `Tick error: ${error.message}`, error);
    emitEvent(config, {
      type: 'error',
      tickId,
      mode,
      stage: 'unknown',
      message: truncate(error.message, 160),
    });
    metrics.errorsCount++;
    return { ...metrics, durationMs };
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

  log(config, '\nInitializing execution clients...');
  const executionClients = createExecutionClients(config);
  const activeExecutor = getActiveExecutorAddress(config);

  if (config.executionMode === 'flashloan') {
    // Use V2 verification if V2 executor is enabled
    if (config.useExecutorV2 && config.flashloanExecutorV2Address) {
      const verification = await verifyFlashloanExecutorV2(
        executionClients.publicClient,
        activeExecutor,
        executionClients.account.address,
        config.morphoBlueAddress,
        config.whypeAddress
      );

      if (!verification.valid) {
        logError(config, `\n❌ Flashloan executor V2 verification failed:`);
        if (!isJsonlEnabled(config)) {
          verification.errors.forEach(e => console.error(`  - ${e}`));
        }
        process.exit(1);
      }
      log(config, `✓ Flashloan executor V2 verified. Owner: ${verification.owner}, Morpho: ${verification.morpho}, WHYPE: ${verification.whype}`);
    } else {
      // V1 verification
      const verification = await verifyFlashloanExecutor(
        executionClients.publicClient,
        activeExecutor,
        executionClients.account.address,
        config.morphoBlueAddress
      );

      if (!verification.valid) {
        logError(config, `\n❌ Flashloan executor verification failed:`);
        if (!isJsonlEnabled(config)) {
          verification.errors.forEach(e => console.error(`  - ${e}`));
        }
        process.exit(1);
      }
      log(config, `✓ Flashloan executor verified. Owner: ${verification.owner}, Morpho: ${verification.morpho}`);
    }
  } else {
    const isOwner = await verifyExecutorOwnership(
      executionClients.publicClient,
      activeExecutor,
      executionClients.account.address
    );

    if (!isOwner) {
      logError(config, `\n❌ Bot account ${executionClients.account.address} is not owner of executor ${activeExecutor}`);
      process.exit(1);
    }
    log(config, `✓ Executor ownership verified. Bot: ${executionClients.account.address}`);
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

    // Initialize error digest (daily summary at 8am UTC)
    const errorDigest = telegramClient ? createErrorDigest({
      telegramClient,
      targetHourUtc: config.errorDigestHourUtc ?? 8,
      maxErrorsPerType: 10,
      maxTotalErrors: 500,
      enabled: config.errorDigestEnabled !== false, // Enabled by default if telegram is configured
    }) : null;

    // Start error digest scheduler
    if (errorDigest) {
      errorDigest.startScheduler();
      log(config, `✓ Error digest enabled (sends at ${config.errorDigestHourUtc ?? 8}:00 UTC)`);
    }

    // Initialize backlog
    const backlog = new CandidateBacklog(config);

    // Create context
    const ctx = {
      config,
      executionClients,
      backlog,
      telegramClient,
      errorDigest,
    };

    // Send startup notification
    if (telegramClient) {
      await telegramClient.send('bot_start', '🤖 BOT START', { force: true });
    }

    // Run once or start scheduler
    if (config.runOnce) {
      log(config, '\n[RUN_ONCE=1] Running single tick...\n');
      ctx._tickCounter = 1; // Set tick counter for runOnce mode
      const metrics = await runTick(ctx);
      log(config, '\n✓ Single tick complete');
      log(config, `  Candidates: ${metrics.fetchedCandidates}, Confirmed: ${metrics.confirmedCount}, Liquidatable: ${metrics.liquidatableCount}`);
      log(config, `  Simulated: ${metrics.simSuccessCount}/${metrics.simulatedCount}, Executed: ${metrics.execSuccessCount}/${metrics.executedCount}`);
      process.exit(0);
    } else {
      // Start scheduler with cleanup callback
      const scheduler = new Scheduler(config);
      
      const onShutdown = async () => {
        // Send final error digest before shutdown if there are errors
        if (errorDigest && errorDigest.totalErrorCount > 0) {
          log(config, '[Shutdown] Sending final error digest...');
          await errorDigest.sendDigestAndReset();
        }
        if (errorDigest) {
          errorDigest.cleanup();
        }
        if (telegramClient) {
          await telegramClient.send('bot_stop', '🛑 BOT STOP', { force: true });
          telegramClient.cleanup();
        }
      };
      
      await scheduler.runScheduler(runTick, ctx, onShutdown);
    }

  } catch (error) {
    logError(config, '\n❌ Error:', error);
    if (!isJsonlEnabled(config)) {
      if (error.message.includes('fetch') || error.message.includes('ECONNREFUSED')) {
        console.error('\n💡 Network error: check RPC and API connectivity.');
      }

      if (error.message.includes('EXECUTOR_ADDRESS') || error.message.includes('PRIVATE_KEY')) {
        console.error('\n💡 Configuration error: check required env vars for execution mode.');
      }
    }

    process.exit(1);
  }
}

// Run the bot
main();
