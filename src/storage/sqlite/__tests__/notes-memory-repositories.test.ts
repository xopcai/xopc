import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Note } from '../../../notes/types.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  searchMemoryIndex,
  searchMemoryRecords,
  syncMemoryIndex,
  upsertMemoryRecord,
  upsertNoteRecord,
  listNoteRecords,
  getNoteRecord,
  deleteNoteRecord,
} from '../index.js';

describe('sqlite notes and memory repositories', () => {
  let stateDir: string;

  function todayMemoryFileName(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}.md`;
  }

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-notes-memory-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('stores notes and supports FTS search', () => {
    const note: Note = {
      id: 'note-1',
      kind: 'thought',
      status: 'inbox',
      markdown: '# Heading\nunique-alpha-keyword in body\n- [ ] todo\n- [x] done\n[[related]]',
      createdAt: 100,
      updatedAt: 100,
      capturedVia: { channel: 'web' },
      tags: ['work'],
    };
    upsertNoteRecord(note);

    expect(getNoteRecord('note-1')?.markdown).toContain('unique-alpha-keyword');

    const listed = listNoteRecords({ search: 'unique-alpha-keyword' });
    expect(listed.items.map((item) => item.id)).toEqual(['note-1']);
    expect(listed.items[0]).toMatchObject({
      headingCount: 1,
      taskCount: 2,
      uncheckedTaskCount: 1,
      linkCount: 1,
    });

    expect(deleteNoteRecord('note-1')).toBe(true);
    expect(getNoteRecord('note-1')).toBeNull();
  });

  it('indexes memory markdown and returns FTS hits', () => {
    const workspaceDir = join(stateDir, 'workspace');
    const memoryDir = join(workspaceDir, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    const dailyFileName = todayMemoryFileName();
    const dailyPath = join(memoryDir, dailyFileName);
    writeFileSync(dailyPath, '# Daily\nproject-phoenix launch checklist\n');

    syncMemoryIndex({ userId: 'local-owner', workspaceDir });
    const hits = searchMemoryIndex({
      userId: 'local-owner',
      query: 'phoenix',
      maxResults: 5,
      minScore: 0.01,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toContain(`memory/${dailyFileName}`);
    expect(hits[0].lines).toContain('phoenix');
  });

  it('recalls memory from a longer natural-language query and preserves rank order', () => {
    upsertMemoryRecord({
      id: 'memory-strong',
      providerId: 'local',
      kind: 'project_context',
      sourceAgentId: 'main',
      workspaceId: '/workspace',
      content: 'Phoenix launch checklist uses staged rollout and verification.',
    });
    upsertMemoryRecord({
      id: 'memory-weak',
      providerId: 'local',
      kind: 'project_context',
      sourceAgentId: 'main',
      workspaceId: '/workspace',
      content: 'Phoenix is the internal project name.',
    });

    const hits = searchMemoryRecords({
      workspaceId: '/workspace',
      query: 'What was the Phoenix launch verification checklist?',
      maxResults: 5,
      minScore: 0.1,
    });

    expect(hits.map((hit) => hit.record.id)).toEqual(['memory-strong', 'memory-weak']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('falls back to bounded lexical similarity for Chinese reformulations', () => {
    upsertMemoryRecord({
      id: 'memory-zh-preference',
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      workspaceId: '/workspace',
      content: '用户偏好简洁的中文回复。',
    });

    const hits = searchMemoryRecords({
      workspaceId: '/workspace',
      query: '请用简洁中文回答',
      maxResults: 5,
      minScore: 0.15,
    });

    expect(hits.map((hit) => hit.record.id)).toContain('memory-zh-preference');
  });
});
