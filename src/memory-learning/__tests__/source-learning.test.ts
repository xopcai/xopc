import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { ConnectedKnowledgePipeline } from '../../knowledge/connected-knowledge-pipeline.js';
import { canUseKnowledge, listKnowledgeItems } from '../../knowledge-memory/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertKnowledgeSourceItems } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { grantUnderstandingConsent, revokeUnderstandingConsent } from '../../user-context/sources/consent-repository.js';
import { upsertUnderstandingSourceGrant } from '../../user-context/sources/repository.js';
import { recoverSourceLearning, runSourceLearning } from '../source-learning.js';

const modelCall = vi.hoisted(() => vi.fn());
const endpoint = vi.hoisted(() => ({ value: 'http://localhost:1234' }));
vi.mock('../../providers/index.js', () => ({ getDefaultModelSync: () => 'test/model',
  resolveModel: () => ({ provider: 'ollama', id: 'model', baseUrl: endpoint.value }) }));
vi.mock('../../providers/model-call.js', () => ({ completeWithResolvedCredentials: modelCall }));
const config = ConfigSchema.parse({});

async function seed() {
  const grant = upsertUnderstandingSourceGrant({ sourceKey: 'local-folder:test', adapterId: 'connector:local-files', category: 'files',
    platform: 'all', displayName: 'Files', accessMode: 'continuous', retentionPolicy: 'bounded_raw', processingPolicy: 'local_only',
    config: { sourceInstanceId: 'local-folder:test' } });
  grantUnderstandingConsent({ grantId: grant.id, purposes: ['work_assistance'], allowedDomains: ['goals'], deniedDomains: [],
    allowedFields: ['content'], accessMode: 'continuous', lookbackDays: 0, rawRetentionDays: 365,
    processingPolicy: 'local_only', allowedAgentIds: ['main'], disclosureVersion: '1' });
  upsertKnowledgeSourceItems([{ sourceInstanceId: 'local-folder:test', collectionScope: 'files', externalId: 'decision.md',
    itemType: 'connected_content', synthesisPipeline: 'connected_knowledge', contentHash: 'v1',
    normalizedText: JSON.stringify({ content: 'Atlas uses SQLite to stay local.', from: 'PRIVATE-SENDER' }) }]);
  await new ConnectedKnowledgePipeline({ agentId: 'main', workspaceId: '/workspace' }).processPending();
  recoverSourceLearning(config);
  return grant;
}

describe('authorized source work learning', () => {
  beforeEach(() => {
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog(); endpoint.value = 'http://localhost:1234';
    modelCall.mockReset().mockImplementation(async (_model, context) => {
      const input = JSON.parse(context.messages[0].content);
      return { stopReason: 'stop', content: [{ type: 'text', text: JSON.stringify({ knowledge: [{ kind: 'decision', topicKey: 'atlas',
        predicate: 'storage.choice', statement: 'Atlas uses SQLite to stay local.', scope: 'workspace', confidence: 0.9, importance: 0.8,
        evidence: [{ ref: input.ref, quote: 'Atlas uses SQLite to stay local.' }] }] }) }] };
    });
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

  it('learns reported work knowledge from consent-filtered chunks and deduplicates completed jobs', async () => {
    await seed();
    expect(await runSourceLearning(() => config)).toBe(true);
    expect(modelCall.mock.calls[0]![1].messages[0].content).not.toContain('PRIVATE-SENDER');
    const memory = listKnowledgeItems({ recordClass: 'memory' })[0]!;
    expect(memory).toMatchObject({ status: 'active', originClass: 'untrusted', claimMode: 'reported', scope: { type: 'workspace', id: '/workspace' } });
    expect(canUseKnowledge(memory, { agentId: 'main', workspaceId: '/workspace', conversationId: '' },
      { scopes: ['workspace'], contentSources: ['memory', 'local_import'] })).toBe(true);
    recoverSourceLearning(config);
    expect(await runSourceLearning(() => config)).toBe(false);
  });

  it('never sends local-only source data to a remote endpoint even for an ollama provider', async () => {
    await seed(); endpoint.value = 'https://models.example.com';
    await runSourceLearning(() => config);
    expect(modelCall).not.toHaveBeenCalled();
    expect(getSqliteDatabase().prepare('SELECT state, error_code FROM memory_source_learning_jobs').get())
      .toMatchObject({ state: 'canceled', error_code: 'local_model_required' });
  });

  it('rechecks authorization after model processing and writes nothing when revoked', async () => {
    const grant = await seed();
    const original = modelCall.getMockImplementation()!;
    modelCall.mockImplementation(async (...args) => { const result = await original(...args); revokeUnderstandingConsent(grant.id); return result; });
    await runSourceLearning(() => config);
    expect(listKnowledgeItems({ recordClass: 'memory' })).toEqual([]);
    expect(getSqliteDatabase().prepare('SELECT state FROM memory_source_learning_jobs').get()).toMatchObject({ state: 'canceled' });
  });

  it('withholds old learned knowledge and invalidates queued chunks on source version changes', async () => {
    await seed(); await runSourceLearning(() => config);
    const memory = listKnowledgeItems({ recordClass: 'memory' })[0]!;
    upsertKnowledgeSourceItems([{ sourceInstanceId: 'local-folder:test', collectionScope: 'files', externalId: 'decision.md',
      itemType: 'local_file', contentHash: 'v2', normalizedText: 'Atlas uses PostgreSQL.' }]);
    expect(canUseKnowledge(memory, { agentId: 'main', workspaceId: '/workspace', conversationId: '' })).toBe(false);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM knowledge_source_chunks').get()).toEqual({ n: 0 });
  });
});
