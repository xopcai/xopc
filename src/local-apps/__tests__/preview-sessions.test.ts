import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAppResourceScopesSchema, type CapabilityCall } from '@xopcai/gateway-contract';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { ProjectService } from '../../projects/project-service.js';
import { NotesService } from '../../notes/service.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import { CapabilityError, type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { LocalAppPreviewSessions } from '../preview-sessions.js';

let directory: string;
let previews: LocalAppPreviewSessions;
const hash = 'a'.repeat(64);
const caller: CapabilityContext = { principalId: 'owner', scopes: ['gateway.admin'], surface: 'http', authorize: () => true };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xopc-preview-isolation-')); resetXopcDatabaseSingletonForTest();
  seedTestDatabase(join(directory, 'xopc.db')); openXopcDatabase({ path: join(directory, 'xopc.db') });
});
afterEach(async () => {
  await previews?.close(); vi.restoreAllMocks(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const notes = new NotesService();
  const note = notes.createNoteAtomically({ title: 'Live note', markdown: 'production secret', capturedVia: { channel: 'web' } });
  const denied = notes.createNoteAtomically({ title: 'Private', markdown: 'unapproved', capturedVia: { channel: 'web' } });
  const projects = new ProjectService();
  const project = projects.create({ name: 'Approved project', instructions: 'HIDDEN PROJECT INSTRUCTIONS' });
  const privateProject = projects.create({ name: 'Private project' });
  const dispatcher = createProductDispatcher(() => notes, { getProjects: () => projects });
  const bindings = dispatcher.list({ ...caller, surface: 'extension' }).map(({ id, majorVersion, descriptorDigest }) => ({ id, majorVersion, descriptorDigest }));
  mkdirSync(join(directory, '.xopc'));
  writeFileSync(join(directory, '.xopc', 'fixtures.json'), JSON.stringify({ schemaVersion: 1,
    notes: [{ id: note.id, title: 'Example note', markdown: 'fixture only' }], tasks: [] }));
  let current = hash;
  previews = new LocalAppPreviewSessions(() => directory, () => ({ appId: 'app', extensionId: 'extension', sourceHash: hash,
    root: directory, permissions: ['theme', 'storage'], bindings: bindings as never, scenarioIds: ['save'], previewUrl: '/api/local-apps/preview/token/snapshots/hash/ui/index.html' }),
  (_id, expected) => { if (current !== expected) throw new CapabilityError('CONTRACT_CHANGED', 'Source changed'); });
  const call = (id: string, input: unknown = {}, key = 'intent'): CapabilityCall => ({
    ...dispatcher.describe(id, { ...caller, surface: 'extension' }), input, idempotencyKey: key,
  });
  const fingerprint = () => ['notes', 'notes_fts', 'tasks', 'capability_operations', 'capability_invocations', 'domain_outbox']
    .map(table => getSqliteDatabase().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  return { notes, note, denied, projects, project, privateProject, dispatcher, call, fingerprint, change: () => { current = 'b'.repeat(64); } };
}

describe('Local App preview isolation', () => {
  it('runs the real write capability against a separate database even for an identical production ID', async () => {
    const f = fixture(); const before = f.fingerprint();
    const session = await previews.create('app', { sourceHash: hash, mode: 'isolated', scenarioId: 'save' }, caller);
    const update = f.call('xopc.notes.update', { id: f.note.id, expectedRevision: 1, patch: { markdown: 'sandbox changed' } });
    const result = await previews.call(session.id, 'xopc.notes.update', update, caller, f.dispatcher);
    expect(result).toMatchObject({ data: { note: { markdown: 'sandbox changed' } } });
    expect((await previews.call(session.id, 'xopc.notes.update', update, caller, f.dispatcher))).toEqual(result);
    expect((await f.notes.getNote(f.note.id))?.markdown).toBe('production secret');
    expect(f.fingerprint()).toEqual(before);
  }, 20000);

  it('reclaims the caller idle workers before retrying but preserves recent and foreign leases', async () => {
    const f = fixture();
    const leases = [];
    for (let i = 0; i < 4; i++) leases.push(await previews.create('app', { sourceHash: hash, mode: 'sample' }, caller));
    await expect(previews.create('app', { sourceHash: hash, mode: 'sample' }, caller)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    await expect(previews.create('app', { sourceHash: hash, mode: 'sample' }, { ...caller, principalId: 'other' })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    previews.describe(leases[1].id, caller, f.dispatcher);
    const next = await previews.create('app', { sourceHash: hash, mode: 'sample' }, caller);
    expect(next.id).not.toBe(leases[0].id);
    expect(() => previews.describe(leases[0].id, caller, f.dispatcher)).toThrow('revoked');
    expect(previews.describe(leases[1].id, caller, f.dispatcher).session.id).toBe(leases[1].id);
    clock.mockRestore();
  }, 20000);

  it('starts every scenario with fresh fixtures, receipts and storage', async () => {
    const f = fixture();
    const first = await previews.create('app', { sourceHash: hash, mode: 'isolated' }, caller);
    await previews.call(first.id, 'xopc.notes.append', f.call('xopc.notes.append', { id: f.note.id, content: 'first run only' }), caller, f.dispatcher);
    previews.storage(first.id, caller, 'storage.set', 'key', 'first run');
    const second = await previews.create('app', { sourceHash: hash, mode: 'isolated' }, caller);
    expect((await previews.call(second.id, 'xopc.notes.get', f.call('xopc.notes.get', { id: f.note.id }), caller, f.dispatcher)).data).toMatchObject({ note: { markdown: 'fixture only' } });
    expect(previews.storage(second.id, caller, 'storage.get', 'key')).toBeUndefined();
  }, 20000);

  it('uses examples rather than production content and respects the caller capability scopes', async () => {
    const f = fixture();
    const session = await previews.create('app', { sourceHash: hash, mode: 'sample' }, caller);
    expect(session.bindings.some(binding => binding.id === 'xopc.agent.delegate')).toBe(false);
    await expect(previews.call(session.id, 'xopc.agent.delegate', f.call('xopc.agent.delegate', { instruction: 'Do not submit' }), caller, f.dispatcher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const result = await previews.call(session.id, 'xopc.notes.list', f.call('xopc.notes.list'), caller, f.dispatcher);
    expect(result.data).toMatchObject({ total: 1, items: [{ title: 'Example note' }] });
    expect(JSON.stringify(result)).not.toContain('production secret');
    await expect(previews.call(session.id, 'xopc.notes.list', f.call('xopc.notes.list'), { ...caller, scopes: [] }, f.dispatcher)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  }, 20000);

  it('intersects live reads with explicit data grants and never admits production writes', async () => {
    const f = fixture(); const before = f.fingerprint();
    const resourceScopes = LocalAppResourceScopesSchema.parse({ notesRead: { mode: 'selected', ids: [f.note.id] } });
    const session = await previews.create('app', { sourceHash: hash, mode: 'readonly', resourceScopes }, caller);
    expect(previews.describe(session.id, caller, f.dispatcher).capabilities.every(item => item.effect === 'read')).toBe(true);
    expect((await previews.call(session.id, 'xopc.notes.list', f.call('xopc.notes.list'), caller, f.dispatcher)).data).toMatchObject({ total: 1, items: [{ id: f.note.id }] });
    await expect(previews.call(session.id, 'xopc.notes.get', f.call('xopc.notes.get', { id: f.denied.id }), caller, f.dispatcher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(previews.call(session.id, 'xopc.notes.create', f.call('xopc.notes.create', { title: 'must not create' }), caller, f.dispatcher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.fingerprint()).toEqual(before);
    await expect(previews.create('app', { sourceHash: hash, mode: 'readonly', resourceScopes: { ...resourceScopes, notesWrite: { mode: 'workspace' } } }, caller)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(previews.create('app', { sourceHash: hash, mode: 'readonly', resourceScopes: { ...resourceScopes, agentDelegate: true } }, caller)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not inherit installed authorization and binds the lease to caller, source and expiry', async () => {
    const f = fixture();
    const session = await previews.create('app', { sourceHash: hash, mode: 'readonly' }, caller);
    await expect(previews.call(session.id, 'xopc.notes.list', f.call('xopc.notes.list'), caller, f.dispatcher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(() => previews.describe(session.id, { ...caller, principalId: 'other' }, f.dispatcher)).toThrow('revoked');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(session.expiresAt + 1);
    expect(() => previews.describe(session.id, caller, f.dispatcher)).toThrow('expired'); clock.mockRestore();
    const next = await previews.create('app', { sourceHash: hash, mode: 'readonly' }, caller);
    f.change(); expect(() => previews.describe(next.id, caller, f.dispatcher)).toThrow('Source changed');
  });

  it('withholds live read results revoked while in flight', async () => {
    const f = fixture();
    const session = await previews.create('app', { sourceHash: hash, mode: 'readonly',
      resourceScopes: LocalAppResourceScopesSchema.parse({ notesRead: { mode: 'workspace' } }) }, caller);
    const list = f.notes.listNotes.bind(f.notes);
    vi.spyOn(f.notes, 'listNotes').mockImplementation(async query => { const result = await list(query); previews.remove(session.id, caller); return result; });
    await expect(previews.call(session.id, 'xopc.notes.list', f.call('xopc.notes.list'), caller, f.dispatcher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

it('previews approved real project metadata, milestones and progress without exposing other projects or writes', async () => {
  const f = fixture();
  f.projects.createMilestone(f.project.id, { title: 'Approved milestone' });
  f.projects.createUpdate(f.project.id, { summary: 'Approved progress', health: 'on_track', actor: { kind: 'system' } });
  f.projects.createMilestone(f.privateProject.id, { title: 'Private milestone' });
  const session = await previews.create('app', { sourceHash: hash, mode: 'readonly', resourceScopes: {
    projectsRead: { mode: 'selected', ids: [f.project.id] },
  } }, caller);
  const described = previews.describe(session.id, caller, f.dispatcher);
  expect(described.capabilities.map(item => item.id)).toEqual(expect.arrayContaining([
    'xopc.projects.get', 'xopc.projects.list', 'xopc.projects.list_milestones', 'xopc.projects.list_updates',
  ]));
  expect(described.capabilities.some(item => item.effect !== 'read')).toBe(false);
  expect(await previews.call(session.id, 'xopc.projects.list', f.call('xopc.projects.list'), caller, f.dispatcher))
    .toMatchObject({ data: { total: 1, items: [{ id: f.project.id }] } });
  const detail = await previews.call(session.id, 'xopc.projects.get', f.call('xopc.projects.get', { id: f.project.id }), caller, f.dispatcher);
  expect(detail).not.toHaveProperty('data.project.instructions');
  expect(await previews.call(session.id, 'xopc.projects.list_milestones', f.call('xopc.projects.list_milestones', { id: f.project.id }), caller, f.dispatcher))
    .toMatchObject({ data: { items: [{ title: 'Approved milestone' }] } });
  expect(await previews.call(session.id, 'xopc.projects.list_updates', f.call('xopc.projects.list_updates', { id: f.project.id }), caller, f.dispatcher))
    .toMatchObject({ data: { items: [{ summary: 'Approved progress' }] } });
  for (const id of ['xopc.projects.get', 'xopc.projects.list_milestones', 'xopc.projects.list_updates']) {
    await expect(previews.call(session.id, id, f.call(id, { id: f.privateProject.id }), caller, f.dispatcher)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  await expect(previews.call(session.id, 'xopc.projects.update', f.call('xopc.projects.update', { id: f.project.id, expectedVersion: f.project.version, patch: { name: 'Forbidden' } }), caller, f.dispatcher))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(f.projects.get(f.project.id)?.name).toBe('Approved project');
});
