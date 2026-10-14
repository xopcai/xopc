import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../../test/sqlite-fixture.js';
import { SessionInputCoordinator } from '../session-input-coordinator.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { ensureSessionRecord, resetSessionRecord } from '../../../storage/sqlite/session-repository.js';
import { claimNextSessionInput, finishSessionInputRun, getSessionInputById, insertSessionInput, mutateQueuedSessionInput } from '../../../storage/sqlite/session-input-repository.js';
import { loadTranscriptRowsForSession } from '../../../storage/sqlite/transcript-repository.js';
import { buildSessionDisplayMessages } from '../../../session/session-context-for-llm.js';
import { connectionBindings, consumeConnectionResume, getActiveConnectionWait, getConnectionWait, interruptedConnectionMessage, queueConnectionResolution, requireSessionConnection, reviseCurrentConnectionObjective, updateConnectionWait } from '../../../storage/sqlite/connection-wait-repository.js';
import { resolveConnectionCandidate } from '../../../connectors/connection-candidates.js';
import { connectionObjectiveContext } from '../../../agent/context/connection-objective-context.js';
import { acceptSessionCommand } from '../../../storage/sqlite/session-creation-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';

const conversationId = '99cd2f1b-390d-432d-aae4-f07ebd01d775';
const origin = { type: 'channel' as const, channel: 'webchat' };
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

describe('connection input continuity', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-connection-input-'));
    resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(dir, 'xopc.db'));
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    ensureSessionRecord(conversationId, dir, { agentId: 'main', sourceChannel: 'webchat' });
  });
  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  function objective() {
    insertSessionInput({ id: 'original', conversationId, clientMessageId: 'original', content: 'Read Slack messages',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin });
    claimNextSessionInput(conversationId, 'original-run');
    const required = requireSessionConnection({ conversationId, principalId: 'local-owner', agentId: 'main',
      summary: 'Read Slack messages', needs: [resolveConnectionCandidate('composio-slack')] });
    finishSessionInputRun(conversationId, 'original-run', 'suspended');
    const wait = getConnectionWait(required.waitId!)!;
    return updateConnectionWait({ ...wait, intent: { objectiveRevision: wait.objectiveRevision, validUntil: Date.now() + 60_000 } }, wait.version);
  }
  function coordinator(overrides: Partial<ConstructorParameters<typeof SessionInputCoordinator>[0]> = {}) {
    const execute = vi.fn(async (_input: { content: string }) => ({ status: 'ok', summary: '' }));
    const interrupt = vi.fn(async () => {});
    const continueConnection = vi.fn(async (wait: ReturnType<typeof objective>) => {
      if (wait.status === 'open') queueConnectionResolution(wait, 'continued');
    });
    const instance = new SessionInputCoordinator({ sessionExists: async () => true, execute, interrupt,
      prioritizeInput: () => true, coalesceWindowMs: 0, continueConnection,
      prepareAttachments: async (_id, attachments) => attachments, prepareContexts: async () => [],
      steer: async () => true, emit: () => {}, ...overrides });
    const submit = (content: string, clientMessageId = content) => instance.submit({ conversationId,
      clientMessageId, content, delivery: 'next', origin });
    return { instance, execute, interrupt, continueConnection, submit };
  }

  it.each([false, true])('binds early corrections across goal changes and restarts (coalesced=%s)', async coalesced => {
    insertSessionInput({ id: 'original', conversationId, clientMessageId: 'original', content: 'Read Slack messages',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', origin });
    claimNextSessionInput(conversationId, 'original-run');
    const c = coordinator();
    const prepared = await c.instance.prepareInput({ conversationId, clientMessageId: 'early-correction',
      content: 'And only show mentions', delivery: 'next', origin });
    expect(prepared.payload).toBeUndefined();
    insertSessionInput({ ...prepared, id: 'early-correction', conversationId, clientMessageId: 'early-correction' });
    if (coalesced) insertSessionInput({ ...prepared, id: 'early-correction-2', conversationId,
      clientMessageId: 'early-correction-2', content: 'And only unread' });
    const required = requireSessionConnection({ conversationId, principalId: 'local-owner', agentId: 'main',
      summary: 'Read Slack messages', needs: [resolveConnectionCandidate('composio-slack')] });
    finishSessionInputRun(conversationId, 'original-run', 'suspended');
    const wait = getConnectionWait(required.waitId!)!;
    getSqliteDatabase().prepare('UPDATE session_inputs SET created_at_ms = ? WHERE id = ?').run(wait.createdAt - 1, 'early-correction');
    if (coalesced) getSqliteDatabase().prepare('UPDATE session_inputs SET created_at_ms = ? WHERE id = ?').run(wait.createdAt - 1, 'early-correction-2');
    const correction = claimNextSessionInput(conversationId, 'early-change-run')!;
    expect(correction.payload).toMatchObject({ waitId: wait.id, connectionBarrier: true });
    reviseCurrentConnectionObjective(conversationId, 'Only today');
    closeXopcDatabase();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    c.instance.recover();
    await c.instance.drain(conversationId);
    c.instance.recover();
    await c.instance.drain(conversationId);
    const revised = getConnectionWait(wait.id)!;
    expect(interruptedConnectionMessage(revised)?.id).toBe('early-correction');
    expect(queueConnectionResolution(revised, 'continued').status).toBe('open');
    expect(c.execute).not.toHaveBeenCalled();
    const blocked = getSessionInputById(conversationId, correction.id)!;
    c.instance.remove(conversationId, blocked.id, blocked.version);
    if (coalesced) {
      const second = getSessionInputById(conversationId, 'early-correction-2')!;
      expect(second.status).toBe('interrupted');
      expect(interruptedConnectionMessage(getConnectionWait(wait.id)!)?.id).toBe(second.id);
      expect(queueConnectionResolution(getConnectionWait(wait.id)!, 'continued').status).toBe('open');
      c.instance.remove(conversationId, second.id, second.version);
    }
    const ready = getConnectionWait(wait.id)!;
    queueConnectionResolution(updateConnectionWait({ ...ready, reviewRequired: false,
      intent: { objectiveRevision: ready.objectiveRevision, validUntil: Date.now() + 60_000 } }, ready.version), 'continued');
    await c.instance.drain(conversationId);
    expect(c.execute).toHaveBeenCalledOnce();
  });

  it('preserves the intent and version for unrelated input, then resumes only once', async () => {
    const wait = objective();
    const queued = queueConnectionResolution(wait, 'continued');
    const c = coordinator();
    await c.submit('Tell me a joke');
    await c.instance.waitForCompletion(conversationId, 'Tell me a joke');
    await vi.waitFor(() => expect(getConnectionWait(wait.id)?.status).toBe('closed'));
    expect(c.execute.mock.calls.map(([input]) => input.content)).toEqual(['Tell me a joke', expect.stringContaining('Recovery checkpoint')]);
    expect(getConnectionWait(wait.id)?.objectiveRevision).toBe(wait.objectiveRevision);
    expect(getConnectionWait(wait.id)?.intent).toEqual(wait.intent);
    expect(getSessionInputById(conversationId, queued.queuedInputId!)?.status).toBe('completed');
    expect(c.interrupt).not.toHaveBeenCalled();
  });

  it.each(['继续', '继续看下', 'continue'])('handles %s as a durable control without a second model run', async text => {
    const wait = objective();
    const c = coordinator();
    await c.submit(text, 'control');
    await c.instance.waitForCompletion(conversationId, 'control');
    await vi.waitFor(() => expect(getConnectionWait(wait.id)?.status).toBe('closed'));
    await c.submit(text, 'control');
    expect(c.continueConnection).toHaveBeenCalledOnce();
    expect(c.execute).toHaveBeenCalledOnce();
    expect(c.execute.mock.calls[0]![0].content).toContain('Recovery checkpoint');
    expect(getConnectionWait(wait.id)?.objectiveRevision).toBe(wait.objectiveRevision);
  });

  it('does not reinterpret a continuation containing a scope change as a control', async () => {
    const wait = objective();
    const queued = queueConnectionResolution(wait, 'continued');
    const execute = vi.fn(async () => {
      expect(connectionObjectiveContext(conversationId)).toContain('Read Slack messages');
      reviseCurrentConnectionObjective(conversationId, 'Read today’s Slack messages');
      return { status: 'ok', summary: '' };
    });
    const c = coordinator({ execute });
    await c.submit('继续，但只看今天');
    await c.instance.waitForCompletion(conversationId, '继续，但只看今天');
    expect(execute).toHaveBeenCalledOnce();
    expect(c.continueConnection).not.toHaveBeenCalled();
    expect(getSessionInputById(conversationId, queued.queuedInputId!)?.status).toBe('cancelled');
    expect(getActiveConnectionWait(conversationId)?.intent).toBeUndefined();
    expect(getActiveConnectionWait(conversationId)).toMatchObject({ summary: 'Read today’s Slack messages',
      objectiveRevision: wait.objectiveRevision + 1 });
  });

  it('yields a claimed recovery to an arriving message without invalidating its intent', async () => {
    const wait = objective();
    const queued = queueConnectionResolution(wait, 'continued');
    const gate = deferred();
    const beforeExecute = vi.fn(async input => {
      if (input.kind === 'connection_resume' && beforeExecute.mock.calls.length === 1) await gate.promise;
      return true;
    });
    const c = coordinator({ beforeExecute });
    const draining = c.instance.drain(conversationId);
    await vi.waitFor(() => expect(beforeExecute).toHaveBeenCalledOnce());
    await c.submit('What is two plus two?');
    expect(getConnectionWait(wait.id)?.intent).toEqual(wait.intent);
    gate.release();
    await draining;
    expect(c.execute.mock.calls.map(([input]) => input.content)).toEqual(['What is two plus two?', expect.stringContaining('Recovery checkpoint')]);
    expect(getSessionInputById(conversationId, queued.queuedInputId!)?.status).toBe('completed');
    expect(c.interrupt).not.toHaveBeenCalled();
  });

  it('waits for asynchronous input validation before consuming the recovery', async () => {
    const wait = objective();
    queueConnectionResolution(wait, 'continued');
    const probe = deferred();
    const preparation = deferred();
    let first = true;
    const c = coordinator({ beforeExecute: async input => {
      if (input.kind === 'connection_resume' && first) { first = false; await probe.promise; }
      return true;
    }, prepareAttachments: async () => { await preparation.promise; return undefined; } });
    const draining = c.instance.drain(conversationId);
    await vi.waitFor(() => expect(first).toBe(false));
    const accepting = c.submit('Unrelated question');
    probe.release();
    await draining;
    expect(c.execute).not.toHaveBeenCalled();
    expect(getConnectionWait(wait.id)?.status).toBe('queued');
    preparation.release();
    await accepting;
    await vi.waitFor(() => expect(c.execute).toHaveBeenCalledTimes(2));
    expect(c.execute.mock.calls[0]![0].content).toBe('Unrelated question');
  });

  it('invalidates the old recovery only after the new turn explicitly changes the objective', async () => {
    const wait = objective();
    const queued = queueConnectionResolution(wait, 'continued');
    const gate = deferred();
    let entered = false;
    const execute = vi.fn(async () => {
      reviseCurrentConnectionObjective(conversationId, 'Only read today');
      return { status: 'ok', summary: '' };
    });
    const c = coordinator({ execute, beforeExecute: async input => {
      if (input.kind === 'connection_resume') { entered = true; await gate.promise; }
      return true;
    } });
    const draining = c.instance.drain(conversationId);
    await vi.waitFor(() => expect(entered).toBe(true));
    await c.submit('只看今天');
    expect(getConnectionWait(wait.id)?.objectiveRevision).toBe(wait.objectiveRevision);
    gate.release();
    await draining;
    expect(execute).toHaveBeenCalledOnce();
    expect(getSessionInputById(conversationId, queued.queuedInputId!)?.status).toBe('cancelled');
    expect(getConnectionWait(wait.id)?.objectiveRevision).toBe(wait.objectiveRevision + 1);
  });

  it('cancels during a delayed preflight and fences its late result', async () => {
    const wait = objective();
    const queued = queueConnectionResolution(wait, 'continued');
    const gate = deferred();
    let entered = false;
    const cancelConnection = vi.fn();
    const c = coordinator({ cancelConnection, beforeExecute: async input => {
      if (input.kind === 'connection_resume') { entered = true; await gate.promise; }
      return true;
    } });
    const draining = c.instance.drain(conversationId);
    await vi.waitFor(() => expect(entered).toBe(true));
    await c.submit('取消这个目标');
    expect(cancelConnection).toHaveBeenCalledWith(expect.objectContaining({ id: wait.id, resolution: 'cancelled' }));
    gate.release();
    await draining;
    expect(c.execute).not.toHaveBeenCalled();
    expect(getConnectionWait(wait.id)).toMatchObject({ status: 'closed', resolution: 'cancelled' });
    expect(getSessionInputById(conversationId, queued.queuedInputId!)?.status).toBe('cancelled');
  });

  it('does not interrupt or steer into an already executing recovery for unrelated input or continue', async () => {
    const wait = objective();
    queueConnectionResolution(wait, 'continued');
    const gate = deferred();
    let running = false;
    const execute = vi.fn(async input => {
      if (input.content.includes('Recovery checkpoint')) { running = true; await gate.promise; }
      return { status: 'ok', summary: '' };
    });
    const c = coordinator({ execute });
    const draining = c.instance.drain(conversationId);
    await vi.waitFor(() => expect(running).toBe(true));
    await c.submit('继续看下');
    await c.submit('Unrelated question');
    expect(c.interrupt).not.toHaveBeenCalled();
    gate.release();
    await draining;
    expect(execute).toHaveBeenCalledTimes(2);
    expect(c.continueConnection).toHaveBeenCalledOnce();
  });

  it('cancels an already consumed recovery through its active run without executing another model turn', async () => {
    const wait = objective();
    queueConnectionResolution(wait, 'continued');
    const gate = deferred();
    let running = false;
    const execute = vi.fn(async () => { running = true; await gate.promise; return { status: 'aborted', summary: '' }; });
    const interrupt = vi.fn(async () => { gate.release(); });
    const c = coordinator({ execute, interrupt });
    const draining = c.instance.drain(conversationId);
    await vi.waitFor(() => expect(running).toBe(true));
    await c.submit('取消这个目标');
    await draining;
    expect(interrupt).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(getConnectionWait(wait.id)?.resolution).toBe('cancelled');
  });

  it('recovers an interrupted control with one durable feedback pair and one original execution', async () => {
    const wait = objective();
    insertSessionInput({ id: 'continue-control', conversationId, clientMessageId: 'continue-control',
      expectedTranscriptId: wait.transcriptId, requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued',
      content: '继续', origin, payload: { waitId: wait.id, objectiveRevision: wait.objectiveRevision, connectionAction: 'continue' } });
    claimNextSessionInput(conversationId, 'crashed-control');
    const c = coordinator();
    c.instance.recover();
    await c.instance.waitForCompletion(conversationId, 'continue-control');
    await vi.waitFor(() => expect(getConnectionWait(wait.id)?.status).toBe('closed'));
    c.instance.recover();
    await c.submit('继续', 'continue-control');
    const visible = buildSessionDisplayMessages(loadTranscriptRowsForSession(conversationId));
    expect(visible.filter(row => row.role === 'user')).toHaveLength(1);
    expect(visible.filter(row => row.role === 'assistant')).toHaveLength(1);
    expect(c.continueConnection).toHaveBeenCalledOnce();
    expect(c.execute).toHaveBeenCalledOnce();
  });

  it('treats edited queued controls as normal input so old control metadata cannot override the new content', async () => {
    const wait = objective();
    const row = insertSessionInput({ id: 'edited-control', conversationId, clientMessageId: 'edited-control',
      expectedTranscriptId: wait.transcriptId, requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued',
      content: '继续', origin, payload: { waitId: wait.id, objectiveRevision: wait.objectiveRevision, connectionAction: 'continue' } });
    expect(mutateQueuedSessionInput({ conversationId, id: row.id, version: row.version, content: '只看今天' })).toBe(true);
    const c = coordinator();
    await c.instance.drain(conversationId);
    expect(c.continueConnection).not.toHaveBeenCalled();
    expect(c.execute).toHaveBeenCalledOnce();
    expect(c.execute.mock.calls[0]![0].content).toBe('只看今天');
  });

  it('does not append a late control reply to the new transcript after reset', async () => {
    objective();
    const gate = deferred();
    let entered = false;
    const c = coordinator({ continueConnection: async () => { entered = true; await gate.promise; } });
    await c.submit('继续', 'late-control');
    await vi.waitFor(() => expect(entered).toBe(true));
    resetSessionRecord(conversationId, dir);
    gate.release();
    await vi.waitFor(() => expect(c.instance.snapshot(conversationId).activeRunId).toBeUndefined());
    expect(loadTranscriptRowsForSession(conversationId)).toEqual([]);
    expect(c.execute).not.toHaveBeenCalled();
  });

  it.each(['Unrelated question', '继续看下', '取消这个目标'])('preserves control semantics through atomic append acceptance: %s', async content => {
    const wait = objective();
    queueConnectionResolution(wait, 'continued');
    const c = coordinator();
    const message = { conversationId, clientMessageId: 'atomic-message', content, delivery: 'next' as const,
      origin: { type: 'system' as const, source: 'cli' as const } };
    await c.instance.withSubmission(conversationId, async () => {
      const preparedInput = await c.instance.prepareInput(message);
      const receipt = acceptSessionCommand({ conversationId, principalId: 'local-owner', preparedInput,
        command: { kind: 'append', clientMessageId: message.clientMessageId, expectedTranscriptId: wait.transcriptId,
          configVersion: 0, delivery: 'next', origin: message.origin, input: { content } } });
      await c.instance.dispatchAcceptedInput(conversationId, receipt.inputId!);
    });
    await c.instance.waitForCompletion(conversationId, 'atomic-message');
    await vi.waitFor(() => expect(c.instance.snapshot(conversationId).activeRunId).toBeUndefined());
    expect(c.execute).toHaveBeenCalledTimes(content === 'Unrelated question' ? 2 : content === '取消这个目标' ? 0 : 1);
    expect(getConnectionWait(wait.id)?.objectiveRevision).toBe(wait.objectiveRevision);
    expect(getConnectionWait(wait.id)?.resolution).toBe(content === '取消这个目标' ? 'cancelled' : 'continued');
  });

  it('does not let a prepared cancellation cancel a newer goal revision at atomic acceptance', async () => {
    const wait = objective();
    const c = coordinator();
    const preparedInput = await c.instance.prepareInput({ conversationId, clientMessageId: 'stale-cancel',
      content: '取消这个目标', delivery: 'next', origin: { type: 'system', source: 'cli' } });
    reviseCurrentConnectionObjective(conversationId, 'Read only today');
    acceptSessionCommand({ conversationId, principalId: 'local-owner', preparedInput,
      command: { kind: 'append', clientMessageId: 'stale-cancel', expectedTranscriptId: wait.transcriptId,
        configVersion: 0, delivery: 'next', origin: { type: 'system', source: 'cli' }, input: { content: '取消这个目标' } } });
    await c.instance.drain(conversationId);
    expect(getConnectionWait(wait.id)).toMatchObject({ status: 'open', summary: 'Read only today', objectiveRevision: wait.objectiveRevision + 1 });
    expect(c.execute).not.toHaveBeenCalled();
  });

  it('leaves an ambiguous continue to the model when another message is being handled', async () => {
    const wait = objective();
    const gate = deferred();
    let running = false;
    const execute = vi.fn(async input => {
      if (input.content === 'Other task') { running = true; await gate.promise; }
      return { status: 'ok', summary: '' };
    });
    const c = coordinator({ execute });
    await c.submit('Other task');
    await vi.waitFor(() => expect(running).toBe(true));
    await c.submit('继续');
    gate.release();
    await c.instance.waitForCompletion(conversationId, '继续');
    expect(execute.mock.calls.map(([input]) => input.content)).toEqual(['Other task', '继续']);
    expect(c.continueConnection).not.toHaveBeenCalled();
    expect(c.interrupt).not.toHaveBeenCalled();
    expect(getConnectionWait(wait.id)?.intent).toEqual(wait.intent);
  });

  it('does not interrupt a newer running revision when an old prepared cancellation is accepted', async () => {
    const wait = objective();
    const c = coordinator();
    const preparedInput = await c.instance.prepareInput({ conversationId, clientMessageId: 'stale-running-cancel',
      content: '取消这个目标', delivery: 'next', origin: { type: 'system', source: 'cli' } });
    reviseCurrentConnectionObjective(conversationId, 'Read only today');
    const revised = getConnectionWait(wait.id)!;
    const confirmed = updateConnectionWait({ ...revised, reviewRequired: false,
      intent: { objectiveRevision: revised.objectiveRevision, validUntil: Date.now() + 60_000 } }, revised.version);
    queueConnectionResolution(confirmed, 'continued');
    const active = claimNextSessionInput(conversationId, 'new-revision-run')!;
    expect(consumeConnectionResume(active)).toBe(true);
    const receipt = acceptSessionCommand({ conversationId, principalId: 'local-owner', preparedInput,
      command: { kind: 'append', clientMessageId: 'stale-running-cancel', expectedTranscriptId: wait.transcriptId,
        configVersion: 0, delivery: 'next', origin: { type: 'system', source: 'cli' }, input: { content: '取消这个目标' } } });
    await c.instance.dispatchAcceptedInput(conversationId, receipt.inputId!);
    expect(c.interrupt).not.toHaveBeenCalled();
    expect(getConnectionWait(wait.id)).toMatchObject({ objectiveRevision: wait.objectiveRevision + 1, resolution: 'continued' });
    finishSessionInputRun(conversationId, 'new-revision-run', 'completed');
    await c.instance.drain(conversationId);
    expect(c.execute).not.toHaveBeenCalled();
  });

  it('retains an interrupted correction across repeated restarts until it is explicitly removed', async () => {
    const wait = objective();
    const queued = queueConnectionResolution(wait, 'continued');
    // Legacy/directly inserted inputs are adopted into the barrier at restart.
    insertSessionInput({ id: 'correction', conversationId, clientMessageId: 'correction', requestedDelivery: 'next',
      effectiveDelivery: 'next', status: 'queued', content: '只看今天，不要看原来的时间范围', origin });
    expect(claimNextSessionInput(conversationId, 'correction-run')?.id).toBe('correction');
    const c = coordinator();
    c.instance.recover();
    await c.instance.drain(conversationId);
    c.instance.recover();
    await c.instance.drain(conversationId);
    expect(c.execute).not.toHaveBeenCalled();
    expect(interruptedConnectionMessage(getConnectionWait(wait.id)!)?.id).toBe('correction');
    expect(getSessionInputById(conversationId, queued.queuedInputId!)?.status).toBe('queued');
    await c.submit('继续原目标');
    await c.instance.waitForCompletion(conversationId, '继续原目标');
    expect(c.execute).not.toHaveBeenCalled();
    const interrupted = getSessionInputById(conversationId, 'correction')!;
    expect(c.instance.remove(conversationId, interrupted.id, interrupted.version).ok).toBe(true);
    await vi.waitFor(() => expect(c.execute).toHaveBeenCalledOnce());
    expect(getConnectionWait(wait.id)?.status).toBe('closed');
  });

  it('lets an explicit new revision replace the interrupted correction barrier without replaying the old goal', async () => {
    const wait = objective();
    const queued = queueConnectionResolution(wait, 'continued');
    insertSessionInput({ id: 'interrupted-change', conversationId, clientMessageId: 'interrupted-change', requestedDelivery: 'next',
      effectiveDelivery: 'next', status: 'queued', content: 'Only today', origin });
    claimNextSessionInput(conversationId, 'change-run');
    const c = coordinator();
    c.instance.recover();
    await c.instance.drain(conversationId);
    reviseCurrentConnectionObjective(conversationId, 'Read only today');
    const revised = getConnectionWait(wait.id)!;
    expect(interruptedConnectionMessage(revised)).toBeUndefined();
    expect(getSessionInputById(conversationId, queued.queuedInputId!)?.status).toBe('cancelled');
    queueConnectionResolution(updateConnectionWait({ ...revised, reviewRequired: false,
      intent: { objectiveRevision: revised.objectiveRevision, validUntil: Date.now() + 60_000 } }, revised.version), 'continued');
    await c.instance.drain(conversationId);
    expect(c.execute).toHaveBeenCalledOnce();
    expect(c.execute.mock.calls[0]![0].content).toContain('Read only today');
  });

  it.each(['before-claim', 'during-delivery', 'legacy-in-flight'] as const)('keeps unhandled corrections fenced after a revision %s and repeated restarts', async timing => {
    const wait = objective();
    const c = coordinator();
    const prepared = await c.instance.prepareInput({ conversationId, clientMessageId: 'second-change',
      content: 'And only show mentions', delivery: 'next', origin });
    if (timing === 'before-claim') reviseCurrentConnectionObjective(conversationId, 'Only read today');
    insertSessionInput({ ...prepared, id: 'second-change', conversationId, clientMessageId: 'second-change',
      expectedTranscriptId: wait.transcriptId });
    claimNextSessionInput(conversationId, 'second-change-run');
    if (timing !== 'before-claim') reviseCurrentConnectionObjective(conversationId, 'Only read today');
    if (timing === 'legacy-in-flight') getSqliteDatabase().prepare(`UPDATE session_inputs
      SET payload_json = json_set(payload_json, '$.objectiveRevision', ?) WHERE id = 'second-change'`).run(wait.objectiveRevision);
    closeXopcDatabase();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    c.instance.recover();
    await c.instance.drain(conversationId);
    c.instance.recover();
    await c.instance.drain(conversationId);
    const revised = getConnectionWait(wait.id)!;
    expect(interruptedConnectionMessage(revised)?.id).toBe('second-change');
    expect(queueConnectionResolution(revised, 'continued').status).toBe('open');
    await c.submit('继续原目标');
    await c.instance.waitForCompletion(conversationId, '继续原目标');
    expect(c.execute).not.toHaveBeenCalled();
    const blocked = getSessionInputById(conversationId, 'second-change')!;
    expect(c.instance.remove(conversationId, blocked.id, blocked.version).ok).toBe(true);
    const ready = getConnectionWait(wait.id)!;
    queueConnectionResolution(updateConnectionWait({ ...ready, reviewRequired: false,
      intent: { objectiveRevision: ready.objectiveRevision, validUntil: Date.now() + 60_000 } }, ready.version), 'continued');
    await c.instance.drain(conversationId);
    expect(c.execute).toHaveBeenCalledOnce();
    expect(c.execute.mock.calls[0]![0].content).toContain('Only read today');
  });

  it('does not mistake a message barrier for recovery ownership or inherit the old selected account', async () => {
    const wait = objective();
    updateConnectionWait({ ...wait, needs: wait.needs.map(need => ({ ...need, accountId: 'original-account' })) }, wait.version);
    const execute = vi.fn(async () => {
      expect(connectionBindings(conversationId)).toEqual([]);
      const next = requireSessionConnection({ conversationId, principalId: 'local-owner', agentId: 'main',
        summary: 'A different request', needs: [resolveConnectionCandidate('composio-gmail')] });
      expect(next.status).toBe('objective_conflict');
      return { status: 'ok', summary: '' };
    });
    const c = coordinator({ execute });
    await c.submit('An unrelated request');
    await c.instance.waitForCompletion(conversationId, 'An unrelated request');
    expect(getConnectionWait(wait.id)?.needs).toHaveLength(1);
    expect(getConnectionWait(wait.id)?.objectiveRevision).toBe(wait.objectiveRevision);
  });

  it.each(['submit', 'atomic'] as const)('accepts later messages without waiting for a slow stop acknowledgement via %s', async path => {
    const wait = objective(); queueConnectionResolution(wait, 'continued');
    const execution = deferred(); const acknowledgement = deferred();
    let running = false;
    const execute = vi.fn(async input => {
      if (input.content.includes('Recovery checkpoint')) { running = true; await execution.promise; }
      return { status: 'ok', summary: '' };
    });
    const interrupt = vi.fn(async () => { await acknowledgement.promise; });
    const c = coordinator({ execute, interrupt });
    const draining = c.instance.drain(conversationId);
    await vi.waitFor(() => expect(running).toBe(true));
    const send = path === 'submit' ? c.submit : async (content: string, clientMessageId = content) => {
      await c.instance.withSubmission(conversationId, async () => {
        const preparedInput = await c.instance.prepareInput({ conversationId, clientMessageId, content, delivery: 'next', origin: { type: 'system', source: 'cli' } });
        const receipt = acceptSessionCommand({ conversationId, principalId: 'local-owner', preparedInput,
          command: { kind: 'append', clientMessageId, expectedTranscriptId: wait.transcriptId,
            configVersion: 0, delivery: 'next', origin: { type: 'system', source: 'cli' }, input: { content } } });
        await c.instance.dispatchAcceptedInput(conversationId, receipt.inputId!);
      });
    };
    await send('取消这个目标', 'cancel-1');
    await send('取消这个目标', 'cancel-2');
    await send('Another question');
    expect(interrupt).toHaveBeenCalledOnce();
    expect(c.instance.isAcceptingInput(conversationId)).toBe(false);
    expect(c.instance.snapshot(conversationId).inputs.some(input => input.content === 'Another question')).toBe(true);
    execution.release();
    await draining;
    expect(execute).toHaveBeenCalledTimes(2);
    expect(getConnectionWait(wait.id)?.resolution).toBe('cancelled');
    acknowledgement.release();
  });
});
