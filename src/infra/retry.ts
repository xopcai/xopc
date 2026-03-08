/**
 * Retry Infrastructure
 * 
 * Provides configurable retry mechanisms with exponential backoff,
 * jitter, and custom retry conditions.
 * 
 * Based on OpenClaw's retry pattern for network resilience.
 */

export interface RetryConfig {
  /** Maximum number of retry attempts */
  attempts?: number;
  /** Minimum delay between retries in milliseconds */
  minDelayMs?: number;
  /** Maximum delay between retries in milliseconds */
  maxDelayMs?: number;
  /** Jitter factor (0-1) to randomize delays */
  jitter?: number;
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
  label?: string;
}

export interface RetryOptions extends RetryConfig {
  /** Label for logging */
  label?: string;
  /** Custom function to determine if error is retryable */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Extract retry-after delay from error (e.g., rate limit) */
  retryAfterMs?: (error: unknown) => number | undefined;
  /** Callback on each retry attempt */
  onRetry?: (info: RetryInfo) => void;
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  attempts: 3,
  minDelayMs: 300,
  maxDelayMs: 30_000,
  jitter: 0.1,
};

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Apply jitter to delay
 */
function applyJitter(delayMs: number, jitter: number): number {
  if (jitter <= 0) return delayMs;
  const offset = (Math.random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(delayMs * (1 + offset)));
}

/**
 * Resolve retry configuration with defaults
 */
export function resolveRetryConfig(
  defaults: Required<RetryConfig> = DEFAULT_RETRY_CONFIG,
  overrides?: RetryConfig
): Required<RetryConfig> {
  return {
    attempts: Math.max(1, overrides?.attempts ?? defaults.attempts),
    minDelayMs: Math.max(0, overrides?.minDelayMs ?? defaults.minDelayMs),
    maxDelayMs: Math.max(
      overrides?.minDelayMs ?? defaults.minDelayMs,
      overrides?.maxDelayMs ?? defaults.maxDelayMs
    ),
    jitter: Math.max(0, Math.min(1, overrides?.jitter ?? defaults.jitter)),
  };
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = resolveRetryConfig(DEFAULT_RETRY_CONFIG, options);
  const shouldRetry = options.shouldRetry ?? (() => true);
  
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt >= config.attempts) {
        break;
      }

      // Check if we should retry this error
      if (!shouldRetry(error, attempt)) {
        throw error;
      }

      // Calculate delay
      let delayMs: number;
      const retryAfter = options.retryAfterMs?.(error);
      
      if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
        // Use server-provided retry-after
        delayMs = Math.max(retryAfter, config.minDelayMs);
      } else {
        // Exponential backoff: 300ms, 600ms, 1200ms, ...
        delayMs = config.minDelayMs * Math.pow(2, attempt - 1);
      }

      // Cap at max delay
      delayMs = Math.min(delayMs, config.maxDelayMs);
      
      // Apply jitter
      delayMs = applyJitter(delayMs, config.jitter);

      // Notify callback
      options.onRetry?.({
        attempt,
        maxAttempts: config.attempts,
        delayMs,
        error,
        label: options.label,
      });

      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error('Retry failed');
}

/**
 * Telegram-specific recoverable error codes
 */
export const RECOVERABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_ABORTED',
  'ECONNABORTED',
  'ERR_NETWORK',
]);

/**
 * Telegram-specific recoverable error names
 */
export const RECOVERABLE_ERROR_NAMES = new Set([
  'AbortError',
  'TimeoutError',
  'ConnectTimeoutError',
  'HeadersTimeoutError',
  'BodyTimeoutError',
]);

/**
 * Check if an error is a recoverable network error
 */
export function isRecoverableNetworkError(
  error: unknown,
  context: 'polling' | 'send' | 'webhook' | 'unknown' = 'unknown'
): boolean {
  if (!error) return false;

  // Helper to extract error code
  const getErrorCode = (err: unknown): string | undefined => {
    if (!err || typeof err !== 'object') return undefined;
    
    // Check error.code
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (typeof code === 'number') return String(code);
    
    // Check error.errno
    const errno = (err as { errno?: unknown }).errno;
    if (typeof errno === 'string') return errno;
    if (typeof errno === 'number') return String(errno);
    
    return undefined;
  };

  // Helper to extract error name
  const getErrorName = (err: unknown): string => {
    if (!err || typeof err !== 'object') return '';
    return String((err as { name?: unknown }).name ?? '');
  };

  // Collect error and its causes
  const errors: unknown[] = [];
  let current: unknown = error;
  const seen = new WeakSet();
  
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    errors.push(current);
    
    // Follow cause chain
    const cause = (current as { cause?: unknown }).cause;
    if (cause) {
      current = cause;
      continue;
    }
    
    // For HttpError, follow .error (grammy specific)
    const name = getErrorName(current);
    if (name === 'HttpError') {
      const wrapped = (current as { error?: unknown }).error;
      if (wrapped) {
        current = wrapped;
        continue;
      }
    }
    
    break;
  }

  // Check each error in the chain
  for (const err of errors) {
    const code = getErrorCode(err);
    if (code && RECOVERABLE_ERROR_CODES.has(code.toUpperCase())) {
      return true;
    }

    const name = getErrorName(err);
    if (RECOVERABLE_ERROR_NAMES.has(name)) {
      return true;
    }

    // Check message patterns (only for polling context to avoid retrying bad requests)
    if (context !== 'send') {
      const message = String((err as { message?: unknown }).message ?? '').toLowerCase();
      const patterns = [
        'fetch failed',
        'network error',
        'socket hang up',
        'getaddrinfo',
        'timeout',
        'timed out',
      ];
      if (patterns.some(p => message.includes(p))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Create a retry runner with Telegram-specific defaults
 */
export function createRetryRunner(options: RetryOptions = {}) {
  const _config = resolveRetryConfig(DEFAULT_RETRY_CONFIG, options);
  void _config; // Config available for future use in retry runner

  return async <T>(fn: () => Promise<T>, label?: string): Promise<T> => {
    return withRetry(fn, {
      ...options,
      label: label ?? options.label,
      shouldRetry: (err, attempt) => {
        // Use custom shouldRetry if provided
        if (options.shouldRetry) {
          return options.shouldRetry(err, attempt);
        }
        // Default to retrying recoverable network errors
        return isRecoverableNetworkError(err, 'send');
      },
    });
  };
}
