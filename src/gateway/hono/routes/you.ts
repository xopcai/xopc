import { userInfo } from 'node:os';

import type { Hono } from 'hono';

import {
  createCollaborationRule, createUnderstanding, decideContextConsent,
  deleteCollaborationRule, deleteUnderstanding, getCollaborationRule,
  getTurnPersonalization, getUnderstanding, getUserProfile,
  listCollaborationRules, listContextConsolidationRuns, listUnderstandingEvidence, listUnderstandings,
  recordContextFeedback, rejectUnderstanding, reviseCollaborationRule,
  reviseUnderstanding, setCollaborationRuleStatus, setUnderstandingStatus, summarizeUserUnderstandingQuality,
  updateUserProfile,
} from '../../../storage/sqlite/index.js';
import { UNDERSTANDING_KINDS, type CollaborationRule, type UnderstandingKind,
  type UnderstandingStatus, type UserContextScope } from '../../../user-context/domain.js';
import { canonicalUnderstandingKey, findDuplicateUnderstanding } from '../../../user-context/understanding.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const UNDERSTANDING_KIND_SET = new Set<UnderstandingKind>(UNDERSTANDING_KINDS);
const UNDERSTANDING_STATUSES = new Set<UnderstandingStatus>([
  'candidate', 'active', 'needs_review', 'stale', 'archived', 'rejected',
]);
const RULE_CATEGORIES = new Set<CollaborationRule['category']>([
  'communication', 'execution', 'boundary', 'routine', 'proactive',
]);
const RULE_STATUSES = new Set<CollaborationRule['status']>(['active', 'disabled', 'archived']);
const FEEDBACK_RATINGS = new Set(['helpful', 'irrelevant', 'wrong', 'stale', 'sensitive']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown> | undefined> {
  try {
    return asRecord(await c.req.json());
  } catch {
    return undefined;
  }
}

function nonEmptyString(value: unknown, max = 2_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result && result.length <= max ? result : undefined;
}

function scopeFrom(value: unknown): UserContextScope | undefined {
  const raw = asRecord(value);
  const type = raw?.type;
  if (type !== 'global' && type !== 'workspace' && type !== 'project' && type !== 'session') return undefined;
  if (type === 'global') return { type };
  const id = nonEmptyString(raw.id, 500);
  return id ? { type, id } : undefined;
}

function validTimezone(value: string): boolean {
  if (!value) return true;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
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

export function registerYouRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const write = deps.strictRateLimitMiddleware;

  authenticated.get('/api/you', (c) => c.json({
    profile: getUserProfile(),
    understandings: listUnderstandings(),
    rules: listCollaborationRules(),
    consolidation: { lastRun: listContextConsolidationRuns(1)[0] ?? null },
    quality: summarizeUserUnderstandingQuality(),
  }));

  authenticated.get('/api/you/profile', (c) => {
    const profile = getUserProfile();
    return c.json({ profile, suggestedCallName: profile.callName || machineCallName() });
  });

  authenticated.patch('/api/you/profile', write, async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);
    const patch: Parameters<typeof updateUserProfile>[0] = {};
    for (const field of ['callName', 'role', 'primaryGoal', 'pronouns', 'timezone', 'locale'] as const) {
      if (body[field] === undefined) continue;
      const max = field === 'primaryGoal' ? 500 : field === 'role' ? 300 : 100;
      if (typeof body[field] !== 'string' || body[field].length > max) {
        return c.json({ error: `${field} must be a string of at most ${max} characters` }, 400);
      }
      patch[field] = body[field].trim();
    }
    if (body.accessibility !== undefined) {
      const accessibility = asRecord(body.accessibility);
      if (!accessibility) return c.json({ error: 'accessibility must be an object' }, 400);
      if (JSON.stringify(accessibility).length > 10_000) return c.json({ error: 'accessibility is too large' }, 400);
      patch.accessibility = accessibility;
    }
    if (patch.timezone !== undefined && !validTimezone(patch.timezone)) {
      return c.json({ error: 'timezone must be a valid IANA time zone' }, 400);
    }
    return c.json({ profile: updateUserProfile(patch) });
  });

  authenticated.post('/api/you/understandings', write, async (c) => {
    const body = await readBody(c);
    const statement = nonEmptyString(body?.statement);
    const kind = body?.kind;
    const scope = scopeFrom(body?.scope ?? { type: 'global' });
    if (!statement || !UNDERSTANDING_KIND_SET.has(kind as UnderstandingKind) || !scope) {
      return c.json({ error: 'Valid statement, kind, and scope are required' }, 400);
    }
    const typedKind = kind as UnderstandingKind;
    const key = canonicalUnderstandingKey(typedKind, statement);
    if (findDuplicateUnderstanding(listUnderstandings(), {
      kind: typedKind, statement, canonicalKey: key, scope,
    })) {
      return c.json({ error: 'This understanding already exists' }, 409);
    }
    const understanding = createUnderstanding({
      kind: typedKind, canonicalKey: key, status: 'active', scope,
      explicitness: 'explicit', durability: 'durable', sensitivity: 'normal',
      disclosurePolicy: typedKind === 'boundary' ? 'silent' : 'referenceable',
      confidence: 1, statement, createdBy: 'user', changeReason: 'Created by user',
    });
    return c.json({ understanding }, 201);
  });

  authenticated.get('/api/you/understandings/:id/evidence', (c) => {
    const understanding = getUnderstanding(c.req.param('id'));
    if (!understanding) return c.json({ error: 'Understanding not found' }, 404);
    return c.json({ evidence: listUnderstandingEvidence(understanding.id) });
  });

  authenticated.patch('/api/you/understandings/:id', write, async (c) => {
    const id = c.req.param('id');
    let understanding = getUnderstanding(id);
    if (!understanding) return c.json({ error: 'Understanding not found' }, 404);
    const body = await readBody(c);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);
    if (body.statement !== undefined) {
      const statement = nonEmptyString(body.statement);
      if (!statement) return c.json({ error: 'statement must be 1-2000 characters' }, 400);
      const key = canonicalUnderstandingKey(understanding.kind, statement);
      if (findDuplicateUnderstanding(listUnderstandings(), {
        kind: understanding.kind,
        statement,
        canonicalKey: key,
        scope: understanding.scope,
        excludeId: id,
      })) {
        return c.json({ error: 'This understanding already exists' }, 409);
      }
      understanding = reviseUnderstanding(id, statement, {
        canonicalKey: key,
        explicitness: 'explicit',
        confidence: 1,
        changeReason: 'Edited by user',
      });
    }
    if (body.status !== undefined) {
      if (!UNDERSTANDING_STATUSES.has(body.status as UnderstandingStatus)) return c.json({ error: 'Invalid status' }, 400);
      understanding = body.status === 'rejected'
        ? rejectUnderstanding(id, nonEmptyString(body.reason, 500) ?? 'Rejected by user')
        : setUnderstandingStatus(
            id,
            body.status as UnderstandingStatus,
            body.status === 'active' ? { explicitness: 'explicit', confidence: 1 } : undefined,
          );
    }
    return c.json({ understanding });
  });

  authenticated.delete('/api/you/understandings/:id', write, (c) => deleteUnderstanding(c.req.param('id'))
    ? c.json({ ok: true })
    : c.json({ error: 'Understanding not found' }, 404));

  authenticated.post('/api/you/rules', write, async (c) => {
    const body = await readBody(c);
    const statement = nonEmptyString(body?.statement);
    const category = body?.category;
    const scope = scopeFrom(body?.scope ?? { type: 'global' });
    if (!statement || !RULE_CATEGORIES.has(category as CollaborationRule['category']) || !scope) {
      return c.json({ error: 'Valid statement, category, and scope are required' }, 400);
    }
    const priority = typeof body?.priority === 'number' && Number.isInteger(body.priority)
      ? Math.max(0, Math.min(100, body.priority)) : 50;
    const conditions = body?.conditions === undefined ? {} : asRecord(body.conditions);
    if (!conditions) return c.json({ error: 'conditions must be an object' }, 400);
    const rule = createCollaborationRule({
      category: category as CollaborationRule['category'], priority, scope, conditions, statement,
    });
    return c.json({ rule }, 201);
  });

  authenticated.patch('/api/you/rules/:id', write, async (c) => {
    const id = c.req.param('id');
    let rule = getCollaborationRule(id);
    if (!rule) return c.json({ error: 'Collaboration rule not found' }, 404);
    const body = await readBody(c);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);
    if (body.statement !== undefined) {
      const statement = nonEmptyString(body.statement);
      if (!statement) return c.json({ error: 'statement must be 1-2000 characters' }, 400);
      rule = reviseCollaborationRule(id, statement);
    }
    if (body.status !== undefined) {
      if (!RULE_STATUSES.has(body.status as CollaborationRule['status'])) return c.json({ error: 'Invalid status' }, 400);
      rule = setCollaborationRuleStatus(id, body.status as CollaborationRule['status']);
    }
    return c.json({ rule });
  });

  authenticated.delete('/api/you/rules/:id', write, (c) => deleteCollaborationRule(c.req.param('id'))
    ? c.json({ ok: true })
    : c.json({ error: 'Collaboration rule not found' }, 404));

  authenticated.get('/api/you/turns/:turnId/personalization', (c) => {
    const personalization = getTurnPersonalization(c.req.param('turnId'));
    return personalization ? c.json({ personalization }) : c.json({ error: 'Personalization run not found' }, 404);
  });

  authenticated.post('/api/you/turns/:turnId/feedback', write, async (c) => {
    const turnId = c.req.param('turnId');
    const run = getTurnPersonalization(turnId);
    if (!run) return c.json({ error: 'Personalization run not found' }, 404);
    const body = await readBody(c);
    if (!body || !FEEDBACK_RATINGS.has(String(body.rating))) return c.json({ error: 'Invalid feedback rating' }, 400);
    const objectType = body.objectType;
    const objectId = body.objectId;
    if ((objectType === undefined) !== (objectId === undefined)
      || (objectType !== undefined && !['profile', 'rule', 'understanding'].includes(String(objectType)))
      || (objectId !== undefined && typeof objectId !== 'string')) {
      return c.json({ error: 'objectType and objectId must be valid and provided together' }, 400);
    }
    if (objectType !== undefined && !run.items.some((item) =>
      item.objectType === objectType && item.objectId === objectId)) {
      return c.json({ error: 'The context object was not part of this turn' }, 400);
    }
    const rating = body.rating as 'helpful' | 'irrelevant' | 'wrong' | 'stale' | 'sensitive';
    recordContextFeedback({
      turnId, runId: run.runId, rating,
      ...(objectType ? { objectType: objectType as 'profile' | 'rule' | 'understanding', objectId: objectId as string } : {}),
      ...(typeof body.reason === 'string' ? { reason: body.reason.slice(0, 500) } : {}),
    });
    if (objectType === 'understanding' && typeof objectId === 'string') {
      if (rating === 'wrong') rejectUnderstanding(objectId, 'Marked wrong from turn feedback');
      if (rating === 'stale') setUnderstandingStatus(objectId, 'stale');
      if (rating === 'sensitive') setUnderstandingStatus(objectId, 'needs_review');
    }
    return c.json({ ok: true });
  });

  authenticated.patch('/api/you/consents/:id', write, async (c) => {
    const body = await readBody(c);
    const decision = body?.decision;
    if (!['once', 'session', 'always', 'deny'].includes(String(decision))) return c.json({ error: 'Invalid consent decision' }, 400);
    return decideContextConsent(c.req.param('id'), decision as 'once' | 'session' | 'always' | 'deny')
      ? c.json({ ok: true })
      : c.json({ error: 'Consent request not found' }, 404);
  });
}
