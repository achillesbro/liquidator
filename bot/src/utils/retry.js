/**
 * Retry wrapper with exponential backoff and jitter for rate-limited calls
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.retries - Number of retries (default: 3)
 * @param {number} options.baseMs - Base delay in milliseconds (default: 200)
 * @param {number} options.jitterMs - Jitter range in milliseconds (default: 200)
 * @returns {Promise<any>} Result of the function call
 */
async function withRetry(fn, { retries = 3, baseMs = 200, jitterMs = 200 } = {}) {
    let lastError;
    
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Check if error is rate-limited
            const isRateLimited = 
                error.code === -32005 ||
                error.code === 'RATE_LIMITED' ||
                (error.message && (
                    error.message.toLowerCase().includes("rate limit") ||
                    error.message.toLowerCase().includes("rate limited") ||
                    error.message.toLowerCase().includes("too many requests")
                ));
            
            if (!isRateLimited || attempt === retries - 1) {
                // Not rate-limited or last attempt
                throw error;
            }
            
            // Exponential backoff with jitter
            const delay = baseMs * Math.pow(2, attempt) + Math.random() * jitterMs;
            console.warn(`Rate limited (attempt ${attempt + 1}/${retries}). Retrying in ${Math.round(delay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}

module.exports = { withRetry };
