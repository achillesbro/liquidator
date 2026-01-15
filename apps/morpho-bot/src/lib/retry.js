/**
 * Retry utility for HTTP requests with exponential backoff
 */

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.delayMs - Initial delay in milliseconds (default: 1000)
 * @param {string} options.description - Description of the operation for error messages
 * @returns {Promise<any>} Result of the function
 */
async function retry(fn, options = {}) {
  const { maxRetries = 3, delayMs = 1000, description = 'operation' } = options;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = delayMs * Math.pow(2, attempt - 1);
        console.warn(`Retry ${attempt}/${maxRetries} for ${description} after ${delay}ms: ${error.message}`);
        await sleep(delay);
      }
    }
  }
  
  throw new Error(`Failed to ${description} after ${maxRetries} attempts: ${lastError.message}`);
}

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { retry, sleep };
