/**
 * Retry Infrastructure Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  sleep,
  resolveRetryConfig,
  isRecoverableNetworkError,
  RECOVERABLE_ERROR_CODES,
  RECOVERABLE_ERROR_NAMES,
} from '../retry.js';

describe('sleep', () => {
  it('should wait for specified milliseconds', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
  });
});

describe('resolveRetryConfig', () => {
  it('should use defaults when no overrides', () => {
    const config = resolveRetryConfig();
    expect(config.attempts).toBe(3);
    expect(config.minDelayMs).toBe(300);
    expect(config.maxDelayMs).toBe(30000);
    expect(config.jitter).toBe(0.1);
  });

  it('should apply overrides', () => {
    const config = resolveRetryConfig(undefined, {
      attempts: 5,
      minDelayMs: 1000,
    });
    expect(config.attempts).toBe(5);
    expect(config.minDelayMs).toBe(1000);
  });

  it('should ensure maxDelayMs >= minDelayMs', () => {
    const config = resolveRetryConfig(undefined, {
      minDelayMs: 1000,
      maxDelayMs: 500, // Less than min
    });
    expect(config.maxDelayMs).toBe(1000);
  });

  it('should clamp jitter between 0 and 1', () => {
    const lowConfig = resolveRetryConfig(undefined, { jitter: -0.5 });
    expect(lowConfig.jitter).toBe(0);

    const highConfig = resolveRetryConfig(undefined, { jitter: 1.5 });
    expect(highConfig.jitter).toBe(1);
  });
});

describe('withRetry', () => {
  it('should return result on success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn, { attempts: 3, minDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');
    
    const result = await withRetry(fn, { attempts: 3, minDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after max attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    
    await expect(withRetry(fn, { attempts: 3, minDelayMs: 10 }))
      .rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should respect shouldRetry', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    const shouldRetry = vi.fn().mockReturnValue(false);
    
    await expect(withRetry(fn, { 
      attempts: 3, 
      minDelayMs: 10,
      shouldRetry 
    })).rejects.toThrow('fatal');
    
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it('should call onRetry callback', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');
    
    await withRetry(fn, { 
      attempts: 3, 
      minDelayMs: 10,
      onRetry,
      label: 'test-op'
    });
    
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      maxAttempts: 3,
      label: 'test-op',
    }));
  });

  it('should use retryAfterMs when provided', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValue('success');
    
    const start = Date.now();
    await withRetry(fn, { 
      attempts: 3, 
      minDelayMs: 10,
      retryAfterMs: () => 50, // Override with 50ms
    });
    const elapsed = Date.now() - start;
    
    expect(elapsed).toBeLessThan(200); // Should use 50ms not calculated delay
  });
});

describe('isRecoverableNetworkError', () => {
  it('should return true for recoverable error codes', () => {
    for (const code of RECOVERABLE_ERROR_CODES) {
      const error = { code };
      expect(isRecoverableNetworkError(error, 'send')).toBe(true);
    }
  });

  it('should return true for recoverable error names', () => {
    for (const name of RECOVERABLE_ERROR_NAMES) {
      const error = { name };
      expect(isRecoverableNetworkError(error, 'send')).toBe(true);
    }
  });

  it('should check error cause chain', () => {
    const innerError = { code: 'ECONNRESET' };
    const outerError = { cause: innerError };
    expect(isRecoverableNetworkError(outerError, 'send')).toBe(true);
  });

  it('should respect context for message matching', () => {
    const error = { message: 'timeout' };
    // In 'send' context, message matching is disabled
    expect(isRecoverableNetworkError(error, 'send')).toBe(false);
    // In 'polling' context, message matching is enabled
    expect(isRecoverableNetworkError(error, 'polling')).toBe(true);
  });

  it('should return false for non-recoverable errors', () => {
    const error = { code: 'UNKNOWN_ERROR', name: 'Error' };
    expect(isRecoverableNetworkError(error, 'send')).toBe(false);
  });

  it('should return false for null/undefined', () => {
    expect(isRecoverableNetworkError(null)).toBe(false);
    expect(isRecoverableNetworkError(undefined)).toBe(false);
  });
});
