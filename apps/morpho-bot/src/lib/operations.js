/**
 * Operational controls for Morpho liquidation bot
 * Milestone 3: Kill switch, cooldowns, caps, Telegram notifications
 */

const { formatUnits } = require('viem');

/**
 * In-memory cooldown cache
 * Key: `${marketId}:${user}` (lowercase)
 * Value: { failedAt: timestamp, reason: string }
 */
const cooldownCache = new Map();

/**
 * Check if bot is paused
 * @param {Object} config - Configuration
 * @returns {boolean} True if paused
 */
function isBotPaused(config) {
  return config.botPaused === true;
}

/**
 * Check if position is in cooldown
 * @param {string} marketId - Market ID
 * @param {string} user - User address
 * @param {number} cooldownMinutes - Cooldown duration in minutes
 * @returns {Object} { inCooldown: boolean, reason?: string, remainingMinutes?: number }
 */
function checkCooldown(marketId, user, cooldownMinutes) {
  const key = `${marketId.toLowerCase()}:${user.toLowerCase()}`;
  const entry = cooldownCache.get(key);
  
  if (!entry) {
    return { inCooldown: false };
  }
  
  const elapsed = (Date.now() - entry.failedAt) / 1000 / 60; // minutes
  
  if (elapsed >= cooldownMinutes) {
    // Cooldown expired, remove entry
    cooldownCache.delete(key);
    return { inCooldown: false };
  }
  
  return {
    inCooldown: true,
    reason: entry.reason,
    remainingMinutes: Math.ceil(cooldownMinutes - elapsed),
  };
}

/**
 * Add position to cooldown
 * @param {string} marketId - Market ID
 * @param {string} user - User address
 * @param {string} reason - Reason for cooldown
 */
function addToCooldown(marketId, user, reason) {
  const key = `${marketId.toLowerCase()}:${user.toLowerCase()}`;
  cooldownCache.set(key, {
    failedAt: Date.now(),
    reason,
  });
}

/**
 * Clear cooldown for a position
 * @param {string} marketId - Market ID
 * @param {string} user - User address
 */
function clearCooldown(marketId, user) {
  const key = `${marketId.toLowerCase()}:${user.toLowerCase()}`;
  cooldownCache.delete(key);
}

/**
 * Get cooldown stats
 * @returns {Object} { count: number, entries: Array }
 */
function getCooldownStats() {
  const entries = [];
  for (const [key, value] of cooldownCache.entries()) {
    entries.push({
      key,
      ...value,
      age: Math.floor((Date.now() - value.failedAt) / 1000 / 60),
    });
  }
  return {
    count: cooldownCache.size,
    entries,
  };
}

/**
 * Check if repay amount exceeds cap
 * @param {bigint} repayAssets - Repay amount
 * @param {bigint|null} maxRepay - Maximum repay cap (null = no cap)
 * @returns {Object} { exceeds: boolean, capped?: bigint }
 */
function checkRepayCap(repayAssets, maxRepay) {
  if (maxRepay === null) {
    return { exceeds: false };
  }
  
  if (repayAssets > maxRepay) {
    return {
      exceeds: true,
      original: repayAssets,
      capped: maxRepay,
    };
  }
  
  return { exceeds: false };
}

/**
 * Apply slippage check to swap output
 * @param {bigint} expectedOut - Expected swap output
 * @param {bigint} minAmountOut - Minimum acceptable output
 * @param {number} slippageBps - Slippage tolerance in basis points
 * @returns {Object} { acceptable: boolean, calculatedMin: bigint }
 */
function checkSlippage(expectedOut, minAmountOut, slippageBps) {
  // Calculate our own minimum based on expected and slippage
  // Add 1 wei buffer to account for rounding differences
  const calculatedMin = expectedOut - (expectedOut * BigInt(slippageBps)) / 10000n - 1n;
  
  // Route's minAmountOut should be at least as good as our calculated minimum
  const acceptable = minAmountOut >= calculatedMin;
  
  // Calculate actual slippage in basis points
  const actualSlippageBps = expectedOut > 0n 
    ? Number((expectedOut - minAmountOut) * 10000n / expectedOut)
    : 0;
  
  return {
    acceptable,
    expectedOut,
    minAmountOut,
    calculatedMin,
    actualSlippageBps,
  };
}

/**
 * Send Telegram notification
 * @param {string} token - Telegram bot token
 * @param {string} chatId - Telegram chat ID
 * @param {string} message - Message to send
 * @returns {Promise<boolean>} Success status
 */
async function sendTelegramNotification(token, chatId, message) {
  if (!token || !chatId) {
    return false;
  }
  
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    
    return response.ok;
  } catch (error) {
    console.warn(`Telegram notification failed: ${error.message}`);
    return false;
  }
}

/**
 * Format success notification for Telegram
 * @param {Object} result - Execution result
 * @param {Object} plan - Execution plan
 * @param {Object} profitInfo - Profit calculation
 * @returns {string} Formatted Telegram message
 */
function formatSuccessNotification(result, plan, profitInfo) {
  const { liquidation } = plan;
  const lines = [
    '✅ <b>Liquidation Successful</b>',
    '',
    `<b>Market:</b> ${liquidation.loanSymbol}/${liquidation.collateralSymbol}`,
    `<b>User:</b> <code>${liquidation.user}</code>`,
    `<b>Repaid:</b> ${formatUnits(liquidation.repayAssets, liquidation.loanDecimals)} ${liquidation.loanSymbol}`,
    `<b>Seized:</b> ${formatUnits(liquidation.seizeAssets, liquidation.collateralDecimals)} ${liquidation.collateralSymbol}`,
  ];
  
  if (profitInfo && profitInfo.profit !== undefined) {
    const profitStr = formatUnits(profitInfo.profit, liquidation.loanDecimals);
    const sign = profitInfo.profit >= 0n ? '+' : '';
    lines.push(`<b>Profit:</b> ${sign}${profitStr} ${liquidation.loanSymbol}`);
  }
  
  lines.push('');
  lines.push(`<b>TX:</b> <a href="https://purrsec.com/tx/${result.hash}">${result.hash.slice(0, 18)}...</a>`);
  lines.push(`<b>Gas:</b> ${result.gasUsed?.toLocaleString() || 'N/A'}`);
  lines.push(`<b>Block:</b> ${result.blockNumber}`);
  
  return lines.join('\n');
}

/**
 * Format failure notification for Telegram
 * @param {Object} result - Execution result
 * @param {Object} plan - Execution plan
 * @param {string} stage - Stage where failure occurred
 * @returns {string} Formatted Telegram message
 */
function formatFailureNotification(result, plan, stage) {
  const { liquidation } = plan;
  const lines = [
    '❌ <b>Liquidation Failed</b>',
    '',
    `<b>Stage:</b> ${stage}`,
    `<b>Market:</b> ${liquidation.loanSymbol}/${liquidation.collateralSymbol}`,
    `<b>User:</b> <code>${liquidation.user}</code>`,
    '',
    `<b>Error:</b> ${result.error || 'Unknown error'}`,
  ];
  
  if (result.hash) {
    lines.push('');
    lines.push(`<b>TX:</b> <a href="https://purrsec.com/tx/${result.hash}">${result.hash.slice(0, 18)}...</a>`);
  }
  
  return lines.join('\n');
}

/**
 * Run statistics tracking
 */
class RunStats {
  constructor() {
    this.reset();
  }
  
  reset() {
    this.candidates = 0;
    this.confirmed = 0;
    this.routesFound = 0;
    this.simulatedOk = 0;
    this.profitable = 0;
    this.executed = 0;
    this.failed = 0;
    this.skippedCooldown = 0;
    this.skippedCap = 0;
    this.skippedBalance = 0;
    this.totalProfit = 0n;
    this.errors = [];
  }
  
  toSummary() {
    return {
      candidates: this.candidates,
      confirmed: this.confirmed,
      routesFound: this.routesFound,
      simulatedOk: this.simulatedOk,
      profitable: this.profitable,
      executed: this.executed,
      failed: this.failed,
      skipped: {
        cooldown: this.skippedCooldown,
        cap: this.skippedCap,
        balance: this.skippedBalance,
      },
      totalProfit: this.totalProfit,
      errors: this.errors.slice(0, 10), // First 10 errors
    };
  }
  
  printSummary(config) {
    const mode = config.executionEnabled ? 'EXECUTION' : 'SIMULATION';
    const execMode = (config.executionMode || 'prefund').toUpperCase();
    console.log('\n' + '='.repeat(70));
    console.log(`MORPHO BOT · HYPEREVM · MILESTONE 4 · ${mode} · ${execMode}`);
    console.log('='.repeat(70));
    console.log(`Candidates discovered:    ${this.candidates}`);
    console.log(`Confirmed liquidatable:   ${this.confirmed}`);
    console.log(`Routes found:             ${this.routesFound}`);
    console.log(`Simulations OK:           ${this.simulatedOk}`);
    console.log(`Profitable:               ${this.profitable}`);
    if (config.executionEnabled) {
      console.log(`Executed:                 ${this.executed}`);
      console.log(`Failed:                   ${this.failed}`);
    }
    console.log(`Skipped (cooldown):       ${this.skippedCooldown}`);
    console.log(`Skipped (cap):            ${this.skippedCap}`);
    console.log(`Skipped (balance):        ${this.skippedBalance}`);
    console.log('='.repeat(70));
  }
}

module.exports = {
  isBotPaused,
  checkCooldown,
  addToCooldown,
  clearCooldown,
  getCooldownStats,
  checkRepayCap,
  checkSlippage,
  sendTelegramNotification,
  formatSuccessNotification,
  formatFailureNotification,
  RunStats,
};
