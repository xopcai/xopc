import { describe, expect, it, vi } from 'vitest';

import { SelfVerifyMiddleware } from '../../middleware/index.js';
import { AgentEventHandler } from '../agent-event-handler.js';

function createHandler(selfVerifyMiddleware: SelfVerifyMiddleware): AgentEventHandler {
  return new AgentEventHandler({
    errorTracker: {
      recordFailure: vi.fn(),
      reset: vi.fn(),
    },
    requestLimiter: {
      recordRequest: vi.fn(),
      reset: vi.fn(),
    },
    lifecycleManager: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
    toolChainTracker: {
      startChain: vi.fn(),
      recordCall: vi.fn(),
      getCurrentChain: vi.fn().mockReturnValue(null),
      recordResult: vi.fn(),
      endChain: vi.fn(),
    },
    selfVerifyMiddleware,
    systemReminder: {
      appendToResult: vi.fn((result) => result),
    },
    toolUsageAnalyzer: {
      recordUsage: vi.fn(),
    },
    errorPatternMatcher: {
      matchError: vi.fn().mockReturnValue({ matched: false }),
    },
  } as any);
}

const context = { sessionKey: 's1' } as any;

function applyPatchEvent() {
  return {
    type: 'tool_execution_end',
    toolName: 'apply_patch',
    isError: false,
    result: {
      content: [{ type: 'text', text: 'update: src/a.ts (+1/-0)' }],
      details: {
        files: ['src/a.ts'],
      },
    },
  } as any;
}

function execCommandEvent(exitCode: number, command = 'pnpm test') {
  return {
    type: 'tool_execution_end',
    toolName: 'exec_command',
    isError: false,
    result: {
      content: [{ type: 'text', text: exitCode === 0 ? 'ok' : 'failed' }],
      details: {
        command,
        status: exitCode === 0 ? 'success' : 'failed',
        exitCode,
        timedOut: false,
      },
    },
  } as any;
}

describe('AgentEventHandler self-verify integration', () => {
  it('records successful apply_patch as an edit and appends the verification reminder', () => {
    const selfVerify = new SelfVerifyMiddleware();
    const handler = createHandler(selfVerify);
    const event = applyPatchEvent();

    handler.handle(event, context);

    const content = event.result.content.map((part: { text?: string }) => part.text ?? '').join('\n');
    expect(content).toContain('Workspace Verification State');
    expect(content).toContain('files changed');
    expect(content).toContain('inspect the changed files');
    expect(selfVerify.getEditCount('src/a.ts', context.sessionKey)).toBe(1);
  });

  it('keeps apply_patch edits pending after a failed exec_command verification', () => {
    const selfVerify = new SelfVerifyMiddleware();
    const handler = createHandler(selfVerify);

    handler.handle(applyPatchEvent(), context);
    handler.handle(execCommandEvent(1), context);
    handler.handle({ type: 'turn_start' } as any, context);

    expect(selfVerify.consumePostEditReminder(context.sessionKey)).toContain('files changed');
  });

  it('clears apply_patch edits after a successful exec_command verification', () => {
    const selfVerify = new SelfVerifyMiddleware();
    const handler = createHandler(selfVerify);

    handler.handle(applyPatchEvent(), context);
    handler.handle(execCommandEvent(0), context);
    handler.handle({ type: 'turn_start' } as any, context);

    expect(selfVerify.consumePostEditReminder(context.sessionKey)).toBe('');
  });

  it('marks git diff as review without clearing apply_patch edits', () => {
    const selfVerify = new SelfVerifyMiddleware();
    const handler = createHandler(selfVerify);

    handler.handle(applyPatchEvent(), context);
    handler.handle(execCommandEvent(0, 'git diff -- src/a.ts'), context);
    handler.handle({ type: 'turn_start' } as any, context);

    const state = selfVerify.getVerificationState(context.sessionKey);
    expect(state.diffReviewed).toBe(true);
    expect(state.hasUnverifiedEdits).toBe(true);
    expect(selfVerify.consumePostEditReminder(context.sessionKey)).toContain('Diff review: completed');
  });
});
