import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAppResourceScopesSchema, type ExtensionCapabilityBinding } from '@xopcai/gateway-contract';

vi.mock('../../providers/model-call.js', () => ({ completeWithResolvedCredentials: vi.fn() }));
vi.mock('../../config/agent-profile.js', () => ({ resolveEffectiveAgentProfile: () => ({ primaryModelRef: 'host-model' }) }));
vi.mock('../../routing/resolve-route.js', () => ({ getDefaultAgentId: () => 'main' }));
vi.mock('../../providers/index.js', () => ({ resolveModel: vi.fn(() => ({ id: 'host-model', maxTokens: 4096 })) }));

import { completeWithResolvedCredentials } from '../../providers/model-call.js';
import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import { NotesService } from '../../notes/service.js';
import { CapabilityError, type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { localAppCapabilities } from '../capabilities/runtime.js';

let root: string;
const caller: CapabilityContext = { principalId: 'owner', scopes: ['gateway.admin'], surface: 'http', authorize: () => true };
const complete = vi.mocked(completeWithResolvedCredentials);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'app-delegation-')); resetXopcDatabaseSingletonForTest();
  seedTestDatabase(join(root, 'xopc.db')); openXopcDatabase({ path: join(root, 'xopc.db') });
  complete.mockReset(); complete.mockResolvedValue({ content: [{ type: 'text', text: 'A bounded answer' }], stopReason: 'stop' } as never);
});
afterEach(() => { vi.useRealTimers(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const notes = new NotesService();
  const note = notes.createNoteAtomically({ title: 'Approved', markdown: 'APPROVED CONTENT', capturedVia: { channel: 'web' } });
  const privateNote = notes.createNoteAtomically({ title: 'Private', markdown: 'PRIVATE CONTENT', capturedVia: { channel: 'web' } });
  const dispatcher = createProductDispatcher(() => notes);
  const bindings = dispatcher.list({ ...caller, surface: 'extension' }).map(({ id, majorVersion, descriptorDigest }) => ({ id, majorVersion, descriptorDigest })) as ExtensionCapabilityBinding[];
  let current = true; let revision = 'revision-1';
  const scopes = LocalAppResourceScopesSchema.parse({ agentDelegate: true, notesRead: { mode: 'selected', ids: [note.id] } });
  const apps = { getCapabilityAccess: () => {
    if (!current) throw new CapabilityError('FORBIDDEN', 'Revoked');
    return { releaseId: 'release-1', grantRevision: revision, bindings, resourceScopes: scopes };
  } };
  const runtime = (context = caller) => localAppCapabilities(apps, dispatcher, 'test-app', 'a'.repeat(64), context);
  const descriptor = bindings.find(item => item.id === 'xopc.agent.delegate')!;
  const input = { instruction: 'Summarize the supplied note', context: 'Explicit context only', sources: [{ capabilityId: 'xopc.notes.get', id: note.id }] };
  const call = (value: unknown = input, key = 'intent', context = caller) => runtime(context).call('xopc.agent.delegate', { ...descriptor, input: value, idempotencyKey: key });
  return { call, input, scopes, bindings, note, privateNote, dispatcher, revoke: () => { current = false; }, regrant: () => { current = true; revision = 'revision-2'; } };
}

describe('restricted Local App Agent delegation', () => {
  it('returns validated JSON and honors a bounded larger output budget without adding tools', async () => {
    const f = fixture();
    complete.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"items":[{"title":"Follow up"}]}' }], stopReason: 'stop' } as never);
    expect(await f.call({ ...f.input, responseFormat: 'json', maxOutputTokens: 4096 })).toMatchObject({
      data: { json: { items: [{ title: 'Follow up' }] }, finishReason: 'completed' },
    });
    expect(complete.mock.calls[0][2]).toMatchObject({ maxTokens: 4096, maxRetries: 0 });
    expect(complete.mock.calls[0][1].systemPrompt).toContain('valid JSON');
    expect(complete.mock.calls[0][1]).not.toHaveProperty('tools');
    for (const [text, stopReason] of [['not JSON', 'stop'], ['{"partial":true}', 'length']] as const) {
      complete.mockResolvedValueOnce({ content: [{ type: 'text', text }], stopReason } as never);
      const key = crypto.randomUUID();
      await expect(f.call({ ...f.input, responseFormat: 'json' }, key)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
      const calls = complete.mock.calls.length;
      await expect(f.call({ ...f.input, responseFormat: 'json' }, key)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
      expect(complete).toHaveBeenCalledTimes(calls);
    }
    await expect(f.call({ ...f.input, maxOutputTokens: 4097 }, 'oversize')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('uses pinned production reads and one tool-less model request with only explicit context; replays once', async () => {
    const f = fixture();
    const result = await f.call();
    expect(result).toMatchObject({ data: { text: 'A bounded answer', finishReason: 'completed' } });
    expect(await f.call()).toEqual(result); expect(complete).toHaveBeenCalledTimes(1);
    const [, context, options] = complete.mock.calls[0];
    expect(Object.keys(context).sort()).toEqual(['messages', 'systemPrompt']);
    expect(context.messages).toHaveLength(1);
    expect(JSON.stringify(context)).toContain('APPROVED CONTENT');
    expect(JSON.stringify(context)).not.toContain('PRIVATE CONTENT');
    expect(options).toMatchObject({ maxTokens: 1024, maxRetries: 0, timeoutMs: 30000 });
    expect(options).not.toHaveProperty('reasoning');
    f.scopes.notesRead = { mode: 'none' };
    await expect(f.call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.scopes.notesRead = { mode: 'selected', ids: [f.note.id], projectIds: [], includeCreated: false };
    f.regrant(); await expect(f.call()).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('rechecks declared reference contracts and caller ceilings before receipt replay', async () => {
    const f = fixture(); await f.call();
    await expect(f.call(f.input, 'intent', { ...caller, allowedCapabilities: ['xopc.agent.delegate'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const index = f.bindings.findIndex(binding => binding.id === 'xopc.notes.get');
    const original = f.bindings[index]; f.bindings[index] = { ...original, descriptorDigest: 'f'.repeat(64) };
    await expect(f.call()).rejects.toMatchObject({ code: 'CONTRACT_CHANGED' });
    f.bindings.splice(index, 1); await expect(f.call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('denies missing delegation consent, missing read declarations and out-of-scope references before inference', async () => {
    const f = fixture(); f.scopes.agentDelegate = false;
    await expect(f.call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.scopes.agentDelegate = true;
    await expect(f.call({ ...f.input, sources: [{ capabilityId: 'xopc.notes.get', id: f.privateNote.id }] }, 'private')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.bindings.splice(f.bindings.findIndex(item => item.id === 'xopc.notes.get'), 1);
    await expect(f.call(f.input, 'undeclared')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(complete).not.toHaveBeenCalled();
  });
  it('rejects identity/model/tool injection, recursive delegation, large context and caller narrowing', async () => {
    const f = fixture();
    for (const extra of [{ model: 'other' }, { agentId: 'admin' }, { tools: ['bash'] }, { conversationId: 'private' }, { callbackUrl: 'https://invalid' }, { sources: [{ capabilityId: 'xopc.agent.delegate', id: 'anything' }] }]) {
      await expect(f.call({ ...f.input, ...extra }, crypto.randomUUID())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    await expect(f.call(f.input, 'narrow', { ...caller, allowedCapabilities: ['xopc.agent.delegate'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(f.call({ ...f.input, instruction: 'a'.repeat(8000), context: 'b'.repeat(16000) }, 'large')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(complete).not.toHaveBeenCalled();
  });
  it('keeps the hourly budget after reopening the database with a new dispatcher', async () => {
    const f = fixture();
    for (let i = 0; i < 20; i++) await f.call(f.input, `intent-${i}`);
    await expect(f.call(f.input, 'over-budget')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(new DurableState<{ count: number }>('local-app-delegation-budget', 'test-app').get('hour')?.count).toBe(20);
    expect(complete).toHaveBeenCalledTimes(20);
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'xopc.db') });
    const next = fixture(); await expect(next.call(next.input, 'new-runtime')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('withholds in-flight revoked results and never resubmits an uncertain provider call', async () => {
    const f = fixture(); let finish!: (value: never) => void;
    complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.call();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    await expect(f.call(f.input, 'concurrent')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    f.revoke(); finish({ content: [{ type: 'text', text: 'WITHHELD' }], stopReason: 'stop' } as never);
    await expect(pending).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    f.regrant(); await expect(f.call()).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('aborts at the deadline without relying on the provider to honor cancellation', async () => {
    const f = fixture(); vi.useFakeTimers();
    let finish!: (value: never) => void;
    complete.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.call(); const rejected = expect(pending).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await vi.advanceTimersByTimeAsync(30001); await rejected;
    expect(complete.mock.calls[0][2].signal?.aborted).toBe(true);
    await expect(f.call(f.input, 'still-pending')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    finish({ content: [], stopReason: 'stop' } as never); await vi.advanceTimersByTimeAsync(0);
  });
  it('does not execute provider tool requests and bounds text output', async () => {
    const f = fixture();
    complete.mockResolvedValueOnce({ content: [{ type: 'toolCall', name: 'bash', arguments: {} }], stopReason: 'toolUse' } as never);
    await expect(f.call()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await expect(f.call()).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' }); expect(complete).toHaveBeenCalledTimes(1);
    complete.mockResolvedValueOnce({ content: [{ type: 'text', text: 'x'.repeat(9000) }], stopReason: 'length' } as never);
    expect(await f.call(f.input, 'length')).toMatchObject({ data: { text: 'x'.repeat(8192), finishReason: 'length' } });
  });
});
