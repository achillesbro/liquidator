/**
 * Simple TTL-based in-memory cache with optional JSON file persistence
 * Used to cache vault whitelist and markets to reduce Morpho API calls
 */

const fs = require('fs');
const path = require('path');

/**
 * Cache entry structure
 * @typedef {Object} CacheEntry
 * @property {*} value - Cached value
 * @property {number} expiresAt - Timestamp when entry expires
 * @property {string} [key] - Cache key (for debugging)
 */

// Cache file path (in the morpho-bot directory)
const CACHE_FILE = path.join(__dirname, '../../.cache.json');

class TTLCache {
  constructor() {
    /** @type {Map<string, CacheEntry>} */
    this.entries = new Map();
    this.persistEnabled = true;
    
    // Load from disk on startup
    this.loadFromDisk();
  }

  /**
   * Load cache from disk
   */
  loadFromDisk() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        const now = Date.now();
        let loaded = 0;
        let expired = 0;
        
        for (const [key, entry] of Object.entries(data)) {
          if (entry.expiresAt > now) {
            this.entries.set(key, entry);
            loaded++;
          } else {
            expired++;
          }
        }
        
        if (loaded > 0 || expired > 0) {
          console.log(`[Cache] Loaded ${loaded} entries from disk (${expired} expired)`);
        }
      }
    } catch (error) {
      console.warn(`[Cache] Failed to load from disk: ${error.message}`);
    }
  }

  /**
   * Save cache to disk
   */
  saveToDisk() {
    if (!this.persistEnabled) return;
    
    try {
      const data = {};
      for (const [key, entry] of this.entries.entries()) {
        data[key] = entry;
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`[Cache] Failed to save to disk: ${error.message}`);
    }
  }

  /**
   * Get value from cache or set it using fetcher
   * @param {string} key - Cache key
   * @param {number} ttlMs - Time to live in milliseconds
   * @param {Function} fetcher - Async function that returns the value to cache
   * @returns {Promise<*>} Cached or freshly fetched value
   */
  async getOrSet(key, ttlMs, fetcher) {
    const entry = this.entries.get(key);
    const now = Date.now();

    // Check if entry exists and is still valid
    if (entry && entry.expiresAt > now) {
      const remainingMs = entry.expiresAt - now;
      console.log(`[Cache] HIT: ${key} (expires in ${Math.round(remainingMs / 1000)}s)`);
      return entry.value;
    }

    // Fetch new value
    console.log(`[Cache] MISS: ${key} - fetching...`);
    const value = await fetcher();

    // Store with expiration
    this.entries.set(key, {
      value,
      expiresAt: now + ttlMs,
      key,
      fetchedAt: new Date().toISOString(),
    });

    // Persist to disk
    this.saveToDisk();

    return value;
  }

  /**
   * Get value from cache without fetching
   * @param {string} key - Cache key
   * @returns {*|null} Cached value or null if not found/expired
   */
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (entry.expiresAt <= now) {
      // Expired, remove it
      this.entries.delete(key);
      this.saveToDisk();
      return null;
    }

    return entry.value;
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttlMs - Time to live in milliseconds
   */
  set(key, value, ttlMs) {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      key,
      fetchedAt: new Date().toISOString(),
    });
    this.saveToDisk();
  }

  /**
   * Clear expired entries
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[Cache] Cleaned up ${removed} expired entries`);
      this.saveToDisk();
    }
  }

  /**
   * Clear all entries
   */
  clear() {
    this.entries.clear();
    this.saveToDisk();
  }

  /**
   * Get cache stats
   * @returns {Object} Cache statistics
   */
  getStats() {
    const now = Date.now();
    let valid = 0;
    let expired = 0;

    for (const entry of this.entries.values()) {
      if (entry.expiresAt > now) {
        valid++;
      } else {
        expired++;
      }
    }

    return {
      total: this.entries.size,
      valid,
      expired,
      file: CACHE_FILE,
    };
  }

  /**
   * Dump cache contents for debugging
   * @returns {Object} Full cache contents
   */
  dump() {
    const now = Date.now();
    const result = {};
    
    for (const [key, entry] of this.entries.entries()) {
      result[key] = {
        ...entry,
        isExpired: entry.expiresAt <= now,
        remainingMs: Math.max(0, entry.expiresAt - now),
        remainingSec: Math.max(0, Math.round((entry.expiresAt - now) / 1000)),
      };
    }
    
    return result;
  }
}

// Singleton instance
const cache = new TTLCache();

// Periodic cleanup every 5 minutes
setInterval(() => {
  cache.cleanup();
}, 5 * 60 * 1000);

module.exports = cache;
