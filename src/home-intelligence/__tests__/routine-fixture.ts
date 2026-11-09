import { randomUUID } from 'node:crypto';
import { TaskApplicationService } from '../../tasks/task-application-service.js';
import { TaskRepository } from '../../tasks/task-repository.js';
import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { HomeObservation } from '../observation.js';
import { appendTranscriptEntry, getXopcDatabase } from '../../storage/sqlite/index.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
export const routinePrincipal = { ownerId: 'owner', workspaceId: 'workspace' };
export function settleTask(taskId: string, passed = true) {
    const task = new TaskRepository().get(taskId)!;
    const runs = new TaskRunRepository();
    const run = runs.getActiveRoot(taskId)!;
    if (!run)
        throw Error('Expected active run');
    return runs.finalize({ runId: run.id, expectedVersion: run.version, receipt: {
            status: passed ? 'succeeded' : 'failed', summary: passed ? 'Current-period private draft with checked sources' : 'Missing source evidence',
            completionVerdict: passed ? 'achieved' : 'not_achieved', changes: [],
            evidence: [{ kind: 'source', title: 'Source check', summary: 'Checked fixture source', provenance: 'tool', strength: 'verified', observedAt: Date.now() }],
            verification: { status: passed ? 'passed' : 'failed', checks: task.contract!.acceptanceCriteria.map(criterion => ({
                    criterion, status: passed ? 'passed' : 'failed', evidenceTitles: ['Source check'],
                })) }, remainingWork: [], needsUser: false,
        } });
}
export function routineTrial() {
    const sourceId = randomUUID();
    createConversation({ agentId: 'main', sourceChannel: 'webchat', name: 'Weekly draft', routing: {
            source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner', agentId: 'main',
        } }, '', sourceId);
    appendTranscriptEntry(sourceId, { role: 'user', content: 'Compile my weekly report', timestamp: Date.now() });
    const observation = new HomeObservation(getXopcDatabase().db, routinePrincipal, () => true);
    observation.command({ expectedRevision: 0, idempotencyKey: 'start', command: { kind: 'start', backfillDays: 30 } });
    observation.collect();
    const topicId = observation.state().topics[0]!.id;
    const trial = new TaskApplicationService().create({ idempotencyKey: 'trial', title: 'Weekly draft', priority: 'normal',
        contract: { objective: 'Produce a weekly private draft', expectedOutputs: ['Draft'], acceptanceCriteria: ['Every item has a source'],
            constraints: ['Private draft only'], approvalRequired: [], assumptions: [], risks: [], acceptancePolicy: 'verified_auto', outputDestinations: [] },
        originConversationId: sourceId, dependencies: [], context: [], authorityGrants: [],
        activation: { mode: 'start', executor: { kind: 'agent', agentId: 'main' } },
    });
    if (!trial.ok)
        throw Error('No trial');
    observation.recordTrial(topicId, 'fixture-opportunity', trial.model.task.id, Date.now());
    return { observation, topicId, sourceId, taskId: trial.model.task.id };
}
