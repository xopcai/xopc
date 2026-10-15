import type { SpecialistTaskRequirements } from '@xopcai/gateway-contract';

import { assessSpecialist, type MatchingContext, type SpecialistAssessment } from '../agent-matching/service.js';
import { personalCapabilities } from '../personal-agent/capability-service.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { assertTaskHandoffExecutorAccess } from './task-handoff.js';
import { TaskContextRepository } from './task-context-repository.js';
import { TaskRepository, type TaskAggregate } from './task-repository.js';

export const EXECUTION_CAPABILITIES = {
  read_input: ['read_file', 'read_media', 'exec_command'],
  execute_code: ['exec_command'],
  publish_files: ['publish_artifacts'],
  web_research: ['web_fetch', 'browser_use'],
  browser: ['browser_use'],
  generate_image: ['image_generate'],
} as const;
export type ExecutionCapability = keyof typeof EXECUTION_CAPABILITIES;
export interface ExecutionRequirement { capability: ExecutionCapability; source: 'structured_input' | 'background_inference'; reason: string }

export function taskExecutionRequirements(task: TaskAggregate, requirements: SpecialistTaskRequirements,
  inferred: ExecutionCapability[] = []): ExecutionRequirement[] {
  const needs = new Map<ExecutionCapability, ExecutionRequirement>();
  const add = (capability: ExecutionCapability, source: ExecutionRequirement['source'], reason: string) => needs.set(capability, { capability, source, reason });
  for (const capability of inferred) if (capability in EXECUTION_CAPABILITIES) add(capability, 'background_inference', 'Minimal operation inferred by the background contract planner; no authority granted');
  if (requirements.inputKinds?.some(kind => /^(csv|xlsx|pdf|docx|pptx|file|document|spreadsheet|text)$/.test(kind))) add('read_input', 'structured_input', 'Structured file input requires a registered reader or execution tool');
  if (requirements.outputKinds?.some(kind => /^(file|pdf|docx|pptx|xlsx|csv|spreadsheet|document)$/.test(kind))) add('publish_files', 'structured_input', 'Requested file output requires publication');
  if (requirements.inputKinds?.some(kind => /^(pdf|docx|pptx|xlsx)$/.test(kind))) add('execute_code', 'structured_input', 'Binary input requires an executable parser; text readers alone do not establish binary processing capability');
  // A long brief needs a bounded read path, not a general product mutation tool.
  if (!requirements.connector && (task.body?.length ?? 0) > 12000) requirements.requiredTools = [...new Set([...(requirements.requiredTools ?? []), 'task_collaboration'])];
  return [...needs.values()];
}

export function assessTaskExecutor(agentId: string, requirements: SpecialistTaskRequirements, needs: ExecutionRequirement[], context: MatchingContext, taskId?: string): SpecialistAssessment {
  const assessment = assessSpecialist(agentId, requirements, context);
  for (const need of needs) {
    const options = EXECUTION_CAPABILITIES[need.capability].map(tool => assessSpecialist(agentId,
      { ...requirements, requiredSkills: [], requiredTools: [tool] }, context));
    const available = options.find(option => option.checks.some(check => check.condition.startsWith('tool:') && check.state === 'verified'));
    assessment.checks.push({ condition: `capability:${need.capability}`, state: available ? 'verified' : 'blocked',
      reasonCode: available ? 'registered_operation_available' : 'required_operation_unavailable',
      detail: available ? available.checks.find(check => check.condition.startsWith('tool:'))?.condition : JSON.stringify(options.flatMap(option => option.checks.filter(check => check.condition.startsWith('tool:')))) });
  }
  if (taskId) {
    try { assertTaskHandoffExecutorAccess(taskId, agentId); }
    catch (error) { assessment.checks.push({ condition: 'source_authorization', state: 'blocked', reasonCode: 'selected_source_unavailable',
      detail: error instanceof Error ? error.message : String(error) }); }
  }
  assessment.eligibility = assessment.checks.some(check => check.state === 'blocked') ? 'blocked'
    : assessment.checks.some(check => check.state === 'unknown') ? 'needs_verification' : 'eligible';
  return assessment;
}

export function captureExecutionRequirements(task: TaskAggregate, requirements: SpecialistTaskRequirements, needs: ExecutionRequirement[]): void {
  new TaskContextRepository().captureSnapshot({ ownerKind: 'task', ownerId: task.id, query: task.contract?.objective ?? task.title,
    relationshipPolicy: { kind: 'task_execution_requirements', contractVersion: task.latestContractVersion },
    selectedItems: [{ requirements, needs, contractVersion: task.latestContractVersion,
      requirementOrigins: { requestedAgentId: 'provided_requirement', requiredSkills: 'provided_requirement',
        requiredTools: 'provided_requirement_or_host_bounded_reader', acceptanceCriteria: 'current_contract' } }], authorizationSnapshot: { expandsAuthority: false, liveRecheckRequired: true } });
}

export function savedExecutionRequirements(taskId: string): { requirements: SpecialistTaskRequirements; needs: ExecutionRequirement[]; contractVersion: number } | undefined {
  const row = getSqliteDatabase().prepare(`SELECT selected_items_json FROM context_snapshots
    WHERE owner_kind = 'task' AND owner_id = ? AND json_extract(relationship_policy_json, '$.kind') = 'task_execution_requirements'
    ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(taskId) as { selected_items_json: string } | undefined;
  return row ? JSON.parse(row.selected_items_json)[0] : undefined;
}

export function assertTaskExecutorReady(taskId: string, originConversationId: string, agentId: string, context: MatchingContext): void {
  const saved = savedExecutionRequirements(taskId);
  if (!saved) return;
  if (new TaskRepository().require(taskId).latestContractVersion !== saved.contractVersion) throw new Error('Task contract changed after capability validation; reallocate before execution');
  const connector = saved.requirements.connector;
  if (connector) {
    const permitted = personalCapabilities(originConversationId, connector.connectorId, connector.accountId)
      .some(capability => capability.status === 'ready' && capability.accounts.some(account => account.accountId === connector.accountId && account.executorAgentIds.includes(agentId)));
    context = { ...context, checkConnector: () => ({ condition: 'connector', state: permitted ? 'verified' : 'blocked', reasonCode: permitted ? 'account_authorized' : 'account_unavailable' }) };
  }
  const fresh = assessTaskExecutor(agentId, saved.requirements, saved.needs, context, taskId);
  if (fresh.eligibility !== 'eligible') throw new Error(`Task executor capability changed: ${JSON.stringify(fresh.checks.filter(check => ['blocked', 'unknown'].includes(check.state)))}`);
}
