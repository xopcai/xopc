import { describe, expect, it, vi } from 'vitest';

import type { SessionInputStatus } from '../../storage/sqlite/session-input-repository.js';
import { selectTaskMainUpdateAttempt, submitAndConfirmTaskMainUpdate } from '../task-main-update-input.js';
import { TaskMainUpdateExhaustedError, taskMainUpdateRetryDelay } from '../task-main-update-retry.js';

const input = { conversationId: 'conversation', clientMessageId: 'task-main-update:entry', content: 'Update' };

describe('submitAndConfirmTaskMainUpdate', () => {
  it('stops submitting when all twenty durable input attempts have failed', async () => {
    const submit = vi.fn();
    const waitForCompletion = vi.fn();
    await expect(submitAndConfirmTaskMainUpdate(input, {
      findInput: () => ({ status: 'failed' }), submit, waitForCompletion,
    })).rejects.toBeInstanceOf(TaskMainUpdateExhaustedError);
    expect(submit).not.toHaveBeenCalled();
    expect(waitForCompletion).not.toHaveBeenCalled();
  });

  it('backs off rate limits exponentially up to fifteen minutes', () => {
    const error = new Error('429: {"code":"platform_token_limit_exceeded"}');
    expect([1, 2, 3, 6, 20].map((count) => taskMainUpdateRetryDelay(error, count)))
      .toEqual([30_000, 60_000, 120_000, 900_000, 900_000]);
    expect(taskMainUpdateRetryDelay(new Error('rate_limit_error'), 1)).toBe(30_000);
    expect(taskMainUpdateRetryDelay(new Error('Network failed'), 1)).toBe(1_000);
  });
  it.each(['failed', 'interrupted'] as const)(
    'keeps a %s update pending and retries with a new idempotency key', async (failedStatus) => {
      const states = new Map<string, SessionInputStatus>();
      const submit = vi.fn(async (message: typeof input) => {
        states.set(message.clientMessageId, 'queued');
        return true;
      });
      const waitForCompletion = vi.fn(async (_conversationId: string, clientMessageId: string) => {
        const status = clientMessageId === input.clientMessageId ? failedStatus : 'completed';
        states.set(clientMessageId, status);
        if (status !== 'completed') throw new Error('Agent turn failed');
      });
      const deps = {
        findInput: (_conversationId: string, clientMessageId: string) => {
          const status = states.get(clientMessageId);
          return status ? { status } : undefined;
        },
        submit,
        waitForCompletion,
      };

      await expect(submitAndConfirmTaskMainUpdate(input, deps)).rejects.toThrow('Agent turn failed');
      expect(await submitAndConfirmTaskMainUpdate(input, deps)).toBe(true);
      expect(submit.mock.calls.map(([message]) => message.clientMessageId)).toEqual([
        input.clientMessageId,
        `${input.clientMessageId}:retry:1`,
      ]);
      expect(await submitAndConfirmTaskMainUpdate(input, deps)).toBe(true);
      expect(submit).toHaveBeenCalledTimes(2);
    },
  );

  it('confirms a queued input after restart without submitting a duplicate', async () => {
    let status: SessionInputStatus = 'queued';
    const submit = vi.fn(async () => true);
    const waitForCompletion = vi.fn(async () => { status = 'completed'; });
    expect(await submitAndConfirmTaskMainUpdate(input, {
      findInput: () => ({ status }), submit, waitForCompletion,
    })).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(waitForCompletion).toHaveBeenCalledWith(input.conversationId, input.clientMessageId);
  });

  it('selects a fresh voice input after an interrupted attempt', () => {
    const findInput = (_conversationId: string, clientMessageId: string) =>
      clientMessageId === input.clientMessageId ? { status: 'interrupted' as const } : undefined;
    expect(selectTaskMainUpdateAttempt(input.conversationId, input.clientMessageId, findInput))
      .toEqual({ kind: 'new', clientMessageId: `${input.clientMessageId}:retry:1` });
  });
});
