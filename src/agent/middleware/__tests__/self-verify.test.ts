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

    it('emits a single lightweight post-edit verification reminder', () => {
      middleware.recordEdit('/path/to/file.ts', 'edit');
      const first = middleware.consumePostEditReminder();
      const second = middleware.consumePostEditReminder();
      expect(first).toContain('Workspace Verification State');
      expect(first).toContain('files changed');
      expect(first).toContain('inspect the changed files');
      expect(second).toBe('');
    });

    it('clears pending verification after a successful test command', () => {
      middleware.recordEdit('/path/to/file.ts', 'edit');
      middleware.recordVerification('exec_command', { cmd: 'pnpm test' }, {
        isError: false,
        result: {
          details: {
            command: 'pnpm test',
            status: 'success',
            exitCode: 0,
            timedOut: false,
          },
        },
      });
      expect(middleware.consumePostEditReminder()).toBe('');
    });

    it('keeps pending verification after a failed test command', () => {
      middleware.recordEdit('/path/to/file.ts', 'edit');
      middleware.recordVerification('exec_command', { cmd: 'pnpm test' }, {
        isError: false,
        result: {
          details: {
            command: 'pnpm test',
            status: 'failed',
            exitCode: 1,
            timedOut: false,
          },
        },
      });
      expect(middleware.consumePostEditReminder()).toContain('files changed');
    });

    it('keeps pending verification after a timed out test command', () => {
      middleware.recordEdit('/path/to/file.ts', 'edit');
      middleware.recordVerification('exec_command', { cmd: 'pnpm test' }, {
        isError: false,
        result: {
          details: {
            command: 'pnpm test',
            status: 'timed_out',
            exitCode: null,
            timedOut: true,
          },
        },
      });
      expect(middleware.consumePostEditReminder()).toContain('files changed');
    });

    it('can read the verification command from exec_command result details', () => {
      middleware.recordEdit('/path/to/file.ts', 'edit');
      middleware.recordVerification('exec_command', undefined, {
        isError: false,
        result: {
          details: {
            command: 'pnpm run typecheck',
            status: 'success',
            exitCode: 0,
            timedOut: false,
          },
        },
      });
      expect(middleware.consumePostEditReminder()).toBe('');
    });

    it('marks git diff as review without clearing pending verification', () => {
      middleware.recordEdit('/path/to/file.ts', 'edit');
      middleware.recordVerification('exec_command', { cmd: 'git diff -- src/file.ts' }, {
        isError: false,
        result: {
          details: {
            command: 'git diff -- src/file.ts',
            status: 'success',
            exitCode: 0,
            timedOut: false,
          },
        },
      });

      const state = middleware.getVerificationState();
      expect(state.diffReviewed).toBe(true);
      expect(state.hasUnverifiedEdits).toBe(true);
      expect(middleware.consumePostEditReminder()).toContain('Diff review: completed');
    });

    it('reports structured pending verification state', () => {
      middleware.recordEdit('/path/to/file.ts', 'edit');
      middleware.recordVerification('exec_command', { cmd: 'pnpm test' }, {
        isError: false,
        result: {
          details: {
            command: 'pnpm test',
            status: 'failed',
            exitCode: 1,
            timedOut: false,
          },
        },
      });

      const state = middleware.getVerificationState();
      expect(state).toMatchObject({
        hasUnverifiedEdits: true,
        changedFiles: ['/path/to/file.ts'],
        diffReviewed: false,
        verificationAttempted: true,
        lastVerificationFailed: true,
      });
      expect(state.lastVerification).toMatchObject({
        command: 'pnpm test',
        success: false,
        exitCode: 1,
      });
      expect(middleware.getPendingVerificationContext()).toContain('Last verification: failed');
    });

    it('keeps verification state isolated by session key', () => {
      middleware.recordEdit('/path/a.ts', 'edit', 'session-a');

      expect(middleware.getPendingVerificationContext('session-a')).toContain('/path/a.ts');
      expect(middleware.getPendingVerificationContext('session-b')).toBe('');
      expect(middleware.getVerificationState('session-b').hasUnverifiedEdits).toBe(false);
    });

    it('uses coder-specific verification context for coder agents', () => {
      middleware.recordEdit('/path/to/file.ts', 'edit', 'coder-session');

      const context = middleware.getPendingVerificationContext('coder-session', 'coder');
      expect(context).toContain('Coder Verification State');
      expect(context).toContain('Changed source files');
      expect(context).toContain('targeted test, typecheck, lint, or build');
    });

    it('uses data-specific verification context for data agents', () => {
      middleware.recordEdit('/path/analysis.py', 'edit', 'data-session');

      const context = middleware.getPendingVerificationContext('data-session', 'data-analyst');
      expect(context).toContain('Data Verification State');
      expect(context).toContain('row counts');
      expect(context).toContain('schemas');
    });

    it('uses writing/research review context for non-coder artifact agents', () => {
      middleware.recordEdit('/path/report.md', 'edit', 'writer-session');
      middleware.recordEdit('/path/sources.md', 'edit', 'research-session');

      const writer = middleware.getPendingVerificationContext('writer-session', 'writer');
      const researcher = middleware.getPendingVerificationContext('research-session', 'researcher');
      expect(writer).toContain('Writing Review State');
      expect(writer).toContain('formatting');
      expect(researcher).toContain('Research Review State');
      expect(researcher).toContain('citations');
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
