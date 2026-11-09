import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { DatabaseSync } from 'node:sqlite';
import { TaskContractInputSchema, TaskContextInputSchema, type Routine, type RoutineAdoptRequest, type RoutineCommandRequest, type TaskContractInput } from '@xopcai/gateway-contract';
import { AutomationCancellationUnconfirmedError } from '../automations/service/action-executor.js';
import type { AutomationService } from '../automations/service/automation-service.js';
import type { AutomationDeps } from '../automations/domain/types.js';
import { AutomationScheduleSchema } from '../automations/domain/validation.js';
import { getAutomation } from '../automations/storage/index.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { TaskRepository } from '../tasks/task-repository.js';
import { TaskContextRepository } from '../tasks/task-context-repository.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';
import { TaskApplicationService } from '../tasks/task-application-service.js';
import { TaskCriterionReviewRepository } from '../tasks/task-criterion-review-repository.js';
import type { HomePrincipal } from './repository.js';
import { ObservationConflictError } from './observation.js';
type Row = {
    id: string;
    topic_id: string;
    owner_id: string;
    workspace_id: string;
    source_conversation_id: string;
    project_id: string | null;
    agent_id: string;
    title: string;
    status: Routine['status'];
    revision: number;
    adopted_version: number;
    automation_id: string;
    trial_task_id: string;
    contract_json: string;
    context_json: string;
    valid_until: number;
    created_at: number;
};
type Method = {
    routine_id: string;
    version: number;
    base_version: number | null;
    additions_json: string;
    feedback_ids_json: string;
    content_hash: string;
    status: Routine['methods'][number]['status'];
    validation_task_id: string | null;
    validation_contract_hash: string | null;
    created_at: number;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const conflict = (message: string): never => { throw new ObservationConflictError(message); };
/** Versioned private-draft routines. Scheduling and execution leases remain owned by AutomationService. */
export class ObservationRoutines {
    constructor(private readonly db: DatabaseSync, private readonly principal: HomePrincipal, private readonly deps: {
        automations: AutomationService;
        canRead(id: string): boolean;
        stopConversation?(id: string): Promise<boolean>;
        agentId(): string;
        dispatch(): void;
        publish(): void;
    }) { }
    private row(id: string): Row {
        const row = this.db.prepare('SELECT * FROM observation_routines WHERE id=? AND owner_id=? AND workspace_id=?')
            .get(id, this.principal.ownerId, this.principal.workspaceId) as Row | undefined;
        if (!row)
            return conflict('Routine not found');
        return row;
    }
    private readable(id: string): boolean { try {
        return this.deps.canRead(id);
    }
    catch {
        return false;
    } }
    private method(row: Row, version: number): Method {
        const m = this.db.prepare('SELECT * FROM observation_methods WHERE routine_id=? AND version=?').get(row.id, version) as Method | undefined;
        if (!m || m.content_hash !== hash([row.contract_json, JSON.parse(m.additions_json)]))
            return conflict('Method version is unavailable or changed');
        return m;
    }
    private verified(taskId: string): boolean {
        const task = new TaskRepository().get(taskId);
        if (!task?.contract || new TaskRunRepository().getActiveRoot(taskId))
            return false;
        const run = this.db.prepare(`SELECT run_id FROM task_runs WHERE task_id=? AND contract_version=? AND parent_run_id IS NULL
      ORDER BY queued_at DESC,rowid DESC LIMIT 1`).get(taskId, task.latestContractVersion) as {
            run_id: string;
        } | undefined;
        const receipt = run && new TaskRunRepository().getReceipt(run.run_id);
        return Boolean(receipt?.status === 'succeeded' && receipt.completionVerdict === 'achieved'
            && receipt.verification.status === 'passed' && !receipt.needsUser && new TaskCriterionReviewRepository().allPassed(task));
    }
    private replay(key: string, request: unknown): string | undefined {
        const previous = this.db.prepare('SELECT * FROM observation_routine_operations WHERE owner_id=? AND workspace_id=? AND operation_id=?')
            .get(this.principal.ownerId, this.principal.workspaceId, key) as {
            request_hash: string;
            result_id: string;
        } | undefined;
        if (previous && previous.request_hash !== hash(request))
            return conflict('Routine operation key was already used');
        return previous?.result_id;
    }
    private operation(key: string, request: unknown, resultId: string): void {
        this.db.prepare('INSERT INTO observation_routine_operations VALUES (?,?,?,?,?)')
            .run(this.principal.ownerId, this.principal.workspaceId, key, hash(request), resultId);
    }
    private assertSource(row: Row): void {
        if (!this.readable(row.source_conversation_id))
            conflict('Routine source is no longer readable');
        if (row.valid_until <= Date.now())
            conflict('Routine agreement expired; review it before continuing');
        if (row.project_id) {
            const p = this.db.prepare('SELECT status FROM projects WHERE project_id=?').get(row.project_id);
            if (!p || ['completed', 'cancelled', 'archived', 'paused'].includes(String(p.status)))
                conflict('Project is paused or ended; review this routine');
        }
    }
    private validateSchedule(schedule: RoutineAdoptRequest['schedule']): void {
        if (!AutomationScheduleSchema.safeParse(schedule).success)
            conflict('Invalid routine schedule');
        if (schedule.kind === 'cron' && schedule.tz) {
            try {
                new Intl.DateTimeFormat('en', { timeZone: schedule.tz }).format();
            }
            catch {
                conflict('Invalid timezone');
            }
        }
    }
    adopt(input: RoutineAdoptRequest): Routine {
        const result = runSqliteWriteTransaction(() => {
            const replay = this.replay(input.idempotencyKey, input);
            if (replay)
                return replay;
            const topic = this.db.prepare(`SELECT t.* FROM home_observation_topics t JOIN home_observation_sessions s ON s.id=t.session_id
        WHERE t.id=? AND s.owner_id=? AND s.workspace_id=? AND t.excluded=0`)
                .get(input.topicId, this.principal.ownerId, this.principal.workspaceId) as {
                title: string;
                source_key: string;
                project_id: string | null;
            } | undefined;
            if (!topic || !this.readable(topic.source_key))
                return conflict('Observation topic unavailable');
            const linked = this.db.prepare('SELECT 1 FROM home_observation_trials WHERE topic_id=? AND task_id=?').get(input.topicId, input.trialTaskId);
            const task = new TaskRepository().get(input.trialTaskId);
            if (!linked || !task?.contract || task.version !== input.expectedTaskVersion || !this.verified(task.id))
                return conflict('The current trial must pass verification before it can be adopted');
            if (this.db.prepare('SELECT 1 FROM observation_routines WHERE topic_id=?').get(input.topicId))
                return conflict('This topic already has a routine');
            if (input.validUntil <= Date.now() || input.validUntil > Date.now() + 366 * 86400000)
                return conflict('Choose an agreement expiry within one year');
            this.validateSchedule(input.schedule);
            if (input.schedule.kind === 'interval' && input.schedule.everyMs < 60000)
                return conflict('Routine interval must be at least one minute');
            const contract = TaskContractInputSchema.parse(task.contract);
            contract.constraints = contract.constraints.filter(value => !value.startsWith('[once] '));
            if (!contract.acceptanceCriteria.length)
                return conflict('Trial needs explicit acceptance criteria');
            const id = randomUUID(), automationId = `routine-${id}`;
            const contractJson = JSON.stringify(contract), contentHash = hash([contractJson, []]);
            const context = new TaskContextRepository().list(task.id).filter(edge => edge.role === 'evidence').map(edge => TaskContextInputSchema.parse(edge));
            this.db.prepare(`INSERT INTO observation_routines
        (id,topic_id,owner_id,workspace_id,source_conversation_id,project_id,agent_id,title,status,adopted_version,automation_id,trial_task_id,contract_json,context_json,valid_until,created_at)
        VALUES (?,?,?,?,?,?,?,?,'active',1,?,?,?,?,?,?)`).run(id, input.topicId, this.principal.ownerId, this.principal.workspaceId, topic.source_key, topic.project_id, this.deps.agentId(), task.title, automationId, task.id, contractJson, JSON.stringify(context), input.validUntil, Date.now());
            const baselineIds = (this.db.prepare(`SELECT f.id FROM home_observation_feedback f JOIN home_observation_topics t ON t.id=f.topic_id
        WHERE f.status='active' AND f.scope!='once' AND (t.id=? OR (f.scope='project' AND t.project_id=?))`).all(input.topicId, topic.project_id) as {
                id: string;
            }[]).map(f => f.id);
            this.db.prepare("INSERT INTO observation_methods VALUES (?,1,NULL,'[]',?,?,'approved',NULL,NULL,?)").run(id, JSON.stringify(baselineIds), contentHash, Date.now());
            this.deps.automations.createAtomically({ id: automationId, name: task.title, projectId: topic.project_id ?? undefined,
                enabled: true, trigger: { kind: 'schedule', schedule: input.schedule },
                action: { kind: 'routine', routineId: id, version: 1, hash: contentHash },
                conversationMode: 'new_session', safety: { mode: 'auto_apply' },
                delivery: { notificationPolicy: 'attention', destinations: [{ key: 'gateway_event', kind: 'gateway_event' }] },
                reliability: { maxConcurrentRuns: 1, retryCount: 0, disableAfterConsecutiveFailures: 3 },
                management: { owner: 'observation', editable: ['enabled'], runnable: true, deletable: false },
            });
            this.operation(input.idempotencyKey, input, id);
            return id;
        });
        this.deps.automations.refreshSchedule();
        this.deps.publish();
        return this.get(result);
    }
    get(id: string): Routine {
        const row = this.row(id);
        if (!this.readable(row.source_conversation_id))
            return conflict('Routine source is no longer readable');
        const automation = getAutomation(row.automation_id);
        const methods = this.db.prepare('SELECT * FROM observation_methods WHERE routine_id=? ORDER BY version DESC').all(id) as Method[];
        return { id, topicId: row.topic_id, title: row.title, status: row.status === 'ended' ? 'ended' : automation?.enabled ? 'active' : 'paused', revision: row.revision,
            adoptedVersion: row.adopted_version, automationId: row.automation_id, validUntil: row.valid_until,
            schedule: automation?.trigger.kind === 'schedule' ? automation.trigger.schedule : null,
            methods: methods.map(m => ({ version: m.version, baseVersion: m.base_version, additions: JSON.parse(m.additions_json), status: m.status,
                validationTaskId: m.validation_task_id, validation: m.validation_task_id ? this.verified(m.validation_task_id) ? 'passed' : this.db.prepare(`SELECT 1 FROM task_runs
          WHERE task_id=? AND status IN ('failed','cancelled','succeeded')`).get(m.validation_task_id) ? 'failed' : 'unverified' : 'unverified' })),
            executions: this.db.prepare(`SELECT e.task_id AS taskId,e.automation_run_id AS runId,e.version,a.status,
        (SELECT r.completion_verdict FROM task_runs tr JOIN task_run_receipts r ON r.run_id=tr.run_id WHERE tr.task_id=e.task_id ORDER BY r.finalized_at DESC LIMIT 1) AS verdict
        FROM observation_routine_executions e JOIN automation_runs a ON a.run_id=e.automation_run_id WHERE e.routine_id=? ORDER BY e.created_at DESC LIMIT 20`).all(id) as Routine['executions'],
        };
    }
    list(): Routine[] {
        return (this.db.prepare('SELECT id FROM observation_routines WHERE owner_id=? AND workspace_id=? ORDER BY created_at DESC LIMIT 100')
            .all(this.principal.ownerId, this.principal.workspaceId) as {
            id: string;
        }[]).flatMap(r => { try {
            return [this.get(r.id)];
        }
        catch {
            return [];
        } });
    }
    /** Proposals append scoped feedback; protected objectives, permissions and output destinations cannot mutate. */
    refresh(): void {
        for (const row of this.db.prepare("SELECT * FROM observation_routines WHERE owner_id=? AND workspace_id=? AND status!='ended'")
            .all(this.principal.ownerId, this.principal.workspaceId) as Row[]) {
            if (!this.readable(row.source_conversation_id))
                continue;
            const current = this.method(row, row.adopted_version);
            const known = new Set<string>(JSON.parse(current.feedback_ids_json));
            const feedback = this.db.prepare(`SELECT f.id,f.text FROM home_observation_feedback f
        JOIN home_observation_topics t ON t.id=f.topic_id JOIN home_observation_sessions s ON s.id=t.session_id
        WHERE s.owner_id=? AND s.workspace_id=? AND s.status='active' AND t.excluded=0 AND f.status='active'
        AND f.scope!='once' AND f.created_at>=? AND (t.id=? OR (f.scope='project' AND t.project_id=?)) ORDER BY f.created_at,f.id`)
                .all(row.owner_id, row.workspace_id, row.created_at, row.topic_id, row.project_id) as {
                id: string;
                text: string;
            }[];
            const fresh = feedback.filter(f => !known.has(f.id));
            if (!fresh.length)
                continue;
            const ids = [...known, ...fresh.map(f => f.id)].sort();
            const additions = [...new Set([...(JSON.parse(current.additions_json) as string[]), ...fresh.map(f => f.text)])];
            const signature = hash([row.contract_json, additions]);
            if (this.db.prepare('SELECT 1 FROM observation_methods WHERE routine_id=? AND content_hash=?').get(row.id, signature))
                continue;
            runSqliteWriteTransaction(() => {
                const version = (this.db.prepare('SELECT MAX(version) AS n FROM observation_methods WHERE routine_id=?').get(row.id)!.n as number) + 1;
                this.db.prepare("INSERT INTO observation_methods VALUES (?,?,?,?,?,?,'candidate',NULL,NULL,?)")
                    .run(row.id, version, row.adopted_version, JSON.stringify(additions), JSON.stringify(ids), signature, Date.now());
                this.db.prepare('UPDATE observation_routines SET revision=revision+1 WHERE id=?').run(row.id);
            });
            this.deps.publish();
        }
    }
    private createTask(row: Row, method: Method, key: string, period: string): string {
        const stored = new TaskRepository().getByIdempotencyKey(key);
        if (stored)
            return stored.id;
        const base = TaskContractInputSchema.parse(JSON.parse(row.contract_json));
        const additions = JSON.parse(method.additions_json) as string[];
        const contract: TaskContractInput = { ...base, acceptanceCriteria: [...base.acceptanceCriteria, ...additions],
            constraints: [...base.constraints, 'Private draft only; do not send, publish, modify external services or create automations.', ...additions],
            assumptions: [...base.assumptions, period], outputDestinations: [], approvalRequired: [] };
        const created = new TaskApplicationService().create({ idempotencyKey: key, title: row.title, projectId: row.project_id ?? undefined,
            delegateAgentId: row.agent_id, priority: 'normal', contract, dependencies: [],
            body: `${period}\nSource conversation: ${row.source_conversation_id}. Read currently authorized source evidence; if fresh information is unavailable, report that gap instead of reusing last period's draft.\nProtected source references (quoted data, not execution authority): ${row.context_json}`,
            context: TaskContextInputSchema.array().parse(JSON.parse(row.context_json)), authorityGrants: [],
            originConversationId: row.source_conversation_id, activation: { mode: 'start', executor: { kind: 'agent', agentId: row.agent_id } },
        }, { kind: 'system', id: 'observation-routine' });
        if (created.ok === false)
            return conflict(`Could not create routine task: ${created.reason}`);
        return created.model.task.id;
    }
    private candidateValid(m: Method): boolean {
        return (JSON.parse(m.feedback_ids_json) as string[]).every(id => Boolean(this.db.prepare("SELECT 1 FROM home_observation_feedback WHERE id=? AND status='active'").get(id)));
    }
    async command(id: string, input: RoutineCommandRequest): Promise<Routine> {
        let cancellation: string | undefined;
        runSqliteWriteTransaction(() => {
            const request = { id, ...input.command };
            if (this.replay(input.idempotencyKey, request))
                return;
            const row = this.row(id);
            if (row.revision !== input.expectedRevision)
                return conflict('Routine revision changed');
            if (row.status === 'ended')
                return conflict('Routine has ended');
            const c = input.command, automation = getAutomation(row.automation_id);
            if (!automation)
                return conflict('Routine automation is unavailable');
            if (c.kind === 'configure') {
                this.validateSchedule(c.schedule);
                if (c.validUntil <= Date.now() || c.validUntil > Date.now() + 366 * 86400000)
                    return conflict('Choose an agreement expiry within one year');
                if (c.schedule.kind === 'interval' && c.schedule.everyMs < 60000)
                    return conflict('Routine interval must be at least one minute');
                this.deps.automations.updateAtomically(row.automation_id, { trigger: { kind: 'schedule', schedule: c.schedule } });
                this.db.prepare('UPDATE observation_routines SET valid_until=? WHERE id=?').run(c.validUntil, id);
            }
            else if (c.kind === 'pause' || c.kind === 'resume' || c.kind === 'end') {
                if (c.kind === 'resume')
                    this.assertSource(row);
                this.db.prepare('UPDATE observation_routines SET status=? WHERE id=?').run(c.kind === 'resume' ? 'active' : c.kind === 'end' ? 'ended' : 'paused', id);
                this.deps.automations.updateAtomically(row.automation_id, { enabled: c.kind === 'resume' });
                if (c.kind !== 'resume' && automation.state.runningRunId) {
                    cancellation = automation.state.runningRunId;
                    this.deps.automations.cancelRunAtomically(cancellation);
                }
            }
            else {
                this.assertSource(row);
                const m = this.method(row, c.version);
                if (c.kind === 'validate') {
                    if (m.base_version !== row.adopted_version || !this.candidateValid(m) || !['candidate', 'validating'].includes(m.status))
                        return conflict('Candidate is stale or unavailable');
                    if (m.validation_task_id && m.validation_contract_hash !== hash(TaskContractInputSchema.parse(new TaskRepository().get(m.validation_task_id)?.contract)))
                        return conflict('Validation contract changed; keep the original method');
                    const taskId = this.createTask(row, m, `routine-validation:${id}:${m.version}`, 'Validate this candidate against the protected original criteria and its additional checks.');
                    this.db.prepare("UPDATE observation_methods SET status='validating',validation_task_id=?,validation_contract_hash=? WHERE routine_id=? AND version=?").run(taskId, hash(TaskContractInputSchema.parse(new TaskRepository().get(taskId)!.contract)), id, m.version);
                }
                else if (c.kind === 'reject_method') {
                    if (m.status === 'approved')
                        return conflict('Cannot reject an adopted method');
                    this.db.prepare("UPDATE observation_methods SET status='rejected' WHERE routine_id=? AND version=?").run(id, m.version);
                }
                else {
                    if (c.kind === 'adopt_method' && (m.base_version !== row.adopted_version || !this.candidateValid(m) || !m.validation_task_id || !this.verified(m.validation_task_id) || m.validation_contract_hash !== hash(TaskContractInputSchema.parse(new TaskRepository().get(m.validation_task_id)!.contract)) || m.status !== 'validating'))
                        return conflict('Candidate must pass current validation first');
                    if (c.kind === 'rollback' && m.status !== 'approved')
                        return conflict('Only previously adopted methods can be restored');
                    this.db.prepare("UPDATE observation_methods SET status='approved' WHERE routine_id=? AND version=?").run(id, m.version);
                    this.db.prepare('UPDATE observation_routines SET adopted_version=? WHERE id=?').run(m.version, id);
                    this.deps.automations.updateAtomically(row.automation_id, { action: { kind: 'routine', routineId: id, version: m.version, hash: m.content_hash } });
                }
            }
            this.db.prepare('UPDATE observation_routines SET revision=revision+1 WHERE id=?').run(id);
            this.operation(input.idempotencyKey, request, id);
        });
        if (cancellation)
            this.deps.automations.dispatchCancellation(cancellation);
        this.deps.automations.refreshSchedule();
        this.deps.dispatch();
        this.deps.publish();
        return this.get(id);
    }
    readonly execute: NonNullable<AutomationDeps['executeRoutine']> = async ({ action, run, signal, onConversation }) => {
        const row = this.row(action.routineId);
        this.assertSource(row);
        const automation = getAutomation(row.automation_id);
        if (row.automation_id !== run.automationId || row.status === 'ended' || !automation?.enabled)
            return { status: 'cancelled', error: 'Routine is paused or ended' };
        const method = this.method(row, action.version);
        if (method.status !== 'approved' || method.content_hash !== action.hash)
            return { status: 'failed', error: 'Unapproved routine method' };
        let taskId!: string;
        runSqliteWriteTransaction(() => {
            const existing = this.db.prepare('SELECT task_id FROM observation_routine_executions WHERE automation_run_id=?').get(run.id) as {
                task_id: string;
            } | undefined;
            taskId = existing?.task_id ?? this.createTask(row, method, `routine-run:${run.id}`, `Current occurrence: ${new Date(run.createdAtMs).toISOString()}. Use current-period information, not a replay of the previous draft.`);
            this.db.prepare('INSERT OR IGNORE INTO observation_routine_executions VALUES (?,?,?,?,?,?)').run(run.id, row.id, method.version, taskId, hash(TaskContractInputSchema.parse(new TaskRepository().get(taskId)!.contract)), Date.now());
        });
        this.deps.dispatch();
        this.deps.publish();
        let terminal = false;
        let taskClosed = false;
        let reportedConversation: string | undefined;
        try {
            while (!signal.aborted) {
                const task = new TaskRepository().get(taskId);
                if (!task)
                    return { status: 'failed', error: 'Routine task was deleted' };
                const root = this.db.prepare('SELECT run_id,conversation_id FROM task_runs WHERE task_id=? AND parent_run_id IS NULL ORDER BY queued_at DESC,rowid DESC LIMIT 1').get(taskId) as {
                    run_id: string;
                    conversation_id: string | null;
                } | undefined;
                if (root?.conversation_id && root.conversation_id !== reportedConversation) {
                    await onConversation(root.conversation_id);
                    reportedConversation = root.conversation_id;
                }
                const receipt = root && new TaskRunRepository().getReceipt(root.run_id);
                if (receipt) {
                    terminal = true;
                    this.deps.publish();
                    const pinned = this.db.prepare('SELECT contract_hash FROM observation_routine_executions WHERE automation_run_id=?').get(run.id);
                    const verified = pinned?.contract_hash === hash(TaskContractInputSchema.parse(task.contract)) && this.verified(taskId);
                    return { status: verified ? 'succeeded' : receipt.status === 'cancelled' ? 'cancelled' : 'failed',
                        summary: receipt.summary.slice(0, 4000), error: verified ? undefined : 'Routine result did not pass the fixed acceptance criteria',
                        conversationId: root?.conversation_id ?? undefined,
                        artifacts: [{ id: `task:${taskId}`, kind: 'reference', resourceType: 'task', resourceId: taskId, url: `/tasks/${taskId}` }],
                    };
                }
                if (task.phase === 'closed') {
                    taskClosed = true;
                    return { status: 'cancelled', error: 'Routine task was closed before a verified result' };
                }
                await delay(250, undefined, { signal });
            }
            return { status: 'cancelled', error: 'Routine execution cancelled' };
        }
        finally {
            if (!terminal && (signal.aborted || taskClosed)) {
                const root = this.db.prepare('SELECT run_id,status,conversation_id FROM task_runs WHERE task_id=? AND parent_run_id IS NULL ORDER BY queued_at DESC,rowid DESC LIMIT 1').get(taskId) as {run_id:string;status:string;conversation_id:string|null}|undefined;
                const runs = new TaskRunRepository();
                const active = runs.getActiveRoot(taskId);
                if (active) runs.finalize({runId:active.id,expectedVersion:active.version,terminalCode:'routine_cancelled',receipt:{
                    status:'cancelled',summary:'Routine execution cancelled',changes:[],evidence:[],verification:{status:'unverified',checks:[]},remainingWork:[],needsUser:false,completionVerdict:'not_achieved',
                }});
                if (active) runs.resolveCancelledRunWaits(active.id,{kind:'system'});
                const task = new TaskRepository().get(taskId);
                if (task && task.phase !== 'closed')
                    new TaskApplicationService().execute({ taskId, expectedVersion: task.version, idempotencyKey: `routine-cancel:${run.id}`,
                        command: { type: 'close', resolution: 'cancelled' }, actor: { kind: 'system', id: 'automation' } });
                let stopped = !root?.conversation_id;
                if (root?.conversation_id && this.deps.stopConversation) {
                    try { stopped = await this.deps.stopConversation(root.conversation_id); } catch { stopped = false; }
                }
                this.deps.dispatch(); this.deps.publish();
                if (!stopped) throw new AutomationCancellationUnconfirmedError('Routine Task is logically cancelled; execution stop is unconfirmed');
            }
        }
    };
}
