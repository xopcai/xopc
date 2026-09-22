import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteGetOutputSchema } from '@xopcai/gateway-contract';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import type { CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { NotesStore } from '../store.js';
import { NotesService } from '../service.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { resolveNoteMediaDir } from '../paths.js';
import type { ShareRecord } from '../../share/share-types.js';

let directory: string;
let previousState: string | undefined;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xopc-note-capabilities-'));
  previousState = process.env.XOPC_STATE_DIR;
  process.env.XOPC_STATE_DIR = directory;
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(directory, 'xopc.db') });
});
afterEach(() => {
  vi.restoreAllMocks();
  closeXopcDatabase();
  resetXopcDatabaseSingletonForTest();
  if (previousState === undefined) delete process.env.XOPC_STATE_DIR;
  else process.env.XOPC_STATE_DIR = previousState;
  rmSync(directory, { recursive: true, force: true });
});
const context: CapabilityContext = { principalId: 'test-owner', surface: 'http', scopes: ['workspace.read', 'workspace.write'], authorize: () => true };

describe('note transactional capabilities', () => {
  it('previews local edits across surfaces without database effects', async () => {
    const service = new NotesService();
    const note = await service.createNote({ markdown: 'Original content' });
    const runtime = createProductDispatcher(() => service);
    const input = { id: note.id, instruction: 'summary', markdown: 'Unsaved draft' };
    const changes = () => getSqliteDatabase().prepare('SELECT total_changes() AS count').get()!.count;
    const before = changes();
    const http = await runtime.call('xopc.notes.preview_edit', input, context) as { patch: { operations: unknown } };
    const agent = await runtime.call('xopc.notes.preview_edit', input, { ...context, surface: 'agent' }) as typeof http;
    expect(agent.patch.operations).toEqual(http.patch.operations);
    expect(changes()).toBe(before);
    expect((await service.getNote(note.id))?.markdown).toBe('Original content');
    await expect(runtime.call('xopc.notes.preview_edit', { ...input, instruction: '' }, context)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(runtime.call('xopc.notes.preview_edit', { ...input, id: 'missing' }, context)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('reads immutable history across surfaces without changing the current note', async () => {
    const service = new NotesService();
    const note = await service.createNote({ markdown: 'Original' });
    await service.updateNote(note.id, { markdown: 'Current' });
    const runtime = createProductDispatcher(() => service);
    const history = await runtime.call('xopc.notes.history', { id: note.id }, context) as { entries: Array<{ timestamp: number }> };
    expect(history.entries).toHaveLength(1);
    const input = { id: note.id, timestamp: history.entries[0].timestamp };
    const snapshot = await runtime.call('xopc.notes.snapshot', input, context);
    expect(snapshot).toMatchObject({ snapshot: { noteId: note.id, markdown: 'Original' } });
    expect(await runtime.call('xopc.notes.snapshot', input, { ...context, surface: 'agent' })).toEqual(snapshot);
    expect((await service.getNote(note.id))?.markdown).toBe('Current');
    await expect(runtime.call('xopc.notes.snapshot', { ...input, timestamp: 0 }, context)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(runtime.call('xopc.notes.snapshot', { ...input, timestamp: '1junk' }, context)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const read = vi.spyOn(service, 'getNoteSnapshot');
    await expect(runtime.call('xopc.notes.snapshot', input, { ...context, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(read).not.toHaveBeenCalled();
    expect(await runtime.call('xopc.notes.project_summaries', {}, context)).toEqual({ items: service.listProjectSummaries() });
  });

  it('cleans an attachment uploaded after its note was deleted', async () => {
    const store = new NotesStore();
    const service = new NotesService(store);
    const note = await service.createNote({ markdown: 'Upload race' });
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const save = store.saveAttachment.bind(store);
    vi.spyOn(store, 'saveAttachment').mockImplementation(async (...args) => { ready(); await blocked; return save(...args); });
    const upload = service.addAttachment(note.id, { name: 'late.txt', buffer: Buffer.from('private'), mimeType: 'text/plain' });
    await started;
    await service.deleteNote(note.id);
    release();
    expect(await upload).toBeNull();
    expect(existsSync(resolveNoteMediaDir(note.id))).toBe(false);
  });

  it('retains failed cleanup with backoff and rejects path traversal', async () => {
    const store = new NotesStore();
    const protectedFile = join(directory, 'notes', 'protected.txt');
    mkdirSync(join(directory, 'notes'), { recursive: true });
    writeFileSync(protectedFile, 'keep');
    getSqliteDatabase().prepare("INSERT INTO note_deletion_cleanup(kind, object_id, created_at) VALUES ('media', '../protected.txt', 1)").run();
    store.drainDeletionCleanup();
    expect(existsSync(protectedFile)).toBe(true);
    expect(getSqliteDatabase().prepare('SELECT attempts, next_attempt_at FROM note_deletion_cleanup').get()).toMatchObject({ attempts: 1, next_attempt_at: expect.any(Number) });
    store.drainDeletionCleanup();
    expect(getSqliteDatabase().prepare('SELECT attempts FROM note_deletion_cleanup').get()?.attempts).toBe(1);
  });
  it('commits deletion, share revocation and file cleanup before retrying a failed notification', async () => {
    const store = new NotesStore();
    const service = new NotesService(store);
    const note = await service.createNote({ markdown: 'Delete fixture' });
    const saved = await store.saveAttachment(note.id, 'fixture.txt', Buffer.from('private'));
    const path = store.resolveAttachmentPath(note.id, saved.relativePath);
    const shares = new DurableState<ShareRecord>('shares');
    shares.set('share-delete', { id: 'share-delete', kind: 'note', sourceNoteId: note.id, revoked: false } as ShareRecord);
    const artifact = join(directory, 'share-artifacts', 'share-delete');
    mkdirSync(artifact, { recursive: true });
    writeFileSync(join(artifact, 'fixture.txt'), 'private');
    const dispatcher = createProductDispatcher(() => service);
    const operation = 'xopc.notes.delete';
    const input = { id: note.id, expectedRevision: note.remoteVersion ?? 1 };
    const invoke = (caller = context) => dispatcher.call(operation, input, caller, { ...dispatcher.describe(operation, caller), idempotencyKey: 'delete' });
    vi.spyOn(service, 'flushCommittedEffects').mockImplementationOnce(() => { throw new Error('Wake failed'); });
    await expect(invoke()).rejects.toThrow('Wake failed');
    expect(await service.getNote(note.id)).toBeNull();
    expect(shares.get('share-delete')?.revoked).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(artifact)).toBe(true);
    expect(await invoke()).toEqual({ deleted: true, revokedShares: 1 });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(artifact)).toBe(false);
    expect(await invoke()).toEqual({ deleted: true, revokedShares: 1 });
    await expect(invoke({ ...context, authorize: () => false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(getSqliteDatabase().prepare("SELECT * FROM domain_outbox WHERE event_type = 'note.deleted'").all()).toHaveLength(1);
  });

  it('rolls back note, snapshots, share revocation and cleanup on output validation failure', async () => {
    const store = new NotesStore();
    const service = new NotesService(store);
    const note = await service.createNote({ markdown: 'Keep fixture' });
    store.saveSnapshot(note, 'edit');
    const shares = new DurableState<ShareRecord>('shares');
    shares.set('keep-share', { id: 'keep-share', kind: 'note', sourceNoteId: note.id, revoked: false } as ShareRecord);
    const original = service.deleteNoteAtomically.bind(service);
    vi.spyOn(service, 'deleteNoteAtomically').mockImplementation((...args) => ({ ...original(...args), revokedShares: -1 }));
    const flush = vi.spyOn(service, 'flushCommittedEffects');
    const dispatcher = createProductDispatcher(() => service);
    const operation = 'xopc.notes.delete';
    await expect(dispatcher.call(operation, { id: note.id, expectedRevision: 1 }, context,
      { ...dispatcher.describe(operation, context), idempotencyKey: 'rollback' })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(await service.getNote(note.id)).toEqual(note);
    expect(store.listSnapshots(note.id)).not.toHaveLength(0);
    expect(shares.get('keep-share')?.revoked).toBe(false);
    expect(getSqliteDatabase().prepare('SELECT * FROM note_deletion_cleanup').all()).toEqual([]);
    expect(flush).not.toHaveBeenCalled();
  });

  it('recovers deletion cleanup on restart and preserves explicitly retained shares', async () => {
    const store = new NotesStore();
    const service = new NotesService(store);
    const note = await service.createNote({ markdown: 'Restart fixture' });
    await store.saveAttachment(note.id, 'fixture.txt', Buffer.from('private'));
    const shares = new DurableState<ShareRecord>('shares');
    shares.set('retained', { id: 'retained', kind: 'note', sourceNoteId: note.id, revoked: false } as ShareRecord);
    expect(service.deleteNoteAtomically(note.id, 1, false)).toEqual({ deleted: true, revokedShares: 0 });
    expect(existsSync(resolveNoteMediaDir(note.id))).toBe(true);
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    await new NotesService().initialize();
    expect(existsSync(resolveNoteMediaDir(note.id))).toBe(false);
    expect(shares.get('retained')?.revoked).toBe(false);
  });

  it('does not delete a newer revision or clean media belonging to a recreated identity', async () => {
    const store = new NotesStore();
    const service = new NotesService(store);
    const note = await service.createNote({ markdown: 'Original' });
    await service.updateNote(note.id, { markdown: 'New version' });
    expect(() => service.deleteNoteAtomically(note.id, 1)).toThrow('Note revision conflict');
    service.deleteNoteAtomically(note.id, 2);
    store.addNote({ ...note, markdown: 'Replacement' });
    const saved = await store.saveAttachment(note.id, 'replacement.txt', Buffer.from('keep'));
    service.flushCommittedEffects();
    expect(existsSync(store.resolveAttachmentPath(note.id, saved.relativePath))).toBe(true);
    expect(store.getNote(note.id)?.markdown).toBe('Replacement');
  });
  it('appends once, preserves intervening edits on replay, and restores with versioned events', async () => {
    const service = new NotesService();
    const dispatcher = createProductDispatcher(() => service);
    const invoke = (id: string, input: unknown, key: string) => dispatcher.call(id, input, context,
      { ...dispatcher.describe(id, context), idempotencyKey: key });
    const { note } = NoteGetOutputSchema.parse(await invoke('xopc.notes.create', { markdown: 'Original' }, 'create'));
    const input = { id: note.id, content: 'Addition' };
    const appended = await invoke('xopc.notes.append', input, 'append');
    await service.updateNote(note.id, { markdown: 'Intervening edit' }, 'ai_edit');
    expect(await invoke('xopc.notes.append', input, 'append')).toEqual(appended);
    expect((await service.getNote(note.id))?.markdown).toBe('Intervening edit');
    const original = (await service.listNoteHistory(note.id)).at(-1)!;
    const restore = { id: note.id, timestamp: original.timestamp, expectedRevision: 3 };
    const restored = NoteGetOutputSchema.parse(await invoke('xopc.notes.restore', restore, 'restore'));
    expect(restored.note.markdown).toBe('Original');
    expect(restored.note.remoteVersion).toBe(4);
    expect(await invoke('xopc.notes.restore', restore, 'restore')).toEqual(restored);
    await expect(invoke('xopc.notes.restore', restore, 'stale-restore')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    const rows = getSqliteDatabase().prepare(`SELECT o.operation_id, count(e.event_id) AS n
      FROM capability_operations o JOIN domain_outbox e ON e.operation_id = o.operation_id
      GROUP BY o.operation_id`).all();
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.n === 1)).toBe(true);
  });
  it('replays creates and updates, rejects altered intent and stale revisions', async () => {
    const service = new NotesService();
    const dispatcher = createProductDispatcher(() => service);
    const invoke = (id: string, input: unknown, key: string) => dispatcher.call(id, input, context,
      { ...dispatcher.describe(id, context), idempotencyKey: key });
    const created = await invoke('xopc.notes.create', { markdown: 'Original' }, 'create');
    expect(await invoke('xopc.notes.create', { markdown: 'Original' }, 'create')).toEqual(created);
    await expect(invoke('xopc.notes.create', { markdown: 'Different' }, 'create')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    const { note } = NoteGetOutputSchema.parse(created);
    const input = { id: note.id, expectedRevision: 1, patch: { markdown: 'Edited' } };
    const updated = await invoke('xopc.notes.update', input, 'edit');
    expect(await invoke('xopc.notes.update', input, 'edit')).toEqual(updated);
    await expect(invoke('xopc.notes.update', input, 'another-edit')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await service.getNote(note.id))?.remoteVersion).toBe(2);
    expect(await service.listNoteHistory(note.id)).toHaveLength(1);
  });

  it('rolls back snapshots, file cleanup and events together, then recovers post-commit cleanup', async () => {
    const store = new NotesStore();
    const service = new NotesService(store);
    const note = await service.createNote({ markdown: 'Keep attachment', capturedVia: { channel: 'web' } });
    const attachment = await service.addAttachment(note.id, { name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') });
    const path = store.resolveAttachmentPath(note.id, attachment!.relativePath);
    const before = await service.getNote(note.id);
    const count = () => Number(getSqliteDatabase().prepare('SELECT count(*) AS n FROM domain_outbox').get()!.n);
    const eventsBefore = count();
    expect(() => runSqliteWriteTransaction(() => {
      service.updateNoteAtomically(note.id, { markdown: 'Remove attachment' }, 'ai_edit');
      throw new Error('Crash before commit');
    })).toThrow('Crash before commit');
    expect(await service.getNote(note.id)).toEqual(before);
    expect(count()).toBe(eventsBefore);
    expect(existsSync(path)).toBe(true);
    service.updateNoteAtomically(note.id, { markdown: 'Remove attachment' }, 'ai_edit');
    expect(existsSync(path)).toBe(true);
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    await new NotesService().initialize();
    expect(existsSync(path)).toBe(false);
    expect(Number(getSqliteDatabase().prepare('SELECT count(*) AS n FROM note_file_cleanup').get()!.n)).toBe(0);
  });
});
