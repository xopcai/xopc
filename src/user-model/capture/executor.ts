import { createHash } from 'node:crypto';

import { createContextEvidence } from '../../storage/sqlite/context-evidence-repository.js';
import {
  createCollaborationRule,
  listCollaborationRules,
} from '../../storage/sqlite/collaboration-rule-repository.js';
import { createUserGoal, listUserGoals } from '../goals.js';
import {
  getUserAssertion,
  linkAssertionEvidence,
  reconcileAssertion,
  setAssertionStatus,
} from '../repository.js';
import type { AssertionStatus, UserModelScopeType } from '../domain.js';
import type { CaptureEvidence, UserModelInterpretation } from './semantic.js';

export interface UserModelCapturePolicy {
  write: 'deny' | 'confirm' | 'allow';
  sensitiveWrite: 'deny' | 'confirm' | 'allow';
  processing: 'local_only' | 'remote_allowed';
}

export interface CaptureScopeContext {
  sessionId: string;
  agentId: string;
  workspaceId: string;
  projectId?: string;
}

export interface UserModelCaptureResult {
  proposed: number;
  created: number;
  deduplicated: number;
  rejected: number;
  createdAssertions: Array<{
    id: string;
    content: string;
    kind: string;
    status: AssertionStatus;
  }>;
  createdGoals: Array<{ id: string; title: string; status: 'proposed' | 'active' }>;
  createdRules: Array<{ id: string; statement: string; status: 'active' | 'disabled' }>;
  outputs: Array<{
    candidateKey: string;
    assertionId?: string;
    outcome: 'created' | 'deduplicated' | 'superseded' | 'conflicted' | 'rejected';
  }>;
}

export function emptyUserModelCaptureResult(): UserModelCaptureResult {
  return {
    proposed: 0,
    created: 0,
    deduplicated: 0,
    rejected: 0,
    createdAssertions: [],
    createdGoals: [],
    createdRules: [],
    outputs: [],
  };
}

function scopeAllowed(type: UserModelScopeType, id: string | undefined, context: CaptureScopeContext): boolean {
  if (type === 'global') return id === undefined;
  return id === ({
    agent: context.agentId,
    workspace: context.workspaceId,
    project: context.projectId,
    session: context.sessionId,
  })[type];
}

function candidateKey(predicate: string, scopeType: string, scopeId?: string): string {
  return `${scopeType}:${scopeId ?? ''}:${predicate}`;
}

export function executeUserModelInterpretation(input: {
  interpretation: UserModelInterpretation;
  evidence: CaptureEvidence[];
  extractionRunId: string;
  extractorId: string;
  scopeContext: CaptureScopeContext;
  policy: UserModelCapturePolicy;
  turnId?: string;
}): UserModelCaptureResult {
  const result = emptyUserModelCaptureResult();
  const targets = input.interpretation.targetAssertionIds.flatMap((id) => getUserAssertion(id) ?? []);

  if (input.interpretation.intent === 'forget') {
    for (const target of targets) {
      setAssertionStatus(target.id, 'rejected', { actor: 'user', reason: 'Explicit user forget request.' });
      result.outputs.push({
        candidateKey: target.id,
        assertionId: target.id,
        outcome: 'rejected',
      });
      result.rejected += 1;
    }
    return result;
  }
  if (input.interpretation.intent === 'confirm' && input.policy.write !== 'deny') {
    for (const target of targets) {
      const confirmed = setAssertionStatus(target.id, 'active', {
        actor: 'user',
        reason: 'Explicit user confirmation.',
      });
      result.createdAssertions.push({
        id: confirmed.id,
        content: confirmed.statement,
        kind: confirmed.kind,
        status: confirmed.status,
      });
      result.outputs.push({
        candidateKey: confirmed.id,
        assertionId: confirmed.id,
        outcome: 'deduplicated',
      });
      result.deduplicated += 1;
    }
  }
  if (input.interpretation.intent === 'correct'
    && targets.length && input.interpretation.candidates.length === 0) {
    for (const target of targets) {
      setAssertionStatus(target.id, 'needs_review', {
        actor: 'user',
        reason: 'Correction requested without a grounded replacement.',
      });
    }
    return result;
  }
  const goals = input.interpretation.goals ?? [];
  const collaborationRules = input.interpretation.collaborationRules ?? [];
  if (!input.interpretation.candidates.length && !goals.length && !collaborationRules.length) return result;

  const evidenceByRef = new Map(input.evidence.map((entry) => [entry.ref, entry]));
  const evidenceIds = new Map<string, string>();
  for (const ref of new Set([
    ...input.interpretation.candidates.flatMap((item) => item.evidenceRefs),
    ...goals.flatMap((item) => item.evidenceRefs),
    ...collaborationRules.flatMap((item) => item.evidenceRefs),
  ])) {
    const item = evidenceByRef.get(ref);
    if (!item || item.role !== 'user') continue;
    const evidence = createContextEvidence({
      sourceType: 'conversation',
      sourceRef: `session:${input.scopeContext.sessionId}:entry:${ref}`,
      sourceRunId: input.extractionRunId,
      sessionId: input.scopeContext.sessionId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      messageId: ref,
      contentHash: createHash('sha256').update(item.text).digest('hex'),
      retentionPolicy: 'derived_only',
      processingPolicy: input.policy.processing,
      extractorId: input.extractorId,
      extractorVersion: 'user-model-v1',
      trustLevel: 'owner',
      observedAt: item.createdAt,
    });
    evidenceIds.set(ref, evidence.id);
  }

  const explicitCommand = input.interpretation.intent === 'remember'
    || input.interpretation.intent === 'correct';
  for (const source of input.interpretation.candidates) {
    result.proposed += 1;
    const key = candidateKey(source.predicate, source.scope.type, source.scope.id);
    const sensitive = source.sensitivity === 'secret' || source.sensitivity === 'regulated';
    if (input.policy.write === 'deny'
      || (sensitive && input.policy.sensitiveWrite === 'deny')
      || !scopeAllowed(source.scope.type, source.scope.id, input.scopeContext)) {
      result.rejected += 1;
      result.outputs.push({ candidateKey: key, outcome: 'rejected' });
      continue;
    }
    const requiresConfirmation = !explicitCommand && (
      input.policy.write === 'confirm'
      || (sensitive && input.policy.sensitiveWrite === 'confirm')
    );
    const refs = source.evidenceRefs.flatMap((ref) => evidenceIds.get(ref) ?? []);
    const applied = reconcileAssertion({
      ...source,
      authority: requiresConfirmation && source.authority === 'user_explicit'
        ? 'user_observed'
        : source.authority,
      createdBy: source.authority === 'user_explicit' ? 'user' : 'runtime',
      ...(refs[0] ? { evidenceId: refs[0], evidenceConfidence: source.confidence } : {}),
    });
    for (const evidenceId of refs.slice(1)) {
      linkAssertionEvidence(applied.assertion.id, evidenceId, 'supports', source.confidence);
    }
    result.createdAssertions.push({
      id: applied.assertion.id,
      content: applied.assertion.statement,
      kind: applied.assertion.kind,
      status: applied.assertion.status,
    });
    result.outputs.push({ candidateKey: key, assertionId: applied.assertion.id, outcome: applied.action });
    if (applied.action === 'deduplicated') result.deduplicated += 1;
    else result.created += 1;
  }

  for (const source of goals) {
    result.proposed += 1;
    const key = candidateKey(`goal:${source.title.toLocaleLowerCase()}`, source.scope.type, source.scope.id);
    if (input.policy.write === 'deny'
      || !scopeAllowed(source.scope.type, source.scope.id, input.scopeContext)) {
      result.rejected += 1;
      result.outputs.push({ candidateKey: key, outcome: 'rejected' });
      continue;
    }
    const existing = listUserGoals().find((goal) => goal.scope.type === source.scope.type
      && goal.scope.id === source.scope.id
      && goal.title.toLocaleLowerCase() === source.title.toLocaleLowerCase()
      && goal.status !== 'achieved' && goal.status !== 'abandoned');
    if (existing) {
      result.deduplicated += 1;
      result.outputs.push({ candidateKey: key, outcome: 'deduplicated' });
      continue;
    }
    const active = explicitCommand || input.policy.write === 'allow';
    const goal = createUserGoal({
      title: source.title,
      desiredOutcome: source.desiredOutcome,
      scope: source.scope,
      ...(source.declaredImportance === undefined ? {} : { declaredImportance: source.declaredImportance }),
      ...(source.targetAt === undefined ? {} : { targetAt: source.targetAt }),
      status: active ? 'active' : 'proposed',
      authority: active ? 'user_explicit' : 'user_observed',
      confidence: active ? 1 : 0.8,
      createdBy: 'runtime',
    });
    result.created += 1;
    result.createdGoals.push({ id: goal.id, title: goal.title, status: goal.status as 'proposed' | 'active' });
    result.outputs.push({ candidateKey: key, outcome: 'created' });
  }

  for (const source of collaborationRules) {
    result.proposed += 1;
    const key = candidateKey(`rule:${source.category}:${source.statement.toLocaleLowerCase()}`, source.scope.type, source.scope.id);
    if (input.policy.write === 'deny'
      || !scopeAllowed(source.scope.type, source.scope.id, input.scopeContext)
      || source.scope.type === 'agent') {
      result.rejected += 1;
      result.outputs.push({ candidateKey: key, outcome: 'rejected' });
      continue;
    }
    const existing = listCollaborationRules().find((rule) => rule.scope.type === source.scope.type
      && rule.scope.id === source.scope.id
      && rule.statement.toLocaleLowerCase() === source.statement.toLocaleLowerCase()
      && rule.status !== 'archived');
    if (existing) {
      result.deduplicated += 1;
      result.outputs.push({ candidateKey: key, outcome: 'deduplicated' });
      continue;
    }
    const active = explicitCommand || input.policy.write === 'allow';
    const rule = createCollaborationRule({
      category: source.category,
      priority: source.priority,
      scope: source.scope,
      conditions: {
        ...source.conditions,
        enforcementLevel: 'prompt',
        ...(active ? {} : { reviewRequired: true }),
      },
      statement: source.statement,
      status: active ? 'active' : 'disabled',
    });
    result.created += 1;
    result.createdRules.push({ id: rule.id, statement: rule.statement, status: rule.status as 'active' | 'disabled' });
    result.outputs.push({ candidateKey: key, outcome: 'created' });
  }
  return result;
}
