import { getSessionMetadata, isXopcDatabaseOpen } from '../../storage/sqlite/index.js';
import { sanitizeForPromptLiteral } from '../prompt/sanitize-for-prompt.js';
import { OutcomeRepository } from '../../work/outcome-repository.js';
import { OutcomeExecutionStateRepository } from '../../work/outcome-execution-state.js';

import { buildActiveProjectContextForPrompt } from './project-context.js';

const MAX_OBJECTIVE_TEXT = 1200;
const MAX_CRITERIA = 12;

export type ExecutionObjective =
  | {
      kind: 'outcome';
      id: string;
      title: string;
      objective: string;
      status: string;
      scopeBoundary?: string;
      acceptanceCriteria: string[];
      deliverables: string[];
      nextAction?: string;
      blockedReason?: string;
    }
  | {
      kind: 'workflow';
      id?: string;
      title: string;
      objective: string;
      status: 'running';
    };

export interface ExecutionScope {
  sessionKey: string;
  projectId?: string;
  objective?: ExecutionObjective;
}

function bounded(value: string | undefined, max = MAX_OBJECTIVE_TEXT): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function outcomeObjective(sessionKey: string): ExecutionObjective | undefined {
  const execution = new OutcomeExecutionStateRepository().getBySession(sessionKey);
  if (!execution) return undefined;
  const outcome = new OutcomeRepository().get(execution.outcomeId);
  if (!outcome) return undefined;
  const contract = outcome.contract;
  return {
    kind: 'outcome',
    id: outcome.id,
    title: outcome.objective,
    objective: contract?.objective.trim() || outcome.objective,
    status: outcome.internalStatus,
    scopeBoundary: bounded(contract?.constraints.join('\n')),
    acceptanceCriteria: contract?.acceptanceCriteria.slice(0, MAX_CRITERIA) ?? [],
    deliverables: contract?.deliverables.slice(0, MAX_CRITERIA) ?? [],
    nextAction: bounded(execution.nextAction),
    blockedReason: bounded(execution.blockedReason),
  };
}

function workflowObjective(sessionKey: string): ExecutionObjective | undefined {
  const metadata = getSessionMetadata(sessionKey);
  if (!metadata) return undefined;
  if (metadata.sessionType === 'workflow-subagent' && metadata.parentSessionKey) {
    return workflowObjective(metadata.parentSessionKey);
  }
  if (metadata.sessionType !== 'workflow-run') return undefined;
  const objective = bounded(
    typeof metadata.customData?.workflowGoal === 'string'
      ? metadata.customData.workflowGoal
      : undefined,
  );
  const definitionId = metadata.workflowDefinitionId?.trim()
    || (typeof metadata.customData?.workflowDefinitionId === 'string'
      ? metadata.customData.workflowDefinitionId.trim()
      : 'workflow');
  return {
    kind: 'workflow',
    id: metadata.workflowRunId,
    title: definitionId,
    objective: objective || definitionId,
    status: 'running',
  };
}

export function resolveExecutionScope(sessionKey: string): ExecutionScope {
  if (!isXopcDatabaseOpen()) return { sessionKey };
  const metadata = getSessionMetadata(sessionKey);
  return {
    sessionKey,
    projectId: metadata?.projectId,
    objective: outcomeObjective(sessionKey) ?? workflowObjective(sessionKey),
  };
}

export function formatCurrentWorkForPrompt(scope: ExecutionScope): string | undefined {
  const objective = scope.objective;
  if (!objective) return undefined;
  const lines = [
    '# Current Work',
    '',
    `Type: ${objective.kind}`,
    ...(objective.id ? [`Id: ${sanitizeForPromptLiteral(objective.id)}`] : []),
    `Title: ${sanitizeForPromptLiteral(objective.title)}`,
    `Status: ${objective.status}`,
    '',
    '## Objective',
    sanitizeForPromptLiteral(objective.objective),
  ];
  if (objective.kind === 'outcome') {
    if (objective.scopeBoundary) {
      lines.push('', '## Scope Boundary', sanitizeForPromptLiteral(objective.scopeBoundary));
    }
    if (objective.acceptanceCriteria.length > 0) {
      lines.push('', '## Acceptance Criteria', ...objective.acceptanceCriteria.map((item) => `- ${sanitizeForPromptLiteral(item)}`));
    }
    if (objective.deliverables.length > 0) {
      lines.push('', '## Deliverables', ...objective.deliverables.map((item) => `- ${sanitizeForPromptLiteral(item)}`));
    }
    if (objective.nextAction) {
      lines.push('', 'Next action:', sanitizeForPromptLiteral(objective.nextAction));
    }
    if (objective.blockedReason) {
      lines.push('', 'Blocked reason:', sanitizeForPromptLiteral(objective.blockedReason));
    }
  }
  lines.push(
    '',
    'Keep work inside this objective and its project scope. Treat the acceptance criteria and completion evidence as the definition of done.',
  );
  return lines.join('\n');
}

export function buildExecutionScopeContextForPrompt(sessionKey: string): string | undefined {
  const scope = resolveExecutionScope(sessionKey);
  const sections = [
    buildActiveProjectContextForPrompt(sessionKey, { memoryQuery: scope.objective?.objective }),
    formatCurrentWorkForPrompt(scope),
  ].filter((section): section is string => Boolean(section?.trim()));
  return sections.join('\n\n') || undefined;
}
