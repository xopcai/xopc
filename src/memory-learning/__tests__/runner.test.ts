import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { claimLearningJob, enqueueConversationLearning } from '../repository.js';
import { runPersistentLearningJob } from '../../agent/background-review/run-background-review.js';

const prompt = vi.hoisted(() => vi.fn());
vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: class {
  state: Record<string, unknown>;
  constructor(options: { initialState: Record<string, unknown> }) { this.state = { messages: [], ...options.initialState }; }
  async prompt(input: unknown) {
    await prompt(input);
    const messages = this.state.messages as Array<{ content: string }>;
    const ref = /\[evidence_ref:([^\]]+)\]/.exec(messages[0]!.content)![1];
    this.state.messages = [...messages, { role: 'assistant', stopReason: 'stop', content: JSON.stringify({
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
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog(); prompt.mockClear(); });
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
});
