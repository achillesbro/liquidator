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
 * @param {Object} event - Event object with schema:
 *   - ts: ISO timestamp (auto-generated if not provided)
 *   - bot: "EREBUS"
 *   - chainId: number
 *   - type: "tick_start" | "tick_end" | "tick_skip" | "tx_sent" | "tx_confirmed" | "error"
 *   - tickId: string (e.g., "T62")
 *   - mode: "BASE" | "FLASHLOAN" | "PREFUND" (string)
 *   - durationMs: number (for tick_end)
 *   - summary: object (for tick_end, optional)
 *   - reason: string (for tick_skip)
 *   - txHash: string (for tx events)
 *   - message: string (for error)
 * @param {string} prettyMessage - Optional pretty message for pretty mode
 */
function emitEvent(config, event, prettyMessage = null) {
  if (isJsonlEnabled(config)) {
    // JSONL mode: emit one JSON object per line
    const jsonEvent = {
      ts: event.ts || new Date().toISOString(),
      bot: 'EREBUS',
      chainId: event.chainId || config.chainId,
      type: event.type,
      ...(event.tickId && { tickId: event.tickId }),
      ...(event.mode && { mode: event.mode }),
      ...(event.durationMs !== undefined && { durationMs: event.durationMs }),
      ...(event.summary && { summary: event.summary }),
      ...(event.reason && { reason: event.reason }),
      ...(event.txHash && { txHash: event.txHash }),
      ...(event.message && { message: event.message }),
    };
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
