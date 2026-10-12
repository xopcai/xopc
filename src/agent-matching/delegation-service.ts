import type { ActorRef, TaskCreateRequest } from '@xopcai/gateway-contract';

import { createLogger } from '../utils/logger.js';
import { afterSqliteCommit, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { TaskApplicationService, type TaskApplicationResult } from '../tasks/task-application-service.js';
import { TaskReadModelProjector } from '../tasks/task-read-model-projector.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';
import { AgentSelectionRepository, selectionRequestHash, type SelectionRecord } from './selection-repository.js';
import { assessSpecialist, type MatchingContext, type SpecialistAssessment } from './service.js';
import type { SpecialistTaskRequirements } from './schema.js';

const log = createLogger('AgentMatching');

export function assertSpecialistEligible(assessment: SpecialistAssessment): void {
  if (assessment.eligibility !== 'eligible') {
    const failures = assessment.checks.filter(check => check.state === 'blocked' || check.state === 'unknown');
    throw new Error(`Specialist Agent is unavailable: ${assessment.id}: ${failures.map(check => `${check.condition} ${check.detail ?? check.reasonCode}`).join('; ')}`);
  }
}

/** Runs inside the product capability transaction; no async work or dispatch occurs here. */
export function createSelectedTask(input: TaskCreateRequest, actor: ActorRef | undefined, selection: {
  conversationId: string; requirements: SpecialistTaskRequirements; context: MatchingContext;
  candidates?: SelectionRecord['candidates']; requestHash?: string; reason?: string; source: SelectionRecord['selectionSource']; previousSelectionId?: string;
}): TaskApplicationResult {
  return runSqliteWriteTransaction(() => {
    if (input.originConversationId !== selection.conversationId) throw new Error('Task selection origin mismatch');
    if (input.activation.mode !== 'start' || !input.delegateAgentId || input.activation.executor?.kind !== 'agent'
      || input.activation.executor.agentId !== input.delegateAgentId) throw new Error('Selection must match the Task executor');
    const repository = new AgentSelectionRepository();
    const hash = selection.requestHash ?? selectionRequestHash({ input, requirements: selection.requirements });
    const previous = repository.find(selection.conversationId, input.idempotencyKey);
    if (previous) {
      if (previous.requestHash !== hash) throw new Error('Idempotency key was reused with different input');
      if (previous.taskId) {
        const model = new TaskReadModelProjector().get(previous.taskId);
        if (!model) throw new Error('Selected Task no longer exists');
        const run = new TaskRunRepository().getActiveRoot(previous.taskId);
        if (previous.status === 'start_failed') return { ok: false, reason: 'invalid_transition', model };
        return previous.status === 'start_blocked' ? { ok: false, reason: 'blocked', model }
          : { ok: true, model, ...(run ? { runId: run.id } : {}) };
      }
      throw new Error('Previous selection attempt was rejected; use a new attempt key');
    }
    const assessment = assessSpecialist(input.delegateAgentId!, selection.requirements, selection.context);
    assertSpecialistEligible(assessment);
    const record = repository.create({ conversationId: selection.conversationId, key: input.idempotencyKey,
      requestHash: hash, requirements: selection.requirements, assessment,
      candidates: selection.candidates, source: selection.source, reason: selection.reason, previousSelectionId: selection.previousSelectionId,
      status: 'task_linked' });
    const result = new TaskApplicationService().create(input, actor);
    repository.link(record.id, { taskId: result.model?.task.id, runId: result.ok ? result.runId : undefined,
      status: result.ok === false ? (result.reason === 'blocked' ? 'start_blocked' : 'start_failed') : 'task_linked',
      reasonCode: result.ok === false ? result.reason : undefined });
    afterSqliteCommit(() => log.info({ selectionId: record.id, conversationId: selection.conversationId,
      agentId: assessment.id, taskId: result.model?.task.id, phase: 'delegate',
      reasonCode: result.ok === false ? result.reason : 'task_linked' }, 'Specialist selection recorded'));
    return result;
  });
}
