import { userInfo } from 'node:os';

import type { Hono } from 'hono';

import { getExecutionContextAudit, recordExecutionContextFeedback } from '../../../agent/context/audit.js';
import {
  getKnowledgeItem,
  deleteKnowledgeItem,
  KnowledgeReviewConflictError,
  listKnowledgeItems,
  reviewKnowledgeItem,
  searchKnowledgeItems,
} from '../../../knowledge-memory/index.js';
import { listMemoryMaintenanceRuns } from '../../../memory-maintenance/index.js';
import { listUnderstandingSourceGrants } from '../../../user-context/sources/repository.js';
import { getActiveUnderstandingConsent } from '../../../user-context/sources/consent-repository.js';
import { runSqliteWriteTransaction } from '../../../storage/sqlite/transaction.js';
import {
  createCollaborationRule,
  getCollaborationRule,
  listCollaborationRules,
  setCollaborationRuleStatus,
  type CollaborationRule,
} from '../../../storage/sqlite/collaboration-rule-repository.js';
import {
  createPriorityWindow,
  createUserGoal,
  applyUserProfilePatch,
  bootstrapUserModel,
  getAssertionSlot,
  getUserAssertion,
  deleteUserAssertion,
  canUseAssertion,
  listPriorityWindows,
  listActionRuleSuggestions,
  listUserAssertionEdges,
  listUserAssertionSources,
  listUserAssertions,
  listUserModelObservations,
  listUserGoals,
  reconcileAssertion,
  getUserProfileSnapshot,
  setAssertionStatus,
  setUserGoalStatus,
  updatePriorityWindow,
  updateUserGoal,
  type AssertionCandidate,
  type AssertionStatus,
  type UserGoalStatus,
  type UserModelScope,
} from '../../../user-model/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | undefined> {
  try {
    return object(await c.req.json());
  } catch {
    return undefined;
  }
}

function scope(value: unknown): UserModelScope | undefined {
  const input = object(value);
  if (!input || !['global', 'agent', 'workspace', 'project', 'session'].includes(String(input.type))) return undefined;
  if (input.type === 'global') return { type: 'global' };
  return typeof input.id === 'string' && input.id.trim()
    ? { type: input.type as Exclude<UserModelScope['type'], 'global'>, id: input.id.trim() }
    : undefined;
}

function subject(value: unknown): AssertionCandidate['subject'] | undefined {
  const input = object(value);
  if (!input || !['user', 'person', 'goal', 'project', 'topic'].includes(String(input.type))
    || typeof input.id !== 'string' || !input.id.trim()) return undefined;
  return { type: input.type as AssertionCandidate['subject']['type'], id: input.id.trim() };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function machineCallName(): string {
  try {
    const username = userInfo().username.trim();
    return ['root', 'admin', 'administrator', 'user'].includes(username.toLocaleLowerCase())
      ? ''
      : username.slice(0, 100);
  } catch {
    return '';
  }
}

const ASSERTION_STATUSES = new Set<AssertionStatus>([
  'candidate', 'active', 'needs_review', 'conflicted', 'stale', 'archived', 'rejected',
]);
const GOAL_STATUSES = new Set<UserGoalStatus>(['proposed', 'active', 'paused', 'achieved', 'abandoned']);
const KNOWLEDGE_REVIEW_ACTIONS = new Set(['approve', 'edit_and_approve', 'reject', 'archive']);
const KNOWLEDGE_STATUSES = new Set(['candidate', 'active', 'needs_review', 'stale', 'archived', 'rejected']);
const RULE_CATEGORIES = new Set<CollaborationRule['category']>([
  'communication', 'execution', 'boundary', 'routine', 'initiative',
]);
const RULE_STATUSES = new Set<CollaborationRule['status']>(['active', 'disabled', 'archived']);

function assertionView(
  assertion: NonNullable<ReturnType<typeof getUserAssertion>>,
  sources = listUserAssertionSources([assertion.id]).get(assertion.id) ?? [],
) {
  const slot = getAssertionSlot(assertion.slotId);
  if (!slot) throw new Error(`Assertion slot not found: ${assertion.slotId}`);
  return {
    ...assertion,
    predicate: slot.predicate,
    subject: slot.subject,
    scope: slot.scope,
    sources,
    usable: canUseAssertion(assertion, Date.now(), {
      use: 'answer',
      ...(assertion.allowedAgentIds?.[0] ? { agentId: assertion.allowedAgentIds[0] } : {}),
    }),
  };
}

export function registerUserModelRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const write = deps.strictRateLimitMiddleware;

  authenticated.get('/api/user-model', (c) => {
    const rawAssertions = listUserAssertions({
      statuses: ['active', 'candidate', 'needs_review', 'conflicted', 'stale'],
      limit: 1_000,
    });
    const assertionSources = listUserAssertionSources(rawAssertions.map((item) => item.id));
    const assertions = rawAssertions.map((item) => assertionView(item, assertionSources.get(item.id) ?? []));
    const goals = listUserGoals();
    const priorities = listPriorityWindows();
    const knowledge = listKnowledgeItems({ recordClass: 'memory', limit: 1_000 });
    const profile = getUserProfileSnapshot();
    const sources = listUnderstandingSourceGrants().map((source) => ({
      id: source.id,
      kind: source.adapterId === 'local-work-folders'
        ? 'work_folder' as const
        : source.adapterId.startsWith('connector:')
          ? 'connector' as const
          : 'local_source' as const,
      adapterId: source.adapterId,
      category: source.category,
      displayName: source.displayName,
      ...(source.lastCollectedAt ? { lastCollectedAt: source.lastCollectedAt } : {}),
      consent: getActiveUnderstandingConsent(source.id),
    }));
    return c.json({
      assertions,
      assertionEdges: listUserAssertionEdges(assertions.map((item) => item.id)),
      observations: listUserModelObservations({ limit: 500 }),
      goals,
      priorities,
      rules: listCollaborationRules(),
      ruleSuggestions: listActionRuleSuggestions(),
      knowledge,
      maintenance: { lastRun: listMemoryMaintenanceRuns(1)[0] ?? null },
      profile,
      sources,
      suggestedCallName: profile.callName || machineCallName(),
      counts: {
        activeAssertions: assertions.filter((item) => item.status === 'active').length,
        reviewAssertions: assertions.filter((item) => item.status === 'needs_review' || item.status === 'conflicted').length,
        activeGoals: goals.filter((item) => item.status === 'active').length,
        activePriorities: priorities.filter((item) => item.status === 'active').length,
        activeKnowledge: knowledge.filter((item) => item.status === 'active').length,
      },
    });
  });

  authenticated.patch('/api/user-model/profile', write, async (c) => {
    const input = await body(c);
    if (!input) return c.json({ error: 'A profile patch is required' }, 400);
    const profileFields = ['callName', 'role', 'pronouns', 'timezone', 'locale'] as const;
    const entries = profileFields.filter((key) => Object.hasOwn(input, key));
    if (!entries.length || entries.some((key) => typeof input[key] !== 'string')) {
      return c.json({ error: 'Profile fields must be strings' }, 400);
    }
    try {
      return c.json({ profile: applyUserProfilePatch(Object.fromEntries(
        entries.map((key) => [key, input[key] as string]),
      )) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  authenticated.post('/api/user-model/bootstrap', write, async (c) => {
    const input = await body(c);
    const profile = object(input?.profile);
    const listFields = ['responsibilities', 'goals', 'communicationPreferences', 'boundaries', 'relationships'] as const;
    const validProfile = profile && Object.values(profile).every((value) => typeof value === 'string');
    const validLists = listFields.every((key) => input?.[key] === undefined
      || (Array.isArray(input[key]) && (input[key] as unknown[]).every((value) => typeof value === 'string')));
    if (!input || !validProfile || !validLists) {
      return c.json({ error: 'profile and string-list user-model fields are required' }, 400);
    }
    try {
      return c.json(bootstrapUserModel({
        profile,
        ...Object.fromEntries(listFields.flatMap((key) => input[key] === undefined ? [] : [[key, input[key]]])),
      } as Parameters<typeof bootstrapUserModel>[0]), 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  authenticated.get('/api/user-model/assertions', (c) => {
    const requested = c.req.query('status')?.split(',').filter(Boolean) as AssertionStatus[] | undefined;
    if (requested?.some((status) => !ASSERTION_STATUSES.has(status))) return c.json({ error: 'Invalid assertion status' }, 400);
    const assertions = listUserAssertions({ ...(requested ? { statuses: requested } : {}), limit: 1_000 });
    const assertionSources = listUserAssertionSources(assertions.map((item) => item.id));
    return c.json({ assertions: assertions.map((item) => assertionView(item, assertionSources.get(item.id) ?? [])) });
  });

  authenticated.get('/api/user-model/assertions/:id', (c) => {
    const assertion = getUserAssertion(c.req.param('id'));
    return assertion ? c.json({ assertion: assertionView(assertion) }) : c.json({ error: 'Assertion not found' }, 404);
  });

  authenticated.post('/api/user-model/assertions', write, async (c) => {
    const input = await body(c);
    const assertionScope = scope(input?.scope);
    if (!input || !assertionScope || typeof input.statement !== 'string'
      || typeof input.predicate !== 'string' || typeof input.value === 'undefined') {
      return c.json({ error: 'statement, predicate, value, and a valid scope are required' }, 400);
    }
    try {
      const now = Date.now();
      const assertionSubject = input.subject === undefined
        ? { type: 'user' as const, id: 'self' }
        : subject(input.subject);
      if (!assertionSubject) return c.json({ error: 'Invalid assertion subject' }, 400);
      const candidate: AssertionCandidate = {
        subject: assertionSubject,
        predicate: input.predicate,
        cardinality: input.cardinality === 'multiple' ? 'multiple' : 'single',
        scope: assertionScope,
        kind: input.kind as AssertionCandidate['kind'] ?? 'derived_insight',
        value: input.value,
        normalizedValue: typeof input.normalizedValue === 'string'
          ? input.normalizedValue : JSON.stringify(input.value).toLocaleLowerCase(),
        statement: input.statement,
        authority: 'user_explicit',
        confidence: 1,
        ...(typeof input.declaredImportance === 'number' ? { declaredImportance: input.declaredImportance } : {}),
        inferredImportance: typeof input.inferredImportance === 'number' ? input.inferredImportance : 0.7,
        consequence: input.consequence as AssertionCandidate['consequence'] ?? 'medium',
        actionability: typeof input.actionability === 'number' ? input.actionability : 0.7,
        volatility: input.volatility as AssertionCandidate['volatility'] ?? 'stable',
        sensitivity: input.sensitivity as AssertionCandidate['sensitivity'] ?? 'normal',
        disclosurePolicy: input.disclosurePolicy as AssertionCandidate['disclosurePolicy'] ?? 'referenceable',
        ...(object(input.applicability) ? { applicability: object(input.applicability)! } : {}),
        ...(typeof input.validFrom === 'number' ? { validFrom: input.validFrom } : {}),
        ...(typeof input.validTo === 'number' ? { validTo: input.validTo } : {}),
        observedAt: typeof input.observedAt === 'number' ? input.observedAt : now,
        ...(typeof input.reviewAt === 'number' ? { reviewAt: input.reviewAt } : {}),
        createdBy: 'user',
        ...(typeof input.correctionOfAssertionId === 'string'
          ? { correctionOfAssertionId: input.correctionOfAssertionId } : {}),
      };
      return c.json(reconcileAssertion(candidate, Date.now(), { restoreDeleted: true }), 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  authenticated.delete('/api/user-model/assertions/:id', write, (c) => {
    return deleteUserAssertion(c.req.param('id'))
      ? c.json({ ok: true }) : c.json({ error: 'Assertion not found' }, 404);
  });

  authenticated.patch('/api/user-model/assertions/:id/status', write, async (c) => {
    const input = await body(c);
    const status = input?.status as AssertionStatus;
    if (!ASSERTION_STATUSES.has(status)) return c.json({ error: 'Invalid assertion status' }, 400);
    try {
      return c.json({ assertion: setAssertionStatus(c.req.param('id'), status, {
        actor: 'user', reason: typeof input?.reason === 'string' ? input.reason : 'Status changed by user.',
      }) });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  });
  authenticated.patch('/api/user-model/assertions/:id', write, async (c) => {
    const current = getUserAssertion(c.req.param('id'));
    const input = await body(c);
    const statement = typeof input?.statement === 'string' ? input.statement.trim() : '';
    const slot = current ? getAssertionSlot(current.slotId) : undefined;
    if (!current || !slot) return c.json({ error: 'Assertion not found' }, 404);
    if (!statement) return c.json({ error: 'statement is required' }, 400);
    try {
      return c.json(reconcileAssertion({
        subject: slot.subject,
        predicate: slot.predicate,
        cardinality: slot.cardinality,
        scope: slot.scope,
        kind: current.kind,
        value: input?.value ?? statement,
        normalizedValue: typeof input?.normalizedValue === 'string'
          ? input.normalizedValue : String(input?.value ?? statement).trim().toLocaleLowerCase(),
        statement,
        authority: 'user_explicit',
        confidence: 1,
        ...(current.declaredImportance === undefined ? {} : { declaredImportance: current.declaredImportance }),
        inferredImportance: current.inferredImportance,
        consequence: current.consequence,
        actionability: current.actionability,
        volatility: current.volatility,
        sensitivity: current.sensitivity,
        disclosurePolicy: current.disclosurePolicy,
        domain: current.domain,
        layer: current.layer,
        sensitivityCategories: current.sensitivityCategories,
        purposeIds: current.purposeIds,
        allowedUses: current.allowedUses,
        allowedAgentIds: current.allowedAgentIds,
        deleteAfter: current.deleteAfter,
        applicability: current.applicability,
        ...(current.validFrom === undefined ? {} : { validFrom: current.validFrom }),
        ...(current.validTo === undefined ? {} : { validTo: current.validTo }),
        ...(current.reviewAt === undefined ? {} : { reviewAt: current.reviewAt }),
        observedAt: Date.now(),
        createdBy: 'user',
        correctionOfAssertionId: current.id,
      }));
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  authenticated.get('/api/user-model/goals', (c) => c.json({ goals: listUserGoals() }));
  authenticated.post('/api/user-model/goals', write, async (c) => {
    const input = await body(c);
    const goalScope = scope(input?.scope);
    if (!input || !goalScope || typeof input.title !== 'string' || typeof input.desiredOutcome !== 'string') {
      return c.json({ error: 'title, desiredOutcome, and a valid scope are required' }, 400);
    }
    try {
      return c.json({ goal: createUserGoal({
        title: input.title,
        desiredOutcome: input.desiredOutcome,
        scope: goalScope,
        ...(typeof input.declaredImportance === 'number' ? { declaredImportance: input.declaredImportance } : {}),
        ...(typeof input.targetAt === 'number' ? { targetAt: input.targetAt } : {}),
      }) }, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });
  authenticated.patch('/api/user-model/goals/:id/status', write, async (c) => {
    const input = await body(c);
    const status = input?.status as UserGoalStatus;
    if (!GOAL_STATUSES.has(status)) return c.json({ error: 'Invalid goal status' }, 400);
    const goal = setUserGoalStatus(c.req.param('id'), status);
    return goal ? c.json({ goal }) : c.json({ error: 'Goal not found' }, 404);
  });

  authenticated.get('/api/user-model/rules', (c) => c.json({ rules: listCollaborationRules() }));
  authenticated.post('/api/user-model/rules', write, async (c) => {
    const input = await body(c);
    const ruleScope = scope(input?.scope);
    const category = input?.category as CollaborationRule['category'];
    if (!input || !ruleScope || !RULE_CATEGORIES.has(category)
      || typeof input.statement !== 'string' || typeof input.priority !== 'number') {
      return c.json({ error: 'category, statement, priority, and a valid scope are required' }, 400);
    }
    try {
      return c.json({ rule: createCollaborationRule({
        category,
        statement: input.statement,
        priority: input.priority,
        scope: ruleScope,
        conditions: object(input.conditions) ?? {},
      }) }, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });
  authenticated.patch('/api/user-model/rules/:id/status', write, async (c) => {
    const input = await body(c);
    const status = input?.status as CollaborationRule['status'];
    if (!RULE_STATUSES.has(status)) return c.json({ error: 'Invalid collaboration rule status' }, 400);
    const rule = setCollaborationRuleStatus(c.req.param('id'), status);
    return rule ? c.json({ rule }) : c.json({ error: 'Collaboration rule not found' }, 404);
  });

  authenticated.get('/api/user-model/priorities', (c) => c.json({ priorities: listPriorityWindows() }));
  authenticated.post('/api/user-model/priorities', write, async (c) => {
    const input = await body(c);
    const priorityScope = scope(input?.scope);
    if (!input || !priorityScope || typeof input.targetId !== 'string'
      || typeof input.validFrom !== 'number' || typeof input.validTo !== 'number'
      || typeof input.urgency !== 'number') {
      return c.json({ error: 'targetId, urgency, validFrom, validTo, and a valid scope are required' }, 400);
    }
    try {
      return c.json({ priority: createPriorityWindow({
        targetType: input.targetType as Parameters<typeof createPriorityWindow>[0]['targetType'],
        targetId: input.targetId,
        rank: input.rank as Parameters<typeof createPriorityWindow>[0]['rank'],
        urgency: input.urgency,
        scope: priorityScope,
        validFrom: input.validFrom,
        validTo: input.validTo,
        ...(typeof input.reviewAt === 'number' ? { reviewAt: input.reviewAt } : {}),
        ...(typeof input.declaredImportance === 'number' ? { declaredImportance: input.declaredImportance } : {}),
      }) }, 201);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });
  authenticated.patch('/api/user-model/priorities/:id', write, async (c) => {
    const input = await body(c);
    const priority = listPriorityWindows().find((item) => item.id === c.req.param('id'));
    if (!priority) return c.json({ error: 'Priority not found' }, 404);
    if (!input) return c.json({ error: 'A priority patch is required' }, 400);
    const editableFields = ['title', 'desiredOutcome', 'validTo', 'status'] as const;
    if (!editableFields.some((field) => Object.hasOwn(input, field))) {
      return c.json({ error: 'At least one editable priority field is required' }, 400);
    }
    if ((Object.hasOwn(input, 'title') && typeof input.title !== 'string')
      || (Object.hasOwn(input, 'desiredOutcome') && typeof input.desiredOutcome !== 'string')
      || (Object.hasOwn(input, 'validTo') && typeof input.validTo !== 'number')
      || (Object.hasOwn(input, 'status') && typeof input.status !== 'string')) {
      return c.json({ error: 'Priority patch fields have invalid types' }, 400);
    }
    const title = typeof input.title === 'string' ? input.title.trim() : undefined;
    const desiredOutcome = typeof input.desiredOutcome === 'string' ? input.desiredOutcome.trim() : undefined;
    const validTo = typeof input.validTo === 'number' ? input.validTo : undefined;
    const status = typeof input.status === 'string' ? input.status as typeof priority.status : undefined;
    if (status && !['active', 'paused', 'completed', 'expired'].includes(status)) {
      return c.json({ error: 'Invalid priority status' }, 400);
    }
    if (validTo !== undefined && validTo < priority.validFrom) {
      return c.json({ error: 'Priority validTo must be after validFrom' }, 400);
    }
    if (title !== undefined && !title) return c.json({ error: 'Priority title is required' }, 400);
    if (desiredOutcome !== undefined && !desiredOutcome) {
      return c.json({ error: 'Priority outcome is required' }, 400);
    }
    try {
      const result = runSqliteWriteTransaction(() => {
        let goal;
        if (priority.targetType === 'goal' && (title !== undefined || desiredOutcome !== undefined)) {
          const currentGoal = listUserGoals().find((item) => item.id === priority.targetId);
          if (!currentGoal) throw new Error('Priority goal not found');
          goal = updateUserGoal(currentGoal.id, {
            title: title ?? currentGoal.title,
            desiredOutcome: desiredOutcome ?? currentGoal.desiredOutcome,
            ...(currentGoal.targetAt === undefined ? {} : { targetAt: currentGoal.targetAt }),
          });
        }
        const updated = updatePriorityWindow(priority.id, {
          ...(priority.targetType === 'goal' || title === undefined ? {} : { targetId: title }),
          ...(validTo === undefined ? {} : { validTo }),
          ...(status === undefined ? {} : { status }),
        });
        return { priority: updated, ...(goal ? { goal } : {}) };
      });
      return c.json(result);
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 400);
    }
  });

  authenticated.get('/api/knowledge-memory', (c) => {
    const query = c.req.query('q')?.trim();
    if (!query) return c.json({ items: listKnowledgeItems({ recordClass: 'memory', limit: 500 }) });
    return c.json({ items: searchKnowledgeItems({
      query,
      context: {
        agentId: c.req.query('agentId') ?? 'main',
        workspaceId: c.req.query('workspaceId') ?? '',
        conversationId: c.req.query('sessionId') ?? '',
        ...(c.req.query('projectId') ? { projectId: c.req.query('projectId') } : {}),
      },
      recordClass: 'memory',
      limit: 100,
    }) });
  });
  authenticated.get('/api/knowledge-memory/:id', (c) => {
    const item = getKnowledgeItem(c.req.param('id'));
    return item ? c.json({ item }) : c.json({ error: 'Knowledge item not found' }, 404);
  });
  authenticated.delete('/api/knowledge-memory/:id', write, (c) => {
    return deleteKnowledgeItem(c.req.param('id'))
      ? c.json({ ok: true }) : c.json({ error: 'Knowledge item not found' }, 404);
  });

  authenticated.post('/api/knowledge-memory/:id/review', write, async (c) => {
    const input = await body(c);
    const action = String(input?.action ?? '');
    if (!KNOWLEDGE_REVIEW_ACTIONS.has(action)) return c.json({ error: 'Invalid knowledge review action' }, 400);
    if (input?.expectedStatus !== undefined && !KNOWLEDGE_STATUSES.has(String(input.expectedStatus))) {
      return c.json({ error: 'Invalid expected knowledge status' }, 400);
    }
    if (input?.content !== undefined && action !== 'edit_and_approve') {
      return c.json({ error: 'Content can only be changed while editing and approving knowledge' }, 400);
    }
    try {
      const item = reviewKnowledgeItem({
        id: c.req.param('id'),
        action: action as Parameters<typeof reviewKnowledgeItem>[0]['action'],
        actor: 'user',
        reason: typeof input?.reason === 'string' && input.reason.trim()
          ? input.reason : `Knowledge ${action} by user.`,
        ...(typeof input?.expectedStatus === 'string'
          ? { expectedStatus: input.expectedStatus as Parameters<typeof reviewKnowledgeItem>[0]['expectedStatus'] }
          : {}),
        ...(typeof input?.content === 'string' ? { content: input.content } : {}),
      });
      return item ? c.json({ item }) : c.json({ error: 'Knowledge item not found' }, 404);
    } catch (error) {
      return c.json(
        { error: errorMessage(error) },
        error instanceof KnowledgeReviewConflictError ? 409 : 400,
      );
    }
  });

  authenticated.get('/api/memory-maintenance/runs', (c) => c.json({
    runs: listMemoryMaintenanceRuns(Math.max(1, Math.min(100, Number(c.req.query('limit') ?? 20)))),
  }));
  authenticated.get('/api/turns/:turnId/execution-context', (c) => {
    const audit = getExecutionContextAudit(c.req.param('turnId'));
    if (!audit) return c.json({ error: 'Execution context not found' }, 404);
    const goals = new Map(listUserGoals().map((item) => [item.id, item]));
    const priorities = new Map(listPriorityWindows().map((item) => [item.id, item]));
    const resolvedItems = audit.items.flatMap((item) => {
      const value = item.objectType === 'assertion' ? getUserAssertion(item.objectId)
        : item.objectType === 'knowledge' ? getKnowledgeItem(item.objectId)
          : item.objectType === 'rule' ? getCollaborationRule(item.objectId)
            : item.objectType === 'goal' ? goals.get(item.objectId)
              : priorities.get(item.objectId);
      if (!value) return [];
      const content = 'statement' in value ? value.statement
        : 'content' in value ? value.content
          : 'desiredOutcome' in value ? `${value.title}: ${value.desiredOutcome}`
            : `${value.targetType}: ${value.targetId}`;
      const origin = item.objectType === 'assertion' && 'authority' in value
        ? value.authority === 'user_explicit' ? 'told_by_user'
          : value.authority === 'system_inferred' ? 'inferred' : 'observed'
        : item.objectType === 'knowledge' && 'originClass' in value && value.originClass === 'untrusted'
          ? 'connected_source' : 'observed';
      return [{ ...item, content, origin, sourceLabel: item.objectType }];
    });
    return c.json({ audit, resolvedItems });
  });
  authenticated.post('/api/turns/:turnId/execution-context/feedback', write, async (c) => {
    const input = await body(c);
    const rating = input?.rating;
    if (rating !== 'helpful' && rating !== 'irrelevant') return c.json({ error: 'Invalid feedback rating' }, 400);
    const saved = recordExecutionContextFeedback({
      turnId: c.req.param('turnId'), rating,
      ...(typeof input?.reason === 'string' ? { reason: input.reason } : {}),
    });
    return saved ? c.json({ ok: true }) : c.json({ error: 'Execution context not found' }, 404);
  });
}
