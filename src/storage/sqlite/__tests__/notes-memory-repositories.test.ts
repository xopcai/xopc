import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Note } from '../../../notes/types.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  searchMemoryRecords,
  upsertMemoryRecord,
  upsertNoteRecord,
  listNoteRecords,
  getNoteRecord,
  deleteNoteRecord,
  getMemoryRecord,
} from '../index.js';

describe('sqlite notes and memory repositories', () => {
  let stateDir: string;

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

  it('keeps storage provider identity separate from source provenance', () => {
    const written = upsertMemoryRecord({
      id: 'provider-identity',
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      content: 'Prefer designs with fewer moving parts.',
      source: { provider: 'personal-context' },
    });

    expect(written.providerId).toBe('local');
    expect(written.source.provider).toBe('personal-context');
    expect(getMemoryRecord(written.id)).toMatchObject({
      providerId: 'local',
      source: { provider: 'personal-context' },
    });
  });

  it('persists structural provenance and fail-closes trusted recall', () => {
    upsertMemoryRecord({
      id: 'trusted-owner-memory',
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      content: 'Prefer structural provenance checks.',
      originClass: 'owner',
      sessionKind: 'interactive',
      observedAt: '2026-08-31T12:00:00.000Z',
      sourceSessionId: 'agent:main:main',
      sourceTurnId: 'turn-1',
    });
    upsertMemoryRecord({
      id: 'recalled-loop-memory',
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      content: 'Prefer structural provenance checks from recalled context.',
      originClass: 'agent',
      sessionKind: 'interactive',
      derivedFromRecalledContext: true,
    });
    upsertMemoryRecord({
      id: 'unknown-origin-memory',
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      content: 'Prefer structural provenance checks from an unknown source.',
    });

    expect(getMemoryRecord('trusted-owner-memory')?.provenance).toMatchObject({
      originClass: 'owner',
      sessionKind: 'interactive',
      observedAt: '2026-08-31T12:00:00.000Z',
      sourceSessionId: 'agent:main:main',
      sourceTurnId: 'turn-1',
      derivedFromRecalledContext: false,
    });
    const trusted = searchMemoryRecords({
      query: 'structural provenance checks',
      trustedOnly: true,
      maxResults: 10,
    });
    expect(trusted.map((hit) => hit.record.id)).toEqual(['trusted-owner-memory']);
    expect(getMemoryRecord('unknown-origin-memory')?.provenance.originClass).toBe('untrusted');
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

  it('prioritizes exact technical identifiers over broad word matches', () => {
    upsertMemoryRecord({
      id: 'memory-release-exact', providerId: 'local', kind: 'project_context', sourceAgentId: 'main',
      workspaceId: '/workspace', content: 'release-42 requires a staged database migration.',
    });
    upsertMemoryRecord({
      id: 'memory-release-general', providerId: 'local', kind: 'project_context', sourceAgentId: 'main',
      workspaceId: '/workspace', content: 'Releases require verification.',
    });

    const hits = searchMemoryRecords({
      workspaceId: '/workspace', query: 'What happened in release-42?', maxResults: 5,
    });

    expect(hits[0]?.record.id).toBe('memory-release-exact');
  });
});
