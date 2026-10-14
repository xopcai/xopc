import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestDatabase } from '../../../test/sqlite-fixture.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { appendTranscriptEntry } from '../../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { TaskApplicationService } from '../task-application-service.js';
import { TaskConversationRepository } from '../task-conversation-repository.js';
import { TaskRunCoordinator } from '../task-run-coordinator.js';
import { TaskRunRepository } from '../task-run-repository.js';
import { TaskCollaborationRepository } from '../task-collaboration-repository.js';
import { TaskResultDeliveryRepository } from '../task-result-delivery-repository.js';
import { applyResearchReview, bindResearchSources, mergeResearchSubmission, submitTaskResearchResult, type ResearchReviewer } from '../task-research-result.js';
import { parseTaskContractResponse } from '../task-contract-planner.js';
import { buildResearchRepair } from '../task-research-repair.js';
import { TaskJudgeService } from '../../agent/tasks/task-judge-service.js';
import { canResumeAfterModelFailure } from '../../agent/orchestration/turn-recovery.js';
import { parsePersonalReplyDraft, type PersonalReplyPacket } from '../../personal-agent/reply-composer.js';

const submission = { sources: [{ id: 'source', excerpt: 'Actual price 1/hour.' }],
  claims: [{ id: 'price', statement: 'Price 1/hour.', kind: 'fact' as const, sourceIds: ['source'] }] };
const review: ResearchReviewer = async () => ({ claims: [{ id: 'price', support: 'supported', note: 'Matches source' }],
  checks: [{ criterionIndex: 0, status: 'passed', claimIds: ['price'], note: 'Matches price' }] });

describe('personal repair benchmark v1', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'xopc-repair-')); vi.stubEnv('XOPC_STATE_DIR', root);
    resetXopcDatabaseSingletonForTest(); seedTestDatabase(join(root, 'xopc.db')); openXopcDatabase({ path: join(root, 'xopc.db') }); });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
  function execution() {
    const main = createConversation({ agentId: 'main' }); const worker = createConversation({ agentId: 'worker' });
    const result = new TaskApplicationService().create({ idempotencyKey: main.key, title: 'Research', originConversationId: main.key,
      contract: { objective: 'Check price', expectedOutputs: ['Report'], acceptanceCriteria: ['Check actual price'],
        constraints: [], assumptions: [], risks: [], approvalRequired: [], acceptancePolicy: 'manual', outputDestinations: [] },
      dependencies: [], context: [], authorityGrants: [], activation: { mode: 'start', executor: { kind: 'agent', agentId: 'worker' } } });
    if (!result.ok || !result.runId) throw new Error('Expected execution');
    const runId = result.runId; const taskId = result.model.task.id;
    new TaskConversationRepository().activateExecutionSession({ taskId, runId, conversationId: worker.key, agentId: 'worker' });
    const context = { runId, taskId, conversationId: worker.key, agentId: 'worker', origin: 'task' as const, channel: 'webchat', triggerKind: 'user' };
    const coordinator = TaskRunCoordinator.start({ runId, context, fallbackObjective: 'Research' })!;
    appendTranscriptEntry(worker.key, { role: 'toolResult', toolCallId: 'read', toolName: 'read_file', isError: false,
      content: [{ type: 'text', text: 'Actual price 1/hour.' }], timestamp: Date.now() });
    const resume = () => { const runs = new TaskRunRepository(); const run = runs.require(runId);
      runs.setStatus({ runId, expectedVersion: run.version, from: ['waiting'], to: 'running' });
      return TaskRunCoordinator.start({ runId, context, fallbackObjective: 'Research' })!; };
    return { worker, taskId, runId, coordinator, resume };
  }
  const finish = (coordinator: TaskRunCoordinator) => coordinator.finalize({ status: 'succeeded', summary: 'Report', assistantText: 'Result with limitations.' });
  const failed: ResearchReviewer = async () => ({ claims: [{ id: 'price', support: 'unsupported', note: 'Wrong price' }],
    checks: [{ criterionIndex: 0, status: 'failed', claimIds: ['price'], note: 'Correct the price' }] });

  it('A01-same-run: repairs unsupported conclusions before any delivery and succeeds after fresh review', async () => {
    const x = execution(); await submitTaskResearchResult(x.worker.key, 'bad', submission, undefined, failed); finish(x.coordinator);
    expect(new TaskRunRepository().require(x.runId).status).toBe('waiting');
    expect(new TaskResultDeliveryRepository().hasForRun(x.runId)).toBe(false);
    const resumed = x.resume(); await submitTaskResearchResult(x.worker.key, 'fixed', submission, undefined, review); finish(resumed);
    expect(new TaskRunRepository().getReceipt(x.runId)?.verification.status).toBe('passed');
    expect(new TaskResultDeliveryRepository().hasForRun(x.runId)).toBe(true);
    expect(getSqliteDatabase().prepare("SELECT run_id FROM task_runs WHERE task_id = ?").all(x.taskId)).toHaveLength(1);
  });
  it('A02-no-progress: identical gaps stop after one automatic continuation with honest partial status', async () => {
    const x = execution(); await submitTaskResearchResult(x.worker.key, 'bad', submission, undefined, failed); finish(x.coordinator);
    const resumed = x.resume(); await submitTaskResearchResult(x.worker.key, 'same', submission, undefined, failed); finish(resumed);
    const receipt = new TaskRunRepository().getReceipt(x.runId)!;
    expect(receipt.completionVerdict).toBe('partial'); expect(receipt.remainingWork.join(' ')).toContain('Wrong price');
    expect(new TaskRunRepository().require(x.runId).policySnapshot.continuationAttempts).toBe(1);
  });
  it('A03-budget: changes cannot create unlimited paid repair rounds', () => {
    const x = execution(); const runs = new TaskRunRepository();
    for (let i = 0; i < 3; i++) { const run = runs.require(x.runId);
      expect(runs.scheduleContinuation({ runId: x.runId, expectedVersion: run.version, reason: 'acceptance_repair',
        repairFingerprint: String(i), message: 'Repair only missing evidence' })).toBe(i < 2);
      if (i < 2) x.resume(); }
  });
  it('A04-file-loss: missing published bytes trigger republication before completion', async () => {
    const x = execution(); await submitTaskResearchResult(x.worker.key, 'good', submission, undefined, review);
    new TaskResultDeliveryRepository().capture(x.runId, { version: 1, outcomeId: 'lost', runId: x.runId, turnId: x.runId,
      status: 'succeeded', evidence: [], createdAt: new Date().toISOString(), deliverables: [{ artifactId: 'lost', kind: 'document',
        title: 'report.md', availability: 'available', location: 'artifact_store', uri: 'media://outbound/lost', capabilities: ['download'] }] });
    finish(x.coordinator);
    expect(new TaskRunRepository().require(x.runId).policySnapshot.continuation).toMatchObject({ reason: 'acceptance_repair' });
    expect(new TaskRunRepository().require(x.runId).policySnapshot.continuation.message).toContain('Published file missing');
  });
  it('A18-502-file-loss: a confirmed evidence-validation failure does not prevent same-run recovery and republication', async () => {
    const x = execution(); await submitTaskResearchResult(x.worker.key, 'good', submission, undefined, review);
    appendTranscriptEntry(x.worker.key, { role: 'toolResult', toolCallId: 'invalid-evidence', toolName: 'publish_task_result',
      isError: true, content: [{ type: 'text', text: 'Source did not match the successful read' }], timestamp: Date.now() });
    new TaskResultDeliveryRepository().capture(x.runId, { version: 1, outcomeId: 'lost-after-502', runId: x.runId,
      turnId: x.runId, status: 'succeeded', evidence: [], createdAt: new Date().toISOString(),
      deliverables: [{ artifactId: 'lost', kind: 'document', title: 'report.md', availability: 'available',
        location: 'artifact_store', uri: 'media://outbound/lost', capabilities: ['download'] }] });
    x.coordinator.finalize({ status: 'failed', summary: '502 provider_error' });
    const run = new TaskRunRepository().require(x.runId);
    expect(run.status).toBe('waiting');
    expect(run.policySnapshot.continuation).toMatchObject({ reason: 'model_failure' });
    expect(run.policySnapshot.continuation.message).toContain('Republish from the existing workspace output');
    expect(new TaskResultDeliveryRepository().hasForRun(x.runId)).toBe(false);
  });
  it('A19-502-unsafe: a failed external operation still prevents automatic replay', () => {
    const x = execution();
    appendTranscriptEntry(x.worker.key, { role: 'toolResult', toolCallId: 'external-write', toolName: 'exec_command',
      isError: true, content: [{ type: 'text', text: 'Unknown operation result' }], timestamp: Date.now() });
    x.coordinator.finalize({ status: 'failed', summary: '502 provider_error' });
    expect(new TaskRunRepository().require(x.runId).status).toBe('failed');
    expect(new TaskRunRepository().getReceipt(x.runId)?.needsUser).toBe(true);
  });
  it('A05-direction: a later user instruction invalidates the old review and requires adoption evidence', async () => {
    const x = execution(); await submitTaskResearchResult(x.worker.key, 'old', submission, undefined, review);
    const entry = new TaskCollaborationRepository().append({ taskId: x.taskId, authorKind: 'user', authorId: 'owner',
      kind: 'instruction', body: 'Include the monthly rate too.', idempotencyKey: 'direction' });
    finish(x.coordinator); const resumed = x.resume();
    const omitted = await submitTaskResearchResult(x.worker.key, 'new', submission, undefined, review);
    expect(omitted.instructionChecks?.[0]).toMatchObject({ sequence: entry.sequence, status: 'unverified' });
    finish(resumed); expect(new TaskRunRepository().require(x.runId).status).toBe('waiting');
  });
  it('A06-direction-proof: a self-declared instruction pass without supported claims stays unverified', async () => {
    const x = execution(); new TaskCollaborationRepository().append({ taskId: x.taskId, authorKind: 'user', authorId: 'owner',
      kind: 'instruction', body: 'Include monthly rate.', idempotencyKey: 'direction' });
    const result = await submitTaskResearchResult(x.worker.key, 'new', submission, undefined, review);
    const reviewed = applyResearchReview(result, { ...(await review({} as never)), instructions: [{ sequence: result.instructionSequence,
      status: 'passed', claimIds: [], note: 'No proof' }] }, ['Check actual price']);
    expect(reviewed.instructionChecks?.[0].status).toBe('unverified');
  });
  it('A07-authority: paused tasks and expired deadlines cannot automatically resume', async () => {
    const x = execution(); await submitTaskResearchResult(x.worker.key, 'bad', submission, undefined, failed);
    getSqliteDatabase().prepare('UPDATE task_runs SET timeout_at = ? WHERE run_id = ?').run(Date.now() - 1, x.runId);
    finish(x.coordinator); expect(new TaskRunRepository().require(x.runId).status).toBe('succeeded');
    expect(new TaskRunRepository().getReceipt(x.runId)?.completionVerdict).toBe('partial');
    const paused = execution(); const runs = new TaskRunRepository();
    runs.createWait({ taskId: paused.taskId, taskRunId: paused.runId, kind: 'paused', reason: 'User paused', condition: {} });
    const run = runs.require(paused.runId); runs.setStatus({ runId: run.id, expectedVersion: run.version, from: ['running'], to: 'waiting' });
    finish(paused.coordinator); expect(runs.require(paused.runId).status).toBe('waiting');
    expect(runs.require(paused.runId).policySnapshot.continuationAttempts).toBeUndefined();
  });
  it('A08-conflict: repair asks for original sources or disclosed uncertainty, never invented agreement', () => {
    const repair = buildResearchRepair({ stale: true, instructionSequence: 2, criteria: ['Reconcile sources'],
      publications: { missing: [], unreviewed: [], artifactIds: [] } })!;
    expect(repair.message).toContain('Never invent a consensus'); expect(repair.message).toContain('Do not replay external writes');
  });
  it('A09-finalizer: the legacy judge cannot complete a research run before evidence repair', async () => {
    const x = execution(); await submitTaskResearchResult(x.worker.key, 'bad', submission, undefined, failed);
    const modelManager = { getModelForSession: vi.fn(() => 'unused') };
    await new TaskJudgeService({ sessionStore: {} as never, modelManager: modelManager as never, getConfig: () => undefined })
      .reviewTurn({ conversationId: x.worker.key, channel: 'webchat', chatId: 'test', aborted: false, assistantPlainText: 'Done' });
    expect(modelManager.getModelForSession).not.toHaveBeenCalled();
    expect(new TaskRunRepository().require(x.runId).status).toBe('running');
    finish(x.coordinator); expect(new TaskRunRepository().require(x.runId).status).toBe('waiting');
  });
  it('A10-fetch-url: a public fetch URL can come from persisted host metadata, never an invented replacement', () => {
    const record = { toolCallId: 'fetch', toolName: 'web_fetch', body: 'Actual price 1/hour.', observedAt: 1, url: 'https://example.test/price' };
    expect(bindResearchSources({ ...submission, sources: [{ ...submission.sources[0], url: record.url }] }, [record])[0].url).toBe(record.url);
    expect(bindResearchSources(submission, [record])[0].url).toBe(record.url);
    expect(() => bindResearchSources({ ...submission, sources: [{ ...submission.sources[0], url: 'https://invented.test' }] }, [record])).toThrow(/no matching/);
  });
  it('A11-missing-review: an explicitly required result cannot bypass repair by omitting the evidence tool', () => {
    const x = execution(); getSqliteDatabase().prepare('UPDATE tasks SET body = ? WHERE task_id = ?')
      .run('Use publish_task_result for evidence review before completion.', x.taskId);
    finish(x.coordinator); expect(new TaskRunRepository().require(x.runId).status).toBe('waiting');
    expect(new TaskRunRepository().require(x.runId).policySnapshot.continuation.message).toContain('required evidence-linked research result is missing');
  });
  it('A12-fetch-failure: failed fetch text is never eligible evidence even when the tool omitted isError', async () => {
    const x = execution(); appendTranscriptEntry(x.worker.key, { role: 'toolResult', toolCallId: 'failed-fetch', toolName: 'web_fetch',
      content: [{ type: 'text', text: 'Fetch error: unavailable' }], details: { error: 'unavailable', url: 'https://example.test' }, timestamp: Date.now() });
    await expect(submitTaskResearchResult(x.worker.key, 'bad', { ...submission,
      sources: [{ id: 'source', excerpt: 'Fetch error: unavailable' }] }, undefined, review)).rejects.toThrow(/no matching/);
  });
  it('A13-safe-recovery: confirmed read failures allow acceptance repair while unknown effects remain blocked', () => {
    const options = { allowFailedReadTools: new Set(['web_fetch', 'publish_task_result']) };
    const call = { role: 'assistant', content: [{ type: 'toolCall', id: 'call', name: 'web_fetch' }] };
    const failed = { role: 'toolResult', toolCallId: 'call', toolName: 'web_fetch', isError: true };
    expect(canResumeAfterModelFailure([call, failed])).toBe(false);
    expect(canResumeAfterModelFailure([call, failed], options)).toBe(true);
    expect(canResumeAfterModelFailure([call], options)).toBe(false);
    expect(canResumeAfterModelFailure([call, { ...failed, toolName: 'exec_command' }], options)).toBe(false);
  });
  it('A14-counts: rejects the observed mistaken nine/eight acceptance summary for a ten/nine result', async () => {
    const x = execution(); const result = await submitTaskResearchResult(x.worker.key, 'review', submission, undefined, review);
    const research = { ...result, checks: Array.from({ length: 10 }, (_, index) => ({ criterionIndex: index, criterion: `Criterion ${index}`,
      status: index === 9 ? 'unverified' as const : 'passed' as const, claimIds: ['price'], note: 'Fixture' })) };
    const packet = { report: 'Data is ready; one process constraint remains unverified.', delivery: { outcome: { research } } } as PersonalReplyPacket;
    expect(() => parsePersonalReplyDraft('九项验收中八项已通过。', packet)).toThrow(/counts/);
    expect(parsePersonalReplyDraft('十项验收中九项已通过。', packet)).toContain('十项');
    expect(parsePersonalReplyDraft('数据与文件已返回，一项过程约束尚未核实。', packet)).toContain('尚未核实');
  });
  it('A15-amendment: targeted repair preserves prior evidence and explicitly retires obsolete claims', async () => {
    const x = execution(); const previous = await submitTaskResearchResult(x.worker.key, 'review', submission, undefined, review);
    const amendment = { mode: 'amend' as const, sources: [{ id: 'new', excerpt: 'New output' }],
      claims: [{ id: 'new-claim', statement: 'New file is ready', kind: 'fact' as const, sourceIds: ['new'] }] };
    const merged = mergeResearchSubmission(amendment, previous);
    expect(merged.claims.map(claim => claim.id)).toEqual(['price', 'new-claim']);
    expect(merged.sources.find(source => source.id === 'source')?.toolCallId).toBe('read');
    expect(mergeResearchSubmission({ ...amendment, retireClaimIds: ['price'] }, previous).claims.map(claim => claim.id)).toEqual(['new-claim']);
    expect(() => mergeResearchSubmission({ ...amendment, retireClaimIds: ['unknown'] }, previous)).toThrow(/unknown claim/);
  });
  it('A16-circular-plan: model planning cannot require its own pending review as acceptance proof', () => {
    const plan = parseTaskContractResponse(JSON.stringify({ objective: 'Research', expectedOutputs: ['report.md'],
      acceptanceCriteria: ['Report prices with sources', '检查 publish_task_result 返回的逐项验收结果', '报告说明 publish_task_result 的参数与返回结构'] }));
    expect(plan?.acceptanceCriteria).toEqual(['Report prices with sources', '报告说明 publish_task_result 的参数与返回结构']);
  });
  it('A17-retention: an omitted mode on a later publication retains earlier primary evidence', async () => {
    const x = execution(); await submitTaskResearchResult(x.worker.key, 'first', submission, undefined, review);
    appendTranscriptEntry(x.worker.key, { role: 'toolResult', toolCallId: 'new-read', toolName: 'read_file',
      content: [{ type: 'text', text: 'New evidence present.' }], timestamp: Date.now() });
    const result = await submitTaskResearchResult(x.worker.key, 'second', { sources: [{ id: 'new-source', excerpt: 'New evidence present.' }],
      claims: [{ id: 'new-claim', statement: 'New evidence present.', kind: 'fact', sourceIds: ['new-source'] }] }, undefined,
      async () => ({ claims: [{ id: 'price', support: 'supported', note: 'Original evidence retained' },
        { id: 'new-claim', support: 'supported', note: 'New evidence matched' }], checks: [{ criterionIndex: 0, status: 'passed', claimIds: ['price'], note: 'Original price remains checked' }] }));
    expect(result.claims.map(claim => claim.id)).toEqual(['price', 'new-claim']);
    expect(result.sources.find(source => source.id === 'source')?.toolCallId).toBe('read');
  });
});
