import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionInputCoordinator } from '../session-input-coordinator.js';
import { appContextToAgentContext } from '../../../agent/source-context/app-context.js';
import {
  appendTranscriptEntry,
  closeXopcDatabase,
  ensureSessionRecord,
  getSessionInputById,
  loadTranscriptRowsForSession,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';

describe('SessionInputCoordinator', () => {
  let dir: string;
  const conversationId = "78fcccd3-a14f-4a70-87d9-69d9471f63d7";
  const origin = { type: 'channel' as const, channel: 'webchat' };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-input-coordinator-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('fails closed on preflight exceptions and continues draining later inputs', async () => {
    let finishFirst!: (value: { status: string; summary: string }) => void;
    const execute = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValue({ status: 'ok', summary: 'done' });
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true, execute,
      beforeExecute: async input => {
        if (input.clientMessageId === 'revoked') throw new Error('Resource no longer accessible');
        return input.clientMessageId !== 'denied';
      },
      prepareAttachments: async (_key, attachments) => attachments,
      prepareContexts: async () => [], steer: async () => false, emit: () => {},
    });
    const ids = new Map<string, string>();
    for (const key of ['active', 'revoked', 'denied', 'allowed']) {
      await coordinator.submit({ conversationId, clientMessageId: key, delivery: 'next', content: key, origin });
      ids.set(key, coordinator.snapshot(conversationId).inputs.find(row => row.clientMessageId === key)!.id);
    }
    finishFirst({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(coordinator.snapshot(conversationId).inputs).toEqual([]));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(getSessionInputById(conversationId, ids.get('revoked')!)?.status).toBe('failed');
    expect(getSessionInputById(conversationId, ids.get('denied')!)?.status).toBe('cancelled');
    expect(getSessionInputById(conversationId, ids.get('allowed')!)?.status).toBe('completed');
  });

  it('keeps one active run and publishes revisioned full snapshots', async () => {
    const completions: Array<(value: { status: string; summary: string }) => void> = [];
    const execute = vi.fn(() => new Promise<{ status: string; summary: string }>((resolve) => {
      completions.push(resolve);
    }));
    const emitted: unknown[] = [];
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true,
      execute,
      prepareAttachments: async (_key, attachments) => attachments,
      prepareContexts: async () => undefined,
      steer: async () => false,
      emit: (_type, payload) => emitted.push(payload),
    });

    const first = await coordinator.submit({
      conversationId, clientMessageId: 'client-1', delivery: 'next', content: 'one', origin,
    });
    const second = await coordinator.submit({
      conversationId, clientMessageId: 'client-2', delivery: 'next', content: 'two', origin,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot(conversationId).inputs.map((row) => row.status)).toEqual(['running', 'queued']);

    completions.shift()?.({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    completions.shift()?.({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(coordinator.snapshot(conversationId).inputs).toEqual([]));

    const revisions = emitted.map((value) => (value as { revision: number }).revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(new Set(revisions).size).toBeGreaterThan(2);
  });

  it('deduplicates retries and falls back from unavailable steer to FIFO next delivery', async () => {
    let complete!: (value: { status: string; summary: string }) => void;
    const execute = vi.fn(() => new Promise<{ status: string; summary: string }>((resolve) => {
      complete = resolve;
    }));
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true,
      execute,
      prepareAttachments: async (_key, attachments) => attachments,
      prepareContexts: async () => undefined,
      steer: async () => false,
      emit: () => {},
    });

    await coordinator.submit({ conversationId, clientMessageId: 'active', delivery: 'next', content: 'active', origin });
    const fallback = await coordinator.submit({
      conversationId, clientMessageId: 'steer-retry', delivery: 'steer', content: 'guide', origin,
    });
    const duplicate = await coordinator.submit({
      conversationId, clientMessageId: 'steer-retry', delivery: 'steer', content: 'duplicate', origin,
    });

    expect(fallback.ok && fallback.effectiveDelivery).toBe('next');
    expect(duplicate.ok && duplicate.state.inputs.filter((row) => row.clientMessageId === 'steer-retry')).toHaveLength(1);
    expect(coordinator.snapshot(conversationId).inputs.map((row) => row.status)).toEqual(['running', 'queued']);

    complete({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    complete({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(coordinator.snapshot(conversationId).inputs).toEqual([]));
  });

  it('tracks an accepted steer against the active run until that run completes', async () => {
    let complete!: (value: { status: string; summary: string }) => void;
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true,
      execute: () => new Promise<{ status: string; summary: string }>((resolve) => { complete = resolve; }),
      prepareAttachments: async (_key, attachments) => attachments,
      prepareContexts: async () => undefined,
      steer: async () => true,
      emit: () => {},
    });

    await coordinator.submit({ conversationId, clientMessageId: 'active', delivery: 'next', content: 'active', origin });
    const steered = await coordinator.submit({
      conversationId, clientMessageId: 'steer-1', delivery: 'steer', content: 'adjust', origin,
    });

    expect(steered.ok && steered.effectiveDelivery).toBe('steer');
    expect(coordinator.snapshot(conversationId).inputs.map((row) => row.status)).toEqual(['running', 'injecting']);

    complete({ status: 'ok', summary: 'done' });
    await expect(coordinator.waitForCompletion(conversationId, 'steer-1')).resolves.toBeUndefined();
    expect(coordinator.snapshot(conversationId).inputs).toEqual([]);
  });

  it('keeps the frozen Note snapshot when queued text is edited without changing its refs', async () => {
    const completions: Array<(value: { status: string; summary: string }) => void> = [];
    const execute = vi.fn(() => new Promise<{ status: string; summary: string }>((resolve) => {
      completions.push(resolve);
    }));
    const prepareContexts = vi.fn(async (_conversationId: string, refs?: Array<{
      kind: 'note'; sourceId: string; expectedVersion?: string;
    }>) => (
      refs?.length
        ? [{
            kind: 'note' as const,
            sourceId: refs[0]!.sourceId,
            version: refs[0]!.expectedVersion ?? 'v1',
            title: 'Frozen note',
            text: 'original snapshot',
          }]
        : undefined
    ));
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true,
      execute,
      prepareAttachments: async (_key, attachments) => attachments,
      prepareContexts,
      steer: async () => false,
      emit: () => {},
    });

    await coordinator.submit({
      conversationId, clientMessageId: 'active', delivery: 'next', content: 'active', origin,
    });
    await coordinator.submit({
      conversationId,
      clientMessageId: 'queued-note',
      delivery: 'next',
      content: 'before edit',
      contextRefs: [{ kind: 'note', sourceId: 'note-1', expectedVersion: 'v1' }],
      origin,
    });

    const queued = coordinator.snapshot(conversationId).inputs.find((input) => input.clientMessageId === 'queued-note');
    expect(queued).toBeDefined();
    const updated = await coordinator.update(conversationId, queued!.id, {
      version: queued!.version,
      content: 'after edit',
      contextRefs: [{ kind: 'note', sourceId: 'note-1', expectedVersion: 'v1' }],
    });

    expect(updated.ok).toBe(true);
    expect(prepareContexts).toHaveBeenCalledTimes(2);
    expect(prepareContexts).toHaveBeenLastCalledWith(conversationId, [
      { kind: 'note', sourceId: 'note-1', expectedVersion: 'v1' },
    ]);
    expect(getSessionInputById(conversationId, queued!.id)).toMatchObject({
      content: 'after edit',
      contextSnapshots: [{ sourceId: 'note-1', version: 'v1', text: 'original snapshot' }],
    });

    completions.shift()?.({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      content: 'after edit',
      sourceContexts: [{ sourceId: 'note-1', version: 'v1', text: 'original snapshot' }],
    });
    completions.shift()?.({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(coordinator.snapshot(conversationId).inputs).toEqual([]));
  });

  it('runs replacement cleanup before atomically queuing the edited latest turn', async () => {
    ensureSessionRecord(conversationId, '/tmp/workspace', { agentId: "main" });
    appendTranscriptEntry(conversationId, { role: 'user', content: 'old', turnId: 'turn-1' } as never);
    appendTranscriptEntry(conversationId, {
      role: 'assistant',
      content: 'partial',
      turnId: 'turn-1',
    } as never);

    let complete!: (value: { status: string; summary: string }) => void;
    const execute = vi.fn(() => new Promise<{ status: string; summary: string }>((resolve) => {
      complete = resolve;
    }));
    const beforeReplace = vi.fn(async () => {});
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true,
      execute,
      prepareAttachments: async (_key, attachments) => attachments,
      prepareContexts: async () => undefined,
      steer: async () => false,
      emit: () => {},
    });

    const result = await coordinator.replaceLatestTurn({
      conversationId,
      targetTurnId: 'turn-1',
      clientMessageId: 'edited-client',
      delivery: 'next',
      content: 'edited',
      origin,
    }, beforeReplace);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Replacement failed: ${result.code}`);
    expect(result.state.activeRunId).toBeTruthy();
    expect(result.state.inputs.find((input) => input.id === result.state.activeInputId))
      .toMatchObject({ clientMessageId: 'edited-client', status: 'running' });
    expect(beforeReplace).toHaveBeenCalledOnce();
    expect(loadTranscriptRowsForSession(conversationId)).toEqual([]);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ content: 'edited' });

    complete({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(coordinator.snapshot(conversationId).inputs).toEqual([]));
  });

  it('freezes browser page context before a turn executes', async () => {
    let complete!: (value: { status: string; summary: string }) => void;
    const execute = vi.fn(() => new Promise<{ status: string; summary: string }>((resolve) => {
      complete = resolve;
    }));
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true,
      execute,
      prepareAttachments: async (_key, attachments) => attachments,
      prepareContexts: async () => undefined,
      steer: async () => false,
      emit: () => {},
    });
    const browserContext = {
      kind: 'browser_page' as const,
      sourceId: 'page-1',
      version: 'digest',
      title: 'Page',
      text: 'Frozen page body',
      url: 'https://example.com/',
      capturedAt: 1,
      documentId: 'doc-1',
    };

    const submission = coordinator.submit({
      conversationId,
      clientMessageId: 'page-turn',
      delivery: 'next',
      content: 'summarize',
      sourceContexts: [browserContext],
      origin,
    });
    browserContext.text = 'mutated while submit awaits session lookup';
    await submission;

    const stored = getSessionInputById(conversationId, coordinator.snapshot(conversationId).activeInputId!);
    expect(stored?.contextSnapshots).toEqual([expect.objectContaining({ text: 'Frozen page body' })]);
    browserContext.text = 'mutated after submit';
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(execute.mock.calls[0]?.[0].sourceContexts).toEqual([
      expect.objectContaining({ text: 'Frozen page body' }),
    ]);
    complete({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(coordinator.snapshot(conversationId).inputs).toEqual([]));
  });

  it('does not clean up or replace the transcript when context preparation fails', async () => {
    ensureSessionRecord(conversationId, '/tmp/workspace', { agentId: 'main' });
    appendTranscriptEntry(conversationId, { role: 'user', content: 'Keep me', turnId: 'turn-1' } as never);
    const beforeReplace = vi.fn(async () => {});
    const execute = vi.fn(async () => ({ status: 'ok', summary: 'done' }));
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true, execute,
      prepareAttachments: async (_key, attachments) => attachments,
      prepareContexts: async () => { throw new Error('Revision changed'); },
      steer: async () => false, emit: () => {},
    });
    const before = loadTranscriptRowsForSession(conversationId);
    expect(await coordinator.replaceLatestTurn({
      conversationId, targetTurnId: 'turn-1', clientMessageId: 'failed-edit',
      delivery: 'next', content: 'Replace', origin,
      contextRefs: [{ kind: 'note', sourceId: 'changed', expectedVersion: '1' }],
    }, beforeReplace)).toEqual({ ok: false, code: 'CONTEXT_UNAVAILABLE' });
    expect(beforeReplace).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(loadTranscriptRowsForSession(conversationId)).toEqual(before);
    expect(coordinator.snapshot(conversationId).inputs).toEqual([]);
  });

  it('persists the exact application envelope and executes its original resolved content', async () => {
    const completions: Array<(value: { status: string; summary: string }) => void> = [];
    const execute = vi.fn(() => new Promise<{ status: string; summary: string }>(resolve => completions.push(resolve)));
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true, execute,
      prepareAttachments: async (_key, attachments) => attachments,
      prepareContexts: async () => [], steer: async () => false, emit: () => {},
    });
    await coordinator.submit({ conversationId, clientMessageId: 'active', delivery: 'next', content: 'Wait', origin });
    const reference = { kind: 'note' as const, id: 'note-1', revision: '2' };
    const source = appContextToAgentContext({
      snapshot: {
        version: 1, clientInstanceId: '7ff7f7a3-463c-4d2c-8a9f-d90c43424f60',
        tabId: '19979ed2-81e0-4c80-9a81-ccbb8fb0061c', sequence: 1,
        surface: 'web', resourceRefs: [reference], capturedAt: 12,
        selection: { text: 'Draft at send time', draft: true },
      },
      resources: [{ reference, title: 'Note', text: 'Saved at send time', truncated: false }],
      selectionTrust: 'user-supplied',
    });
    const expected = structuredClone(source);
    const submission = coordinator.submit({
      conversationId, clientMessageId: 'app-context', delivery: 'next', content: 'Review', origin,
      sourceContexts: [source],
    });
    source.appContext!.selection!.text = 'Different tab content';
    source.text = 'Later body';
    await submission;
    const queued = coordinator.snapshot(conversationId).inputs.find(row => row.clientMessageId === 'app-context')!;
    expect(getSessionInputById(conversationId, queued.id)?.contextSnapshots)
      .toEqual([expect.objectContaining(expected)]);
    expect(await coordinator.submit({
      conversationId, clientMessageId: 'app-context', delivery: 'next', content: 'Review', origin,
      sourceContexts: [source],
    })).toMatchObject({ ok: false, code: 'CONTEXT_UNAVAILABLE' });
    expect(await coordinator.submit({
      conversationId, clientMessageId: 'app-context', delivery: 'next', content: 'Review', origin,
    })).toMatchObject({ ok: false, code: 'CONTEXT_UNAVAILABLE' });
    expect(await coordinator.update(conversationId, queued.id, {
      version: queued.version, content: 'Edited prompt', contextRefs: [],
    })).toMatchObject({ ok: true });
    expect(getSessionInputById(conversationId, queued.id)?.contextSnapshots)
      .toEqual([expect.objectContaining(expected)]);
    completions.shift()!({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls[1]?.[0]).toMatchObject({ sourceContexts: [expected] });
    completions.shift()!({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(coordinator.snapshot(conversationId).inputs).toEqual([]));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    expect(getSessionInputById(conversationId, queued.id)?.contextSnapshots)
      .toEqual([expect.objectContaining(expected)]);
  });
});
