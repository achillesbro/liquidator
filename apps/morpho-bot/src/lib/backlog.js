/**
 * Candidate backlog queue management
 * Maintains a queue of candidates and refills when low
 */

const { checkCooldownByType } = require('./operations');

/**
 * Candidate backlog manager
 */
class CandidateBacklog {
  constructor(config) {
    this.config = config;
    /** @type {Array} */
    this.queue = [];
    /** @type {number} */
    this.lastFetchTime = 0;
    /** @type {number} */
    this.candidatesTtlSeconds = config.candidatesTtlSeconds || 20;
  }

  /**
   * Get a batch of non-cooled candidates from backlog
   * @param {number} n - Number of candidates to get
   * @param {Object} cooldownConfig - Cooldown configuration
   * @returns {Array} Array of candidates (may be less than n if queue is small)
   */
  getBatch(n, cooldownConfig) {
    const batch = [];
    const remaining = [];

    for (const candidate of this.queue) {
      if (batch.length >= n) {
        remaining.push(candidate);
        continue;
      }

      // Check cooldown before including
      const cooldownCheck = checkCooldownByType(
        candidate.marketId,
        candidate.user,
        cooldownConfig
      );

      if (!cooldownCheck.inCooldown) {
        batch.push(candidate);
      } else {
        remaining.push(candidate);
      }
    }

    // Update queue with remaining candidates
    this.queue = remaining;
    return batch;
  }

  /**
   * Add candidates to backlog
   * @param {Array} candidates - Candidates to add
   */
  add(candidates) {
    // Filter out duplicates (same marketId:user)
    const existing = new Set(
      this.queue.map(c => `${c.marketId.toLowerCase()}:${c.user.toLowerCase()}`)
    );

    for (const candidate of candidates) {
      const key = `${candidate.marketId.toLowerCase()}:${candidate.user.toLowerCase()}`;
      if (!existing.has(key)) {
        this.queue.push(candidate);
        existing.add(key);
      }
    }
  }

  /**
   * Check if backlog needs refilling
   * @param {number} minSize - Minimum size to maintain
   * @returns {boolean} True if backlog is below minSize
   */
  needsRefill(minSize) {
    return this.queue.length < minSize;
  }

  /**
   * Check if we should refetch from API (TTL check)
   * @returns {boolean} True if last fetch is older than TTL
   */
  shouldRefetch() {
    const now = Date.now();
    const elapsed = (now - this.lastFetchTime) / 1000; // seconds
    return elapsed >= this.candidatesTtlSeconds;
  }

  /**
   * Refill backlog using fetch function
   * @param {Function} fetchFn - Async function that returns candidates
   * @param {number} minSize - Minimum size to maintain
   * @param {number} targetSize - Target size to fetch
   * @returns {Promise<number>} Number of candidates fetched
   */
  async refillIfLow(fetchFn, minSize, targetSize) {
    // Check if we need to refill
    if (!this.needsRefill(minSize) && !this.shouldRefetch()) {
      return 0;
    }

    // Fetch new candidates
    const candidates = await fetchFn(targetSize);
    this.add(candidates);
    this.lastFetchTime = Date.now();

    return candidates.length;
  }

  /**
   * Clear backlog
   */
  clear() {
    this.queue = [];
    this.lastFetchTime = 0;
  }

  /**
   * Get backlog stats
   * @returns {Object} Backlog statistics
   */
  getStats() {
    return {
      size: this.queue.length,
      lastFetchTime: this.lastFetchTime,
      ageSeconds: this.lastFetchTime > 0
        ? Math.floor((Date.now() - this.lastFetchTime) / 1000)
        : null,
    };
  }
}

module.exports = { CandidateBacklog };
