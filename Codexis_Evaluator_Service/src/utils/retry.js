/**
 * Utility to retry any asynchronous function with exponential backoff and random jitter.
 * 
 * @param {Function} fn - The asynchronous function to execute
 * @param {number} retries - Maximum number of retry attempts
 * @param {number} initialDelay - Delay before the first retry (in ms)
 * @param {number} factor - The multiplier to increase delay on each failure
 */
export const retryWithBackoff = async (fn, retries = 5, initialDelay = 1000, factor = 2) => {
  let delay = initialDelay;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = i === retries - 1;
      if (isLastAttempt) throw err;

      // Add random jitter (+/- 200ms) to avoid Thundering Herd
      const jitter = Math.random() * 400 - 200;
      const sleepTime = Math.max(50, delay + jitter);

      console.warn(`[Retry Utility] Attempt ${i + 1} failed: ${err.message || err}. Retrying in ${Math.round(sleepTime)}ms...`);
      await new Promise(resolve => setTimeout(resolve, sleepTime));
      delay *= factor;
    }
  }
};
