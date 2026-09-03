import crypto from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExecutionCommand } from '@xopcai/realtime-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExecutionHostOperationJournal } from '../operation-journal.js';

describe('ExecutionHostOperationJournal', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('fails closed instead of replaying an interrupted non-idempotent command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-operation-journal-'));
    roots.push(root);
    const command: ExecutionCommand = {
      operationId: crypto.randomUUID(),
      environmentId: 'env-1',
      bindingEpoch: 1,
      deadlineAt: Date.now() + 10_000,
      idempotencyKey: 'tool-call-1',
      command: 'workspace.execute_tool',
      payload: { toolName: 'apply_patch' },
    };
    let finish: ((value: unknown) => void) | undefined;
    const first = new ExecutionHostOperationJournal(root).run(
      command,
      () => new Promise((resolve) => { finish = resolve; }),
      { recoverAfterCrash: false },
    );
    await vi.waitFor(() => expect(readdirSync(join(root, 'operations'))).toContainEqual(expect.stringContaining('.pending.json')));

    await expect(new ExecutionHostOperationJournal(root).run(
      { ...command, operationId: crypto.randomUUID() },
      async () => ({ duplicated: true }),
      { recoverAfterCrash: false },
    )).rejects.toMatchObject({ code: 'INDETERMINATE_OPERATION' });

    finish?.({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });
  });
});
