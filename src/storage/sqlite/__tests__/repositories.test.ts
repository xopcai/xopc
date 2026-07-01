import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { SessionStatus } from '../../../session/types.js';
import {
  closeXopcDatabase,
  deleteSessionConfig,
  deleteSessionRecord,
  ensureSessionRecord,
  getCompactionCheckpointDetail,
  getGlobalSessionStats,
  getSessionConfig,
  getSessionMetadata,
  listCompactionCheckpoints,
  listSessionMetadata,
  loadLlmMessagesForSession,
  loadTranscriptRowsForSession,
  openXopcDatabase,
  patchSessionMetadata,
  replaceTranscriptRows,
  resetSessionRecord,
  resetXopcDatabaseSingletonForTest,
  restoreCompactionCheckpoint,
  setSessionConfig,
  appendTranscriptEntry,
  appendMemoryTraceEvent,
  captureCompactionCheckpoint,
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

  it('replaces transcript rows and records compaction entry', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    replaceTranscriptRows(SESSION_KEY, [userMessage('one'), assistantMessage('two')]);
    replaceTranscriptRows(SESSION_KEY, [userMessage('summary')], {
      appendCompaction: {
        at: new Date().toISOString(),
        summary: 'compacted',
        firstKeptIndex: 0,
        tokensBefore: 100,
        tokensAfter: 20,
      },
    });

    const rows = loadTranscriptRowsForSession(SESSION_KEY);
    expect(rows).toHaveLength(2);
    expect((rows[1] as { type?: string }).type).toBe('compaction');
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

  it('deletes session and cascades config', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    setSessionConfig(SESSION_KEY, { thinkingLevel: 'high' }, CWD);
    expect(getSessionConfig(SESSION_KEY)?.thinkingLevel).toBe('high');

    expect(deleteSessionRecord(SESSION_KEY)).toBe(true);
    expect(getSessionMetadata(SESSION_KEY)).toBeNull();
    deleteSessionConfig(SESSION_KEY);
    expect(getSessionConfig(SESSION_KEY)).toBeNull();
  });

  it('captures and restores compaction checkpoints', () => {
    ensureSessionRecord(SESSION_KEY, CWD);
    replaceTranscriptRows(SESSION_KEY, [userMessage('keep'), assistantMessage('me')]);

    const checkpointId = captureCompactionCheckpoint(SESSION_KEY);
    expect(checkpointId).toBeTruthy();

    const summaries = listCompactionCheckpoints(SESSION_KEY);
    expect(summaries).toHaveLength(1);

    const detail = getCompactionCheckpointDetail(SESSION_KEY, checkpointId!);
    expect(detail?.messageCount).toBe(2);

    replaceTranscriptRows(SESSION_KEY, [userMessage('replaced')]);
    restoreCompactionCheckpoint(SESSION_KEY, checkpointId!);

    const llm = loadLlmMessagesForSession(SESSION_KEY);
    expect(llm).toHaveLength(2);
    expect((llm[0] as AgentMessage).content).toBe('keep');
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
      agentId: 'main',
      workspaceId: CWD,
      content: 'Use the zeta migration checklist before memory schema changes.',
      status: 'candidate',
      sensitivity: 'normal',
      evidence: [{ sessionKey: SESSION_KEY, sourceText: 'The migration checklist caught a bug.' }],
      confidence: 0.82,
      tags: ['migration'],
    });

    expect(listMemoryRecords({ status: 'candidate' }).map((record) => record.id)).toContain(candidate.id);
    expect(searchMemoryRecords({ query: 'zeta migration checklist', agentId: 'main', workspaceId: CWD })).toHaveLength(0);

    upsertMemoryRecord({
      ...candidate,
      providerId: 'local',
      agentId: candidate.scope.agentId,
      workspaceId: candidate.scope.workspaceId,
      sessionKey: candidate.scope.sessionKey,
      status: 'active',
    });

    const results = searchMemoryRecords({ query: 'zeta migration checklist', agentId: 'main', workspaceId: CWD });
    expect(results[0]?.record.id).toBe(candidate.id);
    expect(results[0]?.record.status).toBe('active');
  });

  it('records memory trace feedback and summarizes recall quality by record', () => {
    const traceId = appendMemoryTraceEvent({
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
  });
});
