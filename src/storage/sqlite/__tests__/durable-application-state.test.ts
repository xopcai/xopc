import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeXopcDatabase, openXopcDatabase } from '../connection.js';
import { DurableState } from '../durable-state.js';
import { DurableQueue } from '../durable-queue.js';
import { AgentInbox } from '../../../agent/ipc/inbox.js';
import { NotesStore } from '../../../notes/store.js';
import { createWorkflowCatalog, WorkflowRevisionConflictError } from '../../../agent/workflow/catalog.js';
import { loadExtensionStore, saveExtensionStore } from '../../../gateway/hono/lib/extension-store.js';
import { appendComposioTriggerEvent } from '../../../connectors/composio-triggers.js';
import { ShareStore } from '../../../share/share-store.js';
import { WorkflowEventStore } from '../../../workflows/store/event-store.js';
import type { Config } from '../../../config/schema.js';
import type { AgentIPCMessage } from '../../../agent/ipc/types.js';
import type { Note } from '../../../notes/types.js';

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xopc-durable-'));
  dbPath = join(dir, 'xopc.db');
  openXopcDatabase({ path: dbPath });
});
afterEach(() => { vi.restoreAllMocks(); closeXopcDatabase(); rmSync(dir, { recursive: true, force: true }); });

const graph = {
  schemaVersion: 1 as const,
  nodes: [
    { id: 'input', kind: 'input' as const, title: 'Input', position: { x: 0, y: 0 }, config: {} },
    { id: 'output', kind: 'output' as const, title: 'Output', position: { x: 100, y: 0 }, config: {} },
  ],
  edges: [{ id: 'edge', source: 'input', target: 'output' }],
};

describe('durable application storage', () => {
  it('isolates exact namespaces and scopes and rolls back failed mutations', () => {
    const first = new DurableState<number>('a/b', 'one');
    const second = new DurableState<number>('a_b', 'one');
    first.set('key', 1);
    second.set('key', 2);
    expect(() => first.update('key', () => { second.set('key', 9); throw new Error('abort'); })).toThrow('abort');
    closeXopcDatabase(); openXopcDatabase({ path: dbPath });
    expect(first.get('key')).toBe(1);
    expect(second.get('key')).toBe(2);
    expect(new DurableState('a/b', 'two').get('key')).toBeUndefined();
  });

  it('saves workflow current revision and history atomically and rejects stale writers', () => {
    const a = createWorkflowCatalog();
    const b = createWorkflowCatalog();
    a.save({ name: 'demo', graph, expectedRevision: 0 });
    b.save({ name: 'demo', graph, expectedRevision: 1 });
    expect(() => a.save({ name: 'demo', graph, expectedRevision: 1 })).toThrow(WorkflowRevisionConflictError);
    closeXopcDatabase(); openXopcDatabase({ path: dbPath });
    expect(a.load('demo').revision).toBe(2);
    expect(a.listRevisions('demo').map(row => row.revision)).toEqual([2, 1]);
  });

  it('allocates unique event sequences across concurrent store instances', async () => {
    const stores = [new WorkflowEventStore({} as Config, 'main'), new WorkflowEventStore({} as Config, 'main')];
    await Promise.all(Array.from({ length: 20 }, (_, i) => stores[i % 2].append({
      runId: 'run', type: 'run_started', payload: { startedAtMs: i },
    })));
    expect((await stores[0].readRunEvents('run')).map(row => row.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await new WorkflowEventStore({} as Config, 'other').readRunEvents('run')).toEqual([]);
  });

  it('does not overwrite same-millisecond snapshots and cascades note deletion', async () => {
    const store = new NotesStore();
    const note: Note = { id: 'note', markdown: 'one', kind: 'thought', status: 'inbox', createdAt: 1, updatedAt: 1, capturedVia: { channel: 'web' } };
    await store.addNote(note);
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    await store.saveSnapshot(note, 'edit');
    await store.saveSnapshot({ ...note, markdown: 'two' }, 'edit');
    expect((await store.listSnapshots(note.id)).map(item => item.timestamp)).toEqual([1001, 1000]);
    await store.deleteNote(note.id);
    expect(await store.listSnapshots(note.id)).toEqual([]);
  });

  it('persists extension state without leaking mutable references or colliding namespace names', async () => {
    await saveExtensionStore('a/b', { answer: 1 });
    await saveExtensionStore('a_b', { answer: 2 });
    const loaded = await loadExtensionStore('a/b'); loaded.answer = 9;
    closeXopcDatabase(); openXopcDatabase({ path: dbPath });
    expect(await loadExtensionStore('a/b')).toEqual({ answer: 1 });
    expect(await loadExtensionStore('a_b')).toEqual({ answer: 2 });
  });

  it('deduplicates archived connector events beyond the old last-500 window', async () => {
    const config = {} as Config;
    const first = await appendComposioTriggerEvent(config, { id: 'first', data: 'original' });
    for (let i = 0; i < 501; i++) await appendComposioTriggerEvent(config, { id: String(i) });
    expect(await appendComposioTriggerEvent(config, { id: 'first', data: 'changed' })).toEqual(first);
  });

  it('enforces share view limits across instances and database reopen', async () => {
    const first = new ShareStore();
    const second = new ShareStore();
    try {
      new DurableState('shares').set('one', { id: 'one', token: 'token', revoked: false, expiresAt: new Date(Date.now() + 60_000).toISOString(), maxViews: 1, downloadCount: 0 });
      expect(first.consumeAccess('one')).toEqual({ valid: true });
      expect(second.consumeAccess('one')).toEqual({ valid: false, reason: 'max_views' });
      closeXopcDatabase(); openXopcDatabase({ path: dbPath });
      expect(second.getByToken('token')?.downloadCount).toBe(1);
    } finally { first.shutdown(); second.shutdown(); }
  });

  it('reclaims expired leases and rejects stale acknowledgements', () => {
    const a = new DurableQueue<{ id: string }>('q', 'agent');
    const b = new DurableQueue<{ id: string }>('q', 'agent');
    a.enqueue('one', { id: 'one' });
    a.enqueue('one', { id: 'duplicate' });
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const first = a.claim(100)!;
    expect(b.claim(100)).toBeNull();
    vi.spyOn(Date, 'now').mockReturnValue(1101);
    const replacement = b.claim(100)!;
    a.finish(first.id, first.token, true);
    expect(a.pending()).toEqual([{ id: 'one' }]);
    b.finish(replacement.id, replacement.token, true);
    expect(a.pending()).toEqual([]);
  });

  it('retains failed IPC messages until a handler succeeds', async () => {
    const inbox = new AgentInbox('main');
    await inbox.enqueue({ id: 'message', from: 'other', to: 'main' } as AgentIPCMessage);
    const stop = await inbox.watch(async () => { throw new Error('retry'); });
    stop();
    expect(await inbox.count()).toBe(1);
    const handled = vi.fn(async () => {});
    const stopAgain = await inbox.watch(handled);
    stopAgain();
    expect(handled).toHaveBeenCalledTimes(1);
    expect(await inbox.count()).toBe(0);
  });

  it('uses full durability and rejects network volumes before creating a database', () => {
    const opened = openXopcDatabase({ path: dbPath });
    expect(opened.db.prepare('PRAGMA synchronous').get()?.synchronous).toBe(2);
    expect(opened.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    closeXopcDatabase();
    vi.spyOn(fs, 'statfsSync').mockReturnValue({ type: 0xff534d42 } as fs.StatsFs);
    expect(() => openXopcDatabase({ path: join(dir, 'network.db') })).toThrow('local filesystem');
    expect(fs.existsSync(join(dir, 'network.db'))).toBe(false);
  });
});
