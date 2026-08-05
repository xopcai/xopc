import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { ProjectStore } from '../../../projects/project-store.js';
import { SessionStatus } from '../../../session/types.js';
import {
  closeXopcDatabase,
  deleteSessionConfig,
  deleteSessionRecord,
  ensureSessionRecord,
  getGlobalSessionStats,
  getSessionConfig,
  getSessionMetadata,
  listCompactionBoundaries,
  listSessionMetadata,
  loadLlmMessagesForSession,
  loadTranscriptHistoryRowsForSession,
  loadTranscriptRowsForSession,
  openXopcDatabase,
  patchSessionMetadata,
  replaceTranscriptRows,
  resetSessionRecord,
  resetXopcDatabaseSingletonForTest,
  restoreBeforeCompactionBoundary,
  setSessionConfig,
  appendTranscriptEntry,
  appendCompactionBoundary,
  appendMemoryTraceEvent,
  paginateTranscriptMessages,
  listMemoryRecords,
  listMemoryTraceEvents,
  searchMemoryRecords,
  setMemoryTraceFeedback,
  summarizeMemoryRecallFeedback,
  upsertMemoryRecord,
} from '../index.js';

const SESSION_KEY = 'agent:main:webchat:default:dm:test-user';
const CWD = '/tmp/workspace';
const METADATA = {
  sourceChannel: 'webchat',
  sourceChatId: 'default:dm:test-user',
  routing: {
    agentId: 'main',
    source: 'webchat',
    accountId: 'default',
    peerKind: 'dm',
    peerId: 'test-user',
  },
};

function userMessage(text: string): AgentMessage {
  return { role: 'user', content: text };
}

function assistantMessage(text: string): AgentMessage {
  return { role: 'assistant', content: text };
}

describe('sqlite repositories', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-repo-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('creates and reads session metadata', () => {
    const created = ensureSessionRecord(SESSION_KEY, CWD, METADATA);
    expect(created.key).toBe(SESSION_KEY);
    expect(created.sessionId).toBeTruthy();
    expect(created.messageCount).toBe(0);

    const loaded = getSessionMetadata(SESSION_KEY);
    expect(loaded?.sessionId).toBe(created.sessionId);
    expect(loaded?.routing?.agentId).toBe('main');
    expect(loaded?.sourceChannel).toBe('webchat');
  });

  it('does not infer metadata from session key', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    const loaded = getSessionMetadata(SESSION_KEY);
    expect(loaded?.routing).toBeUndefined();
    expect(loaded?.sourceChannel).toBe('');
    expect(loaded?.sourceChatId).toBe('');
  });

  it('lists and patches session metadata', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    patchSessionMetadata(SESSION_KEY, {
      name: 'Test chat',
      tags: ['alpha'],
      status: SessionStatus.PINNED,
    });

    const page = listSessionMetadata({ search: 'Test chat', limit: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0]?.name).toBe('Test chat');
    expect(page.items[0]?.tags).toEqual(['alpha']);
    expect(page.items[0]?.status).toBe(SessionStatus.PINNED);
  });

  it('filters unassigned sessions separately from project sessions', () => {
    const unassignedKey = 'agent:main:webchat:default:direct:chat_unassigned';
    const projectKey = 'agent:main:webchat:default:direct:chat_project';

    ensureSessionRecord(unassignedKey, CWD, {
      ...METADATA,
      sourceChatId: 'default:direct:chat_unassigned',
    });
    ensureSessionRecord(projectKey, CWD, {
      ...METADATA,
      sourceChatId: 'default:direct:chat_project',
      projectId: 'project-1',
    });

    const unassigned = listSessionMetadata({ unassigned: true, limit: 10 });
    expect(unassigned.items.map((item) => item.key)).toContain(unassignedKey);
    expect(unassigned.items.map((item) => item.key)).not.toContain(projectKey);

    const project = listSessionMetadata({ projectId: 'project-1', limit: 10 });
    expect(project.items.map((item) => item.key)).toEqual([projectKey]);
  });

  it('lists only projects with sidebar-eligible sessions', () => {
    const projects = new ProjectStore();
    const emptyProject = projects.create({ name: 'Empty Project' });
    const oldProject = projects.create({ name: 'Old Project' });
    const recentProject = projects.create({ name: 'Recent Project' });
    const pinnedProject = projects.create({ name: 'Pinned Project' });
    const currentProject = projects.create({ name: 'Current Project' });
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const oldIso = new Date(cutoff - 24 * 60 * 60 * 1000).toISOString();

    const oldKey = 'agent:main:webchat:default:direct:old_project';
    const recentKey = 'agent:main:webchat:default:direct:recent_project';
    const pinnedKey = 'agent:main:webchat:default:direct:pinned_project';
    const currentKey = 'agent:main:webchat:default:direct:current_project';

    ensureSessionRecord(oldKey, CWD, { ...METADATA, projectId: oldProject.id });
    ensureSessionRecord(recentKey, CWD, { ...METADATA, projectId: recentProject.id });
    ensureSessionRecord(pinnedKey, CWD, { ...METADATA, projectId: pinnedProject.id });
    ensureSessionRecord(currentKey, CWD, { ...METADATA, projectId: currentProject.id });
    patchSessionMetadata(oldKey, { updatedAt: oldIso, lastAccessedAt: oldIso });
    patchSessionMetadata(pinnedKey, {
      status: SessionStatus.PINNED,
      updatedAt: oldIso,
      lastAccessedAt: oldIso,
    });
    patchSessionMetadata(currentKey, { updatedAt: oldIso, lastAccessedAt: oldIso });

    const withoutCurrent = projects.listWithSidebarSessions({
      status: 'active',
      updatedAfter: cutoff,
      includePinned: true,
      limit: 10,
    });
    expect(withoutCurrent.items.map((project) => project.id)).toContain(recentProject.id);
    expect(withoutCurrent.items.map((project) => project.id)).toContain(pinnedProject.id);
    expect(withoutCurrent.items.map((project) => project.id)).not.toContain(emptyProject.id);
    expect(withoutCurrent.items.map((project) => project.id)).not.toContain(oldProject.id);
    expect(withoutCurrent.items.map((project) => project.id)).not.toContain(currentProject.id);

    const withCurrent = projects.listWithSidebarSessions({
      status: 'active',
      updatedAfter: cutoff,
      includePinned: true,
      includeSessionKey: currentKey,
      limit: 10,
    });
    expect(withCurrent.items.map((project) => project.id)).toContain(currentProject.id);
  });

  it('moves deleted project sessions to unassigned while keeping sidebar age filtering', () => {
    const projects = new ProjectStore();
    const project = projects.create({ name: 'Deleted Project' });
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const oldIso = new Date(cutoff - 24 * 60 * 60 * 1000).toISOString();
    const key = 'agent:main:webchat:default:direct:deleted_project_session';

    ensureSessionRecord(key, CWD, { ...METADATA, projectId: project.id });
    patchSessionMetadata(key, { updatedAt: oldIso, lastAccessedAt: oldIso });
    projects.delete(project.id);

    expect(getSessionMetadata(key)?.projectId).toBeUndefined();
    expect(listSessionMetadata({
      unassigned: true,
      updatedAfter: cutoff,
      includePinned: true,
      limit: 10,
    }).items.map((item) => item.key)).not.toContain(key);
    expect(listSessionMetadata({
      unassigned: true,
      updatedAfter: cutoff,
      includePinned: true,
      includeSessionKey: key,
      limit: 10,
    }).items.map((item) => item.key)).toContain(key);
  });

  it('hides empty shells from default session lists until a user message is written', () => {
    ensureSessionRecord(SESSION_KEY, CWD, {
      ...METADATA,
      hiddenFromSessionList: true,
      customData: { genericNewChatShell: true },
    });

    expect(listSessionMetadata({ limit: 10 }).items.map((item) => item.key)).not.toContain(SESSION_KEY);
    expect(listSessionMetadata({ includeHidden: true, limit: 10 }).items.map((item) => item.key)).toContain(SESSION_KEY);

    appendTranscriptEntry(SESSION_KEY, userMessage('hello'));

    const meta = getSessionMetadata(SESSION_KEY);
    expect(meta?.hiddenFromSessionList).toBe(false);
    expect(listSessionMetadata({ limit: 10 }).items.map((item) => item.key)).toContain(SESSION_KEY);
  });

  it('unhides shells when transcript rows are replaced with user messages', () => {
    ensureSessionRecord(SESSION_KEY, CWD, {
      ...METADATA,
      hiddenFromSessionList: true,
      customData: { genericNewChatShell: true },
    });

    replaceTranscriptRows(SESSION_KEY, [userMessage('restored user turn')]);

    expect(getSessionMetadata(SESSION_KEY)?.hiddenFromSessionList).toBe(false);
    expect(listSessionMetadata({ limit: 10 }).items.map((item) => item.key)).toContain(SESSION_KEY);
  });

  it('appends transcript rows and paginates messages', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    appendTranscriptEntry(SESSION_KEY, userMessage('hello'));
    appendTranscriptEntry(SESSION_KEY, assistantMessage('hi there'));

    const rows = loadTranscriptRowsForSession(SESSION_KEY);
    expect(rows).toHaveLength(2);

    const llm = loadLlmMessagesForSession(SESSION_KEY);
    expect(llm.map((m) => m.role)).toEqual(['user', 'assistant']);

    const page = paginateTranscriptMessages(SESSION_KEY, { limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.messages).toHaveLength(1);

    const meta = getSessionMetadata(SESSION_KEY);
    expect(meta?.messageCount).toBe(2);
  });

  it('excludes hidden empty project sessions from project counts and recent sessions', () => {
    const projects = new ProjectStore();
    const project = projects.create({ name: 'Session Visibility' });
    const hiddenKey = 'agent:main:webchat:default:direct:chat_hidden';
    const visibleKey = 'agent:main:webchat:default:direct:chat_visible';

    ensureSessionRecord(hiddenKey, CWD, {
      sourceChannel: 'webchat',
      sourceChatId: 'default:direct:chat_hidden',
      routing: {
        agentId: 'main',
        source: 'webchat',
        accountId: 'default',
        peerKind: 'direct',
        peerId: 'chat_hidden',
      },
      projectId: project.id,
      hiddenFromSessionList: true,
    });
    ensureSessionRecord(visibleKey, CWD, {
      sourceChannel: 'webchat',
      sourceChatId: 'default:direct:chat_visible',
      routing: {
        agentId: 'main',
        source: 'webchat',
        accountId: 'default',
        peerKind: 'direct',
        peerId: 'chat_visible',
      },
      projectId: project.id,
    });
    appendTranscriptEntry(visibleKey, userMessage('visible'));

    expect(projects.getSessionCount(project.id)).toBe(1);
    expect(projects.getRecentSessions(project.id).map((session) => session.key)).toEqual([visibleKey]);
  });

  it('replaces transcript rows exactly', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    replaceTranscriptRows(SESSION_KEY, [userMessage('one'), assistantMessage('two')]);
    replaceTranscriptRows(SESSION_KEY, [userMessage('replacement')]);

    const rows = loadTranscriptRowsForSession(SESSION_KEY);
    expect(rows).toEqual([userMessage('replacement')]);
  });

  it('resets session with new session id while keeping session key', () => {
    const created = ensureSessionRecord(SESSION_KEY, CWD);
    appendTranscriptEntry(SESSION_KEY, userMessage('before reset'));

    const reset = resetSessionRecord(SESSION_KEY, CWD);
    expect(reset?.previousSessionId).toBe(created.sessionId);
    expect(reset?.sessionId).not.toBe(created.sessionId);

    const meta = getSessionMetadata(SESSION_KEY);
    expect(meta?.sessionId).toBe(reset?.sessionId);
    expect(meta?.messageCount).toBe(0);
    expect(loadTranscriptRowsForSession(SESSION_KEY)).toHaveLength(0);
  });

  it('paginates archived reset transcripts for read-only conversation history', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    appendTranscriptEntry(SESSION_KEY, userMessage('before reset'));
    resetSessionRecord(SESSION_KEY, CWD);
    appendTranscriptEntry(SESSION_KEY, userMessage('after reset'));

    const activeOnly = paginateTranscriptMessages(SESSION_KEY, { limit: 10 });
    expect(activeOnly.rows.map((row) => (row as AgentMessage).content)).toEqual(['after reset']);

    const fullHistory = paginateTranscriptMessages(SESSION_KEY, {
      limit: 10,
      includeArchived: true,
    });
    expect(fullHistory.total).toBe(2);
    expect(fullHistory.rows.map((row) => (row as AgentMessage).content)).toEqual([
      'before reset',
      'after reset',
    ]);

    const tail = paginateTranscriptMessages(SESSION_KEY, {
      limit: 1,
      includeArchived: true,
    });
    expect(tail.rows.map((row) => (row as AgentMessage).content)).toEqual(['after reset']);

    const older = paginateTranscriptMessages(SESSION_KEY, {
      limit: 1,
      beforeIndex: 1,
      includeArchived: true,
    });
    expect(older.rows.map((row) => (row as AgentMessage).content)).toEqual(['before reset']);

    expect(
      loadTranscriptHistoryRowsForSession(SESSION_KEY).map(
        (row) => (row as AgentMessage).content,
      ),
    ).toEqual(['before reset', 'after reset']);
  });

  it('deletes session and cascades config', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    setSessionConfig(SESSION_KEY, { thinkingLevel: 'high' }, CWD);
    expect(getSessionConfig(SESSION_KEY)?.thinkingLevel).toBe('high');

    expect(deleteSessionRecord(SESSION_KEY)).toBe(true);
    expect(getSessionMetadata(SESSION_KEY)).toBeNull();
    deleteSessionConfig(SESSION_KEY);
    expect(getSessionConfig(SESSION_KEY)).toBeNull();
  });

  it('restores context by appending a logical compaction boundary', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    replaceTranscriptRows(SESSION_KEY, [userMessage('keep'), assistantMessage('me')]);
    const boundary = appendCompactionBoundary(SESSION_KEY, {
      type: 'compaction',
      at: new Date().toISOString(),
      plannerVersion: 2,
      summaryModelRef: 'test/model',
      qualityAudit: 'passed',
      summary: 'condensed',
      messages: [userMessage('summary')],
      firstKeptIndex: 2,
      tokensBefore: 100,
      tokensAfter: 10,
    });
    appendTranscriptEntry(SESSION_KEY, userMessage('later'));

    restoreBeforeCompactionBoundary(SESSION_KEY, boundary.entry_id);

    const llm = loadLlmMessagesForSession(SESSION_KEY);
    expect(llm).toHaveLength(2);
    expect((llm[0] as AgentMessage).content).toBe('keep');
    const boundaries = listCompactionBoundaries(SESSION_KEY);
    expect(boundaries).toHaveLength(2);
    expect(boundaries[0]?.restoredFromCompactionId).toBe(boundary.entry_id);
  });

  it('computes global session stats', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    ensureSessionRecord('agent:main:telegram:default:dm:2', CWD);
    appendTranscriptEntry(SESSION_KEY, userMessage('msg'));

    const stats = getGlobalSessionStats();
    expect(stats.totalSessions).toBe(2);
    expect(stats.totalMessages).toBe(1);
  });

  it('handles concurrent transcript appends', async () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve(appendTranscriptEntry(SESSION_KEY, userMessage(`msg-${i}`))),
      ),
    );

    const meta = getSessionMetadata(SESSION_KEY);
    expect(meta?.messageCount).toBe(20);
    expect(loadTranscriptRowsForSession(SESSION_KEY)).toHaveLength(20);
  });

  it('keeps candidate memory out of default recall until approved', () => {
    const candidate = upsertMemoryRecord({
      providerId: 'local',
      kind: 'task_lesson',
      sourceAgentId: 'main',
      workspaceId: CWD,
      projectId: 'project-memory',
      content: 'Use the zeta migration checklist before memory schema changes.',
      status: 'candidate',
      sensitivity: 'normal',
      evidence: [{ sessionKey: SESSION_KEY, sourceText: 'The migration checklist caught a bug.' }],
      confidence: 0.82,
      tags: ['migration'],
    });

    expect(candidate.scope.projectId).toBe('project-memory');
    expect(listMemoryRecords({ status: 'candidate', projectId: 'project-memory' }).map((record) => record.id)).toContain(candidate.id);
    expect(listMemoryRecords({ status: 'candidate', projectId: 'other-project' }).map((record) => record.id)).not.toContain(candidate.id);
    expect(searchMemoryRecords({ query: 'zeta migration checklist', workspaceId: CWD })).toHaveLength(0);

    upsertMemoryRecord({
      ...candidate,
      providerId: 'local',
      sourceAgentId: candidate.provenance.sourceAgentId,
      workspaceId: candidate.scope.workspaceId,
      sessionKey: candidate.scope.sessionKey,
      projectId: candidate.scope.projectId,
      status: 'active',
    });

    expect(searchMemoryRecords({ query: 'zeta migration checklist', projectId: 'other-project' })).toHaveLength(0);
    const results = searchMemoryRecords({ query: 'zeta migration checklist', workspaceId: CWD, projectId: 'project-memory' });
    expect(results[0]?.record.id).toBe(candidate.id);
    expect(results[0]?.record.status).toBe('active');
  });

  it('limits session-scoped memory visibility to the active session', () => {
    upsertMemoryRecord({
      id: 'global-memory',
      providerId: 'local',
      kind: 'preference',
      sourceAgentId: 'main',
      workspaceId: CWD,
      content: 'Use concise aurora summaries for status updates.',
    });
    upsertMemoryRecord({
      id: 'session-memory',
      providerId: 'local',
      kind: 'project_context',
      sourceAgentId: 'main',
      workspaceId: CWD,
      sessionKey: SESSION_KEY,
      content: 'Aurora deployment belongs to the current private session.',
    });

    expect(searchMemoryRecords({
      query: 'aurora',
      workspaceId: CWD,
      visibleToSessionKey: SESSION_KEY,
    }).map((result) => result.record.id)).toEqual(expect.arrayContaining(['global-memory', 'session-memory']));

    expect(searchMemoryRecords({
      query: 'aurora',
      workspaceId: CWD,
      visibleToSessionKey: 'agent:main:webchat:default:dm:other-user',
    }).map((result) => result.record.id)).toEqual(['global-memory']);
  });

  it('records memory trace feedback and summarizes recall quality by record', () => {
    const traceId = appendMemoryTraceEvent({
      sourceAgentId: 'main',
      sessionKey: SESSION_KEY,
      phase: 'search',
      providerId: 'local',
      request: { query: 'migration checklist' },
      resultCount: 1,
      selectedRecordIds: ['memory-record-1'],
      durationMs: 12,
    });

    const updated = setMemoryTraceFeedback({
      traceId,
      feedback: {
        outcome: 'helpful',
        score: 0.8,
        reason: 'The recalled checklist changed the final answer.',
        source: 'evaluator',
      },
      nowMs: Date.parse('2026-01-01T00:00:00.000Z'),
    });

    expect(updated?.feedback?.outcome).toBe('helpful');
    expect(updated?.feedback?.score).toBe(0.8);

    const traces = listMemoryTraceEvents({ sessionKey: SESSION_KEY });
    expect(traces[0]?.feedback?.reason).toContain('changed the final answer');

    const summaries = summarizeMemoryRecallFeedback({ recordId: 'memory-record-1' });
    expect(summaries[0]).toMatchObject({
      recordId: 'memory-record-1',
      helpful: 1,
      notHelpful: 0,
      total: 1,
      averageScore: 0.8,
    });

    const researchTraceId = appendMemoryTraceEvent({
      sourceAgentId: 'research',
      sessionKey: 'agent:research:webchat:default:dm:test-user',
      phase: 'search',
      providerId: 'local',
      request: { query: 'migration checklist' },
      resultCount: 1,
      selectedRecordIds: ['research-memory-record'],
      durationMs: 9,
    });
    setMemoryTraceFeedback({
      traceId: researchTraceId,
      feedback: { outcome: 'not_helpful', source: 'evaluator' },
    });

    expect(listMemoryTraceEvents().map((trace) => trace.traceId)).toEqual(expect.arrayContaining([traceId, researchTraceId]));
    expect(listMemoryTraceEvents({ sourceAgentId: 'main' }).map((trace) => trace.traceId)).not.toContain(researchTraceId);
    expect(summarizeMemoryRecallFeedback({ sourceAgentId: 'main' }).map((summary) => summary.recordId))
      .not.toContain('research-memory-record');
  });
});
