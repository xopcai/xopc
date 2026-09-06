import { userInfo } from 'node:os';

import type { Hono } from 'hono';

import {
  createCollaborationRule, createUnderstanding, decideContextConsent,
  deleteCollaborationRule, deleteUnderstanding, getCollaborationRule,
  getTurnPersonalization, getUnderstanding, getUserProfile,
  listCollaborationRules, listContextConsolidationRuns, listUnderstandingEvidence, listUnderstandingStatusEvents, listUnderstandings,
  recordContextFeedback, rejectUnderstanding, reviseCollaborationRule,
  reviseUnderstanding, setCollaborationRuleStatus, setUnderstandingStatus,
  updateUserProfile,
  listContextExtractionRuns,
} from '../../../storage/sqlite/index.js';
import { UNDERSTANDING_KINDS, type CollaborationRule, type UnderstandingKind,
  type UnderstandingStatus, type UserContextScope } from '../../../user-context/domain.js';
import { listContextObjects, type ContextObjectView } from '../../../user-context/context-objects.js';
import { repairExtractedContext } from '../../../user-context/extraction/repair.js';
import {
  getUserRelationship,
  listUserRelationships,
  mergeUserRelationships,
  patchUserRelationship,
} from '../../../user-context/relationships/service.js';
import { USER_PERSON_KINDS, type UserPersonKind } from '../../../user-context/relationships/types.js';
import { listUserFocuses, updateUserFocus } from '../../../user-context/sources/repository.js';
import { canonicalUnderstandingKey, findDuplicateUnderstanding } from '../../../user-context/understanding.js';
import {
  deleteUserAvatar,
  readUserAvatar,
  writeUserAvatar,
} from '../../../user-context/user-avatar.js';
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
const CONTEXT_OBJECT_VIEWS = new Set<ContextObjectView>(['current', 'review', 'history']);
const USER_PERSON_KIND_SET = new Set<UserPersonKind>(USER_PERSON_KINDS);

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

  authenticated.get('/api/you/avatar', async (c) => {
    const result = await readUserAvatar();
    if (result.ok === false) return c.json({ error: result.error }, result.status);
    return new Response(result.data.buffer, {
      status: 200,
      headers: {
        'Content-Type': result.data.contentType,
        'Cache-Control': 'private, no-store',
      },
    });
  });

  authenticated.put('/api/you/avatar', write, async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);
    const result = await writeUserAvatar(
      typeof body.base64 === 'string' ? body.base64 : '',
      typeof body.mimeType === 'string' ? body.mimeType : '',
    );
    if (result.ok === false) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });

  authenticated.delete('/api/you/avatar', write, async (c) => {
    const result = await deleteUserAvatar();
    if (result.ok === false) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });

  authenticated.get('/api/you', (c) => c.json({
    profile: getUserProfile(),
    understandings: listUnderstandings(),
    focuses: listUserFocuses(),
    rules: listCollaborationRules(),
    consolidation: { lastRun: listContextConsolidationRuns(1)[0] ?? null },
  }));

  authenticated.get('/api/you/relationships', (c) => {
    const kind = c.req.query('kind');
    if (kind && !USER_PERSON_KIND_SET.has(kind as UserPersonKind)) {
      return c.json({ error: 'Invalid relationship kind' }, 400);
    }
    const requestedLimit = Number(c.req.query('limit') ?? '30');
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      return c.json({ error: 'limit must be an integer from 1 to 100' }, 400);
    }
    const cursor = c.req.query('cursor');
    if (cursor && !/^\d+$/.test(cursor)) return c.json({ error: 'Invalid cursor' }, 400);
    return c.json(listUserRelationships({
      query: c.req.query('q') ?? '',
      ...(kind ? { kind: kind as UserPersonKind } : {}),
      ...(c.req.query('source') ? { sourceInstanceId: c.req.query('source') } : {}),
      includeHidden: c.req.query('includeHidden') === 'true',
      hiddenOnly: c.req.query('hidden') === 'true',
      ...(cursor ? { cursor } : {}),
      limit: requestedLimit,
    }));
  });

  authenticated.get('/api/you/relationships/:id', (c) => {
    const person = getUserRelationship(c.req.param('id'));
    return person ? c.json({ person }) : c.json({ error: 'Relationship not found' }, 404);
  });

  authenticated.patch('/api/you/relationships/:id', write, async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);
    const patch: { displayName?: string | null; kind?: UserPersonKind | null; hidden?: boolean } = {};
    if (body.displayName !== undefined) {
      if (body.displayName !== null && (typeof body.displayName !== 'string' || body.displayName.trim().length > 160)) {
        return c.json({ error: 'displayName must be null or a string of at most 160 characters' }, 400);
      }
      patch.displayName = typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim()
        : null;
    }
    if (body.kind !== undefined) {
      if (body.kind !== null && !USER_PERSON_KIND_SET.has(body.kind as UserPersonKind)) {
        return c.json({ error: 'Invalid relationship kind' }, 400);
      }
      patch.kind = body.kind as UserPersonKind | null;
    }
    if (body.hidden !== undefined) {
      if (typeof body.hidden !== 'boolean') return c.json({ error: 'hidden must be a boolean' }, 400);
      patch.hidden = body.hidden;
    }
    if (!Object.keys(patch).length) return c.json({ error: 'No relationship fields provided' }, 400);
    const person = patchUserRelationship(c.req.param('id'), patch);
    return person ? c.json({ person }) : c.json({ error: 'Relationship not found' }, 404);
  });

  authenticated.post('/api/you/relationships/merge', write, async (c) => {
    const body = await readBody(c);
    const sourcePersonId = nonEmptyString(body?.sourcePersonId, 200);
    const targetPersonId = nonEmptyString(body?.targetPersonId, 200);
    if (!sourcePersonId || !targetPersonId || sourcePersonId === targetPersonId) {
      return c.json({ error: 'Distinct sourcePersonId and targetPersonId are required' }, 400);
    }
    const person = mergeUserRelationships(sourcePersonId, targetPersonId);
    return person ? c.json({ person }) : c.json({ error: 'Relationship not found' }, 404);
  });

  authenticated.get('/api/you/context-objects', (c) => {
    const view = c.req.query('view') ?? 'current';
    if (!CONTEXT_OBJECT_VIEWS.has(view as ContextObjectView)) return c.json({ error: 'Invalid context object view' }, 400);
    return c.json({ objects: listContextObjects(view as ContextObjectView) });
  });

  authenticated.get('/api/you/extraction-runs', (c) => c.json({
    runs: listContextExtractionRuns({
      ...(c.req.query('sourceRef') ? { sourceRef: c.req.query('sourceRef') } : {}),
      ...(c.req.query('extractorId') ? { extractorId: c.req.query('extractorId') } : {}),
      ...(c.req.query('extractorVersion') ? { extractorVersion: c.req.query('extractorVersion') } : {}),
      limit: 100,
    }),
  }));

  authenticated.post('/api/you/context-repair', write, async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: 'Invalid JSON' }, 400);
    const filter = Object.fromEntries(
      ['runId', 'sourceRef', 'extractorId', 'extractorVersion', 'objectVersionId']
        .flatMap((field) => typeof body[field] === 'string' && body[field].trim()
          ? [[field, body[field].trim()]] : []),
    );
    if (!Object.keys(filter).length) return c.json({ error: 'At least one repair filter is required' }, 400);
    return c.json({ result: repairExtractedContext(filter) });
  });

  authenticated.post('/api/you/context-objects/batch-review', write, async (c) => {
    const body = await readBody(c);
    const decisions = body?.decisions;
    if (!Array.isArray(decisions) || decisions.length < 1 || decisions.length > 50) {
      return c.json({ error: 'decisions must contain 1-50 items' }, 400);
    }
    const normalized: Array<{ objectType: 'focus' | 'understanding'; objectId: string; action: 'accept' | 'reject' | 'pause' }> = [];
    const targets = new Set<string>();
    for (const value of decisions) {
      const item = asRecord(value);
      const objectType = item?.objectType;
      const objectId = nonEmptyString(item?.objectId, 200);
      const action = item?.action;
      if ((objectType !== 'focus' && objectType !== 'understanding') || !objectId
        || (action !== 'accept' && action !== 'reject' && action !== 'pause')) {
        return c.json({ error: 'Each decision must contain a valid objectType, objectId, and action' }, 400);
      }
      const exists = objectType === 'understanding'
        ? Boolean(getUnderstanding(objectId))
        : listUserFocuses().some((focus) => focus.id === objectId);
      if (!exists) return c.json({ error: `Context object not found: ${objectId}` }, 404);
      const target = `${objectType}:${objectId}`;
      if (targets.has(target)) return c.json({ error: `Duplicate context object decision: ${objectId}` }, 400);
      targets.add(target);
      normalized.push({ objectType, objectId, action });
    }
    const objects = normalized.map(({ objectType, objectId, action }) => {
      if (objectType === 'understanding') {
        return action === 'accept'
          ? setUnderstandingStatus(objectId, 'active', {
              explicitness: 'explicit', confidence: 1, actorType: 'user', source: 'context-review',
            })
          : action === 'reject'
            ? rejectUnderstanding(objectId, 'Rejected during context review', 'user')
            : setUnderstandingStatus(objectId, 'needs_review', { actorType: 'user', source: 'context-review-later' });
      }
      return updateUserFocus(objectId, { status: action === 'accept' ? 'active' : action === 'reject' ? 'rejected' : 'paused' });
    });
    return c.json({ objects });
  });

  authenticated.get('/api/you/profile', async (c) => {
    const profile = getUserProfile();
    const avatar = await readUserAvatar();
    return c.json({ profile, suggestedCallName: profile.callName || machineCallName(), hasAvatar: avatar.ok });
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
    return c.json({
      evidence: listUnderstandingEvidence(understanding.id),
      statusEvents: listUnderstandingStatusEvents(understanding.id),
    });
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
        ? rejectUnderstanding(id, nonEmptyString(body.reason, 500) ?? 'Rejected by user', 'user')
        : setUnderstandingStatus(
            id,
            body.status as UnderstandingStatus,
            {
              ...(body.status === 'active' ? { explicitness: 'explicit' as const, confidence: 1 } : {}),
              actorType: 'user', source: 'understanding-edit',
            },
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
      || (objectType !== undefined && !['profile', 'rule', 'focus', 'understanding'].includes(String(objectType)))
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
      ...(objectType ? { objectType: objectType as 'profile' | 'rule' | 'focus' | 'understanding', objectId: objectId as string } : {}),
      ...(typeof body.reason === 'string' ? { reason: body.reason.slice(0, 500) } : {}),
    });
    if (objectType === 'understanding' && typeof objectId === 'string') {
      if (rating === 'wrong') rejectUnderstanding(objectId, 'Marked wrong from turn feedback', 'user');
      if (rating === 'stale') setUnderstandingStatus(objectId, 'stale', { actorType: 'user', source: 'turn-feedback-stale' });
      if (rating === 'sensitive') setUnderstandingStatus(objectId, 'needs_review', { actorType: 'user', source: 'turn-feedback-sensitive' });
    }
    if (objectType === 'focus' && typeof objectId === 'string') {
      if (rating === 'wrong') updateUserFocus(objectId, { status: 'rejected' });
      if (rating === 'stale' || rating === 'sensitive') updateUserFocus(objectId, { status: 'paused' });
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
