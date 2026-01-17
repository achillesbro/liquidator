/**
 * Structured logging helper for EREBUS bot
 * Supports both pretty (human-readable) and jsonl (structured JSON) formats
 * Uses the same event schema as HEGEMON keeper
 */

/**
 * Check if JSONL logging is enabled
 * @param {Object} config - Configuration object
 * @returns {boolean} True if jsonl mode is enabled
 */
function isJsonlEnabled(config) {
  return config?.logFormat === 'jsonl';
}

/**
 * Emit a structured event (JSONL mode) or pretty log (pretty mode)
 * @param {Object} config - Configuration object
 * @param {Object} event - Event object with schema (all fields optional except type):
 *   - ts: ISO timestamp (auto-generated if not provided)
 *   - bot: "EREBUS"
 *   - chainId: number
 *   - type: "tick_start" | "tick_end" | "tick_skip" | "tx_sent" | "tx_confirmed" | "error"
 *   - tickId: string (e.g., "T62")
 *   - mode: "BASE" | "FLASHLOAN" | "FLASHLOAN_V2" | "PREFUND" (string)
 *   - config: object (for tick_start: intervalSec, batchSize, mode, executionEnabled, useExecutorV2)
 *   - cache: object (for tick_start: vaultsTtlSec, marketsTtlSec)
 *   - versions: object (for tick_start: commit, pkgVersion)
 *   - durationMs: number (for tick_end, tick_skip)
 *   - summary: object (for tick_end: comprehensive summary)
 *   - reasonCode: string (for tick_skip: stable short code)
 *   - reason: string (for tick_skip: human-readable)
 *   - counts: object (for tick_skip: candidates, confirmedLiquidatable, passed)
 *   - txHash: string (for tx events)
 *   - marketId: string (for tx events, error)
 *   - user: string (for tx events, error)
 *   - pair: string (for tx events)
 *   - repay: object (for tx events: assets, symbol, decimals)
 *   - profit: object (for tx events: assets, symbol, usd OR hype, minHype for V2)
 *   - gas: object (for tx events: limit, price, used)
 *   - route: object (for tx events: venue, to, calldataSize)
 *   - flashloan: object (for V2 tx events: token, assets)
 *   - profitSwap: object (for V2 tx events: router, feeTier, skip)
 *   - status: string (for tx_confirmed: "success" or "reverted")
 *   - blockNumber: number (for tx_confirmed)
 *   - explorerUrl: string (for tx events)
 *   - stage: string (for error: candidates|confirm|filter|plan|simulate|execute|telegrams|unknown)
 *   - message: string (for error)
 *   - errorCode: string (for error, optional)
 * @param {string} prettyMessage - Optional pretty message for pretty mode
 */
function emitEvent(config, event, prettyMessage = null) {
  if (isJsonlEnabled(config)) {
    // JSONL mode: emit one JSON object per line
    // Include all provided fields, maintaining backward compatibility
    const jsonEvent = {
      ts: event.ts || new Date().toISOString(),
      bot: 'EREBUS',
      chainId: event.chainId || config.chainId,
      type: event.type,
    };
    
    // Add all optional fields if present
    if (event.tickId) jsonEvent.tickId = event.tickId;
    if (event.mode) jsonEvent.mode = event.mode;
    if (event.config) jsonEvent.config = event.config;
    if (event.cache) jsonEvent.cache = event.cache;
    if (event.versions) jsonEvent.versions = event.versions;
    if (event.durationMs !== undefined) jsonEvent.durationMs = event.durationMs;
    if (event.summary) jsonEvent.summary = event.summary;
    if (event.reasonCode) jsonEvent.reasonCode = event.reasonCode;
    if (event.reason) jsonEvent.reason = event.reason;
    if (event.counts) jsonEvent.counts = event.counts;
    if (event.txHash) jsonEvent.txHash = event.txHash;
    if (event.marketId) jsonEvent.marketId = event.marketId;
    if (event.user) jsonEvent.user = event.user;
    if (event.pair) jsonEvent.pair = event.pair;
    if (event.repay) jsonEvent.repay = event.repay;
    if (event.profit) jsonEvent.profit = event.profit;
    if (event.gas) jsonEvent.gas = event.gas;
    if (event.route) jsonEvent.route = event.route;
    if (event.flashloan) jsonEvent.flashloan = event.flashloan;
    if (event.profitSwap) jsonEvent.profitSwap = event.profitSwap;
    if (event.status) jsonEvent.status = event.status;
    if (event.blockNumber !== undefined) jsonEvent.blockNumber = event.blockNumber;
    if (event.explorerUrl) jsonEvent.explorerUrl = event.explorerUrl;
    if (event.stage) jsonEvent.stage = event.stage;
    if (event.message) jsonEvent.message = event.message;
    if (event.errorCode) jsonEvent.errorCode = event.errorCode;
    
    console.log(JSON.stringify(jsonEvent));
  } else {
    // Pretty mode: use provided message or generate one
    if (prettyMessage) {
      console.log(prettyMessage);
    } else {
      // Fallback: generate a simple message
      const parts = [];
      if (event.tickId) parts.push(`[${event.tickId}]`);
      if (event.type) parts.push(event.type);
      if (event.message) parts.push(event.message);
      if (event.txHash) parts.push(`tx: ${event.txHash}`);
      console.log(parts.join(' ') || JSON.stringify(event));
    }
  }
}

/**
 * Log a message (only in pretty mode, suppressed in jsonl)
 * @param {Object} config - Configuration object
 * @param {string} message - Message to log
 */
function log(config, message) {
  if (!isJsonlEnabled(config)) {
    console.log(message);
  }
}

/**
 * Log an error (always logged, but formatted differently)
 * @param {Object} config - Configuration object
 * @param {string} message - Error message
 * @param {Error} error - Optional error object
 */
function logError(config, message, error = null) {
  if (isJsonlEnabled(config)) {
    emitEvent(config, {
      type: 'error',
      message: error ? `${message}: ${error.message}` : message,
    });
  } else {
    console.error(message);
    if (error) {
      console.error(error.stack || error.message);
    }
  }
}

module.exports = {
  isJsonlEnabled,
  emitEvent,
  log,
  logError,
};
