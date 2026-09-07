import { randomUUID } from 'node:crypto';

import {
  searchKnowledgeItems,
  type KnowledgeItem,
  type KnowledgeSource,
  type KnowledgeVisibilityContext,
} from '../../knowledge-memory/index.js';
import { retrievalLexicalSimilarity } from '../../retrieval/textFeatures.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { listCollaborationRules } from '../../storage/sqlite/collaboration-rule-repository.js';
import { calculateExecutionValue } from '../../user-model/importance.js';
import { listUserAssertions } from '../../user-model/repository.js';
import type { UserAssertion, UserModelScope } from '../../user-model/domain.js';
import { buildUserContextBlock } from '../memory/context-fence.js';
import { getExecutionContextFeedbackScores } from './audit.js';

export type RuleEnforcementLevel = 'prompt' | 'planner' | 'tool_gate';

export interface ExecutionRule {
  id: string;
  statement: string;
  priority: number;
  enforcementLevel: RuleEnforcementLevel;
  conditions: Record<string, unknown>;
}

export interface RankedExecutionAssertion {
  assertion: UserAssertion;
  score: number;
  reasons: string[];
}

export interface ExecutionGoal {
  id: string;
  title: string;
  desiredOutcome: string;
  status: string;
  declaredImportance?: number;
  targetAt?: number;
}

export interface ExecutionPriority {
  id: string;
  targetType: string;
  targetId: string;
  rank: 'primary' | 'secondary' | 'background';
  urgency: number;
  validTo: number;
}

export interface ExecutionContext {
  traceId: string;
  asOf: number;
  query: string;
  rules: ExecutionRule[];
  assertions: RankedExecutionAssertion[];
  goals: ExecutionGoal[];
  priorities: ExecutionPriority[];
  knowledge: KnowledgeItem[];
}

export interface ExecutionContextRequest extends KnowledgeVisibilityContext {
  query: string;
  asOf?: number;
  maxAssertions?: number;
  maxKnowledge?: number;
  includeUserModel?: boolean;
  includeKnowledge?: boolean;
  knowledgeSources?: readonly KnowledgeSource[];
}

function scopeVisible(scope: UserModelScope, context: ExecutionContextRequest): boolean {
  if (scope.type === 'global') return true;
  return scope.id === ({
    agent: context.agentId,
    workspace: context.workspaceId,
    project: context.projectId,
    session: context.sessionId,
  })[scope.type];
}

function applicabilityVisible(
  applicability: Record<string, unknown>,
  context: ExecutionContextRequest,
): boolean {
  const operation = applicability.operation;
  if (typeof operation === 'string' && operation !== 'response') return false;
  if (Array.isArray(operation)
    && !operation.some((value) => value === 'response')) return false;

  for (const [key, actual] of [
    ['agentId', context.agentId],
    ['workspaceId', context.workspaceId],
    ['projectId', context.projectId],
    ['sessionId', context.sessionId],
  ] as const) {
    const expected = applicability[key];
    if (typeof expected === 'string' && expected !== actual) return false;
    if (Array.isArray(expected)
      && !expected.some((value) => typeof value === 'string' && value === actual)) return false;
  }
  return true;
}

function urgency(assertion: UserAssertion, asOf: number): number {
  const deadline = assertion.validTo ?? assertion.reviewAt;
  if (deadline === undefined) return 0;
  const remaining = deadline - asOf;
  if (remaining <= 0) return 1;
  return Math.max(0, 1 - remaining / (30 * 24 * 60 * 60 * 1_000));
}

function rankAssertion(
  assertion: UserAssertion,
  query: string,
  asOf: number,
  feedbackScore: number,
): RankedExecutionAssertion {
  const taskRelevance = retrievalLexicalSimilarity(query, `${assertion.statement} ${assertion.normalizedValue}`);
  const score = calculateExecutionValue({
    declaredImportance: assertion.declaredImportance,
    inferredImportance: assertion.inferredImportance,
    consequence: assertion.consequence,
    actionability: assertion.actionability,
    taskRelevance,
    urgency: urgency(assertion, asOf),
  }) + feedbackScore;
  const reasons = [taskRelevance >= 0.35 ? 'task_relevant' : '',
    assertion.declaredImportance !== undefined ? 'user_declared_importance' : '',
    assertion.consequence === 'critical' || assertion.consequence === 'high' ? 'high_consequence' : '',
    assertion.kind === 'identity' || assertion.kind === 'preference' ? 'stable_personalization' : '',
    feedbackScore > 0 ? 'historically_helpful' : '',
    feedbackScore < 0 ? 'historically_irrelevant' : '',
  ].filter(Boolean);
  return { assertion, score, reasons };
}

function ruleEnforcement(conditions: Record<string, unknown>): RuleEnforcementLevel {
  const value = conditions.enforcementLevel;
  return value === 'planner' || value === 'tool_gate' ? value : 'prompt';
}

function loadRules(context: ExecutionContextRequest): ExecutionRule[] {
  return listCollaborationRules()
    .filter((rule) => rule.status === 'active' && scopeVisible(rule.scope as UserModelScope, context))
    .map((rule) => ({
      id: rule.id,
      statement: rule.statement,
      priority: rule.priority,
      enforcementLevel: ruleEnforcement(rule.conditions),
      conditions: rule.conditions,
    }))
    .sort((left, right) => left.priority - right.priority);
}

function loadGoals(context: ExecutionContextRequest, asOf: number): ExecutionGoal[] {
  const rows = getSqliteDatabase().prepare(`SELECT g.goal_id, g.status, g.declared_importance,
      g.target_at, g.scope_type, g.scope_id, r.title, r.desired_outcome
    FROM user_goals g JOIN user_goal_revisions r ON r.revision_id = g.current_revision_id
    WHERE g.principal_id = 'local-owner' AND g.status IN ('active', 'proposed')
      AND (g.valid_from IS NULL OR g.valid_from <= ?)
      AND (g.valid_to IS NULL OR g.valid_to >= ?)
    ORDER BY COALESCE(g.declared_importance, 0) DESC, g.updated_at DESC LIMIT 30`)
    .all(asOf, asOf) as Array<{
      goal_id: string; status: string; declared_importance: number | null; target_at: number | null;
      scope_type: UserModelScope['type']; scope_id: string | null; title: string; desired_outcome: string;
    }>;
  return rows.filter((row) => scopeVisible({
    type: row.scope_type,
    ...(row.scope_id ? { id: row.scope_id } : {}),
  }, context)).map((row) => ({
    id: row.goal_id,
    title: row.title,
    desiredOutcome: row.desired_outcome,
    status: row.status,
    ...(row.declared_importance === null ? {} : { declaredImportance: row.declared_importance }),
    ...(row.target_at === null ? {} : { targetAt: row.target_at }),
  }));
}

function loadPriorities(context: ExecutionContextRequest, asOf: number): ExecutionPriority[] {
  const rows = getSqliteDatabase().prepare(`SELECT priority_id, target_type, target_id, rank, urgency,
      valid_to, scope_type, scope_id FROM user_priority_windows
    WHERE principal_id = 'local-owner' AND status = 'active' AND valid_from <= ? AND valid_to >= ?
    ORDER BY CASE rank WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END, urgency DESC LIMIT 30`)
    .all(asOf, asOf) as Array<{
      priority_id: string; target_type: string; target_id: string;
      rank: ExecutionPriority['rank']; urgency: number; valid_to: number;
      scope_type: UserModelScope['type']; scope_id: string | null;
    }>;
  return rows.filter((row) => scopeVisible({
    type: row.scope_type,
    ...(row.scope_id ? { id: row.scope_id } : {}),
  }, context)).map((row) => ({
    id: row.priority_id,
    targetType: row.target_type,
    targetId: row.target_id,
    rank: row.rank,
    urgency: row.urgency,
    validTo: row.valid_to,
  }));
}

export function buildExecutionContext(request: ExecutionContextRequest): ExecutionContext {
  const asOf = request.asOf ?? Date.now();
  const includeUserModel = request.includeUserModel !== false;
  const feedbackScores = getExecutionContextFeedbackScores();
  const assertions = includeUserModel ? listUserAssertions({ statuses: ['active'], limit: 1_000 })
    .filter((item) => scopeVisible(getAssertionScope(item.slotId), request))
    .filter((item) => applicabilityVisible(item.applicability, request))
    .filter((item) => (item.validFrom === undefined || item.validFrom <= asOf)
      && (item.validTo === undefined || item.validTo >= asOf))
    .filter((item) => item.authority !== 'external_untrusted')
    .filter((item) => item.sensitivity !== 'secret' && item.sensitivity !== 'regulated'
      && item.disclosurePolicy !== 'ask_before_reference')
    .map((item) => rankAssertion(
      item,
      request.query,
      asOf,
      feedbackScores.get(`assertion:${item.id}`) ?? 0,
    ))
    .filter((item) => item.score >= 0.12 || item.reasons.includes('high_consequence'))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(100, request.maxAssertions ?? 20))) : [];
  const maxKnowledge = Math.max(0, Math.min(100, request.maxKnowledge ?? 12));
  const knowledge = request.includeKnowledge === false || maxKnowledge === 0
    ? []
    : searchKnowledgeItems({
        query: request.query,
        context: request,
        asOf,
        trustedOnly: true,
        sources: request.knowledgeSources,
        limit: Math.min(100, maxKnowledge * 2),
      })
      .map((item) => ({
        item,
        score: retrievalLexicalSimilarity(request.query, item.content) * 0.7
          + item.importance * 0.3
          + (feedbackScores.get(`knowledge:${item.id}`) ?? 0),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, maxKnowledge)
      .map(({ item }) => item);
  return {
    traceId: randomUUID(),
    asOf,
    query: request.query,
    rules: includeUserModel ? loadRules(request) : [],
    assertions,
    goals: includeUserModel ? loadGoals(request, asOf) : [],
    priorities: includeUserModel ? loadPriorities(request, asOf) : [],
    knowledge,
  };
}

function getAssertionScope(slotId: string): UserModelScope {
  const row = getSqliteDatabase().prepare(`SELECT scope_type, scope_id FROM user_assertion_slots
    WHERE slot_id = ?`).get(slotId) as { scope_type: UserModelScope['type']; scope_id: string | null };
  return { type: row.scope_type, ...(row.scope_id ? { id: row.scope_id } : {}) };
}

export function renderExecutionContext(context: ExecutionContext): string {
  const sections: string[] = [];
  if (context.rules.length) {
    sections.push(`Collaboration rules:\n${context.rules.map((rule) => `- ${rule.statement}`).join('\n')}`);
  }
  if (context.assertions.length) {
    sections.push(`Relevant user facts:\n${context.assertions.map((item) => `- ${item.assertion.statement}`).join('\n')}`);
  }
  if (context.goals.length) {
    sections.push(`Active goals:\n${context.goals.map((goal) => `- ${goal.title}: ${goal.desiredOutcome}`).join('\n')}`);
  }
  if (context.priorities.length) {
    sections.push(`Current priorities:\n${context.priorities.map((item) => `- ${item.rank}: ${item.targetType}/${item.targetId}`).join('\n')}`);
  }
  if (context.knowledge.length) {
    sections.push(`Relevant knowledge:\n${context.knowledge.map((item) => `- ${item.content}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

export function fitExecutionContextToChars(
  context: ExecutionContext,
  maxChars: number,
): { context: ExecutionContext; rendered: string } {
  const selected: ExecutionContext = {
    ...context,
    rules: [],
    assertions: [],
    goals: [],
    priorities: [],
    knowledge: [],
  };
  const fits = () => buildUserContextBlock(renderExecutionContext(selected)).length <= maxChars;
  for (const item of context.rules) {
    selected.rules.push(item);
    if (!fits()) selected.rules.pop();
  }
  for (const item of context.assertions) {
    selected.assertions.push(item);
    if (!fits()) selected.assertions.pop();
  }
  for (const item of context.goals) {
    selected.goals.push(item);
    if (!fits()) selected.goals.pop();
  }
  for (const item of context.priorities) {
    selected.priorities.push(item);
    if (!fits()) selected.priorities.pop();
  }
  for (const item of context.knowledge) {
    selected.knowledge.push(item);
    if (!fits()) selected.knowledge.pop();
  }
  return {
    context: selected,
    rendered: buildUserContextBlock(renderExecutionContext(selected)),
  };
}

export function evaluateToolGate(
  context: ExecutionContext,
  operation: string,
): { allowed: boolean; rule?: ExecutionRule; reason?: string } {
  for (const rule of context.rules) {
    if (rule.enforcementLevel !== 'tool_gate') continue;
    const operations = Array.isArray(rule.conditions.operationTypes)
      ? rule.conditions.operationTypes.filter((item): item is string => typeof item === 'string')
      : [];
    if (operations.length && !operations.includes(operation)) continue;
    if (rule.conditions.effect === 'deny') {
      return { allowed: false, rule, reason: rule.statement };
    }
  }
  return { allowed: true };
}
