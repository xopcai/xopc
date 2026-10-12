import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, upsertKnowledgeSourceItems } from '../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createContextEvidence } from '../../storage/sqlite/context-evidence-repository.js';
import { upsertUnderstandingSourceGrant } from '../../user-context/sources/repository.js';
import { grantUnderstandingConsent, revokeUnderstandingConsent } from '../../user-context/sources/consent-repository.js';
import { canUseKnowledge, deleteKnowledgeItem, searchKnowledgeItems, writeKnowledgeItem } from '../index.js';
import { replaceKnowledgeChunks } from '../../knowledge/chunks.js';
import { reconcileAssertion } from '../../user-model/repository.js';
import { canUseAssertion } from '../../user-model/usage-policy.js';

const context = { agentId: 'main', workspaceId: '/workspace', conversationId: 'session-1' };
const policy = { scopes: ['global', 'workspace'] as const, contentSources: ['memory', 'connector'] as const };
function connected() {
  const grant = upsertUnderstandingSourceGrant({ sourceKey: 'test:gmail', adapterId: 'connector:gmail', category: 'mail',
    platform: 'all', displayName: 'Test mail', accessMode: 'continuous', retentionPolicy: 'bounded_raw',
    processingPolicy: 'remote_allowed', config: { sourceInstanceId: 'gmail:test' } });
  const consent = grantUnderstandingConsent({ grantId: grant.id, purposes: ['work_assistance'], allowedDomains: ['goals'],
    deniedDomains: [], allowedFields: ['title', 'content'], accessMode: 'continuous', lookbackDays: 30, rawRetentionDays: 30,
    processingPolicy: 'remote_allowed', allowedAgentIds: ['main'], disclosureVersion: '1' });
  const source = upsertKnowledgeSourceItems([{ sourceInstanceId: 'gmail:test', collectionScope: 'mail', externalId: '1',
    itemType: 'email', contentHash: 'v1', normalizedText: '鸿蒙应用的相机功能正在开发。' }]).items[0]!;
  const evidence = createContextEvidence({ sourceType: 'connector', sourceInstanceId: source.sourceInstanceId,
    sourceItemId: source.id, sourceRef: `knowledge-source://${source.id}`, contentHash: 'v1', trustLevel: 'untrusted', observedAt: Date.now() });
  const item = writeKnowledgeItem({ kind: 'work_thread', scope: { type: 'global' }, content: '鸿蒙应用的相机功能正在开发。',
    canonicalKey: 'thread:camera', confidence: 0.9, importance: 0.8, originClass: 'untrusted', verification: 'supported',
    claimMode: 'reported', source: { sourceInstanceId: source.sourceInstanceId },
    evidence: [{ id: evidence.id, contentHash: 'v1', consentReceiptId: consent.id }] }).item!;
  return { source, item, grant };
}

describe('evidence-aware knowledge learning and retrieval', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

  it('uses an authorized external report without turning it into owner authority', () => {
    const { item } = connected();
    expect(item).toMatchObject({ status: 'active', originClass: 'untrusted', claimMode: 'reported' });
    expect(searchKnowledgeItems({ query: '相机', context, policy }).map(result => result.id)).toEqual([item.id]);
    expect(searchKnowledgeItems({ query: '相机', context, policy: { ...policy, contentSources: ['memory'] } })).toEqual([]);
    expect(canUseKnowledge(item, { ...context, agentId: 'other' }, policy)).toBe(false);
  });

  it('immediately withholds revoked or changed source evidence', () => {
    const { source, item, grant } = connected();
    upsertKnowledgeSourceItems([{ ...source, contentHash: 'v2', normalizedText: '项目已取消' }]);
    expect(canUseKnowledge(item, context, policy)).toBe(false);
    revokeUnderstandingConsent(grant.id);
    expect(searchKnowledgeItems({ query: '相机', context, policy })).toEqual([]);
  });

  it('finds retained content after the old 8000-character truncation boundary', () => {
    const { source, grant } = connected();
    const updated = upsertKnowledgeSourceItems([{ ...source, contentHash: 'long', normalizedText: 'background '.repeat(1200) + '鸿蒙相机曝光补偿' }]).items[0]!;
    const consent = getSqliteDatabase().prepare('SELECT receipt_id FROM understanding_consent_receipts WHERE grant_id = ?').get(grant.id) as { receipt_id: string };
    replaceKnowledgeChunks(getSqliteDatabase(), { ...updated, consentReceiptId: consent.receipt_id });
    const evidence = createContextEvidence({ sourceType: 'connector', sourceInstanceId: source.sourceInstanceId,
      sourceItemId: updated.id, sourceRef: 'long-source', contentHash: 'long', trustLevel: 'untrusted', observedAt: Date.now() });
    writeKnowledgeItem({ kind: 'workspace_fact', scope: { type: 'workspace', id: '/workspace' }, content: 'background only',
      canonicalKey: 'long-index', recordClass: 'source_index', confidence: 0.8, importance: 0.5, originClass: 'untrusted', status: 'active',
      verification: 'supported', evidence: [{ id: evidence.id, contentHash: 'long', consentReceiptId: consent.receipt_id }],
      source: { sourceItemId: source.id, sourceInstanceId: source.sourceInstanceId, consentReceiptId: consent.receipt_id } });
    expect(searchKnowledgeItems({ query: '曝光补偿', context, policy })[0]?.retrievalSnippet).toContain('鸿蒙相机曝光补偿');
  });

  it('keeps revisions and clears them with deleted memory', () => {
    const input = { kind: 'decision' as const, scope: { type: 'global' as const }, content: 'Use SQLite',
      canonicalKey: 'db', confidence: 1, importance: 1, originClass: 'owner' as const };
    const original = writeKnowledgeItem(input).item!;
    writeKnowledgeItem({ ...input, content: 'Use PostgreSQL', replaceExisting: true });
    expect(getSqliteDatabase().prepare('SELECT content FROM knowledge_revisions WHERE knowledge_id = ?').get(original.id)).toMatchObject({ content: 'Use SQLite' });
    deleteKnowledgeItem(original.id);
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM knowledge_revisions').get()).toMatchObject({ n: 0 });
  });

  it('checks consent and immutable source versions for connector-derived user understanding too', () => {
    const { source, grant } = connected();
    const receipt = getSqliteDatabase().prepare('SELECT receipt_id FROM understanding_consent_receipts WHERE grant_id = ?')
      .get(grant.id) as { receipt_id: string };
    const evidence = createContextEvidence({ sourceType: 'connector', sourceInstanceId: source.sourceInstanceId,
      sourceItemId: source.id, sourceRef: 'assertion-proof', contentHash: 'v1', trustLevel: 'owner', observedAt: Date.now() });
    const assertion = reconcileAssertion({ subject: { type: 'goal', id: 'camera' }, predicate: 'goal.camera.current_state',
      cardinality: 'single', scope: { type: 'global' }, kind: 'current_state', value: 'developing', normalizedValue: 'developing',
      statement: '相机项目正在开发。', authority: 'user_observed', confidence: 0.9, inferredImportance: 0.8,
      consequence: 'low', actionability: 0.8, volatility: 'event', sensitivity: 'normal', domain: 'goals',
      disclosurePolicy: 'referenceable', observedAt: Date.now(), createdBy: 'connector', consentReceiptId: receipt.receipt_id,
      validTo: Date.now() + 30 * 86_400_000,
      purposeIds: ['work_assistance'], allowedAgentIds: ['main'],
      evidenceId: evidence.id }).assertion!;
    expect(canUseAssertion(assertion, Date.now(), { agentId: 'main', use: 'answer' })).toBe(true);
    createContextEvidence({ sourceType: 'connector', sourceInstanceId: source.sourceInstanceId,
      sourceItemId: source.id, sourceRef: 'assertion-proof', contentHash: 'v2', trustLevel: 'owner', observedAt: Date.now() });
    expect(canUseAssertion(assertion, Date.now(), { agentId: 'main', use: 'answer' })).toBe(false);
    revokeUnderstandingConsent(grant.id);
    expect(canUseAssertion(assertion, Date.now(), { agentId: 'main', use: 'answer' })).toBe(false);
  });
});
