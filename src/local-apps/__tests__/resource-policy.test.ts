import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAppResourceScopesSchema, type LocalAppResourceScopes } from '@xopcai/gateway-contract';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createProductDispatcher } from '../../capabilities/runtime/product.js';
import { type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { NotesService } from '../../notes/service.js';
import { ProjectService } from '../../projects/project-service.js';
import { ObjectLinkService } from '../../activity/service.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { localAppCapabilities } from '../capabilities/runtime.js';
import { listLocalAppAccess } from '../access-audit.js';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'xopc-app-resources-'));
  resetXopcDatabaseSingletonForTest(); seedTestDatabase(join(directory, 'xopc.db'));
  openXopcDatabase({ path: join(directory, 'xopc.db') });
});
afterEach(() => {
  vi.restoreAllMocks(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true });
});

function fixture(initial: Partial<LocalAppResourceScopes> = {}) {
  const notes = new NotesService();
  const projects = new ProjectService();
  const project = projects.create({ name: 'Allowed project' });
  const otherProject = projects.create({ name: 'Private project' });
  const allowed = notes.createNoteAtomically({ title: 'Allowed', markdown: 'visible', capturedVia: { channel: 'web' } });
  const denied = notes.createNoteAtomically({ title: 'Private', markdown: 'secret', capturedVia: { channel: 'web' } });
  const links = new ObjectLinkService();
  for (const [note, parent] of [[allowed, project], [denied, otherProject]] as const) links.create({
    id: `link-${note.id}`, from: { kind: 'note', id: note.id }, to: { kind: 'project', id: parent.id }, relation: 'belongs_to', source: 'user',
  });
  const tasks = new TaskRepository();
  const task = tasks.create({ title: 'Allowed task', objective: 'Private contract', projectId: project.id });
  const otherTask = tasks.create({ title: 'Private task', objective: 'Secret', projectId: otherProject.id });
  const dispatcher = createProductDispatcher(() => notes, { getProjects: () => projects });
  const caller: CapabilityContext = { principalId: 'owner', surface: 'http', scopes: ['gateway.admin'], authorize: () => true };
  const bindings = dispatcher.list({ ...caller, surface: 'extension' }).map(({ id, majorVersion, descriptorDigest }) => ({ id, majorVersion, descriptorDigest }));
  let resourceScopes = LocalAppResourceScopesSchema.parse(initial);
  let revision = 'first';
  const apps = { getCapabilityAccess: () => ({ releaseId: 'release', bindings, resourceScopes, grantRevision: revision }) };
  const runtime = (extensionId = 'app', context = caller) => localAppCapabilities(apps as never, dispatcher, extensionId, 'a'.repeat(64), context);
  const call = (id: string, input: unknown = {}, extensionId = 'app', key = 'intent') => runtime(extensionId).call(id,
    { ...dispatcher.describe(id, { ...caller, surface: 'extension' }), input, idempotencyKey: key });
  return { notes, allowed, denied, project, otherProject, task, otherTask, call, runtime, caller, dispatcher,
    grant(next: Partial<LocalAppResourceScopes>) { resourceScopes = LocalAppResourceScopesSchema.parse(next); revision += '-next'; } };
}

describe('Local App resource authorization', () => {
  it('defaults to no access, including reads and creation', async () => {
    const f = fixture();
    for (const [id, input] of [['xopc.notes.list', {}], ['xopc.tasks.list', {}], ['xopc.notes.get', { id: f.allowed.id }], ['xopc.notes.create', { title: 'Blocked' }]] as const) {
      await expect(f.call(id, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(listLocalAppAccess('app').every(event => event.status === 'denied')).toBe(true);
  });

  it('restricts selection, search, counts and pagination before producing results', async () => {
    const f = fixture();
    f.grant({ notesRead: { mode: 'selected', ids: [], projectIds: [f.project.id], includeCreated: false },
      tasksRead: { mode: 'selected', ids: [f.task.id], projectIds: [], includeCreated: false } });
    const read = await f.call('xopc.notes.list', { limit: 1 }) as { data: { total: number; items: Array<{ id: string }> } };
    expect(read.data.total).toBe(1); expect(read.data.items.map(item => item.id)).toEqual([f.allowed.id]);
    expect(read.data.items[0]).not.toHaveProperty('projects');
    expect((await f.call('xopc.notes.list', { search: 'secret' })).data).toMatchObject({ total: 0, items: [] });
    expect((await f.call('xopc.notes.list', { offset: 1, limit: 1 })).data).toMatchObject({ total: 1, items: [], hasMore: false });
    expect((await f.call('xopc.notes.list', { projectId: f.otherProject.id })).data).toMatchObject({ total: 0, items: [] });
    expect((await f.call('xopc.tasks.list')).data).toMatchObject({ total: 1, items: [{ task: { id: f.task.id } }] });
    for (const [id, resource] of [['xopc.notes.get', f.denied.id], ['xopc.tasks.get', f.otherTask.id]]) {
      await expect(f.call(id, { id: resource })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    const detail = (await f.call('xopc.tasks.get', { id: f.task.id })).data;
    expect(detail).not.toHaveProperty('context'); expect(detail).not.toHaveProperty('conversation');
    expect(detail).not.toHaveProperty('authorityGrants'); expect(detail).not.toHaveProperty('task.contract');
    expect(JSON.stringify(listLocalAppAccess('app'))).not.toContain('Private contract');
  });

  it('keeps read and write scopes separate and does not allow scope injection', async () => {
    const f = fixture();
    f.grant({ notesRead: { mode: 'workspace' }, notesWrite: { mode: 'selected', ids: [f.allowed.id], projectIds: [], includeCreated: false } });
    await expect(f.call('xopc.notes.update', { id: f.denied.id, expectedRevision: 1, patch: { title: 'hijacked' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.call('xopc.notes.list', { resourceRestriction: { scope: { mode: 'workspace' } } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(f.call('xopc.notes.update', { id: f.allowed.id, expectedRevision: 1, patch: { aiDeep: { processedAt: 0 } } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await f.call('xopc.notes.update', { id: f.allowed.id, expectedRevision: 1, patch: { title: 'Changed' } })).data).toMatchObject({ note: { title: 'Changed' } });
    expect((await f.notes.getNote(f.denied.id))?.title).toBe('Private');
  });

  it('tracks app-created ownership transactionally and isolates other applications', async () => {
    const own = { mode: 'selected' as const, ids: [], projectIds: [], includeCreated: true };
    const f = fixture({ notesRead: own, notesWrite: own });
    const created = await f.call('xopc.notes.create', { title: 'Mine', markdown: 'owned' }) as { data: { note: { id: string } } };
    await f.call('xopc.notes.create', { title: 'Mine', markdown: 'owned' });
    expect((await f.call('xopc.notes.list')).data).toMatchObject({ total: 1 });
    await expect(f.call('xopc.notes.get', { id: created.data.note.id }, 'other')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(f.call('xopc.notes.create', { projectId: f.otherProject.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('invalidates existing leases after grant changes, including in-flight reads', async () => {
    const f = fixture({ notesRead: { mode: 'workspace' } });
    const stale = f.runtime();
    f.grant({});
    const descriptor = f.dispatcher.describe('xopc.notes.list', { ...f.caller, surface: 'extension' });
    await expect(stale.call(descriptor.id, { ...descriptor, input: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    f.grant({ notesRead: { mode: 'workspace' } });
    const list = f.notes.listNotes.bind(f.notes);
    vi.spyOn(f.notes, 'listNotes').mockImplementation(async query => { const result = await list(query); f.grant({}); return result; });
    await expect(f.call('xopc.notes.list')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rechecks project membership after asynchronous authorization and before writes', async () => {
    const f = fixture();
    f.grant({ notesWrite: { mode: 'selected', ids: [], projectIds: [f.project.id], includeCreated: false } });
    const caller = { ...f.caller, authorize: async () => {
      getSqliteDatabase().prepare("DELETE FROM object_links WHERE from_kind = 'note' AND from_id = ?").run(f.allowed.id);
      return true;
    } };
    const descriptor = f.dispatcher.describe('xopc.notes.append', { ...caller, surface: 'extension' });
    await expect(f.runtime('app', caller).call(descriptor.id, { ...descriptor, idempotencyKey: 'append', input: { id: f.allowed.id, content: 'blocked' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await f.notes.getNote(f.allowed.id))?.markdown).toBe('visible');
  });
});
