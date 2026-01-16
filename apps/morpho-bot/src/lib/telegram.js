/**
 * Telegram notification client with rate limiting and deduplication
 * Milestone 3-4: Liquidation event notifications
 */

/**
 * Create Telegram client
 * @param {Object} options - Client options
 * @param {string} options.token - Telegram bot token
 * @param {string} options.chatId - Telegram chat ID
 * @param {boolean} options.enabled - Whether notifications are enabled
 * @param {number} options.rateLimitSeconds - Minimum seconds between messages
 * @param {number} options.maxPerHour - Maximum messages per hour
 * @returns {Object} Telegram client
 */
function createTelegramClient({ token, chatId, enabled, rateLimitSeconds = 30, maxPerHour = 60 }) {
  // Dedupe map: key -> { sentAt: timestamp }
  const dedupeMap = new Map();
  const DEDUPE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  // Rate limiting state
  let lastSentAt = 0;
  const hourlyMessages = []; // Array of timestamps

  // Cleanup dedupe map periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of dedupeMap.entries()) {
      if (now - value.sentAt > DEDUPE_TTL_MS) {
        dedupeMap.delete(key);
      }
    }
  }, 60 * 1000); // Every minute

  /**
   * Check if message should be rate limited
   * @returns {Object} { rateLimited: boolean, reason?: string }
   */
  function checkRateLimit() {
    const now = Date.now();

    // Check per-message rate limit
    const timeSinceLastSent = (now - lastSentAt) / 1000; // seconds
    if (timeSinceLastSent < rateLimitSeconds) {
      return {
        rateLimited: true,
        reason: `Rate limit: ${rateLimitSeconds}s between messages (${timeSinceLastSent.toFixed(1)}s since last)`,
      };
    }

    // Check hourly limit
    const oneHourAgo = now - 60 * 60 * 1000;
    const recentMessages = hourlyMessages.filter(ts => ts > oneHourAgo);
    hourlyMessages.length = 0;
    hourlyMessages.push(...recentMessages);

    if (recentMessages.length >= maxPerHour) {
      return {
        rateLimited: true,
        reason: `Hourly limit: ${maxPerHour} messages per hour (${recentMessages.length} sent)`,
      };
    }

    return { rateLimited: false };
  }

  /**
   * Send Telegram message
   * @param {string} eventKey - Event key for deduplication (e.g., tx hash)
   * @param {string} text - Message text
   * @param {Object} options - Send options
   * @param {string} options.dedupeKey - Optional dedupe key (defaults to eventKey)
   * @param {boolean} options.force - Force send (skip rate limit and dedupe)
   * @returns {Promise<boolean>} Success status
   */
  async function send(eventKey, text, { dedupeKey, force = false } = {}) {
    // Check if enabled
    if (!enabled || !token || !chatId) {
      return false;
    }

    // Deduplication (unless forced)
    if (!force) {
      const key = dedupeKey || eventKey;
      if (dedupeMap.has(key)) {
        // Already sent, skip
        return false;
      }
    }

    // Rate limiting (unless forced)
    if (!force) {
      const rateLimitCheck = checkRateLimit();
      if (rateLimitCheck.rateLimited) {
        // Drop message silently (don't throw)
        return false;
      }
    }

    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        // Log once and continue (don't throw)
        console.warn(`[Telegram] API error: ${response.status} ${errorText.slice(0, 100)}`);
        return false;
      }

      // Mark as sent
      const now = Date.now();
      lastSentAt = now;
      hourlyMessages.push(now);

      if (!force) {
        const key = dedupeKey || eventKey;
        dedupeMap.set(key, { sentAt: now });
      }

      return true;
    } catch (error) {
      // Log once and continue (don't throw)
      console.warn(`[Telegram] Send failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Cleanup resources
   */
  function cleanup() {
    clearInterval(cleanupInterval);
    dedupeMap.clear();
    hourlyMessages.length = 0;
  }

  return {
    send,
    cleanup,
  };
}

module.exports = { createTelegramClient };
