import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { writeKnowledgeItem } from '../../knowledge-memory/index.js';
import { personalAgentId } from '../../personal-agent/repository.js';
import { ProjectStore } from '../../projects/project-store.js';
import { setSessionConfig } from '../../storage/sqlite/config-repository.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, getSqliteDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { listSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry, readSessionTranscriptEntries } from '../../storage/sqlite/transcript-repository.js';
import { VOICE_TRANSCRIPT_TYPE } from '../voice-transcript.js';
import {
  canRecallConversation,
  canSearchConversation,
  canSearchHistoryEntry,
} from '../history-recall-policy.js';

const uuid = (label: string) => {
  const h = createHash('sha256').update(label).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

describe('cross-session history recall vs active search policy', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
    seedTestAgentCatalog();
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('allows active cross-agent, cross-project, cross-workspace, and Ada session search while keeping automatic recall strict', () => {
    const config = structuredClone(ConfigSchema.parse({}));
    const projectA = new ProjectStore().create({ name: 'Alpha', workspaceRoot: '/ws-alpha' });
    const projectB = new ProjectStore().create({ name: 'Beta', workspaceRoot: '/ws-beta' });
    const adaAgentId = personalAgentId('local-owner');

    const adaId = createConversation({
      agentId: adaAgentId,
      sourceChannel: 'webchat',
      name: 'Ada',
      hiddenFromSessionList: true,
      customData: { personalAgent: true, keepHiddenFromSessionList: true },
    }, '/ws-home', uuid('ada')).key;
    const coderId = createConversation({
      agentId: 'coder',
      sourceChannel: 'webchat',
      projectId: projectA.id,
      name: 'Alpha API refactor',
    }, '/ws-alpha', uuid('coder')).key;
    const writerId = createConversation({
      agentId: 'writer',
      sourceChannel: 'webchat',
      projectId: projectB.id,
      name: 'Beta launch blog',
    }, '/ws-beta', uuid('writer')).key;

    appendTranscriptEntry(adaId, { role: 'user', content: 'This week I focused on Alpha and Beta', timestamp: 1_700_000_000_000 });
    appendTranscriptEntry(coderId, { role: 'user', content: 'Finished the Alpha API migration', timestamp: 1_700_000_100_000 });
    appendTranscriptEntry(writerId, { role: 'user', content: 'Drafted the Beta launch post', timestamp: 1_700_000_200_000 });

    // Even when a project-scoped knowledge item is linked to coder's conversation, active cross-project search still allows reading it.
    writeKnowledgeItem({
      kind: 'project_fact',
      scope: { type: 'project', id: projectA.id },
      content: 'Alpha uses GraphQL v2',
      canonicalKey: 'alpha-api',
      originClass: 'owner',
      confidence: 1,
      importance: 0.8,
      sourceConversationId: coderId,
    });

    const adaCtx = { agentId: adaAgentId, workspaceId: '/ws-home', conversationId: adaId };
    const coderCtx = { agentId: 'coder', workspaceId: '/ws-alpha', conversationId: coderId, projectId: projectA.id };

    // Ada can search coder (Project A) and writer (Project B)
    expect(canSearchConversation(config, adaCtx, coderId)).toBe(true);
    expect(canSearchConversation(config, adaCtx, writerId)).toBe(true);
    // Coder (Project A) can search Ada's personal chat and writer (Project B)
    expect(canSearchConversation(config, coderCtx, adaId)).toBe(true);
    expect(canSearchConversation(config, coderCtx, writerId)).toBe(true);

    // Automatic deepRecall policy remains strictly scoped to same agent/project/workspace
    expect(canRecallConversation(config, adaCtx, coderId)).toBe(false);
    expect(canRecallConversation(config, coderCtx, writerId)).toBe(false);
    expect(canRecallConversation(config, coderCtx, adaId)).toBe(false);

    // listSessionMetadata excludes Ada by default but includes Ada when includePersonalAgent=true
    expect(listSessionMetadata({ limit: 10 }).items.map(s => s.key)).not.toContain(adaId);
    expect(listSessionMetadata({ limit: 10, includePersonalAgent: true }).items.map(s => s.key)).toEqual(
      expect.arrayContaining([adaId, coderId, writerId]),
    );
  });

  it('still enforces owner-only, non-temporary, session-only markers, and session-scoped facts in active cross-session search', () => {
    const config = structuredClone(ConfigSchema.parse({}));
    const callerId = createConversation({ agentId: 'main', sourceChannel: 'webchat' }, '/ws', uuid('caller')).key;
    const tempId = createConversation({ agentId: 'coder', sourceChannel: 'webchat' }, '/ws-other', uuid('temp')).key;
    const narrowId = createConversation({ agentId: 'coder', sourceChannel: 'webchat' }, '/ws-other', uuid('narrow')).key;
    const groupId = createConversation({
      agentId: 'coder',
      sourceChannel: 'telegram',
      routing: { agentId: 'coder', source: 'telegram', accountId: 'default', peerKind: 'group', peerId: 'grp-1' },
    }, '/ws-other', uuid('group')).key;

    setSessionConfig(tempId, { userContextMode: 'temporary' }, '/ws-other');
    appendTranscriptEntry(narrowId, { role: 'user', content: '仅当前会话记住：这是秘密草稿', timestamp: Date.now() });

    const callerCtx = { agentId: 'main', workspaceId: '/ws', conversationId: callerId };

    expect(canSearchConversation(config, callerCtx, tempId)).toBe(false);
    expect(canSearchConversation(config, callerCtx, narrowId)).toBe(false);
    expect(canSearchConversation(config, callerCtx, groupId)).toBe(false);
    expect(canSearchHistoryEntry(callerCtx, narrowId, 'e1', '仅当前会话记住：秘密')).toBe(false);
    expect(canSearchHistoryEntry(callerCtx, narrowId, 'e2', 'Only in this chat: private note')).toBe(false);

    // Caller in temporary mode cannot search any other session
    const allowedId = createConversation({ agentId: 'writer', sourceChannel: 'webchat' }, '/ws-other', uuid('allowed')).key;
    expect(canSearchConversation(config, callerCtx, allowedId)).toBe(true);
    setSessionConfig(callerId, { userContextMode: 'temporary' }, '/ws');
    expect(canSearchConversation(config, callerCtx, allowedId)).toBe(false);
  });

  it('reads chronological transcript entries with time bounds, pagination, and voice transcripts', () => {
    const id = createConversation({ agentId: personalAgentId('local-owner'), sourceChannel: 'webchat' }, '/ws', uuid('voice')).key;
    const e1 = appendTranscriptEntry(id, { role: 'user', content: 'Old topic from last month', timestamp: 1_000 });
    const e2 = appendTranscriptEntry(id, { role: 'assistant', content: 'Old reply', timestamp: 2_000 });
    const e3 = appendTranscriptEntry(id, {
      role: 'custom',
      customType: VOICE_TRANSCRIPT_TYPE,
      content: 'Spoken weekly update about Q4 roadmap',
      details: { role: 'user' },
      timestamp: 5_000,
    } as never);
    const e4 = appendTranscriptEntry(id, { role: 'assistant', content: 'Got it, tracking Q4 roadmap.', timestamp: 6_000 });
    const updateTime = getSqliteDatabase().prepare('UPDATE transcript_entries SET created_at = ? WHERE entry_id = ?');
    updateTime.run(1_000, e1.entry_id);
    updateTime.run(2_000, e2.entry_id);
    updateTime.run(5_000, e3.entry_id);
    updateTime.run(6_000, e4.entry_id);

    const windowPage = readSessionTranscriptEntries(id, { since: 4_000, until: 7_000, limit: 10 });
    expect(windowPage.total).toBe(2);
    expect(windowPage.hasMore).toBe(false);
    expect(windowPage.entries.map(e => ({ role: e.role, content: e.content }))).toEqual([
      { role: 'user', content: 'Spoken weekly update about Q4 roadmap' },
      { role: 'assistant', content: 'Got it, tracking Q4 roadmap.' },
    ]);

    const paged = readSessionTranscriptEntries(id, { offset: 0, limit: 2 });
    expect(paged.total).toBe(4);
    expect(paged.hasMore).toBe(true);
    expect(paged.entries).toHaveLength(2);
  });
});
