/**
 * Daily Error Digest - Collects errors and sends summary via Telegram at 8am UTC
 * 
 * Tracks simulation/execution errors throughout the day and aggregates them
 * into a single digest message for debugging purposes.
 */

/**
 * @typedef {Object} ErrorRecord
 * @property {string} ts - ISO timestamp
 * @property {string} errorType - Error type identifier
 * @property {string} message - Human-readable error message
 * @property {string} marketId - Market ID (hex)
 * @property {string} user - User address
 * @property {string} pair - Trading pair (e.g., "WETH→USDC")
 * @property {string} [route] - Swap route venue if applicable
 * @property {bigint|string} [amount] - Relevant amount (repay, seize, etc.)
 * @property {string} [selector] - Raw error selector if available
 * @property {Object} [extra] - Additional context
 */

/**
 * Error Digest Manager
 * Collects errors and sends daily summaries
 */
class ErrorDigest {
  /**
   * @param {Object} options
   * @param {Object} options.telegramClient - Telegram client instance
   * @param {number} [options.targetHourUtc=8] - Hour (0-23) to send digest (UTC)
   * @param {number} [options.maxErrorsPerType=10] - Max examples to keep per error type
   * @param {number} [options.maxTotalErrors=500] - Max total errors to store
   * @param {boolean} [options.enabled=true] - Whether digest is enabled
   */
  constructor({ telegramClient, targetHourUtc = 8, maxErrorsPerType = 10, maxTotalErrors = 500, enabled = true }) {
    this.telegramClient = telegramClient;
    this.targetHourUtc = targetHourUtc;
    this.maxErrorsPerType = maxErrorsPerType;
    this.maxTotalErrors = maxTotalErrors;
    this.enabled = enabled;

    // Error storage: Map<errorType, ErrorRecord[]>
    this.errorsByType = new Map();
    this.totalErrorCount = 0;
    this.periodStart = new Date();
    
    // Scheduler state
    this.schedulerInterval = null;
    this.lastDigestSentDate = null; // YYYY-MM-DD of last sent digest
  }

  /**
   * Record an error
   * @param {ErrorRecord} error - Error to record
   */
  recordError(error) {
    if (!this.enabled || this.totalErrorCount >= this.maxTotalErrors) {
      return;
    }

    const errorType = error.errorType || 'unknown';
    
    if (!this.errorsByType.has(errorType)) {
      this.errorsByType.set(errorType, []);
    }
    
    const errors = this.errorsByType.get(errorType);
    
    // Store up to maxErrorsPerType examples
    if (errors.length < this.maxErrorsPerType) {
      errors.push({
        ts: error.ts || new Date().toISOString(),
        errorType,
        message: error.message,
        marketId: error.marketId,
        user: error.user,
        pair: error.pair,
        route: error.route,
        amount: error.amount?.toString(),
        selector: error.selector,
        extra: error.extra,
      });
    }
    
    this.totalErrorCount++;
  }

  /**
   * Get current error statistics
   * @returns {Object} Error stats
   */
  getStats() {
    const stats = {
      totalErrors: this.totalErrorCount,
      errorTypes: this.errorsByType.size,
      periodStartUtc: this.periodStart.toISOString(),
      byType: {},
    };

    for (const [errorType, errors] of this.errorsByType) {
      stats.byType[errorType] = {
        count: errors.length,
        // If we hit maxErrorsPerType, actual count is higher
        estimatedTotal: errors.length >= this.maxErrorsPerType 
          ? `${errors.length}+` 
          : errors.length,
      };
    }

    return stats;
  }

  /**
   * Format digest message for Telegram
   * @returns {string} Formatted HTML message
   */
  formatDigestMessage() {
    const now = new Date();
    const periodDurationHours = Math.round((now - this.periodStart) / (1000 * 60 * 60));
    
    let message = `📊 <b>Daily Error Digest</b>\n`;
    message += `Period: ${periodDurationHours}h (since ${this.periodStart.toISOString().slice(0, 16)}Z)\n\n`;
    
    if (this.totalErrorCount === 0) {
      message += `✅ <b>No errors recorded</b>\n`;
      return message;
    }

    message += `<b>Total Errors:</b> ${this.totalErrorCount}\n`;
    message += `<b>Error Types:</b> ${this.errorsByType.size}\n\n`;

    // Sort error types by frequency (estimated)
    const sortedTypes = Array.from(this.errorsByType.entries())
      .sort((a, b) => b[1].length - a[1].length);

    for (const [errorType, errors] of sortedTypes) {
      const countStr = errors.length >= this.maxErrorsPerType 
        ? `${errors.length}+` 
        : `${errors.length}`;
      
      message += `\n<b>${this.formatErrorType(errorType)}</b> (${countStr})\n`;
      
      // Show up to 3 examples
      const examples = errors.slice(0, 3);
      for (const err of examples) {
        const marketShort = err.marketId ? `${err.marketId.slice(0, 10)}...` : '?';
        const userShort = err.user ? `${err.user.slice(0, 8)}...` : '?';
        const timeShort = err.ts ? err.ts.slice(11, 16) : '?';
        
        message += `  • <code>${timeShort}</code> ${err.pair || '?'} ${userShort}\n`;
        
        // Add relevant details based on error type
        if (err.amount) {
          message += `    amt: ${err.amount}\n`;
        }
        if (err.route) {
          message += `    route: ${err.route}\n`;
        }
        if (err.message && err.message.length < 60) {
          message += `    msg: ${err.message}\n`;
        }
      }
      
      if (errors.length > 3) {
        message += `  ... and ${errors.length - 3} more\n`;
      }
    }

    return message;
  }

  /**
   * Format error type for display
   * @param {string} errorType - Raw error type
   * @returns {string} Formatted error type
   */
  formatErrorType(errorType) {
    const typeLabels = {
      'insufficient_hype_profit': '💰 Insufficient HYPE Profit',
      'insufficient_profit': '💰 Insufficient Profit',
      'insufficient_balance': '💳 Insufficient Balance',
      'call_failed': '❌ Call Failed',
      'only_morpho': '🔒 Only Morpho',
      'unexpected_flashloan': '⚡ Unexpected Flashloan',
      'hype_transfer_failed': '💸 HYPE Transfer Failed',
      'revert_string': '⚠️ Revert',
      'panic': '🚨 Panic',
      'sim_failed': '🔬 Simulation Failed',
      'exec_failed': '⚡ Execution Failed',
      'route_failed': '🛤️ Route Failed',
      'unknown': '❓ Unknown',
    };
    
    return typeLabels[errorType] || `❓ ${errorType}`;
  }

  /**
   * Send digest and reset counters
   * @returns {Promise<boolean>} Success status
   */
  async sendDigestAndReset() {
    if (!this.telegramClient || !this.enabled) {
      return false;
    }

    try {
      const message = this.formatDigestMessage();
      const today = new Date().toISOString().slice(0, 10);
      
      const sent = await this.telegramClient.send(
        `error-digest-${today}`,
        message,
        { force: true } // Skip rate limiting for digest
      );

      if (sent) {
        this.lastDigestSentDate = today;
        this.reset();
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[ErrorDigest] Failed to send digest: ${error.message}`);
      return false;
    }
  }

  /**
   * Reset error counters for new period
   */
  reset() {
    this.errorsByType.clear();
    this.totalErrorCount = 0;
    this.periodStart = new Date();
  }

  /**
   * Check if it's time to send digest
   * @returns {boolean} True if should send
   */
  shouldSendDigest() {
    const now = new Date();
    const currentHourUtc = now.getUTCHours();
    const today = now.toISOString().slice(0, 10);
    
    // Send if: correct hour AND haven't sent today
    return currentHourUtc === this.targetHourUtc && this.lastDigestSentDate !== today;
  }

  /**
   * Start the digest scheduler
   * Checks every minute if it's time to send
   */
  startScheduler() {
    if (this.schedulerInterval) {
      return; // Already running
    }

    // Check every minute
    this.schedulerInterval = setInterval(async () => {
      if (this.shouldSendDigest()) {
        await this.sendDigestAndReset();
      }
    }, 60 * 1000);

    // Don't prevent process exit
    if (this.schedulerInterval.unref) {
      this.schedulerInterval.unref();
    }
  }

  /**
   * Stop the digest scheduler
   */
  stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopScheduler();
    this.errorsByType.clear();
  }
}

/**
 * Create error digest instance
 * @param {Object} options - Options
 * @returns {ErrorDigest} Error digest instance
 */
function createErrorDigest(options) {
  return new ErrorDigest(options);
}

module.exports = { ErrorDigest, createErrorDigest };
