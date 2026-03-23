/**
 * RequestLimiter unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RequestLimiter } from '../request-limiter.js';

describe('RequestLimiter', () => {
  let limiter: RequestLimiter;

  beforeEach(() => {
    limiter = new RequestLimiter({
      maxRequestsPerTurn: 50,
      warnThreshold: 0.8,
      softLimit: false,
    });
  });

  describe('recordRequest', () => {
    it('should record a request and return correct status', () => {
      const result = limiter.recordRequest();
      
      expect(result.count).toBe(1);
      expect(result.remaining).toBe(49);
      expect(result.limit).toBe(50);
      expect(result.allowed).toBe(true);
      expect(result.isWarning).toBe(false);
      expect(result.shouldStop).toBe(false);
    });

    it('should track multiple requests', () => {
      limiter.recordRequest();
      limiter.recordRequest();
      limiter.recordRequest();
      
      const result = limiter.recordRequest();
      expect(result.count).toBe(4);
      expect(result.remaining).toBe(46);
    });

    it('should set isWarning when approaching limit', () => {
      // 80% of 50 = 40
      for (let i = 0; i < 40; i++) {
        limiter.recordRequest();
      }
      
      const result = limiter.recordRequest();
      expect(result.isWarning).toBe(true);
      expect(result.count).toBe(41);
    });

    it('should set shouldStop when limit reached with hard limit', () => {
      const hardLimiter = new RequestLimiter({
        maxRequestsPerTurn: 10,
        softLimit: false,
      });
      
      for (let i = 0; i < 10; i++) {
        hardLimiter.recordRequest();
      }
      
      const result = hardLimiter.recordRequest();
      expect(result.shouldStop).toBe(true);
      expect(result.allowed).toBe(false);
    });

    it('should allow requests even when limit reached with soft limit', () => {
      const softLimiter = new RequestLimiter({
        maxRequestsPerTurn: 10,
        softLimit: true,
      });
      
      for (let i = 0; i < 10; i++) {
        softLimiter.recordRequest();
      }
      
      const result = softLimiter.recordRequest();
      expect(result.shouldStop).toBe(false);
      expect(result.allowed).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return current status without recording', () => {
      limiter.recordRequest();
      limiter.recordRequest();
      
      const status = limiter.getStatus();
      expect(status.count).toBe(2);
      expect(status.remaining).toBe(48);
      
      // Calling getStatus again should not change count
      const status2 = limiter.getStatus();
      expect(status2.count).toBe(2);
    });
  });

  describe('getCount', () => {
    it('should return current request count', () => {
      expect(limiter.getCount()).toBe(0);
      
      limiter.recordRequest();
      expect(limiter.getCount()).toBe(1);
      
      limiter.recordRequest();
      expect(limiter.getCount()).toBe(2);
    });
  });

  describe('getRemaining', () => {
    it('should return remaining requests', () => {
      expect(limiter.getRemaining()).toBe(50);
      
      limiter.recordRequest();
      expect(limiter.getRemaining()).toBe(49);
      
      limiter.recordRequest();
      expect(limiter.getRemaining()).toBe(48);
    });

    it('should not return negative values', () => {
      for (let i = 0; i < 60; i++) {
        limiter.recordRequest();
      }
      
      expect(limiter.getRemaining()).toBe(0);
    });
  });

  describe('isLimitReached', () => {
    it('should return false when limit not reached', () => {
      for (let i = 0; i < 49; i++) {
        limiter.recordRequest();
      }
      expect(limiter.isLimitReached()).toBe(false);
    });

    it('should return true when limit reached', () => {
      for (let i = 0; i < 50; i++) {
        limiter.recordRequest();
      }
      expect(limiter.isLimitReached()).toBe(true);
    });
  });

  describe('isApproachingLimit', () => {
    it('should return false when not approaching limit', () => {
      for (let i = 0; i < 30; i++) {
        limiter.recordRequest();
      }
      expect(limiter.isApproachingLimit()).toBe(false);
    });

    it('should return true when approaching limit', () => {
      // 80% of 50 = 40
      for (let i = 0; i < 40; i++) {
        limiter.recordRequest();
      }
      expect(limiter.isApproachingLimit()).toBe(true);
    });
  });

  describe('getUsagePercent', () => {
    it('should return correct usage percentage', () => {
      expect(limiter.getUsagePercent()).toBe(0);
      
      limiter.recordRequest();
      expect(limiter.getUsagePercent()).toBe(0.02);
      
      for (let i = 1; i < 25; i++) {
        limiter.recordRequest();
      }
      expect(limiter.getUsagePercent()).toBe(0.5);
    });

    it('should handle zero maxRequestsPerTurn gracefully', () => {
      const zeroLimiter = new RequestLimiter({
        maxRequestsPerTurn: 0,
      });
      
      const percent = zeroLimiter.getUsagePercent();
      // Should return 1.0 (treated as full) to avoid division by zero
      expect(percent).toBe(1.0);
      expect(Number.isFinite(percent)).toBe(true);
    });
  });

  describe('getWarningMessage', () => {
    it('should return null when not approaching limit', () => {
      const message = limiter.getWarningMessage();
      expect(message).toBeNull();
    });

    it('should return warning message when approaching limit', () => {
      for (let i = 0; i < 45; i++) {
        limiter.recordRequest();
      }
      
      const message = limiter.getWarningMessage();
      expect(message).toContain('Approaching request limit');
      expect(message).toContain('45/50');
    });

    it('should return stop message when limit reached', () => {
      const hardLimiter = new RequestLimiter({
        maxRequestsPerTurn: 10,
        softLimit: false,
      });
      
      for (let i = 0; i < 10; i++) {
        hardLimiter.recordRequest();
      }
      
      const message = hardLimiter.getWarningMessage();
      expect(message).toContain('Request limit reached');
      expect(message).toContain('Stopping execution');
    });
  });

  describe('reset', () => {
    it('should reset request count', () => {
      for (let i = 0; i < 25; i++) {
        limiter.recordRequest();
      }
      
      limiter.reset();
      
      expect(limiter.getCount()).toBe(0);
      expect(limiter.getRemaining()).toBe(50);
    });

    it('should reset turn start time', () => {
      const beforeReset = limiter.getTurnDuration();
      
      limiter.reset();
      
      const afterReset = limiter.getTurnDuration();
      expect(afterReset).toBeLessThanOrEqual(beforeReset);
    });
  });

  describe('setCount', () => {
    it('should manually set request count', () => {
      limiter.setCount(25);
      expect(limiter.getCount()).toBe(25);
      expect(limiter.getRemaining()).toBe(25);
    });

    it('should not allow negative count', () => {
      limiter.setCount(-10);
      expect(limiter.getCount()).toBe(0);
    });
  });

  describe('getTurnDuration', () => {
    it('should return duration since turn start', () => {
      const startDuration = limiter.getTurnDuration();
      
      // Wait a bit
      const startTime = Date.now();
      while (Date.now() - startTime < 10) {
        // Busy wait 10ms
      }
      
      const endDuration = limiter.getTurnDuration();
      expect(endDuration).toBeGreaterThanOrEqual(startDuration);
    });

    it('should reset duration on reset', () => {
      // Wait a bit
      const startTime = Date.now();
      while (Date.now() - startTime < 10) {}
      
      const beforeReset = limiter.getTurnDuration();
      
      limiter.reset();
      
      const afterReset = limiter.getTurnDuration();
      expect(afterReset).toBeLessThan(beforeReset);
    });
  });

  describe('getStats', () => {
    it('should return complete stats object', () => {
      for (let i = 0; i < 25; i++) {
        limiter.recordRequest();
      }
      
      const stats = limiter.getStats();
      
      expect(stats.count).toBe(25);
      expect(stats.limit).toBe(50);
      expect(stats.remaining).toBe(25);
      expect(stats.usagePercent).toBe(0.5);
      expect(stats.isWarning).toBe(false);
      expect(stats.isLimitReached).toBe(false);
      expect(typeof stats.turnDurationMs).toBe('number');
    });

    it('should return correct warning and limit flags', () => {
      // At 80% threshold
      for (let i = 0; i < 40; i++) {
        limiter.recordRequest();
      }
      
      const stats = limiter.getStats();
      expect(stats.isWarning).toBe(true);
      expect(stats.isLimitReached).toBe(false);
      
      // At limit
      for (let i = 40; i < 50; i++) {
        limiter.recordRequest();
      }
      
      const stats2 = limiter.getStats();
      expect(stats2.isWarning).toBe(true);
      expect(stats2.isLimitReached).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very small maxRequestsPerTurn', () => {
      const smallLimiter = new RequestLimiter({
        maxRequestsPerTurn: 1,
      });
      
      expect(smallLimiter.isLimitReached()).toBe(false);
      smallLimiter.recordRequest();
      expect(smallLimiter.isLimitReached()).toBe(true);
    });

    it('should handle very large maxRequestsPerTurn', () => {
      const largeLimiter = new RequestLimiter({
        maxRequestsPerTurn: 1000000,
      });
      
      for (let i = 0; i < 1000; i++) {
        largeLimiter.recordRequest();
      }
      
      expect(largeLimiter.isLimitReached()).toBe(false);
      expect(largeLimiter.getRemaining()).toBe(999000);
    });

    it('should handle zero warnThreshold', () => {
      const zeroThresholdLimiter = new RequestLimiter({
        maxRequestsPerTurn: 50,
        warnThreshold: 0,
      });
      
      const result = zeroThresholdLimiter.recordRequest();
      expect(result.isWarning).toBe(true); // Warning from first request
    });

    it('should handle warnThreshold of 1', () => {
      const fullThresholdLimiter = new RequestLimiter({
        maxRequestsPerTurn: 50,
        warnThreshold: 1,
      });
      
      for (let i = 0; i < 49; i++) {
        fullThresholdLimiter.recordRequest();
      }
      
      const result = fullThresholdLimiter.recordRequest();
      expect(result.isWarning).toBe(true); // Warning at 100%
    });
  });
});
