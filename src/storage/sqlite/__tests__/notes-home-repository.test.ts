import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ObjectLinkService } from '../../../activity/service.js';
import type { Note } from '../../../notes/types.js';
import { closeXopcDatabase, openXopcDatabase, requireXopcDatabase, resetXopcDatabaseSingletonForTest } from '../index.js';
import { listNoteProjectSummaries, listNoteRecords, upsertNoteRecord } from '../notes-repository.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'notes-home-'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(dir, 'xopc.db') });
  const db = requireXopcDatabase().db;
  for (const id of ['p1', 'p2', 'empty']) {
    db.prepare('INSERT INTO projects(project_id, name, slug, created_at, updated_at) VALUES (?, ?, ?, 1, 1)').run(id, `Project ${id}`, id);
  }
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); });
function note(id: string, patch: Partial<Note> = {}) {
  upsertNoteRecord({ id, title: id, markdown: `# ${id}\nResearch material`, kind: 'thought', status: 'inbox', createdAt: 1, updatedAt: 10, capturedVia: { channel: 'web' }, ...patch });
}
function link(id: string, noteId: string, projectId: string) {
  new ObjectLinkService().create({ id, from: { kind: 'note', id: noteId }, to: { kind: 'project', id: projectId }, relation: 'belongs_to', source: 'user' });
}

describe('notes home read model', () => {
  it('returns current project names, deduplicates links and counts notes independently of list pagination', () => {
    note('n1'); note('n2', { updatedAt: 30 }); note('trash', { status: 'trashed', updatedAt: 100 });
    link('l1', 'n1', 'p1'); link('l2', 'n1', 'p1'); link('l3', 'n1', 'p2'); link('l4', 'n2', 'p1'); link('l5', 'trash', 'p1');
    requireXopcDatabase().db.prepare('UPDATE projects SET name = ? WHERE project_id = ?').run('Renamed', 'p1');
    const result = listNoteRecords({ projectId: 'p1', limit: 1, sortBy: 'updatedAt' });
    expect(result).toMatchObject({ total: 2, hasMore: true });
    expect(result.items[0]).toMatchObject({ id: 'n2', projects: [{ id: 'p1', name: 'Renamed' }] });
    expect(listNoteRecords({ search: 'n1' }).items[0].projects).toHaveLength(2);
    expect(listNoteProjectSummaries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'p1', name: 'Renamed', noteCount: 2, updatedAt: 30 }),
      expect.objectContaining({ id: 'empty', noteCount: 0, updatedAt: undefined }),
    ]));
  });
  it('combines unassigned, favorites and agent edits before pagination, ignoring dangling project links', () => {
    note('unassigned', { pinned: true, lastEditTrigger: 'ai_edit' });
    note('linked', { pinned: true, lastEditTrigger: 'ai_edit', updatedAt: 40 });
    note('manual', { pinned: true, lastEditTrigger: 'edit' });
    link('l1', 'linked', 'p1'); link('dangling', 'unassigned', 'deleted-project');
    const result = listNoteRecords({ unassigned: true, pinned: true, agentEdited: true, search: 'Research', limit: 1 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ id: 'unassigned', lastEditTrigger: 'ai_edit', projects: [] });
  });
});
