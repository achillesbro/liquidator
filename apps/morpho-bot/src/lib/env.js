/**
 * Environment configuration loader
 * Milestone 4: Flashloan execution mode support
 */

const path = require('path');
const fs = require('fs');

/**
 * Load environment variables from .env file if present
 */
function loadEnv() {
  const envPath = path.join(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim();
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    });
  }
}

loadEnv();

/** @type {'prefund' | 'flashloan'} */
const EXECUTION_MODES = ['prefund', 'flashloan'];

/**
 * Validate configuration for execution mode
 * @param {Object} config - Configuration object
 * @throws {Error} If required config is missing
 */
function validateExecutionConfig(config) {
  const errors = [];
  
  if (config.executionEnabled) {
    if (!config.privateKey) {
      errors.push('LIQUIDATION_PRIVATE_KEY_999 is required when EXECUTION_ENABLED=1');
    }
    if (!config.treasuryAddress) {
      errors.push('TREASURY_ADDRESS is required when EXECUTION_ENABLED=1');
    }
    
    // Mode-specific validation
    if (config.executionMode === 'prefund') {
      if (!config.executorAddress) {
        errors.push('EXECUTOR_ADDRESS_999 is required when EXECUTION_MODE=prefund');
      }
    } else if (config.executionMode === 'flashloan') {
      if (!config.flashloanExecutorAddress) {
        errors.push('FLASHLOAN_EXECUTOR_ADDRESS_999 is required when EXECUTION_MODE=flashloan');
      }
    }
    
    // Validate execution mode is valid
    if (!EXECUTION_MODES.includes(config.executionMode)) {
      errors.push(`EXECUTION_MODE must be one of: ${EXECUTION_MODES.join(', ')}`);
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Get configuration from environment variables with defaults
 */
function getConfig() {
  // Parse execution mode
  const executionMode = (process.env.EXECUTION_MODE || 'prefund').toLowerCase();
  
  const config = {
    // Chain configuration
    chainId: parseInt(process.env.CHAIN_ID || '999', 10),
    rpcUrl: process.env.RPC_URL_999 || 'https://rpc.hyperliquid.xyz/evm',
    
    // API endpoints
    morphoApiUrl: process.env.MORPHO_API_URL || 'https://api.morpho.org',
    ponderServiceUrl: process.env.PONDER_SERVICE_URL || 'http://localhost:42069',
    
    // Morpho Blue constants (HyperEVM)
    morphoBlueAddress: '0x68e37dE8d93d3496ae143F2E900490f6280C57cD',
    whypeAddress: '0x5555555555555555555555555555555555555555',
    multicall3Address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    
    // Milestone 4: Execution mode configuration
    executionEnabled: parseInt(process.env.EXECUTION_ENABLED || '0', 10) === 1,
    executionMode, // 'prefund' or 'flashloan'
    privateKey: process.env.LIQUIDATION_PRIVATE_KEY_999 || '',
    
    // Prefund mode (Milestone 3)
    executorAddress: process.env.EXECUTOR_ADDRESS_999 || '',
    
    // Flashloan mode (Milestone 4)
    flashloanExecutorAddress: process.env.FLASHLOAN_EXECUTOR_ADDRESS_999 || '',
    // Flashloan buffer: must be large enough to cover interest accrual during liquidation
    // Default 100% buffer (double repay amount) to handle deeply underwater positions
    // Morpho's liquidation math can require more than the calculated repay due to:
    // - Interest accrual during the liquidate call
    // - Rounding in share/asset conversions
    // - Bad debt scenarios where collateral < debt
    flashloanBufferBps: parseInt(process.env.FLASHLOAN_BUFFER_BPS || '10000', 10), // 100% buffer
    maxFlashloanAssets: process.env.MAX_FLASHLOAN_ASSETS 
      ? BigInt(process.env.MAX_FLASHLOAN_ASSETS) 
      : null, // null = no cap
    minFlashloanProfit: process.env.MIN_FLASHLOAN_PROFIT
      ? BigInt(process.env.MIN_FLASHLOAN_PROFIT)
      : 0n, // Minimum profit in loan token units
    requireRoute: parseInt(process.env.REQUIRE_ROUTE || '1', 10) === 1, // Fail if no swap route
    
    // Treasury (both modes)
    treasuryAddress: process.env.TREASURY_ADDRESS || '0xdA042130f265e594e3f8aF12E006F63BAD2349d3',
    
    // Safety controls
    botPaused: process.env.BOT_PAUSED === 'true',
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || '50', 10), // 0.5% default
    cooldownMinutes: parseInt(process.env.COOLDOWN_MINUTES || '60', 10),
    maxRepayLoanAssets: process.env.MAX_REPAY_LOAN_ASSETS 
      ? BigInt(process.env.MAX_REPAY_LOAN_ASSETS) 
      : null, // null = no cap
    maxTxPerRun: parseInt(process.env.MAX_TX_PER_RUN || '5', 10),
    
    // Gas limits (optional)
    maxGas: process.env.MAX_GAS ? parseInt(process.env.MAX_GAS, 10) : null,
    maxFeeGwei: process.env.MAX_FEE_GWEI ? parseFloat(process.env.MAX_FEE_GWEI) : null,
    
    // Telegram notifications (optional)
    telegramToken: process.env.TELEGRAM_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    
    // Milestone 2 configuration
    maxCandidates: parseInt(process.env.MAX_CANDIDATES || '100', 10),
    maxSimulations: parseInt(process.env.MAX_SIMULATIONS || '25', 10),
    maxPositionsPrint: parseInt(process.env.MAX_POSITIONS_PRINT || '50', 10),
    simulationOnly: parseInt(process.env.SIMULATION_ONLY || '1', 10) === 1,
    profitCheckEnabled: parseInt(process.env.PROFIT_CHECK_ENABLED || '1', 10) === 1,
    minProfitUsd: parseFloat(process.env.MIN_PROFIT_USD || '0'),
    
    // Testing mode - artificially lower LLTV to find at-risk positions
    testMode: parseInt(process.env.TEST_MODE || '0', 10) === 1,
    testLltvMultiplier: parseFloat(process.env.TEST_LLTV_MULTIPLIER || '0.80'), // 80% of actual LLTV
    
    // LiquidSwap configuration
    liquidSwapApiUrl: process.env.LIQUIDSWAP_API_URL || 'https://api.liqd.ag',
    liquidSwapRouterAddress: '0x744489ee3d540777a66f2cf297479745e0852f7a',
    maxPriceImpactPct: parseFloat(process.env.MAX_PRICE_IMPACT_PCT || '10'), // Max 10% price impact
    
    // Bad debt handling
    allowBadDebt: process.env.ALLOW_BAD_DEBT === 'true',
    
    // Testing: allow unprofitable liquidations (for testing plumbing)
    allowUnprofitable: process.env.ALLOW_UNPROFITABLE === '1' || process.env.ALLOW_UNPROFITABLE === 'true',
    
    // Minimum repay amount filter (skip dust positions)
    // Default: 1 USD worth (assuming 6 decimals for most stables)
    minRepayAssets: process.env.MIN_REPAY_ASSETS 
      ? BigInt(process.env.MIN_REPAY_ASSETS)
      : 1000000n, // 1 USDC/USDT (6 decimals)
    
    // Seize buffer: reduce seizeAssets by this % to avoid rounding/timing issues
    // Default: 5 bps (0.05%) - small enough to not lose much, large enough to handle drift
    seizeBufferBps: parseInt(process.env.SEIZE_BUFFER_BPS || '5', 10),
    
    // Scheduler configuration
    tickBaseSeconds: parseInt(process.env.TICK_BASE_SECONDS || '30', 10),
    tickFastSeconds: parseInt(process.env.TICK_FAST_SECONDS || '10', 10),
    jitterPct: parseInt(process.env.JITTER_PCT || '10', 10),
    fastModeMinutes: parseInt(process.env.FAST_MODE_MINUTES || '5', 10),
    
    // Cache TTLs (in minutes)
    vaultsTtlMinutes: parseInt(process.env.VAULTS_TTL_MINUTES || '30', 10),
    marketsTtlMinutes: parseInt(process.env.MARKETS_TTL_MINUTES || '15', 10),
    candidatesTtlSeconds: parseInt(process.env.CANDIDATES_TTL_SECONDS || '20', 10),
    
    // Per-tick caps
    candidatesPerTick: parseInt(process.env.CANDIDATES_PER_TICK || '400', 10),
    maxConfirmationsPerTick: parseInt(process.env.MAX_CONFIRMATIONS_PER_TICK || '200', 10),
    maxSimulationsPerTick: parseInt(process.env.MAX_SIMULATIONS_PER_TICK || '75', 10),
    maxTxPerTick: parseInt(process.env.MAX_TX_PER_TICK || '2', 10),
    
    // Cooldown durations (in minutes)
    solventCooldownMinutes: parseInt(process.env.SOLVENT_COOLDOWN_MINUTES || '30', 10),
    failCooldownMinutes: parseInt(process.env.FAIL_COOLDOWN_MINUTES || '60', 10),
    execFailCooldownMinutes: parseInt(process.env.EXEC_FAIL_COOLDOWN_MINUTES || '120', 10),
    
    // Run mode
    runOnce: parseInt(process.env.RUN_ONCE || '0', 10) === 1,
  };
  
  // Validate if execution is enabled
  if (config.executionEnabled) {
    validateExecutionConfig(config);
  }
  
  return config;
}

/**
 * Get the active executor address based on execution mode
 * @param {Object} config - Configuration object
 * @returns {string} Active executor address
 */
function getActiveExecutorAddress(config) {
  if (config.executionMode === 'flashloan') {
    return config.flashloanExecutorAddress;
  }
  return config.executorAddress;
}

module.exports = { getConfig, validateExecutionConfig, getActiveExecutorAddress, EXECUTION_MODES };
