import { describe, expect, it } from 'vitest';

import { TurnDiffTracker } from '../turn-diff-tracker.js';

describe('TurnDiffTracker', () => {
  it('records apply_patch changes and builds a final guard before review/verification', () => {
    const tracker = new TurnDiffTracker();
    tracker.beginTurn('s1', 't1');

    tracker.recordToolResult({
      sessionKey: 's1',
      toolName: 'apply_patch',
      isError: false,
      result: {
        details: {
          files: ['src/a.ts'],
          added: 2,
          removed: 1,
          diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-old\n+new\n+line\n',
          changes: [
            {
              kind: 'update',
              path: 'src/a.ts',
              added: 2,
              removed: 1,
              diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-old\n+new\n+line\n',
            },
          ],
        },
      },
    });

    const state = tracker.getState('s1');
    expect(state.changedFiles).toEqual(['src/a.ts']);
    expect(state.added).toBe(2);
    expect(state.removed).toBe(1);
    expect(state.cumulativeDiff).toContain('+++ b/src/a.ts');

    const guard = tracker.buildFinalGuardContext('s1');
    expect(guard).toContain('This turn changed workspace files');
    expect(guard).toContain('Inspect the diff');
    expect(guard).toContain('Run the smallest meaningful verification');
  });

  it('marks diff review and successful verification from exec_command', () => {
    const tracker = new TurnDiffTracker();
    tracker.beginTurn('s1', 't1');
    tracker.recordToolResult({
      sessionKey: 's1',
      toolName: 'write_file',
      args: { path: 'src/new.ts' },
      isError: false,
      result: { details: { size: 12 } },
    });

    tracker.recordToolResult({
      sessionKey: 's1',
      toolName: 'exec_command',
      args: { cmd: 'git status --short' },
      isError: false,
      result: { details: { command: 'git status --short', status: 'success', exitCode: 0 } },
    });
    tracker.recordToolResult({
      sessionKey: 's1',
      toolName: 'exec_command',
      args: { cmd: 'pnpm test' },
      isError: false,
      result: { details: { command: 'pnpm test', status: 'success', exitCode: 0 } },
    });

    const state = tracker.getState('s1');
    expect(state.diffReviewed).toBe(true);
    expect(state.verificationAttempted).toBe(true);
    expect(state.lastVerification?.success).toBe(true);
    expect(tracker.buildFinalGuardContext('s1')).toBe('');
  });

  it('reports failed verification and dirty command mutations', () => {
    const tracker = new TurnDiffTracker();
    tracker.beginTurn('s1', 't1');

    tracker.recordToolResult({
      sessionKey: 's1',
      toolName: 'exec_command',
      args: { cmd: "python - <<'PY'\nopen('a.txt','w').write('x')\nPY" },
      isError: false,
      result: { details: { command: 'python write', status: 'success', exitCode: 0 } },
    });
    tracker.recordToolResult({
      sessionKey: 's1',
      toolName: 'exec_command',
      args: { cmd: 'pnpm typecheck' },
      isError: false,
      result: { details: { command: 'pnpm typecheck', status: 'failed', exitCode: 2 } },
    });

    const state = tracker.getState('s1');
    expect(state.dirty).toBe(true);
    expect(state.lastVerification?.success).toBe(false);

    const guard = tracker.buildFinalGuardContext('s1');
    expect(guard).toContain('A command may have modified the workspace');
    expect(guard).toContain('Last verification failed');
    expect(guard).toContain('pnpm typecheck');
  });
});
