import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowUpCommand, FollowUpCreate, TaskResearchResult } from '@xopcai/gateway-contract';
import { allowsExecutionTool, resolveExecutionToolPolicy } from '../../agent/embedded/execution-tool-policy.js';
import { createTaskCollaborationTool } from '../../agent/tools/task-collaboration-tool.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { appendTranscriptEntry, closeXopcDatabase, getXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { TaskConversationRepository } from '../../tasks/task-conversation-repository.js';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { TaskReadModelProjector } from '../../tasks/task-read-model-projector.js';
import { TaskDeletionService } from '../../tasks/task-deletion-service.js';
import { TaskRunCoordinator } from '../../tasks/task-run-coordinator.js';
import { submitTaskResearchResult, currentTaskResearchResult } from '../../tasks/task-research-result.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { HomeFollowUps } from '../follow-ups.js';
import { HomeObservation } from '../observation.js';
import { routinePrincipal, routineTrial, settleTask } from './routine-fixture.js';
let service: HomeFollowUps;
let fixture: ReturnType<typeof routineTrial>;
let allowed: boolean;
const publish = vi.fn(), dispatch = vi.fn();
function request(override: Partial<FollowUpCreate> = {}): FollowUpCreate { return { goal: '查清重复请求的原因', criteria: ['复现条件清楚', '原因有证据支持'], firstStep: '整理现有线索和缺少的日志', topicIds: [fixture.topicId], autoContinue: true, stepBudget: 3, locale: 'zh', expectedObservationRevision: fixture.observation.state().revision, idempotencyKey: randomUUID(), ...override }; }
function command(id: string, command: FollowUpCommand['command']) { return service.command(id, { expectedRevision: service.get(id).revision, idempotencyKey: randomUUID(), command }); }
function finish(taskId: string, followUp: TaskResearchResult['followUp'], passed = true) {
    const run = new TaskRunRepository().getActiveRoot(taskId)!;
    const research: TaskResearchResult = { version: 1, contractVersion: run.contractVersion, instructionSequence: 0, review: 'model_reviewed',
        sources: [{ id: 'source', toolCallId: 'read', toolName: 'read_file', excerpt: 'Observed log', snapshotHash: 'a'.repeat(64), observedAt: Date.now() }],
        claims: [{ id: 'claim', statement: 'Observed progress', kind: 'fact', sourceIds: ['source'], support: 'supported' }], checks: [], followUp };
    getXopcDatabase().db.prepare('INSERT INTO task_run_outcomes(task_run_id,outcome_id,assignment_epoch,outcome_json,created_at) VALUES (?,?,0,?,?)').run(run.id, randomUUID(), JSON.stringify({ research }), Date.now());
    settleTask(taskId, passed);
}
describe('continuing work goals', () => {
    beforeEach(() => {
        resetXopcDatabaseSingletonForTest();
        openXopcDatabase({ path: ':memory:' });
        allowed = true;
        publish.mockReset();
        dispatch.mockReset();
        fixture = routineTrial();
        const observer = new HomeObservation(getXopcDatabase().db, routinePrincipal, () => allowed);
        service = new HomeFollowUps(getXopcDatabase().db, routinePrincipal, observer, { agentId: () => 'main', publish, dispatch });
    });
    afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });
    it('keeps one parent goal and distinct child Tasks, with idempotent creation', () => {
        const input = request(), goal = service.create(input);
        expect(service.create(input).id).toBe(goal.id);
        expect(new TaskRepository().get(goal.steps[0]!.taskId)!.parentTaskId).toBe(goal.rootTaskId);
        expect(new TaskRepository().get(goal.rootTaskId)!.contract!.acceptanceCriteria).toEqual(input.criteria);
        expect(new TaskRunRepository().getActiveRoot(goal.rootTaskId)).toBeUndefined();
        expect(goal.status).toBe('working');
        expect(goal.remainingSteps).toBe(2);
        expect(new TaskReadModelProjector().get(goal.rootTaskId)!.allowedCommands).not.toContain('start');
        expect(new TaskApplicationService().execute({ taskId: goal.rootTaskId, expectedVersion: new TaskRepository().get(goal.rootTaskId)!.version, idempotencyKey: 'start-parent', command: { type: 'start', executor: { kind: 'agent', agentId: 'main' } } }).ok).toBe(false);
    });
    it('advances from verified results, retains prior progress, and never auto-completes the goal', async () => {
        let goal = service.create(request());
        finish(goal.steps[0]!.taskId, { state: 'next_step', nextStep: '核对两次请求的时间戳', reason: '日志已整理' });
        await service.refresh();
        goal = service.get(goal.id);
        expect(goal.steps).toHaveLength(2);
        expect(goal.status).toBe('working');
        const next = new TaskRepository().get(goal.steps[1]!.taskId)!;
        expect(next.body).toContain('Current-period private draft');
        expect(next.contract!.outputDestinations).toEqual([]);
        finish(goal.steps[1]!.taskId, { state: 'review_goal', reason: '核对完成，等待用户验收' });
        await service.refresh();
        goal = service.get(goal.id);
        expect(goal.status).toBe('review');
        expect(new TaskRepository().get(goal.rootTaskId)!.phase).not.toBe('closed');
        await expect(command(goal.id, { kind: 'complete', confirmedCriteria: [0], note: 'Only one criterion' })).rejects.toThrow('every');
        goal = await command(goal.id, { kind: 'complete', confirmedCriteria: [0, 1], note: '已核对日志与复现步骤，符合两项标准' });
        expect(goal.status).toBe('done');
        expect(new TaskRepository().get(goal.rootTaskId)!.resolution).toBe('done');
    });
    it('waits for missing input and resumes only with new material, not a repeated timer tick', async () => {
        let goal = service.create(request());
        finish(goal.steps[0]!.taskId, { state: 'waiting', waitingFor: '需要两次重复请求的日志', nextStep: '结合新日志检查请求时间线' });
        await service.refresh();
        goal = service.get(goal.id);
        expect(goal.status).toBe('waiting');
        await service.refresh();
        expect(service.get(goal.id).steps).toHaveLength(1);
        fixture.observation.command({ expectedRevision: fixture.observation.state().revision, idempotencyKey: 'pause-observer', command: { kind: 'pause' } });
        goal = await command(goal.id, { kind: 'add_input', text: '新增日志显示两次请求间隔 200ms，requestId 相同。' });
        expect(goal.steps).toHaveLength(2);
        expect(goal.status).toBe('working');
        expect(new TaskRepository().get(goal.steps[1]!.taskId)!.body).toContain('200ms');
        await service.refresh();
        expect(service.get(goal.id).steps).toHaveLength(2);
    });
    it('enforces the round budget, refuses repeated automatic steps, and does not continue failed verification', async () => {
        let goal = service.create(request({ stepBudget: 1 }));
        finish(goal.steps[0]!.taskId, { state: 'next_step', nextStep: '比对请求链路', reason: '还需要检查' });
        await service.refresh();
        goal = service.get(goal.id);
        expect(goal.steps).toHaveLength(1);
        expect(goal.status).toBe('review');
        expect(goal.remainingSteps).toBe(0);
        goal = await command(goal.id, { kind: 'continue', nextStep: '比对请求链路', stepBudget: 2 });
        finish(goal.steps[1]!.taskId, { state: 'next_step', nextStep: '比对请求链路', reason: 'Again' });
        await service.refresh();
        expect(service.get(goal.id).steps).toHaveLength(2);
        goal = await command(goal.id, { kind: 'continue', nextStep: '调整验证方法', stepBudget: 2 });
        finish(goal.steps[2]!.taskId, { state: 'next_step', nextStep: 'Claim a fix', reason: 'Unverified' }, false);
        await service.refresh();
        expect(service.get(goal.id).status).toBe('waiting');
        expect(service.get(goal.id).steps).toHaveLength(3);
    });
    it('pauses the active TaskRun, rejects stale controls and restores a reviewable next step', async () => {
        let goal = service.create(request()), taskId = goal.steps[0]!.taskId;
        const revision = goal.revision;
        goal = await command(goal.id, { kind: 'pause' });
        expect(goal.status).toBe('paused');
        expect(new TaskRunRepository().getActiveRoot(taskId)).toBeUndefined();
        await expect(service.command(goal.id, { expectedRevision: revision, idempotencyKey: 'stale', command: { kind: 'resume' } })).rejects.toThrow('changed');
        goal = await command(goal.id, { kind: 'resume' });
        expect(goal.status).toBe('review');
        goal = await command(goal.id, { kind: 'continue', nextStep: '补充复现清单', stepBudget: 1 });
        expect(goal.steps).toHaveLength(2);
        expect((await command(goal.id, { kind: 'end' })).status).toBe('ended');
    });
    it('stops on lost access and retains old authorized scope beyond the 20-topic display window', async () => {
        const goal = service.create(request());
        for (let i = 0; i < 23; i++) {
            const id = createConversation({ agentId: 'main', sourceChannel: 'webchat', name: `Other ${i}`, routing: { source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner', agentId: 'main' } }).key;
            appendTranscriptEntry(id, { role: 'user', content: `Other work ${i}`, timestamp: Date.now() });
        }
        fixture.observation.collect();
        expect(fixture.observation.state().topics.some(t => t.id === fixture.topicId)).toBe(false);
        expect(fixture.observation.state([fixture.topicId]).topics).toHaveLength(1);
        await service.refresh();
        expect(service.get(goal.id).status).toBe('working');
        allowed = false;
        await service.refresh();
        expect(service.get(goal.id).status).toBe('waiting');
        expect(new TaskRunRepository().getActiveRoot(goal.steps[0]!.taskId)).toBeUndefined();
        await expect(command(goal.id, { kind: 'continue', nextStep: 'Read revoked data', stepBudget: 1 })).rejects.toThrow('readable');
    });
    it('guards deletion while a child runs and does not reuse step identities after deleting history', async () => {
        let goal = service.create(request({ autoContinue: false }));
        const deletion = new TaskDeletionService();
        expect(deletion.delete(goal.rootTaskId)).toMatchObject({ ok: false, reason: 'active_run' });
        const first = goal.steps[0]!.taskId;
        finish(first, { state: 'review_goal', reason: 'Review' });
        await service.refresh();
        expect(deletion.delete(first).ok).toBe(true);
        expect(service.get(goal.id).status).toBe('paused');
        await command(goal.id, { kind: 'resume' });
        goal = await command(goal.id, { kind: 'continue', nextStep: '重新整理核对清单', stepBudget: 1 });
        expect(goal.steps[0]!.number).toBe(2);
        expect(goal.steps[0]!.taskId).not.toBe(first);
        await command(goal.id, { kind: 'end' });
        expect(deletion.delete(goal.rootTaskId).ok).toBe(true);
        expect(service.list()).toEqual([]);
    });
    it('requires a continuation decision from actual result submission and persists it with reviewed evidence', async () => {
        const goal = service.create(request({ stepBudget: 1 })), taskId = goal.steps[0]!.taskId, run = new TaskRunRepository().getActiveRoot(taskId)!;
        const conversation = createConversation({ agentId: 'main', sourceChannel: 'webchat' }).key;
        new TaskConversationRepository().activateExecutionSession({ taskId, conversationId: conversation, agentId: 'main', runId: run.id });
        TaskRunCoordinator.start({ runId: run.id, fallbackObjective: goal.goal, context: { runId: run.id, conversationId: conversation, agentId: 'main', taskId, origin: 'task', channel: 'webchat', triggerKind: 'user' } });
        appendTranscriptEntry(conversation, { role: 'toolResult', toolCallId: 'read', toolName: 'web_fetch', content: [{ type: 'text', text: 'Two requests have the same requestId.' }], isError: false, timestamp: Date.now() });
        const input = { sources: [{ id: 'source', toolCallId: 'read', excerpt: 'Two requests have the same requestId.' }], claims: [{ id: 'claim', statement: 'Two requests have the same requestId.', kind: 'fact' as const, sourceIds: ['source'] }] };
        await expect(submitTaskResearchResult(conversation, 'publish', input)).rejects.toThrow('needs followUp');
        const result = await submitTaskResearchResult(conversation, 'publish', { ...input, followUp: { state: 'waiting', waitingFor: '需要请求链路日志', nextStep: '比对请求链路' } }, undefined, async ({ criteria }) => ({ claims: [{ id: 'claim', support: 'supported', note: 'Observed source' }], checks: criteria.map((_, criterionIndex) => ({ criterionIndex, status: 'passed', claimIds: ['claim'], note: 'Observed source' })) }));
        expect(result.followUp).toMatchObject({ state: 'waiting', waitingFor: '需要请求链路日志' });
        expect(currentTaskResearchResult(run.id)!.followUp).toEqual(result.followUp);
    });
    it('permits only private evidence reads and forbids task tool mutations', async () => {
        const goal = service.create(request()), taskId = goal.steps[0]!.taskId, run = new TaskRunRepository().getActiveRoot(taskId)!;
        const conversation = createConversation({ agentId: 'main', sourceChannel: 'webchat' }).key;
        new TaskConversationRepository().activateExecutionSession({ taskId, conversationId: conversation, agentId: 'main', runId: run.id });
        const policy = resolveExecutionToolPolicy(conversation);
        expect(policy).toMatchObject({ followUp: true, privateRoutine: true, nativeMcp: false });
        expect(allowsExecutionTool(policy, 'task_collaboration')).toBe(true);
        expect(allowsExecutionTool(policy, 'exec_command')).toBe(false);
        const tool = createTaskCollaborationTool({ getCurrentConversationId: () => conversation } as Parameters<typeof createTaskCollaborationTool>[0]);
        await expect(tool.execute('post', { command: 'post', kind: 'progress', body: 'mutate' }, undefined)).rejects.toThrow('read-only');
        await expect(tool.execute('source', { command: 'get', section: 'source', materialize: true }, undefined)).rejects.toThrow('read-only');
        const ledger = await tool.execute('goal', { command: 'get', section: 'goal' }, undefined);
        expect(JSON.stringify(ledger)).toContain('查清重复请求的原因');
        const result = await tool.execute('brief', { command: 'get', section: 'brief' }, undefined);
        expect(JSON.stringify(result)).toContain('Confirmed continuing goal');
    });
});
