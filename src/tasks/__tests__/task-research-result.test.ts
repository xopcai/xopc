import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TaskResearchResult } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { parsePersonalReplyDraft, type PersonalReplyPacket } from '../../personal-agent/reply-composer.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskConversationRepository } from '../task-conversation-repository.js';
import { TaskRunCoordinator } from '../task-run-coordinator.js';
import { TaskRunRepository } from '../task-run-repository.js';
import { TaskResultDeliveryRepository } from '../task-result-delivery-repository.js';
import { TaskCollaborationRepository } from '../task-collaboration-repository.js';
import { defineTaskContract } from '../task-contract-definition.js';
import { applyResearchReview, bindResearchSources, currentTaskResearchResult, submitTaskResearchResult, type ResearchReviewer } from '../task-research-result.js';

const input = { sources: [{ id: 'official', excerpt: 'Price is 1.00 per hour.' }],
  claims: [{ id: 'price', statement: 'Price is 1.00 per hour.', kind: 'fact' as const, sourceIds: ['official'] }] };
const tools = [{ toolCallId: 'read-1', toolName: 'web_fetch', body: 'https://example.test/pricing\nPrice is 1.00 per hour.', observedAt: 1 }];
const seedResult = (): TaskResearchResult => ({ version: 1, contractVersion: 1, instructionSequence: 0,
  sources: bindResearchSources(input, tools), claims: input.claims.map(claim => ({ ...claim, support: 'unreviewed' })), checks: [], review: 'unavailable' });

describe('personal research benchmark v1', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xopc-research-result-'));
    vi.stubEnv('XOPC_STATE_DIR', root); resetXopcDatabaseSingletonForTest();
    seedTestDatabase(join(root, 'xopc.db')); openXopcDatabase({ path: join(root, 'xopc.db') });
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

  function execution(criteria = ['Use the official hourly rate', 'Cite the source']) {
    const main = createConversation({ agentId: 'main' });
    const worker = createConversation({ agentId: 'worker' });
    const task = new TaskApplicationService().create({ idempotencyKey: main.key, title: 'Price research',
      originConversationId: main.key, contract: { objective: 'Research price', expectedOutputs: ['Conclusion'],
        acceptanceCriteria: criteria, constraints: [], approvalRequired: [],
        assumptions: [], risks: [], acceptancePolicy: 'manual', outputDestinations: [] }, dependencies: [], context: [], authorityGrants: [],
      activation: { mode: 'start', executor: { kind: 'agent', agentId: 'worker' } } });
    if (!task.ok || !task.runId) throw new Error('Expected run');
    new TaskConversationRepository().activateExecutionSession({ taskId: task.model.task.id, conversationId: worker.key,
      agentId: 'worker', runId: task.runId });
    const coordinator = TaskRunCoordinator.start({ runId: task.runId, fallbackObjective: 'Research price', context: {
      runId: task.runId, conversationId: worker.key, agentId: 'worker', taskId: task.model.task.id, origin: 'task', channel: 'webchat', triggerKind: 'user' } })!;
    appendTranscriptEntry(worker.key, { role: 'toolResult', toolCallId: 'read-1', toolName: 'web_fetch',
      content: [{ type: 'text', text: tools[0].body }], isError: false, timestamp: Date.now() });
    return { main, worker, runId: task.runId, taskId: task.model.task.id, coordinator };
  }
  const reviewer: ResearchReviewer = async ({ criteria }) => ({ claims: [{ id: 'price', support: 'supported', note: 'The quote supports the exact hourly rate.' }],
    checks: criteria.map((_criterion, criterionIndex) => ({ criterionIndex, status: 'passed', claimIds: ['price'], note: 'Supported by the observed source.' })) });

  it('R01-source: binds actual tool provenance and a stable source snapshot', () => {
    const sources = bindResearchSources({ ...input, sources: [{ ...input.sources[0], url: 'https://example.test/pricing' }] }, tools);
    expect(sources[0]).toMatchObject({ toolCallId: 'read-1', toolName: 'web_fetch', observedAt: 1 });
    expect(sources[0].snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(bindResearchSources({ ...input, sources: [{ id: 'files', excerpt: '3 artifacts published' }] },
      [{ ...tools[0], toolName: 'publish_artifacts', body: '3 artifacts published: report.md, reproduce.mjs, monthly.csv' }])[0].toolName).toBe('publish_artifacts');
  });
  it('R02-fabricated-quote: rejects excerpts not present in actual reads', () => {
    expect(() => bindResearchSources({ ...input, sources: [{ id: 'fake', excerpt: 'Price is 9.00 per hour.' }] }, tools)).toThrow(/no matching/);
  });
  it('R03-fabricated-url: rejects an invented URL even with a genuine quote', () => {
    expect(() => bindResearchSources({ ...input, sources: [{ ...input.sources[0], url: 'https://invented.test' }] }, tools)).toThrow(/no matching/);
  });
  it('R04-missing-criterion: omitted and unexpanded criteria remain unverified', async () => {
    const result = applyResearchReview(seedResult(), { claims: [{ id: 'price', support: 'supported', note: 'Quote supports rate' }], checks: [] }, ['Use hourly units']);
    expect(result.checks[0].status).toBe('unverified');
    const { worker } = execution(defineTaskContract('Research price').acceptanceCriteria);
    const generic = await submitTaskResearchResult(worker.key, 'generic', input, undefined, reviewer);
    expect(generic.checks.every(check => check.status === 'unverified')).toBe(true);
    expect(generic.checks[0].note).toContain('not expanded');
  });
  it('R05-unsupported: self-declared passes cannot bypass unsupported claims', () => {
    const result = applyResearchReview(seedResult(), { claims: [{ id: 'price', support: 'unsupported', note: 'Unit mismatch' }],
      checks: [{ criterionIndex: 0, status: 'passed', claimIds: ['price'], note: 'False pass' }] }, ['Use hourly units']);
    expect(result.checks[0].status).toBe('unverified');
  });
  it('R06-unknown-reference: rejects reviewer references to invented claims', () => {
    expect(() => applyResearchReview(seedResult(), { claims: [], checks: [{ criterionIndex: 0, status: 'passed', claimIds: ['invented'], note: 'False pass' }] }, ['Cite sources']))
      .toThrow(/unknown claim/);
  });
  it('R07-durable: research survives later outcomes and produces per-criterion receipts', async () => {
    const { worker, runId, coordinator } = execution();
    await submitTaskResearchResult(worker.key, 'result-1', input, undefined, reviewer);
    new TaskResultDeliveryRepository().capture(runId, { version: 1, outcomeId: 'later', runId, turnId: runId,
      status: 'succeeded', summary: 'Final text', deliverables: [], evidence: [], createdAt: new Date().toISOString() });
    coordinator.finalize({ status: 'succeeded', summary: 'Result', assistantText: 'Price is 1.00 per hour.' });
    const receipt = new TaskRunRepository().getReceipt(runId)!;
    expect(receipt.verification.checks).toHaveLength(2);
    expect(receipt.verification.status).toBe('passed');
    expect(receipt.evidence[0].provenance).toBe('judge');
    const payload = JSON.parse((getSqliteDatabase().prepare('SELECT payload_json FROM task_result_deliveries WHERE task_run_id = ?').get(runId) as { payload_json: string }).payload_json);
    expect(payload.outcome.research.sources[0].toolCallId).toBe('read-1');
    expect(payload.outcome.research.claims[0].sourceIds).toEqual(['official']);
    expect(payload.outcome.research.review).toBe('model_reviewed');
  });
  it('R08-review-outage: keeps sources but never certifies checks after review failure', async () => {
    const { worker, runId } = execution();
    const result = await submitTaskResearchResult(worker.key, 'result-1', input, undefined, async () => { throw new Error('Fixed outage'); });
    expect(result.review).toBe('unavailable');
    expect(result.checks.every(check => check.status === 'unverified')).toBe(true);
    expect(currentTaskResearchResult(runId)!.sources).toHaveLength(1);
  });
  it('R09-stale-direction: rejects a review completed before later user direction', async () => {
    const { worker, taskId, runId } = execution();
    await expect(submitTaskResearchResult(worker.key, 'result-1', input, undefined, async args => {
      new TaskCollaborationRepository().append({ taskId, authorKind: 'user', authorId: 'owner', kind: 'instruction',
        body: 'Use monthly price instead.', idempotencyKey: 'new-direction' });
      return reviewer(args);
    })).rejects.toThrow(/requirements changed/);
    expect(currentTaskResearchResult(runId)).toBeUndefined();
  });
  it('R10-no-research: lists every acceptance item as unverified without a submitted result', () => {
    const { coordinator, runId } = execution();
    coordinator.finalize({ status: 'succeeded', summary: 'Text result', assistantText: 'Unsubstantiated report.' });
    expect(new TaskRunRepository().getReceipt(runId)!.verification.checks.map(check => check.status)).toEqual(['unverified', 'unverified']);
  });
  it('S03-prose: valid concise prose and legacy JSON share the same validation', () => {
    const packet = { report: 'Price is uncertain. https://example.test/pricing' } as PersonalReplyPacket;
    expect(parsePersonalReplyDraft('Price is uncertain.', packet)).toBe('Price is uncertain.');
    expect(parsePersonalReplyDraft('{"text":"Price is uncertain."}', packet)).toBe('Price is uncertain.');
    expect(() => parsePersonalReplyDraft('{"text":', packet)).toThrow();
    expect(() => parsePersonalReplyDraft('Source: https://invented.test', packet)).toThrow(/invented/);
    const research = { ...seedResult(), sources: bindResearchSources({ ...input,
      sources: [{ ...input.sources[0], url: 'https://example.test/pricing' }] }, tools) };
    const cited = { report: 'Evidence is retained in the result envelope.', delivery: { outcome: { research } } } as PersonalReplyPacket;
    expect(parsePersonalReplyDraft('来源：https://example.test/pricing。', cited)).toContain('example.test');
  });
  it('S04-acceptance: rejects an acceptance upgrade with missing evidence', () => {
    const research = { ...seedResult(), checks: [{ criterionIndex: 0, criterion: 'Cite sources', status: 'unverified' as const, claimIds: [], note: 'Missing' }] };
    const packet = { report: '未核实', delivery: { outcome: { research } } } as PersonalReplyPacket;
    expect(() => parsePersonalReplyDraft('全部验收通过。', packet)).toThrow(/upgraded/);
    expect(parsePersonalReplyDraft('报价尚未核实。', packet)).toBe('报价尚未核实。');
    expect(() => parsePersonalReplyDraft('任务已完成并通过验收。', { ...packet, verificationStatus: 'unverified' })).toThrow(/upgraded/);
  });
});
