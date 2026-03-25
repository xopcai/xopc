import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeWithTimeout,
  executeWithTimeoutResult,
  withTimeout,
  TimeoutManager,
  TimeoutError,
  DEFAULT_TIMEOUT_CONFIG,
} from '../lifecycle/timeout-wrapper.js';

describe('TimeoutWrapper Module', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('executeWithTimeout', () => {
    it('should succeed within timeout', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await executeWithTimeout(operation, {
        toolName: 'test',
        timeoutMs: 5000,
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should timeout on slow operation', async () => {
      // Create a promise that never resolves
      const operation = vi.fn().mockImplementation(() => new Promise(() => {}));

      const promise = executeWithTimeout(operation, {
        toolName: 'slow-tool',
        timeoutMs: 1000,
      });

      // Fast-forward past timeout
      vi.advanceTimersByTime(1000);

      // Should reject with TimeoutError
      await expect(promise).rejects.toThrow(TimeoutError);
      await expect(promise).rejects.toThrow('slow-tool');
    });

    it('should use appropriate timeout for shell tools', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      await executeWithTimeout(operation, { toolName: 'shell_exec' });

      // Should use shell timeout (5 minutes = 300000ms)
      // We can't easily test this without exposing internals,
      // but we can verify it doesn't timeout immediately
      vi.advanceTimersByTime(1000);
      expect(operation).toHaveBeenCalled();
    });

    it('should use appropriate timeout for read tools', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      await executeWithTimeout(operation, { toolName: 'read_file' });

      // Should use read timeout (30 seconds)
      vi.advanceTimersByTime(1000);
      expect(operation).toHaveBeenCalled();
    });

    it('should clear timeout on success', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await executeWithTimeout(operation, {
        toolName: 'test',
        timeoutMs: 5000,
      });

      expect(result).toBe('success');

      // Fast-forward past original timeout to ensure no lingering timers
      vi.advanceTimersByTime(10000);
    });

    it('should clear timeout on error', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('operation failed'));

      await expect(
        executeWithTimeout(operation, { toolName: 'test', timeoutMs: 5000 })
      ).rejects.toThrow('operation failed');

      // Fast-forward past original timeout
      vi.advanceTimersByTime(10000);
    });
  });

  describe('executeWithTimeoutResult', () => {
    it('should return success result', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await executeWithTimeoutResult(operation, {
        toolName: 'test',
        timeoutMs: 5000,
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
      expect(result.timedOut).toBe(false);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return timeout result', async () => {
      // Create a promise that never resolves
      const operation = vi.fn().mockImplementation(() => new Promise(() => {}));

      const promise = executeWithTimeoutResult(operation, {
        toolName: 'test',
        timeoutMs: 1000,
      });

      vi.advanceTimersByTime(1000);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.error).toBeInstanceOf(TimeoutError);
    });

    it('should return error result', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('failed'));

      const result = await executeWithTimeoutResult(operation, {
        toolName: 'test',
        timeoutMs: 5000,
      });

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(false);
      expect(result.error?.message).toBe('failed');
    });
  });

  describe('withTimeout', () => {
    it('should wrap function with timeout', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const wrapped = withTimeout(fn, { toolName: 'test', timeoutMs: 5000 });
      const result = await wrapped('arg1', 'arg2');

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should support dynamic description', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const wrapped = withTimeout(fn, {
        toolName: 'test',
        timeoutMs: 1000,
        description: (...args) => `Processing ${args.join(', ')}`,
      });

      await wrapped('file1', 'file2');

      // The description function should have been called
      // We can't easily verify this without exposing internals
      expect(fn).toHaveBeenCalledWith('file1', 'file2');
    });
  });

  describe('TimeoutManager', () => {
    it('should track execution statistics', async () => {
      const manager = new TimeoutManager();

      const operation1 = vi.fn().mockResolvedValue('success');
      // Create a promise that never resolves
      const operation2 = vi.fn().mockImplementation(() => new Promise(() => {}));

      await manager.execute(operation1, { toolName: 'fast-tool', timeoutMs: 5000 });

      const promise = manager.execute(operation2, {
        toolName: 'slow-tool',
        timeoutMs: 1000,
      });
      
      vi.advanceTimersByTime(1000);
      
      // Should reject, but we don't care about the error
      try {
        await promise;
      } catch {
        // Expected timeout error
      }

      const stats = manager.getStats();

      expect(stats.totalExecutions).toBe(2);
      expect(stats.timeoutCount).toBe(1);
      expect(stats.timeoutRate).toBe(0.5);
      expect(stats.byTool['fast-tool'].count).toBe(1);
      expect(stats.byTool['slow-tool'].timeouts).toBe(1);
    });

    it('should cleanup old records', async () => {
      const manager = new TimeoutManager();

      // Add some executions
      await manager.execute(
        () => Promise.resolve('success'),
        { toolName: 'test', timeoutMs: 1000 }
      );

      // Verify execution was recorded
      let stats = manager.getStats();
      expect(stats.totalExecutions).toBe(1);

      // Advance time by 2ms
      vi.advanceTimersByTime(2);

      // Cleanup records older than 1ms
      manager.cleanup(1);

      stats = manager.getStats();
      expect(stats.totalExecutions).toBe(0);
    });
  });

  describe('TimeoutError', () => {
    it('should create error with tool name', () => {
      const error = new TimeoutError('shell', 300000);

      expect(error.name).toBe('TimeoutError');
      expect(error.toolName).toBe('shell');
      expect(error.timeoutMs).toBe(300000);
      expect(error.message).toContain('shell');
      expect(error.message).toContain('300');
    });

    it('should create error with description', () => {
      const error = new TimeoutError('test', 5000, 'custom operation');

      expect(error.message).toContain('custom operation');
      expect(error.description).toBe('custom operation');
    });

    it('should provide user-friendly message for shell', () => {
      const error = new TimeoutError('shell_exec', 300000);
      const message = error.getUserMessage();

      expect(message).toContain('⚠️');
      expect(message).toContain('Break the command into smaller steps');
    });

    it('should provide user-friendly message for read', () => {
      const error = new TimeoutError('read_file', 30000);
      const message = error.getUserMessage();

      expect(message).toContain('⚠️');
      expect(message).toContain('Read the file in smaller chunks');
    });

    it('should provide user-friendly message for web', () => {
      const error = new TimeoutError('web_fetch', 60000);
      const message = error.getUserMessage();

      expect(message).toContain('⚠️');
      expect(message).toContain('Check network connectivity');
    });
  });

  describe('DEFAULT_TIMEOUT_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_TIMEOUT_CONFIG.defaultTimeoutMs).toBe(300000); // 5 minutes
      expect(DEFAULT_TIMEOUT_CONFIG.shellTimeoutMs).toBe(300000); // 5 minutes
      expect(DEFAULT_TIMEOUT_CONFIG.readTimeoutMs).toBe(30000); // 30 seconds
      expect(DEFAULT_TIMEOUT_CONFIG.writeTimeoutMs).toBe(60000); // 1 minute
      expect(DEFAULT_TIMEOUT_CONFIG.networkTimeoutMs).toBe(60000); // 1 minute
      expect(DEFAULT_TIMEOUT_CONFIG.gracefulShutdownMs).toBe(5000); // 5 seconds
    });
  });
});
