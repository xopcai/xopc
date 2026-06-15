import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JobExecution } from '../../../cron/types.js';
import type { Note } from '../../../notes/types.js';
import {
  appendCronRun,
  closeXopcDatabase,
  deleteCronRunsForJob,
  openXopcDatabase,
  readAllCronRuns,
  readCronJobHistory,
  resetXopcDatabaseSingletonForTest,
  searchMemoryIndex,
  syncMemoryIndex,
  upsertNoteRecord,
  listNoteRecords,
  getNoteRecord,
  deleteNoteRecord,
} from '../index.js';

describe('sqlite phase-6 repositories', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-phase6-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('persists and trims cron runs per job', () => {
    const jobId = 'job-1';
    for (let i = 0; i < 5; i++) {
      const execution: JobExecution = {
        id: `run-${i}`,
        jobId,
        status: 'success',
        startedAt: new Date(Date.UTC(2025, 0, 1, 0, 0, i)).toISOString(),
        endedAt: new Date(Date.UTC(2025, 0, 1, 0, 0, i + 1)).toISOString(),
        duration: 1000,
        retryCount: 0,
        summary: `run ${i}`,
      };
      appendCronRun(execution);
    }

    const history = readCronJobHistory(jobId, 10);
    expect(history).toHaveLength(5);
    expect(history[0].id).toBe('run-4');

    const all = readAllCronRuns(3);
    expect(all).toHaveLength(3);

    deleteCronRunsForJob(jobId);
    expect(readCronJobHistory(jobId, 10)).toHaveLength(0);
  });

  it('stores notes and supports FTS search', () => {
    const note: Note = {
      id: 'note-1',
      kind: 'thought',
      status: 'inbox',
      text: 'unique-alpha-keyword in body',
      createdAt: 100,
      updatedAt: 100,
      capturedVia: { channel: 'web' },
      tags: ['work'],
    };
    upsertNoteRecord(note);

    expect(getNoteRecord('note-1')?.text).toContain('unique-alpha-keyword');

    const listed = listNoteRecords({ search: 'unique-alpha-keyword' });
    expect(listed.items.map((item) => item.id)).toEqual(['note-1']);

    expect(deleteNoteRecord('note-1')).toBe(true);
    expect(getNoteRecord('note-1')).toBeNull();
  });

  it('indexes memory markdown and returns FTS hits', () => {
    const workspaceDir = join(stateDir, 'workspace');
    const memoryDir = join(workspaceDir, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    const dailyPath = join(memoryDir, '2026-06-15.md');
    writeFileSync(dailyPath, '# Daily\nproject-phoenix launch checklist\n');

    syncMemoryIndex({ agentId: 'main', workspaceDir });
    const hits = searchMemoryIndex({
      agentId: 'main',
      query: 'phoenix',
      maxResults: 5,
      minScore: 0.01,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].path).toContain('memory/2026-06-15.md');
    expect(hits[0].lines).toContain('phoenix');
  });
});
