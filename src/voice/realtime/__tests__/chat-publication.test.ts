import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../../config/schema.js';
import { learningTranscriptMessage } from '../../../memory-learning/transcript-source.js';
import { transcriptRowsToClientHistory } from '../../../session/client-history.js';
import { buildSessionContextForLlm, buildSessionDisplayMessages } from '../../../session/session-context-for-llm.js';
import { storedRowsToFileEntries } from '../../../session/stored-rows-to-file-entries.js';
import { SessionStore } from '../../../session/store.js';
import { appendTranscriptEntry, claimNextSessionInput, closeXopcDatabase, ensureSessionRecord, insertSessionInput,
  loadTranscriptRowsForSession, openXopcDatabase, resetSessionRecord, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { publishVoiceChatMessage } from '../chat-publication.js';
import { buildVoiceResumeHistory } from '../conversation-context.js';

const conversationId = '7db85af2-aae9-4fa8-9d37-5ff5b8898f0a';
let transcriptId: string;
let store: SessionStore;
beforeEach(() => {
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog();
  transcriptId = ensureSessionRecord(conversationId, '/tmp', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' }).transcriptId!;
  store = new SessionStore({ config: ConfigSchema.parse({}) });
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

describe('continuous voice Chat boundary', () => {
  it('restores private voice exchanges through a fresh store without depending on visible Chat', async () => {
    for (const [role, content] of [['user', '周四去杭州，预算三千。'], ['assistant', '方案先保留，不订票。']]) {
      await store.appendTranscriptCustomMessageEntry(conversationId, { expectedTranscriptId: transcriptId,
        customType: 'voice_omni_transcript', content, display: false, details: { role, callId: 'previous-call' } });
    }
    const reopenedStore = new SessionStore({ config: ConfigSchema.parse({}) });
    const restored = buildVoiceResumeHistory(await reopenedStore.loadMessages(conversationId));
    expect(restored).toContain('周四去杭州，预算三千');
    expect(restored).toContain('不订票');
    expect(transcriptRowsToClientHistory(await reopenedStore.loadTranscriptRows(conversationId))).toEqual([]);
    resetSessionRecord(conversationId, '/tmp');
    expect(buildVoiceResumeHistory(await reopenedStore.loadMessages(conversationId))).toBe('');
  });
  it('retains hidden speech for context and learning while showing only useful assistant content', async () => {
    const speech = { role: 'custom' as const, customType: 'voice_omni_transcript', content: '以后叫我小林。',
      display: false, timestamp: 100, details: { role: 'user', callId: 'call', itemId: 'speech' } };
    appendTranscriptEntry(conversationId, speech);
    appendTranscriptEntry(conversationId, { ...speech, content: '好的。', details: { ...speech.details, role: 'assistant' } });
    expect(transcriptRowsToClientHistory(loadTranscriptRowsForSession(conversationId))).toEqual([]);
    expect(JSON.stringify(buildSessionContextForLlm(loadTranscriptRowsForSession(conversationId)))).toContain('小林');
    expect(learningTranscriptMessage({ role: 'custom', payload_json: JSON.stringify(speech) })?.role).toBe('user');
    await publishVoiceChatMessage(store, conversationId, transcriptId, { text: '方案整理好了：先完成接口，再验证发布流程。',
      publicationId: 'content:call:turn', source: 'conversation', callId: 'call' });
    const rows = loadTranscriptRowsForSession(conversationId);
    const visible = transcriptRowsToClientHistory(rows);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ role: 'assistant', content: '方案整理好了：先完成接口，再验证发布流程。' });
    const page = await store.getMessagePage(conversationId, { includeContextRows: true, limit: 1 });
    expect(page?.pagination.total).toBe(1);
    expect(page?.session.messages).toHaveLength(1);
    expect(buildSessionDisplayMessages(rows).map(message => message.role)).toEqual(['assistant']);
    const context = buildSessionContextForLlm(rows);
    expect(context.at(-1)?.role).toBe('assistant');
    const hydrated = storedRowsToFileEntries({ transcriptId, cwd: '/tmp', rows });
    expect(hydrated.filter(row => row.type === 'message').at(-1)).toMatchObject({ message: { role: 'assistant' } });
    expect(learningTranscriptMessage({ role: 'custom', payload_json: JSON.stringify(rows.at(-1)) })).toBeUndefined();
  });

  it('publishes once across retries and rejects a late result after conversation reset', async () => {
    const publication = { text: '查询完成，找到三项结论。', publicationId: 'task:run', source: 'agent_result' as const };
    await Promise.all([publishVoiceChatMessage(store, conversationId, transcriptId, publication),
      publishVoiceChatMessage(store, conversationId, transcriptId, publication)]);
    expect(loadTranscriptRowsForSession(conversationId)).toHaveLength(1);
    resetSessionRecord(conversationId, '/tmp');
    await expect(publishVoiceChatMessage(store, conversationId, transcriptId, publication)).rejects.toThrow(/changed/);
    expect(loadTranscriptRowsForSession(conversationId)).toEqual([]);
  });

  it('hides voice execution chatter but retains ordinary typed Chat', () => {
    insertSessionInput({ id: 'voice-input', conversationId, clientMessageId: 'voice-action:call:tool',
      expectedTranscriptId: transcriptId, requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued',
      content: 'Query the project', origin: { type: 'channel', channel: 'voice' } });
    claimNextSessionInput(conversationId, 'voice-run');
    appendTranscriptEntry(conversationId, { role: 'user', content: 'Query the project', timestamp: 10, turnId: 'voice-run' } as never);
    appendTranscriptEntry(conversationId, { role: 'assistant', content: 'I will search now.', timestamp: 11, turnId: 'voice-run' } as never);
    appendTranscriptEntry(conversationId, { role: 'user', content: 'Please add the source links.', timestamp: 12 } as never);
    const rows = loadTranscriptRowsForSession(conversationId);
    expect(transcriptRowsToClientHistory(rows).map(message => message.content)).toEqual(['Please add the source links.']);
    expect(JSON.stringify(buildSessionContextForLlm(rows))).toContain('Query the project');
  });
});
