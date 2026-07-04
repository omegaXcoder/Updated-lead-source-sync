/**
 * Retries a flaky async operation a couple of times before giving up.
 * Used around individual SA navigations/edits — occasional net::ERR_ABORTED
 * or similar one-off browser hiccups shouldn't sacrifice an entire client's
 * remaining leads (confirmed live: a single transient nav failure partway
 * through a 90-lead run previously aborted everything after it).
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 2000): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}
