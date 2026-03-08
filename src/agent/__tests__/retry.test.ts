import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  sleep,
  resolveRetryConfig,
} from '../../infra/retry.js';

describe('Retry Module', () => {
  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await withRetry(operation, { attempts: 3 });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success');

      const result = await withRetry(operation, {
        attempts: 3,
        minDelayMs: 10,
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should throw after max attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('timeout'));

      await expect(
        withRetry(operation, {
          attempts: 3,
          minDelayMs: 10,
        })
      ).rejects.toThrow('timeout');

      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry when shouldRetry returns false', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('not found'));

      await expect(
        withRetry(operation, {
          attempts: 3,
          shouldRetry: () => false,
        })
      ).rejects.toThrow('not found');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should use exponential backoff', async () => {
      const delays: number[] = [];
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success');

      const onRetry = vi.fn((info) => {
        delays.push(info.delayMs);
      });

      await withRetry(operation, {
        attempts: 3,
        minDelayMs: 100,
        jitter: 0.1,
        onRetry,
      });

      expect(delays.length).toBe(2);
      // Second delay should be roughly 2x the first (with jitter tolerance)
      expect(delays[1]).toBeGreaterThan(delays[0] * 1.2);
    });

    it('should support custom shouldRetry function', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('custom error'))
        .mockResolvedValue('success');

      const shouldRetry = vi.fn((error) => {
        return error instanceof Error && error.message.includes('custom');
      });

      const result = await withRetry(operation, {
        attempts: 3,
        minDelayMs: 10,
        shouldRetry,
      });

      expect(result).toBe('success');
      expect(shouldRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('sleep', () => {
    it('should delay for specified milliseconds', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small timing variance
    });
  });

  describe('resolveRetryConfig', () => {
    it('should use defaults when no overrides provided', () => {
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
      expect(config.maxDelayMs).toBe(30000); // Default preserved
    });

    it('should enforce minimum values', () => {
      const config = resolveRetryConfig(undefined, {
        attempts: 0,
        minDelayMs: -100,
        jitter: 2, // Should be capped at 1
      });

      expect(config.attempts).toBe(1);
      expect(config.minDelayMs).toBe(0);
      expect(config.jitter).toBe(1);
    });
  });

  describe('resolveRetryConfig defaults', () => {
    it('should have sensible defaults', () => {
      const config = resolveRetryConfig();
      expect(config.attempts).toBe(3);
      expect(config.minDelayMs).toBe(300);
      expect(config.maxDelayMs).toBe(30000);
      expect(config.jitter).toBe(0.1);
    });
  });
});
