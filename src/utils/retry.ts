/**
 * Retry Utility with Exponential Backoff
 *
 * Provides resilient operation execution with configurable retry logic.
 * Useful for network operations that may fail transiently.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelay?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay?: number;
  /** Jitter factor 0-1 to add randomness (default: 0.1) */
  jitter?: number;
  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** Callback called before each retry */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Execute a function with exponential backoff retry
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns Promise resolving to the function's return value
 * @throws Last error if all retries fail
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await retryWithBackoff(
 *   () => fetch('https://api.example.com/data'),
 *   { maxRetries: 3, baseDelay: 1000 }
 * );
 *
 * // With custom retry logic
 * const result = await retryWithBackoff(
 *   () => ipnsPublish(cid),
 *   {
 *     maxRetries: 3,
 *     baseDelay: 2000,
 *     shouldRetry: (error) => error.message.includes('timeout'),
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Retry ${attempt} in ${delay}ms: ${error.message}`);
 *     }
 *   }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    jitter = 0.1,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if we've exhausted retries
      if (attempt === maxRetries) {
        throw lastError;
      }

      // Check if error is retryable
      if (!shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = baseDelay * Math.pow(2, attempt);
      const jitterAmount = exponentialDelay * jitter * Math.random();
      const delay = Math.min(exponentialDelay + jitterAmount, maxDelay);

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt + 1, delay);
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error("Retry failed");
}

/**
 * Default retry options for IPFS/IPNS operations
 * These operations can be slow due to DHT lookups
 */
export const IPFS_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 2000,
  maxDelay: 30000,
  jitter: 0.2,
  onRetry: (error, attempt, delay) => {
    console.warn(
      `📦 IPFS operation retry ${attempt} in ${Math.round(delay)}ms: ${error.message}`
    );
  },
};

/**
 * Default retry options for network requests
 */
export const NETWORK_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  jitter: 0.1,
  shouldRetry: (error) => {
    // Retry on network errors and timeouts
    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused") ||
      message.includes("enotfound")
    );
  },
};

/**
 * Create a retry wrapper with pre-configured options
 *
 * @example
 * ```typescript
 * const ipfsRetry = createRetryWrapper(IPFS_RETRY_OPTIONS);
 * const result = await ipfsRetry(() => ipnsPublish(cid));
 * ```
 */
export function createRetryWrapper(defaultOptions: RetryOptions) {
  return <T>(
    fn: () => Promise<T>,
    overrideOptions?: Partial<RetryOptions>
  ): Promise<T> => {
    return retryWithBackoff(fn, { ...defaultOptions, ...overrideOptions });
  };
}
