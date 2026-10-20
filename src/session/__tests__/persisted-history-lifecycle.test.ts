import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { performSessionReset } from '../../gateway/session-reset-service.js';
import { isPersonalConversation, personalAgentId } from '../../personal-agent/repository.js';
import { closeXopcDatabase, getXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/connection.js';
import { loadCompactionSourceSnapshot } from '../../storage/sqlite/transcript-repository.js';
import { initSessionTurn } from '../init-session-turn.js';
import { SessionStore } from '../store.js';

const id = '5ab440be-b242-454c-9aeb-ebf7c41c64c5';
const original: AgentMessage[] = Array.from({ length: 3 }, (_, index) => [
  { role: 'user', turnId: `old-${index}`, content: `Question ${index}`, timestamp: index * 2 },
  { role: 'assistant', turnId: `old-${index}`, content: [{ type: 'text', text: `Saved answer ${index}` }], stopReason: 'stop', timestamp: index * 2 + 1 },
]).flat() as AgentMessage[];

describe('persisted reply lifecycle', () => {
  let directory: string;
  let previousStateDir: string | undefined;
  let store: SessionStore;
  const config = ConfigSchema.parse({ session: { reset: { mode: 'daily', atHour: 4 } } });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'xopc-persisted-lifecycle-'));
    previousStateDir = process.env.XOPC_STATE_DIR;
    process.env.XOPC_STATE_DIR = directory;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(directory, 'xopc.db') });
    seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: directory },
      { id: personalAgentId('local-owner'), enabled: true, workspace: directory }] });
    store = new SessionStore({ config });
    await store.saveMessages(id, original, { metadata: { agentId: 'main' } });
  });
  afterEach(async () => {
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    await rm(directory, { recursive: true, force: true });
  });
  const savedEntries = () => getXopcDatabase().db.prepare(`SELECT entry_id,payload_json FROM transcript_entries
    WHERE transcript_id IN (SELECT transcript_id FROM transcripts WHERE conversation_id=?) AND role='assistant' ORDER BY seq`).all(id);
  const replies = async () => (await store.getMessagePage(id, { includeContextRows: true, limit: 200 }))!.session.messages.filter(row => row.role === 'assistant');
  const compact = async () => {
    const snapshot = loadCompactionSourceSnapshot(id)!;
    await store.applyCompaction(id, { compacted: true, summary: 'Summary',
      messages: [{ role: 'user', content: 'Summary', timestamp: 10 }], firstKeptIndex: original.length,
      tokensBefore: 1000, tokensAfter: 10, plannerVersion: 3, summaryModelRef: 'fixture/model', qualityAudit: 'passed',
      handover: { version: 1, sourceThroughSeq: snapshot.lastSeq, items: [] },
      audit: { status: 'passed', mode: 'structural', missingItemsFound: 0, repaired: false } }, snapshot);
  };

  it('keeps committed replies across compaction, session archive, and boundary restoration', async () => {
    const before = savedEntries();
    expect(await replies()).toHaveLength(3);
    await compact();
    expect((await store.loadMessages(id)).filter(row => row.role === 'assistant')).toHaveLength(0);
    expect(await replies()).toHaveLength(3);
    expect(savedEntries()).toEqual(before);
    await store.archive(id);
    expect(await replies()).toHaveLength(3);
    const [boundary] = await store.listCompactionBoundaries(id);
    await store.appendTranscriptMessage(id, { role: 'user', content: 'Later input', timestamp: 20 });
    await store.restoreBeforeCompactionBoundary(id, boundary.id);
    expect(await replies()).toHaveLength(3);
    expect(savedEntries()).toEqual(before);
  });

  it('can return an invisible raw tail while every old reply remains committed to the active transcript', async () => {
    const before = savedEntries();
    for (let index = 0; index < 80; index++) await store.appendTranscriptContextEntry(id, { text: `Diagnostic ${index}` });
    const page = (await store.getMessagePage(id, { includeContextRows: true, limit: 50 }))!;
    expect(page.session.messages).toHaveLength(50);
    expect(page.session.messages.every(row => row.role === 'system')).toBe(true);
    expect(page.pagination).toMatchObject({ total: 86, hasMore: true, nextBeforeCursor: '36' });
    expect(savedEntries()).toEqual(before);
    const older = (await store.getMessagePage(id, { includeContextRows: true, limit: 50, before: '36' }))!;
    expect(older.session.messages.filter(row => row.role === 'assistant')).toHaveLength(3);
  });

  it.each([false, true])('archives only the new failed attempt, including after compaction=%s', async compressed => {
    const before = savedEntries();
    if (compressed) await compact();
    const prefix = await store.loadTranscriptRows(id);
    await store.appendTranscriptMessage(id, { role: 'user', content: 'New input', timestamp: 20 });
    await store.appendTranscriptMessage(id, { role: 'assistant', content: [{ type: 'text', text: 'Partial new answer' }],
      stopReason: 'error', errorMessage: '503', timestamp: 21 } as AgentMessage);
    await expect(store.prepareModelFallback(id, prefix)).resolves.toBe('resume');
    expect(await replies()).toHaveLength(3);
    expect(savedEntries()).toEqual(before);
    expect(JSON.stringify(await store.loadTranscriptRows(id))).toContain('model_attempt_error');
  });

  it('changes the read scope after explicit reset without deleting archived replies', async () => {
    const before = savedEntries();
    const oldTranscriptId = (await store.getMetadata(id))!.transcriptId;
    await store.reset(id);
    await store.appendTranscriptMessage(id, { role: 'user', content: 'After reset', timestamp: 20 });
    expect((await store.getMetadata(id))!.transcriptId).not.toBe(oldTranscriptId);
    expect(await replies()).toHaveLength(0);
    expect(savedEntries()).toEqual(before);
    expect((await store.loadTranscriptHistoryRows(id)).filter(row => 'role' in row && row.role === 'assistant')).toHaveLength(3);
  });

  it('rejects automatic and API resets of a correctly identified Personal conversation', async () => {
    const personalId = personalAgentId('local-owner');
    const personalConversation = '9557e481-d6db-468a-9fa8-1a54fae52ef0';
    await store.saveMessages(personalConversation, original, { metadata: { agentId: personalId, customData: { personalAgent: true } } });
    await store.updateMetadata(personalConversation, { sessionStartedAt: '2020-01-01T00:00:00.000Z' });
    const before = await store.loadTranscriptRows(personalConversation);
    expect(isPersonalConversation(personalConversation)).toBe(true);
    for (const body of ['Continue', '/new']) {
      const turn = await initSessionTurn({ cfg: config, conversationId: personalConversation, body,
        resetSession: key => store.reset(key) });
      expect(turn.resetTriggered || turn.staleRollover).toBe(false);
    }
    expect(await performSessionReset(personalConversation, {} as never)).toMatchObject({ ok: false });
    expect(await store.loadTranscriptRows(personalConversation)).toEqual(before);
  });
});
