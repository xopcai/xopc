import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { deleteKnowledgeItem, getKnowledgeItem } from '../../knowledge-memory/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { createCollaborationRule } from '../../storage/sqlite/collaboration-rule-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import { applyWorkCandidates } from '../work-capture.js';
import { WorkCandidateSchema } from '../work-candidate.js';
import { prepareWorkReview, applyWorkReviews, workReviewTrigger, type WorkReview } from '../work-review.js';

const id = '4dffa204-0300-4d2d-89ce-55305490c550';
const context = { conversationId: id, agentId: 'main', workspaceId: '/workspace' };
const policy = { scopes: ['workspace' as const], contentSources: ['memory' as const] };
const original = 'Atlas timeout is 30 seconds only in staging; production stays at 5 seconds.';
const fresh = [{ ref: 'fresh', role: 'user' as const, text: 'Correction: review the Atlas timeout summary.', createdAt: Date.now() + 1000 }];

function seed() {
  ensureSessionRecord(id, '/workspace', { agentId: 'main', sourceChannel: 'webchat', sessionType: 'chat' });
  const row = appendTranscriptEntry(id, { role: 'user', content: original, timestamp: Date.now() });
  const evidence = [{ ref: row.entry_id, role: 'user' as const, text: original, createdAt: row.created_at }];
  const result = applyWorkCandidates({ candidates: [{ kind: 'project_fact', topicKey: 'atlas', predicate: 'timeout.value', scope: 'workspace',
    statement: 'Atlas timeout is 30 seconds.', confidence: 0.9, importance: 0.8, evidence: [{ ref: row.entry_id, quote: original }] }],
    evidence, ...context, processingPolicy: 'remote_allowed', runId: 'seed' })[0];
  const item = getKnowledgeItem(result.objectId!)!;
  const plan = prepareWorkReview({ context, policy, processingPolicy: 'remote_allowed', evidence: fresh });
  const operation: WorkReview = { targetId: item.id, action: 'revise', reason: 'qualifier_lost', replacement: original,
    evidence: [{ ref: row.entry_id, quote: original }] };
  return { item, plan, operation, row };
}

describe('evidence-based work memory review', () => {
  beforeEach(() => { resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog(); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

  it('restores qualifiers from complete original rows and records a revision, then rejects replay', () => {
    const { item, plan, operation } = seed();
    expect(plan.targets).toHaveLength(1);
    expect(runSqliteWriteTransaction(() => applyWorkReviews(plan, [operation], fresh, 'review'))[0].reasonCode).toBe('review_revised');
    expect(getKnowledgeItem(item.id)?.content).toBe(original);
    expect(getSqliteDatabase().prepare('SELECT content FROM knowledge_revisions WHERE knowledge_id = ?').get(item.id))
      .toMatchObject({ content: item.content });
    expect(applyWorkReviews(plan, [operation], fresh, 'replay')[0].outcome).toBe('rejected');
  });

  it.each(['owner', 'project', 'local_only', 'changed_source', 'deleted'] as const)('excludes %s targets before model access', variant => {
    const { item } = seed(); const db = getSqliteDatabase();
    if (variant === 'owner') db.prepare("UPDATE knowledge_items SET origin_class='owner' WHERE knowledge_id=?").run(item.id);
    if (variant === 'project') db.prepare("UPDATE knowledge_items SET scope_type='project',scope_id='other' WHERE knowledge_id=?").run(item.id);
    if (variant === 'local_only') db.prepare("UPDATE context_evidence SET processing_policy='local_only'").run();
    if (variant === 'changed_source') db.prepare("UPDATE transcript_entries SET payload_json=json_set(payload_json,'$.content','Changed source')").run();
    if (variant === 'deleted') deleteKnowledgeItem(item.id);
    expect(prepareWorkReview({ context, policy, processingPolicy: 'remote_allowed', evidence: fresh }).targets).toHaveLength(0);
  });

  it.each(['memory_changed', 'deleted', 'source_changed'] as const)('rejects %s during model execution', variant => {
    const { item, plan, operation } = seed(); const db = getSqliteDatabase();
    if (variant === 'memory_changed') db.prepare("UPDATE knowledge_items SET content='Owner correction' WHERE knowledge_id=?").run(item.id);
    if (variant === 'deleted') deleteKnowledgeItem(item.id);
    if (variant === 'source_changed') db.prepare("UPDATE transcript_entries SET payload_json=json_set(payload_json,'$.content','Changed source')").run();
    expect(applyWorkReviews(plan, [operation], fresh, 'review')[0].outcome).toBe('rejected');
  });

  it('rejects invented quotes, synthesized replacements, and unsupported new facts', () => {
    const { plan, operation } = seed();
    for (const invalid of [
      { ...operation, evidence: [{ ref: 'invented', quote: original }] },
      { ...operation, replacement: 'Atlas timeout is always 30 seconds.' },
      { ...operation, replacement: 'Atlas timeout is 30 seconds', evidence: [{ ref: operation.evidence[0].ref, quote: 'Atlas timeout is 30 seconds' }] },
      { ...operation, reason: 'contradicted' as const },
    ]) expect(applyWorkReviews(plan, [invalid], fresh, 'review')[0].outcome).toBe('rejected');
  });

  it.each([0, 1000])('uses source order despite same-millisecond or delayed memory writes: delay=%s', delay => {
    const { item, plan } = seed();
    const text = 'Correction: Atlas timeout is now 45 seconds only in staging.';
    const row = appendTranscriptEntry(id, { role: 'user', content: text, timestamp: Date.now() });
    getSqliteDatabase().prepare('UPDATE knowledge_items SET created_at=? WHERE knowledge_id=?').run(row.created_at + delay, item.id);
    plan.targets[0].item = getKnowledgeItem(item.id)!;
    const evidence = [{ ref: row.entry_id, role: 'user' as const, text, createdAt: row.created_at }];
    const op: WorkReview = { targetId: item.id, action: 'revise', reason: 'contradicted', replacement: text.replace('Correction: ', ''),
      evidence: [{ ref: row.entry_id, quote: text }] };
    expect(applyWorkReviews(plan, [op], evidence, 'review')[0].reasonCode).toBe('review_revised');
    expect(getKnowledgeItem(item.id)?.content).toBe(text);
    const next = prepareWorkReview({ context, policy, processingPolicy: 'remote_allowed', evidence });
    getSqliteDatabase().prepare("UPDATE transcript_entries SET payload_json=json_set(payload_json,'$.content','Changed fresh source') WHERE entry_id=?").run(row.entry_id);
    expect(applyWorkReviews(next, [{ ...op, action: 'withhold' }], evidence, 'stale')[0].outcome).toBe('rejected');
  });

  it('keeps correct memory without rewriting it or adding revisions', () => {
    const { item, plan, operation } = seed();
    expect(applyWorkReviews(plan, [{ ...operation, action: 'keep', reason: 'still_supported', replacement: undefined }], fresh, 'review')[0].reasonCode)
      .toBe('review_still_supported');
    expect(getKnowledgeItem(item.id)).toEqual(item);
    expect(getSqliteDatabase().prepare('SELECT count(*) AS n FROM knowledge_revisions').get()).toEqual({ n: 0 });
  });

  it('does not trigger on assistant claims or third-party correction instructions', () => {
    expect(workReviewTrigger([{ ...fresh[0], role: 'assistant' }])).toBe('');
    expect(workReviewTrigger([{ ...fresh[0], text: '> Correction: Atlas timeout is 90 seconds.' }])).toBe('');
    expect(workReviewTrigger([{ ...fresh[0], text: 'Please analyze this quotation.\n> Correction: Atlas timeout is 90 seconds.' }])).toBe('');
  });

  it('uses the same multipart text projection as transcript learning', () => {
    const { row } = seed();
    getSqliteDatabase().prepare('UPDATE transcript_entries SET payload_json=json_set(payload_json,\'$.content\',json(?)) WHERE entry_id=?')
      .run(JSON.stringify([{ type: 'text', text: original.slice(0, 20) }, { type: 'text', text: original.slice(20) }]), row.entry_id);
    expect(prepareWorkReview({ context, policy, processingPolicy: 'remote_allowed', evidence: fresh }).targets).toHaveLength(1);
  });

  it('honors a new forgetting boundary before reading and before committing originals', () => {
    const { plan, operation } = seed();
    createCollaborationRule({ category: 'boundary', priority: 100, scope: { type: 'workspace', id: '/workspace' },
      statement: 'Do not retain the forgotten source.', conditions: { forgottenHistoryEntries: [`${id}:*`] } });
    expect(prepareWorkReview({ context, policy, processingPolicy: 'remote_allowed', evidence: fresh }).targets).toHaveLength(0);
    expect(applyWorkReviews(plan, [operation], fresh, 'review')[0].outcome).toBe('rejected');
  });

  it('withholds an invalidated reusable lesson instead of keeping its old successful verification', () => {
    const { item } = seed();
    getSqliteDatabase().prepare("UPDATE knowledge_items SET kind='task_lesson' WHERE knowledge_id=?").run(item.id);
    const text = 'Atlas staging timeout tests failed.';
    const row = appendTranscriptEntry(id, { role: 'toolResult', content: [{ type: 'text', text }], toolName: 'test', toolCallId: 'test' } as never);
    const evidence = [{ ref: row.entry_id, role: 'toolResult' as const, text, createdAt: row.created_at }];
    const plan = prepareWorkReview({ context, policy, processingPolicy: 'remote_allowed', evidence });
    expect(applyWorkReviews(plan, [{ targetId: item.id, action: 'revise', reason: 'verification_failed', replacement: text,
      evidence: [{ ref: row.entry_id, quote: text }] }], evidence, 'review')[0].reasonCode).toBe('review_withheld');
    expect(getKnowledgeItem(item.id)?.status).toBe('needs_review');
  });

  it('keeps unverified lessons tentative and requires successful tool evidence for promotion', () => {
    seed();
    const evidence = [
      { ref: 'condition', role: 'user' as const, text: 'Only when Atlas staging cache is stale.', createdAt: Date.now() },
      { ref: 'action', role: 'toolResult' as const, text: 'Removed the Atlas staging cache.', createdAt: Date.now() },
      { ref: 'verification', role: 'toolResult' as const, text: 'Atlas staging tests passed.', createdAt: Date.now() },
    ];
    const claims = evidence.map(e => ({ ref: e.ref, quote: e.text }));
    const candidate = { kind: 'task_lesson' as const, topicKey: 'atlas-cache', predicate: 'cache.recovery', scope: 'workspace' as const,
      statement: 'When Atlas staging cache is stale, remove it; staging tests passed.', confidence: 0.9, importance: 0.8, evidence: claims };
    expect(WorkCandidateSchema.safeParse(candidate).success).toBe(false);
    const apply = (c = candidate, e = evidence) => applyWorkCandidates({ candidates: [c], evidence: e, ...context,
      processingPolicy: 'remote_allowed', runId: 'lesson' })[0];
    expect(getKnowledgeItem(apply().objectId!)?.verification).toBe('tentative');
    const verified = { ...candidate, lesson: { condition: claims[0], action: claims[1], verification: claims[2] } };
    const admitted = getKnowledgeItem(apply(verified).objectId!)!;
    expect(admitted.verification).toBe('supported');
    expect(admitted.content).toContain(`Condition: ${claims[0].quote}`);
    expect(applyWorkCandidates({ candidates: [verified], evidence, ...context, processingPolicy: 'remote_allowed', runId: 'external',
      source: { instanceId: 'connector', itemId: 'document', contentHash: 'hash', consentReceiptId: 'receipt' } })[0].reasonCode)
      .toBe('lesson_runtime_verification_required');
    expect(apply(verified, evidence.map(e => e.ref === 'verification' ? { ...e, role: 'user' } : e)).reasonCode)
      .toBe('lesson_verification_not_successful');
  });

  it('rejects translation and quotation material instead of persisting it as a tentative work note', () => {
    seed();
    const text = '请翻译客户原话：“我偏好硬件周报，标识客户测试”。我自己习惯先讲风险。';
    const result = applyWorkCandidates({ candidates: [{ kind: 'note', topicKey: 'client', predicate: 'report.preference', scope: 'session',
      statement: 'Client prefers hardware weekly reports.', confidence: 0.8, importance: 0.6,
      evidence: [{ ref: 'mixed', quote: '我偏好硬件周报，标识客户测试' }] }],
      evidence: [{ ref: 'mixed', text, role: 'user', createdAt: Date.now() }], ...context,
      processingPolicy: 'remote_allowed', runId: 'mixed' });
    expect(result[0].reasonCode).toBe('work_quote_not_owned');
  });
});
