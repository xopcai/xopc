import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { claimLearningJob, enqueueConversationLearning } from '../repository.js';
import { writeKnowledgeItem, listKnowledgeItems } from '../../knowledge-memory/index.js';
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

});
