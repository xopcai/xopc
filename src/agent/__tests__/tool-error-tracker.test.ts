/**
 * ToolErrorTracker unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolErrorTracker } from '../tools/error-tracker.js';

describe('ToolErrorTracker', () => {
  let tracker: ToolErrorTracker;

  beforeEach(() => {
    tracker = new ToolErrorTracker({
      maxFailuresPerTool: 3,
      maxTotalFailures: 5,
      resetOnTurnEnd: true,
      failureWindowMs: 5 * 60 * 1000,
    });
  });

  describe('recordFailure', () => {
    it('should record a single tool failure', () => {
      tracker.recordFailure('shell', 'Error: command failed');
      expect(tracker.getFailureCount('shell')).toBe(1);
    });

    it('should track multiple failures for the same tool', () => {
      tracker.recordFailure('shell', 'Error 1');
      tracker.recordFailure('shell', 'Error 2');
      tracker.recordFailure('shell', 'Error 3');
      
      expect(tracker.getFailureCount('shell')).toBe(3);
      expect(tracker.getSummary().total).toBe(3);
    });

    it('should track failures for different tools separately', () => {
      tracker.recordFailure('shell', 'Error 1');
      tracker.recordFailure('read', 'Error 2');
      tracker.recordFailure('write', 'Error 3');
      
      expect(tracker.getFailureCount('shell')).toBe(1);
      expect(tracker.getFailureCount('read')).toBe(1);
      expect(tracker.getFailureCount('write')).toBe(1);
      expect(tracker.getSummary().total).toBe(3);
    });
  });

  describe('remainingAttempts', () => {
    it('should return correct remaining attempts', () => {
      expect(tracker.remainingAttempts('shell')).toBe(3);
      
      tracker.recordFailure('shell');
      expect(tracker.remainingAttempts('shell')).toBe(2);
      
      tracker.recordFailure('shell');
      expect(tracker.remainingAttempts('shell')).toBe(1);
      
      tracker.recordFailure('shell');
      expect(tracker.remainingAttempts('shell')).toBe(0);
    });

    it('should not return negative values', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      tracker.recordFailure('shell'); // Exceed limit
      
      expect(tracker.remainingAttempts('shell')).toBe(0);
    });
  });

  describe('isToolLimitReached', () => {
    it('should return false when limit not reached', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      expect(tracker.isToolLimitReached('shell')).toBe(false);
    });

    it('should return true when limit reached', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      expect(tracker.isToolLimitReached('shell')).toBe(true);
    });

    it('should return true when limit exceeded', () => {
      tracker.recordFailure('shell', 'Error 1');
      tracker.recordFailure('shell', 'Error 2');
      tracker.recordFailure('shell', 'Error 3');
      tracker.recordFailure('shell', 'Error 4');
      expect(tracker.isToolLimitReached('shell')).toBe(true);
    });
  });

  describe('isTotalLimitReached', () => {
    it('should return false when total limit not reached', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('read');
      tracker.recordFailure('write');
      tracker.recordFailure('grep');
      expect(tracker.isTotalLimitReached()).toBe(false);
    });

    it('should return true when total limit reached', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('read');
      tracker.recordFailure('write');
      tracker.recordFailure('grep');
      tracker.recordFailure('find');
      expect(tracker.isTotalLimitReached()).toBe(true);
    });
  });

  describe('isAnyLimitReached', () => {
    it('should return false when no limits reached', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('read');
      expect(tracker.isAnyLimitReached()).toBe(false);
    });

    it('should return true when tool limit reached', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      expect(tracker.isAnyLimitReached()).toBe(true);
    });

    it('should return true when total limit reached', () => {
      tracker.recordFailure('tool1');
      tracker.recordFailure('tool2');
      tracker.recordFailure('tool3');
      tracker.recordFailure('tool4');
      tracker.recordFailure('tool5');
      expect(tracker.isAnyLimitReached()).toBe(true);
    });
  });

  describe('getFailureHint', () => {
    it('should return warning with remaining attempts', () => {
      tracker.recordFailure('shell');
      const hint = tracker.getFailureHint('shell');
      expect(hint).toContain('shell');
      expect(hint).toContain('1 times');
      expect(hint).toContain('Remaining attempts: 2');
    });

    it('should return error when tool limit reached', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      const hint = tracker.getFailureHint('shell');
      expect(hint).toContain('Do not retry this tool');
    });

    it('should return error when total limit reached', () => {
      tracker.recordFailure('tool1');
      tracker.recordFailure('tool2');
      tracker.recordFailure('tool3');
      tracker.recordFailure('tool4');
      tracker.recordFailure('tool5');
      const hint = tracker.getFailureHint('tool1');
      expect(hint).toContain('Total failure limit');
    });
  });

  describe('reset', () => {
    it('should clear all failures', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('read');
      tracker.reset();
      
      expect(tracker.getFailureCount('shell')).toBe(0);
      expect(tracker.getFailureCount('read')).toBe(0);
      expect(tracker.getSummary().total).toBe(0);
    });

    it('should not clear if resetOnTurnEnd is false', () => {
      const noResetTracker = new ToolErrorTracker({
        maxFailuresPerTool: 3,
        resetOnTurnEnd: false,
      });
      
      noResetTracker.recordFailure('shell');
      noResetTracker.reset();
      
      expect(noResetTracker.getFailureCount('shell')).toBe(1);
    });
  });

  describe('resetTool', () => {
    it('should reset failures for a specific tool', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      tracker.recordFailure('read');
      
      tracker.resetTool('shell');
      
      expect(tracker.getFailureCount('shell')).toBe(0);
      expect(tracker.getFailureCount('read')).toBe(1);
      expect(tracker.getSummary().total).toBe(1);
    });

    it('should handle non-existent tool gracefully', () => {
      expect(() => tracker.resetTool('nonexistent')).not.toThrow();
    });
  });

  describe('getFailures', () => {
    it('should return a copy of failures map', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('read');
      
      const failures = tracker.getFailures();
      expect(failures.size).toBe(2);
      expect(failures.has('shell')).toBe(true);
      expect(failures.has('read')).toBe(true);
      
      // Modifying returned map should not affect tracker
      failures.delete('shell');
      expect(tracker.getFailures().has('shell')).toBe(true);
    });
  });

  describe('getSummary', () => {
    it('should return correct summary', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      tracker.recordFailure('read');
      
      const summary = tracker.getSummary();
      expect(summary.total).toBe(3);
      expect(summary.byTool.shell).toBe(2);
      expect(summary.byTool.read).toBe(1);
    });

    it('should return empty summary when no failures', () => {
      const summary = tracker.getSummary();
      expect(summary.total).toBe(0);
      expect(Object.keys(summary.byTool).length).toBe(0);
    });
  });

  describe('cleanupOldFailures', () => {
    it('should not clean up recent failures', () => {
      tracker.recordFailure('shell');
      tracker.cleanupOldFailures();
      
      expect(tracker.getFailureCount('shell')).toBe(1);
    });

    // Note: Testing old failure cleanup would require mocking Date.now()
    // or waiting for the failure window to expire
  });

  describe('getLimitReachedTool', () => {
    it('should return null when no limit reached', () => {
      tracker.recordFailure('shell');
      expect(tracker.getLimitReachedTool()).toBeNull();
    });

    it('should return tool name when limit reached', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      expect(tracker.getLimitReachedTool()).toBe('shell');
    });

    it('should return first tool that reached limit', () => {
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      tracker.recordFailure('shell');
      tracker.recordFailure('read');
      tracker.recordFailure('read');
      tracker.recordFailure('read');
      expect(tracker.getLimitReachedTool()).toBe('shell');
    });
  });
});
