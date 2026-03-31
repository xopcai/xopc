import { describe, it, expect, beforeEach } from 'vitest';
import { SelfVerifyMiddleware } from '../index.js';

describe('SelfVerifyMiddleware', () => {
  let middleware: SelfVerifyMiddleware;

  beforeEach(() => {
    middleware = new SelfVerifyMiddleware({
      maxEditsPerFile: 5,
      enablePreCompletionCheck: true,
      minTurnsForVerification: 3,
      resetOnVerification: true,
    });
  });

  describe('recordEdit', () => {
    it('should record file write operations', () => {
      middleware.recordEdit('/path/to/file.ts', 'write');
      expect(middleware.getEditCount('/path/to/file.ts')).toBe(1);
    });

    it('should record file edit operations', () => {
      middleware.recordEdit('/path/to/file.ts', 'edit');
      middleware.recordEdit('/path/to/file.ts', 'edit');
      expect(middleware.getEditCount('/path/to/file.ts')).toBe(2);
    });

    it('should track different files separately', () => {
      middleware.recordEdit('/path/to/file1.ts', 'write');
      middleware.recordEdit('/path/to/file2.ts', 'write');
      expect(middleware.getEditCount('/path/to/file1.ts')).toBe(1);
      expect(middleware.getEditCount('/path/to/file2.ts')).toBe(1);
    });

    it('should track operations array', () => {
      middleware.recordEdit('/path/to/file.ts', 'write');
      middleware.recordEdit('/path/to/file.ts', 'edit');
      const summary = middleware.getEditSummary();
      expect(summary.topFiles[0].count).toBe(2);
    });
  });

  describe('hasExcessiveEdits', () => {
    it('should return null when no excessive edits', () => {
      middleware.recordEdit('/path/to/file.ts', 'write');
      expect(middleware.hasExcessiveEdits()).toBeNull();
    });

    it('should detect excessive edits', () => {
      // Default max is 5
      for (let i = 0; i < 5; i++) {
        middleware.recordEdit('/path/to/file.ts', 'edit');
      }
      const excessive = middleware.hasExcessiveEdits();
      expect(excessive).not.toBeNull();
      expect(excessive?.file).toBe('/path/to/file.ts');
      expect(excessive?.count).toBe(5);
    });
  });

  describe('turn tracking', () => {
    it('should track turn count', () => {
      middleware.onTurnStart();
      middleware.onTurnStart();
      middleware.onTurnStart();
      // Turn count is incremented on each call
      const injection = middleware.getContextInjection();
      expect(injection).toContain('Verification Check');
    });

    it('should not prompt for verification before min turns', () => {
      middleware = new SelfVerifyMiddleware({
        maxEditsPerFile: 5,
        enablePreCompletionCheck: true,
        minTurnsForVerification: 5,
        resetOnVerification: true,
      });

      middleware.onTurnStart();
      middleware.onTurnStart();
      middleware.onTurnStart();

      const injection = middleware.getContextInjection();
      expect(injection).not.toContain('Verification Check');
    });
  });

  describe('getContextInjection', () => {
    it('should include workflow guidance', () => {
      const injection = middleware.getContextInjection();
      expect(injection).toContain('Problem Solving Workflow');
      expect(injection).toContain('Plan');
      expect(injection).toContain('Build');
      expect(injection).toContain('Verify');
      expect(injection).toContain('Fix');
    });

    it('should include excessive edit warning when applicable', () => {
      for (let i = 0; i < 5; i++) {
        middleware.recordEdit('/path/to/file.ts', 'edit');
      }
      const injection = middleware.getContextInjection();
      expect(injection).toContain('Pattern Alert');
      expect(injection).toContain('/path/to/file.ts');
      expect(injection).toContain('5 times');
    });

    it('should include pre-completion reminder after min turns', () => {
      middleware.onTurnStart();
      middleware.onTurnStart();
      middleware.onTurnStart();
      middleware.onTurnStart();

      const injection = middleware.getContextInjection();
      expect(injection).toContain('Verification Check');
    });
  });

  describe('reset', () => {
    it('should clear all tracking data', () => {
      middleware.recordEdit('/path/to/file.ts', 'write');
      middleware.onTurnStart();

      middleware.reset();

      expect(middleware.getEditCount('/path/to/file.ts')).toBe(0);
      const summary = middleware.getEditSummary();
      expect(summary.totalFiles).toBe(0);
      expect(summary.totalEdits).toBe(0);
    });
  });

  describe('getEditSummary', () => {
    it('should return correct summary', () => {
      middleware.recordEdit('/path/file1.ts', 'write');
      middleware.recordEdit('/path/file1.ts', 'edit');
      middleware.recordEdit('/path/file2.ts', 'write');
      middleware.recordEdit('/path/file3.ts', 'write');

      const summary = middleware.getEditSummary();
      expect(summary.totalFiles).toBe(3);
      expect(summary.totalEdits).toBe(4);
      expect(summary.topFiles.length).toBe(3);
      expect(summary.topFiles[0].path).toBe('/path/file1.ts');
      expect(summary.topFiles[0].count).toBe(2);
    });

    it('should limit top files to 5', () => {
      for (let i = 0; i < 10; i++) {
        middleware.recordEdit(`/path/file${i}.ts`, 'write');
      }

      const summary = middleware.getEditSummary();
      expect(summary.topFiles.length).toBe(5);
    });
  });

  describe('configuration', () => {
    it('should use default config when not specified', () => {
      const defaultMiddleware = new SelfVerifyMiddleware();
      expect(defaultMiddleware.getConfig().maxEditsPerFile).toBe(5);
      expect(defaultMiddleware.getConfig().enablePreCompletionCheck).toBe(true);
    });

    it('should allow config updates', () => {
      middleware.setConfig({ maxEditsPerFile: 3 });
      expect(middleware.getConfig().maxEditsPerFile).toBe(3);
      // Other values should remain
      expect(middleware.getConfig().enablePreCompletionCheck).toBe(true);
    });
  });
});
