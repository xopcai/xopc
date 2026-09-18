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
  appendCompactionBoundaryIfUnchanged,
  loadCompactionSourceSnapshot,
  paginateTranscriptMessages,
  searchSessionTranscript,
} from '../index.js';

const CONVERSATION_ID = "f3745a3a-cedd-4f7f-8e27-09b81615fea4";
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
    const created = ensureSessionRecord(CONVERSATION_ID, CWD, METADATA);
    expect(created.key).toBe(CONVERSATION_ID);
    expect(created.transcriptId).toBeTruthy();
    expect(created.messageCount).toBe(0);

    const loaded = getSessionMetadata(CONVERSATION_ID);
    expect(loaded?.transcriptId).toBe(created.transcriptId);
    expect(loaded?.routing?.agentId).toBe('main');
    expect(loaded?.sourceChannel).toBe('webchat');
  });

  it('does not infer metadata from session key', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    const loaded = getSessionMetadata(CONVERSATION_ID);
    expect(loaded?.routing).toBeUndefined();
    expect(loaded?.sourceChannel).toBe('');
    expect(loaded?.sourceChatId).toBe('');
  });

  it('lists and patches session metadata', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    patchSessionMetadata(CONVERSATION_ID, {
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
    const unassignedKey = "6d16b7d4-c87c-45b2-8ff3-1c035daae3a4";
    const projectKey = "0edfc629-b4dc-4949-8beb-0e744f97b9a0";

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

  it('lists empty projects alongside projects with sidebar-eligible sessions', () => {
    const projects = new ProjectStore();
    const emptyProject = projects.create({ name: 'Empty Project' });
    const oldProject = projects.create({ name: 'Old Project' });
    const recentProject = projects.create({ name: 'Recent Project' });
    const pinnedProject = projects.create({ name: 'Pinned Project' });
    const currentProject = projects.create({ name: 'Current Project' });
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const oldIso = new Date(cutoff - 24 * 60 * 60 * 1000).toISOString();

    const oldKey = "0de1651e-babb-48fe-8ce1-7b680b7797dd";
    const recentKey = "7fffbe3b-03a4-420e-87fc-732fe386b11e";
    const pinnedKey = "0c38d52f-073d-483d-894b-1ac98ed37ed0";
    const currentKey = "5ecc36e0-fc25-4023-8d99-ffb6f2aaaaeb";

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
    expect(withoutCurrent.items.map((project) => project.id)).toContain(emptyProject.id);
    expect(withoutCurrent.items.map((project) => project.id)).not.toContain(oldProject.id);
    expect(withoutCurrent.items.map((project) => project.id)).not.toContain(currentProject.id);

    const withCurrent = projects.listWithSidebarSessions({
      status: 'active',
      updatedAfter: cutoff,
      includePinned: true,
      includeConversationId: currentKey,
      limit: 10,
    });
    expect(withCurrent.items.map((project) => project.id)).toContain(currentProject.id);
  });

  it('moves deleted project sessions to unassigned while keeping sidebar age filtering', () => {
    const projects = new ProjectStore();
    const project = projects.create({ name: 'Deleted Project' });
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const oldIso = new Date(cutoff - 24 * 60 * 60 * 1000).toISOString();
    const key = "63c8a52d-af81-4afa-8c45-8b9796efcc21";

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
      includeConversationId: key,
      limit: 10,
    }).items.map((item) => item.key)).toContain(key);
  });

  it('hides empty shells from default session lists until a user message is written', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, {
      ...METADATA,
      hiddenFromSessionList: true,
      customData: { genericNewChatShell: true },
    });

    expect(listSessionMetadata({ limit: 10 }).items.map((item) => item.key)).not.toContain(CONVERSATION_ID);
    expect(listSessionMetadata({ includeHidden: true, limit: 10 }).items.map((item) => item.key)).toContain(CONVERSATION_ID);

    appendTranscriptEntry(CONVERSATION_ID, userMessage('hello'));

    const meta = getSessionMetadata(CONVERSATION_ID);
    expect(meta?.hiddenFromSessionList).toBe(false);
    expect(listSessionMetadata({ limit: 10 }).items.map((item) => item.key)).toContain(CONVERSATION_ID);
  });

  it('unhides shells when transcript rows are replaced with user messages', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, {
      ...METADATA,
      hiddenFromSessionList: true,
      customData: { genericNewChatShell: true },
    });

    replaceTranscriptRows(CONVERSATION_ID, [userMessage('restored user turn')]);

    expect(getSessionMetadata(CONVERSATION_ID)?.hiddenFromSessionList).toBe(false);
    expect(listSessionMetadata({ limit: 10 }).items.map((item) => item.key)).toContain(CONVERSATION_ID);
  });

  it('keeps background shells hidden until their output is ready', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, {
      ...METADATA,
      hiddenFromSessionList: true,
      customData: { deferVisibilityUntilOutput: true },
    });

    appendTranscriptEntry(CONVERSATION_ID, userMessage('internal automation instruction'));
    expect(getSessionMetadata(CONVERSATION_ID)?.hiddenFromSessionList).toBe(true);

    replaceTranscriptRows(CONVERSATION_ID, [userMessage('restored internal instruction')]);
    expect(getSessionMetadata(CONVERSATION_ID)?.hiddenFromSessionList).toBe(true);
  });

  it('filters legacy automation shells without output from visible session lists', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, {
      ...METADATA,
      sourceChannel: 'automation',
      hiddenFromSessionList: false,
    });
    appendTranscriptEntry(CONVERSATION_ID, userMessage('internal automation instruction'));

    expect(getSessionMetadata(CONVERSATION_ID)?.hiddenFromSessionList).toBe(false);
    expect(listSessionMetadata({ limit: 10 }).items.map((item) => item.key)).not.toContain(CONVERSATION_ID);

    appendTranscriptEntry(CONVERSATION_ID, assistantMessage('automation output'));
    expect(listSessionMetadata({ limit: 10 }).items.map((item) => item.key)).toContain(CONVERSATION_ID);
  });

  it('appends transcript rows and paginates messages', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    appendTranscriptEntry(CONVERSATION_ID, userMessage('hello'));
    appendTranscriptEntry(CONVERSATION_ID, assistantMessage('hi there'));

    const rows = loadTranscriptRowsForSession(CONVERSATION_ID);
    expect(rows).toHaveLength(2);

    const llm = loadLlmMessagesForSession(CONVERSATION_ID);
    expect(llm.map((m) => m.role)).toEqual(['user', 'assistant']);

    const page = paginateTranscriptMessages(CONVERSATION_ID, { limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.messages).toHaveLength(1);

    const meta = getSessionMetadata(CONVERSATION_ID);
    expect(meta?.messageCount).toBe(2);
  });

  it('excludes hidden empty project sessions from project counts and recent sessions', () => {
    const projects = new ProjectStore();
    const project = projects.create({ name: 'Session Visibility' });
    const hiddenKey = "9d6e49b8-74c9-49ab-8700-96c622499382";
    const visibleKey = "2c37343b-a6f9-48e1-8e13-8a54112fecb6";

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
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    replaceTranscriptRows(CONVERSATION_ID, [userMessage('one'), assistantMessage('two')]);
    replaceTranscriptRows(CONVERSATION_ID, [userMessage('replacement')]);

    const rows = loadTranscriptRowsForSession(CONVERSATION_ID);
    expect(rows).toEqual([userMessage('replacement')]);
  });

  it('resets session with new session id while keeping session key', () => {
    const created = ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    appendTranscriptEntry(CONVERSATION_ID, userMessage('before reset'));

    const reset = resetSessionRecord(CONVERSATION_ID, CWD);
    expect(reset?.previousTranscriptId).toBe(created.transcriptId);
    expect(reset?.transcriptId).not.toBe(created.transcriptId);

    const meta = getSessionMetadata(CONVERSATION_ID);
    expect(meta?.transcriptId).toBe(reset?.transcriptId);
    expect(meta?.messageCount).toBe(0);
    expect(loadTranscriptRowsForSession(CONVERSATION_ID)).toHaveLength(0);
  });

  it('paginates archived reset transcripts for read-only conversation history', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    appendTranscriptEntry(CONVERSATION_ID, userMessage('before reset'));
    resetSessionRecord(CONVERSATION_ID, CWD);
    appendTranscriptEntry(CONVERSATION_ID, userMessage('after reset'));

    const activeOnly = paginateTranscriptMessages(CONVERSATION_ID, { limit: 10 });
    expect(activeOnly.rows.map((row) => (row as AgentMessage).content)).toEqual(['after reset']);

    const fullHistory = paginateTranscriptMessages(CONVERSATION_ID, {
      limit: 10,
      includeArchived: true,
    });
    expect(fullHistory.total).toBe(2);
    expect(fullHistory.rows.map((row) => (row as AgentMessage).content)).toEqual([
      'before reset',
      'after reset',
    ]);

    const tail = paginateTranscriptMessages(CONVERSATION_ID, {
      limit: 1,
      includeArchived: true,
    });
    expect(tail.rows.map((row) => (row as AgentMessage).content)).toEqual(['after reset']);

    const older = paginateTranscriptMessages(CONVERSATION_ID, {
      limit: 1,
      beforeIndex: 1,
      includeArchived: true,
    });
    expect(older.rows.map((row) => (row as AgentMessage).content)).toEqual(['before reset']);

    expect(
      loadTranscriptHistoryRowsForSession(CONVERSATION_ID).map(
        (row) => (row as AgentMessage).content,
      ),
    ).toEqual(['before reset', 'after reset']);
  });

  it('deletes session and cascades config', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    setSessionConfig(CONVERSATION_ID, { thinkingLevel: 'high' }, CWD);
    expect(getSessionConfig(CONVERSATION_ID)?.thinkingLevel).toBe('high');

    expect(deleteSessionRecord(CONVERSATION_ID)).toBe(true);
    expect(getSessionMetadata(CONVERSATION_ID)).toBeNull();
    deleteSessionConfig(CONVERSATION_ID);
    expect(getSessionConfig(CONVERSATION_ID)).toBeNull();
  });

  it('persists the per-session user understanding mode', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: 'main' });
    setSessionConfig(CONVERSATION_ID, { userContextMode: 'off' }, CWD);
    expect(getSessionConfig(CONVERSATION_ID)?.userContextMode).toBe('off');

    setSessionConfig(CONVERSATION_ID, { userContextMode: 'enabled' }, CWD);
    expect(getSessionConfig(CONVERSATION_ID)?.userContextMode).toBe('enabled');
  });

  it('restores context by truncating the selected compaction boundary and later rows', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    replaceTranscriptRows(CONVERSATION_ID, [userMessage('keep'), assistantMessage('me')]);
    const snapshot = loadCompactionSourceSnapshot(CONVERSATION_ID)!;
    const boundary = appendCompactionBoundaryIfUnchanged(CONVERSATION_ID, snapshot, {
      type: 'compaction',
      at: new Date().toISOString(),
      plannerVersion: 3,
      summaryModelRef: 'test/model',
      qualityAudit: 'passed',
      handover: { version: 1, sourceThroughSeq: 2, items: [] },
      audit: { status: 'passed', mode: 'structural', missingItemsFound: 0, repaired: false },
      summary: 'condensed',
      messages: [userMessage('summary')],
      firstKeptIndex: 2,
      tokensBefore: 100,
      tokensAfter: 10,
    });
    expect(boundary).not.toBeNull();
    expect(loadLlmMessagesForSession(CONVERSATION_ID).map((row) => (row as AgentMessage).content))
      .toEqual(['summary']);
    expect(loadCompactionSourceSnapshot(CONVERSATION_ID)!.entries.slice(0, 2).map((entry) =>
      (entry.row as AgentMessage).content)).toEqual(['keep', 'me']);
    appendTranscriptEntry(CONVERSATION_ID, userMessage('later'));
    expect(loadLlmMessagesForSession(CONVERSATION_ID).map((row) => (row as AgentMessage).content))
      .toEqual(['summary', 'later']);

    restoreBeforeCompactionBoundary(CONVERSATION_ID, boundary!.entry_id);

    const llm = loadLlmMessagesForSession(CONVERSATION_ID);
    expect(llm).toHaveLength(2);
    expect((llm[0] as AgentMessage).content).toBe('keep');
    const boundaries = listCompactionBoundaries(CONVERSATION_ID);
    expect(boundaries).toHaveLength(0);
  });

  it('captures transcript source metadata and rejects a stale compaction boundary', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    const first = appendTranscriptEntry(CONVERSATION_ID, userMessage('first'));
    const snapshot = loadCompactionSourceSnapshot(CONVERSATION_ID);

    expect(snapshot).toMatchObject({ lastSeq: 1 });
    expect(snapshot?.entries[0]).toMatchObject({
      entryId: first.entry_id,
      seq: 1,
      row: { role: 'user', content: 'first' },
    });

    appendTranscriptEntry(CONVERSATION_ID, assistantMessage('concurrent'));
    const stale = appendCompactionBoundaryIfUnchanged(CONVERSATION_ID, snapshot!, {
      type: 'compaction',
      at: new Date().toISOString(),
      plannerVersion: 3,
      summaryModelRef: 'test/model',
      qualityAudit: 'passed',
      handover: { version: 1, sourceThroughSeq: 1, items: [] },
      audit: { status: 'passed', mode: 'structural', missingItemsFound: 0, repaired: false },
      summary: 'stale',
      messages: [userMessage('summary')],
      firstKeptIndex: 1,
      tokensBefore: 10,
      tokensAfter: 5,
    });

    expect(stale).toBeNull();
    expect(listCompactionBoundaries(CONVERSATION_ID)).toHaveLength(0);
  });

  it('recalls authoritative raw turns older than a compaction boundary', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    appendTranscriptEntry(CONVERSATION_ID, userMessage('The exact launch code is ORBIT-7429.'));
    appendTranscriptEntry(CONVERSATION_ID, assistantMessage('Acknowledged.'));
    appendTranscriptEntry(CONVERSATION_ID, {
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: 'tool-1',
        name: 'deployctl',
        arguments: { artifact: 'release-candidate-17' },
      }],
    } as unknown as AgentMessage);
    const snapshot = loadCompactionSourceSnapshot(CONVERSATION_ID)!;
    appendCompactionBoundaryIfUnchanged(CONVERSATION_ID, snapshot, {
      type: 'compaction',
      at: new Date().toISOString(),
      plannerVersion: 3,
      summaryModelRef: 'test/model',
      qualityAudit: 'passed',
      handover: { version: 1, sourceThroughSeq: 1, items: [] },
      audit: { status: 'passed', mode: 'structural', missingItemsFound: 0, repaired: false },
      summary: 'A launch code was discussed.',
      messages: [userMessage('summary without the exact code')],
      firstKeptIndex: 1,
      tokensBefore: 20,
      tokensAfter: 5,
    });
    appendTranscriptEntry(CONVERSATION_ID, userMessage('Continue.'));

    const matches = searchSessionTranscript(CONVERSATION_ID, 'ORBIT-7429');

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      seq: 1,
      role: 'user',
      content: 'The exact launch code is ORBIT-7429.',
    });
    const toolArgument = searchSessionTranscript(CONVERSATION_ID, 'release-candidate-17');
    expect(toolArgument).toHaveLength(1);
    expect(toolArgument[0]?.content).toContain('deployctl');
  });

  it('computes global session stats', () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    ensureSessionRecord("192c8bfa-679c-4ae0-80c7-e8f3a125cdb1", CWD, { agentId: "main" });
    appendTranscriptEntry(CONVERSATION_ID, userMessage('msg'));

    const stats = getGlobalSessionStats();
    expect(stats.totalSessions).toBe(2);
    expect(stats.totalMessages).toBe(1);
  });

  it('handles concurrent transcript appends', async () => {
    ensureSessionRecord(CONVERSATION_ID, CWD, { agentId: "main" });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve(appendTranscriptEntry(CONVERSATION_ID, userMessage(`msg-${i}`))),
      ),
    );

    const meta = getSessionMetadata(CONVERSATION_ID);
    expect(meta?.messageCount).toBe(20);
    expect(loadTranscriptRowsForSession(CONVERSATION_ID)).toHaveLength(20);
  });

});
