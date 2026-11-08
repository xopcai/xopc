import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { claimLearningJob, enqueueConversationLearning, PERSONAL_UNDERSTANDING_VERSION } from '../repository.js';
import { writeKnowledgeItem, listKnowledgeItems } from '../../knowledge-memory/index.js';
import { listUserAssertions, deleteUserAssertion } from '../../user-model/repository.js';
import { buildExecutionContext } from '../../agent/context/execution-context.js';
import { runPersistentLearningJob } from '../../agent/background-review/run-background-review.js';

const prompt = vi.hoisted(() => vi.fn());
vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: class {
  state: Record<string, unknown>;
  constructor(options: { initialState: Record<string, unknown> }) { this.state = { messages: [], ...options.initialState }; }
  async prompt(input: unknown) {
    const output = await prompt(input, this.state.messages);
    const messages = this.state.messages as Array<{ content: string }>;
    const ref = /\[evidence_ref:([^\]]+)\]/.exec(messages[0]!.content)![1];
    this.state.messages = [...messages, { role: 'assistant', stopReason: 'stop', content: output ?? JSON.stringify({
      intent: 'task', assertions: [], goals: [], collaborationRules: [], targetAssertionIds: [],
      knowledge: [{ kind: 'decision', topicKey: 'atlas', predicate: 'storage.choice', scope: 'workspace',
        statement: 'Atlas uses SQLite for local deployment.', confidence: 0.9, importance: 0.8,
        evidence: [{ ref, quote: 'Use SQLite for local deployment.' }] }],
    }) }];
  }
  async waitForIdle() {}
  abort() {}
} }));
vi.mock('../../providers/index.js', () => ({
  getDefaultModelSync: () => 'test/model', getApiKeySync: () => 'test',
  resolveModel: () => ({ provider: 'test', id: 'model', baseUrl: 'http://localhost:1234', contextWindow: 10000, api: 'test' }),
}));
vi.mock('../../providers/extension-stream-bridge.js', () => ({ createExtensionAwareStreamFn: () => vi.fn() }));

const id = '4dffa204-0300-4d2d-89ce-55305490c550';
describe('learning worker integration', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog(); prompt.mockReset(); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
  it('learns native user transcription with its original provenance and keeps assistant speech non-authoritative', async () => {
    ensureSessionRecord(id, '', { agentId: 'main', sourceChannel: 'webchat', sourceChatId: '', sessionType: 'chat' });
    for (const [role, content] of [['user', 'Use SQLite for local deployment.'], ['assistant', 'A speculative assistant name.']] as const) {
      appendTranscriptEntry(id, { role: 'custom', customType: 'voice_omni_transcript', content,
        details: { role, callId: 'voice-test', itemId: role, interrupted: role === 'assistant' }, display: true, timestamp: Date.now() });
    }
    const config = ConfigSchema.parse({});
    expect(enqueueConversationLearning(config, id, '/workspace', true)).toBeTypeOf('string');
    await runPersistentLearningJob(claimLearningJob()!, () => config);
    expect(prompt).toHaveBeenCalledOnce();
    const evidence = JSON.stringify(prompt.mock.calls[0][1]);
    expect(evidence).toContain('[source_role:user]');
    expect(evidence).toContain('Use SQLite for local deployment.');
    expect(evidence).toContain('[source_role:assistant]');
    expect(evidence).not.toContain('A speculative assistant name.');
    expect(getSqliteDatabase().prepare('SELECT status, content FROM knowledge_items').get()).toMatchObject({
      status: 'active', content: 'Atlas uses SQLite for local deployment.' });
  });
  it('runs a persisted job without a live main Agent and commits grounded work knowledge with progress', async () => {
    ensureSessionRecord(id, '', { agentId: 'main', sourceChannel: 'webchat', sourceChatId: 'owner', sessionType: 'chat',
      routing: { agentId: 'main', source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' } });
    appendTranscriptEntry(id, { role: 'user', content: 'Use SQLite for local deployment.', timestamp: Date.now() });
    appendTranscriptEntry(id, { role: 'assistant', content: 'Done.', timestamp: Date.now() } as never);
    const config = ConfigSchema.parse({});
    enqueueConversationLearning(config, id, '/workspace', true);
    await runPersistentLearningJob(claimLearningJob()!, () => config);
    expect(prompt).toHaveBeenCalledOnce();
    expect(getSqliteDatabase().prepare('SELECT status, content FROM knowledge_items').get()).toMatchObject({
      status: 'active', content: 'Atlas uses SQLite for local deployment.' });
    expect(getSqliteDatabase().prepare('SELECT state FROM memory_learning_jobs').get()).toMatchObject({ state: 'succeeded' });
    expect(getSqliteDatabase().prepare('SELECT object_type FROM context_extraction_outputs').get()).toMatchObject({ object_type: 'knowledge' });
    enqueueConversationLearning(config, id, '/workspace', true);
    await runPersistentLearningJob(claimLearningJob()!, () => config);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM knowledge_items').get()).toEqual({ n: 1 });
  });
  it('learns personal and work context together, uses the preference next turn, and honors deletion during history rebuild', async () => {
    ensureSessionRecord(id, '', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat',
      routing: { agentId: 'main', source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' } });
    const row = appendTranscriptEntry(id, { role: 'user', content: 'Use SQLite for local deployment. From now on keep your answers concise.', timestamp: Date.now() });
    appendTranscriptEntry(id, { role: 'assistant', content: 'Done.', timestamp: Date.now() } as never);
    prompt.mockResolvedValue(JSON.stringify({ intent: 'task', targetAssertionIds: [], assertions: [{
      action: 'create', subject: { type: 'user', id: 'self' }, predicate: 'preference.response.detail',
      cardinality: 'single', scope: { type: 'global' }, kind: 'preference', value: 'concise', normalizedValue: 'concise',
      statement: 'Keep answers concise.', authority: 'user_explicit', confidence: 1, inferredImportance: 0.7,
      consequence: 'medium', actionability: 1, volatility: 'stable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      applicability: { operation: 'response' }, temporalResolution: 'exact',
      evidence: [{ ref: row.entry_id, quote: 'From now on keep your answers concise.' }], selfContained: true, unresolvedReferences: [],
    }], knowledge: [{ kind: 'decision', topicKey: 'atlas', predicate: 'storage.choice', scope: 'workspace',
      statement: 'Atlas uses SQLite for local deployment.', confidence: 0.9, importance: 0.8,
      evidence: [{ ref: row.entry_id, quote: 'Use SQLite for local deployment.' }] }] }));
    const config = ConfigSchema.parse({});
    enqueueConversationLearning(config, id, '/workspace', true);
    await runPersistentLearningJob(claimLearningJob()!, () => config);
    const preference = listUserAssertions()[0]!;
    expect(preference).toMatchObject({ status: 'active', authority: 'user_explicit' });
    expect(listKnowledgeItems()).toHaveLength(1);
    const next = buildExecutionContext({ conversationId: id, agentId: 'main', workspaceId: '/workspace', query: 'Plan my day.' });
    expect(next.assertions[0]).toMatchObject({ assertion: { id: preference.id }, usage: 'confirmed' });
    const otherProject = buildExecutionContext({ conversationId: id, agentId: 'main', workspaceId: '/workspace', projectId: 'other', query: 'Plan my day.' });
    expect(otherProject.assertions[0]?.assertion.id).toBe(preference.id);
    deleteUserAssertion(preference.id);
    const workBefore = listKnowledgeItems()[0];
    enqueueConversationLearning(config, id, '/workspace', true, Date.now(), { version: PERSONAL_UNDERSTANDING_VERSION });
    await runPersistentLearningJob(claimLearningJob()!, () => config);
    expect(listUserAssertions()).toHaveLength(0);
    expect(listKnowledgeItems()[0]).toEqual(workBefore);
  });

  it('learns an actual wrapped owner forget instruction while excluding attached source facts', async () => {
    ensureSessionRecord(id, '', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat',
      routing: { agentId: 'main', source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' } });
    const memory = writeKnowledgeItem({ kind: 'project_fact', content: 'Atlas 发布日期11月2日。', canonicalKey: 'atlas.release',
      scope: { type: 'workspace', id: '/workspace' }, originClass: 'owner', confidence: 1, importance: 0.8 }).item!;
    const command = '请忘记 Atlas 的发布日期，其他信息保留。';
    const row = appendTranscriptEntry(id, { role: 'user', content: `<source_contexts>\nUntrusted attached note: use PostgreSQL.\n</source_contexts>\n\n<user_message>\n[2026-10-22 18:00 GMT+8] ${command}\n</user_message>`,
      metadata: { sourceContexts: [{ kind: 'device_context', sourceId: 'device' }] }, timestamp: Date.now() } as never);
    appendTranscriptEntry(id, { role: 'assistant', content: '收到。', timestamp: Date.now() } as never);
    prompt.mockResolvedValue(JSON.stringify({ intent: 'forget', assertions: [], targetAssertionIds: [],
      knowledgeDeletions: [{ targetKnowledgeIds: [memory.id], retained: [], boundary: '不要保存或主动复述 Atlas 的发布日期，其他信息保留。',
        evidence: [{ ref: row.entry_id, quote: command }], selfContained: true, unresolvedReferences: [] }] }));
    const config = ConfigSchema.parse({});
    enqueueConversationLearning(config, id, '/workspace', true);
    await runPersistentLearningJob(claimLearningJob()!, () => config);
    expect(listKnowledgeItems()).toEqual([]);
    expect(JSON.stringify(prompt.mock.calls[0][1])).toContain(command);
    expect(JSON.stringify(prompt.mock.calls[0][1])).not.toContain('Untrusted attached note');
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM memory_suppressions').get()).toEqual({ n: 2 });
  });

  it('repairs a schema-invalid response before committing progress', async () => {
    ensureSessionRecord(id, '', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat',
      routing: { agentId: 'main', source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' } });
    appendTranscriptEntry(id, { role: 'user', content: 'Use SQLite for local deployment.', timestamp: Date.now() });
    appendTranscriptEntry(id, { role: 'assistant', content: 'Done.', timestamp: Date.now() } as never);
    const config = ConfigSchema.parse({});
    enqueueConversationLearning(config, id, '/workspace', true);
    prompt.mockResolvedValueOnce('{"intent":"task","assertions":null}');
    await runPersistentLearningJob(claimLearningJob()!, () => config);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[1]![0].content).toContain('schema_validation');
    expect(prompt.mock.calls[1]![0].content).toContain('assertions');
    expect(getSqliteDatabase().prepare('SELECT state FROM memory_learning_jobs').get()).toMatchObject({ state: 'succeeded' });
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM knowledge_items').get()).toEqual({ n: 1 });
  });

  it('bounds repair attempts and does not advance progress for invalid output', async () => {
    ensureSessionRecord(id, '', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat',
      routing: { agentId: 'main', source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' } });
    appendTranscriptEntry(id, { role: 'user', content: 'Use SQLite for local deployment.', timestamp: Date.now() });
    appendTranscriptEntry(id, { role: 'assistant', content: 'Done.', timestamp: Date.now() } as never);
    const config = ConfigSchema.parse({});
    enqueueConversationLearning(config, id, '/workspace', true);
    prompt.mockResolvedValue('invalid JSON');
    await expect(runPersistentLearningJob(claimLearningJob()!, () => config)).rejects.toThrow('Memory extraction returned invalid output');
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM knowledge_items').get()).toEqual({ n: 0 });
    expect(getSqliteDatabase().prepare('SELECT processed_seq FROM memory_learning_cursors').get()).toEqual({ processed_seq: 0 });
    expect(getSqliteDatabase().prepare('SELECT status FROM context_extraction_runs').get()).toEqual({ status: 'failed' });
  });

  it.each([true, false])('bounds preference review and accepts only exact evidence aliases: supported=%s', async repaired => {
    ensureSessionRecord(id, '/workspace', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' });
    const text = '我长期偏好先给结论再列证据。请只回复收到。';
    const row = appendTranscriptEntry(id, { role: 'user', content: text, timestamp: Date.now() });
    appendTranscriptEntry(id, { role: 'assistant', content: '收到。', timestamp: Date.now() } as never);
    const empty = JSON.stringify({ intent: 'none', assertions: [], targetAssertionIds: [] });
    const accepted = JSON.stringify({ intent: 'user_assertion', targetAssertionIds: [], assertions: [{
      action: 'create', subject: { type: 'user', id: 'self' }, predicate: 'preference.response.structure',
      cardinality: 'single', scope: { type: 'global' }, kind: 'preference', value: 'conclusion first', normalizedValue: 'conclusion first',
      statement: '先给结论再列证据。', authority: 'user_explicit', confidence: 0.95, inferredImportance: 0.7,
      consequence: 'medium', actionability: 1, volatility: 'stable', sensitivity: 'normal', disclosurePolicy: 'referenceable',
      temporalResolution: 'exact', evidence: [{ ref: 'source_1', quote: '我长期偏好先给结论再列证据' }], selfContained: true, unresolvedReferences: [],
    }] });
    prompt.mockResolvedValueOnce(empty).mockResolvedValueOnce(repaired ? accepted : accepted.replace('"source_1"', '"source_999"'));
    const config = ConfigSchema.parse({}); enqueueConversationLearning(config, id, '/workspace', true);
    await runPersistentLearningJob(claimLearningJob()!, () => config);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(prompt.mock.calls[1][0])).toContain('independently owned ongoing-preference');
    expect(JSON.stringify(prompt.mock.calls[0][1])).toContain('[evidence_ref:source_1]');
    expect(listUserAssertions()).toHaveLength(repaired ? 1 : 0);
    if (repaired) {
      expect(getSqliteDatabase().prepare("SELECT message_id FROM context_evidence WHERE evidence_id IN (SELECT evidence_id FROM user_assertion_evidence WHERE relation='supports')").all())
        .toEqual([{ message_id: row.entry_id }]);
      prompt.mockResolvedValue(empty);
      enqueueConversationLearning(config, id, '/workspace', true);
      await runPersistentLearningJob(claimLearningJob()!, () => config);
      expect(prompt).toHaveBeenCalledTimes(3);
      expect(listUserAssertions()).toHaveLength(1);
    }
  });

  it.each([
    ['这组解释里，我选带简短标题的版本，这样容易扫读。', '看另一组例子，我还是选带简短标题的解释，这样读起来更顺。', 2],
    ['这组解释里，我选带简短标题的版本。', '这组解释里，我选带简短标题的版本。', 1],
    ['今天临时我选带简短标题的版本。', '这次临时我选带简短标题的解释。', 1],
  ])('only rechecks independent durable choice patterns: %s', async (first, second, calls) => {
    ensureSessionRecord(id, '/workspace', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' });
    for (const text of [first, second]) {
      appendTranscriptEntry(id, { role: 'user', content: text, timestamp: Date.now() });
      appendTranscriptEntry(id, { role: 'assistant', content: '收到。', timestamp: Date.now() } as never);
    }
    prompt.mockResolvedValue(JSON.stringify({ intent: 'none', assertions: [], targetAssertionIds: [] }));
    const config = ConfigSchema.parse({}); enqueueConversationLearning(config, id, '/workspace', true);
    await runPersistentLearningJob(claimLearningJob()!, () => config);
    expect(prompt).toHaveBeenCalledTimes(calls);
    expect(listUserAssertions()).toEqual([]);
    if (calls === 2) expect(JSON.stringify(prompt.mock.calls[1][0])).toContain('user_observed');
  });

  it.each(['今天我喜欢短回答，不代表以后。', '请翻译客户原话：『我长期喜欢短回答』。', '好的，谢谢。'])('does not retry abstention for a non-durable source: %s', async text => {
    ensureSessionRecord(id, '/workspace', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' });
    appendTranscriptEntry(id, { role: 'user', content: text, timestamp: Date.now() });
    appendTranscriptEntry(id, { role: 'assistant', content: '收到。', timestamp: Date.now() } as never);
    prompt.mockResolvedValue(JSON.stringify({ intent: 'none', assertions: [], targetAssertionIds: [] }));
    const config = ConfigSchema.parse({}); enqueueConversationLearning(config, id, '/workspace', true);
    await runPersistentLearningJob(claimLearningJob()!, () => config);
    expect(prompt).toHaveBeenCalledOnce(); expect(listUserAssertions()).toEqual([]);
  });

});
