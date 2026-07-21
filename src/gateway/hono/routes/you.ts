import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import type { MemoryRecord } from '../../../agent/memory/types.js';
import { nextMemoryReviewAt, resolveMemoryStability } from '../../../agent/memory/lifecycle.js';
import type { Config } from '../../../config/schema.js';
import { UserContextConfigSchema } from '../../../user-context/config.js';
import { listConnectorCatalog } from '../../../connectors/catalog.js';
import { listConnectorInstances } from '../../../connectors/instances.js';
import { uninstallConnector } from '../../../connectors/install.js';
import { revokeComposioConnection } from '../../../connectors/composio.js';
import { draftGoalContract, GoalService } from '../../../goals/index.js';
import { readUserProfileFile, writeUserProfileFile } from '../../agents-admin.js';
import {
  decideMemoryReferenceConsent,
  deleteMemoryRecord,
  getMemoryRecord,
  getUserProfilePromptState,
  getUserTrustPolicy,
  listKnowledgeSourceItems,
  listKnowledgeSyncRuns,
  getConnectorConnection,
  listConnectorConnections,
  listMemoryRecords,
  listMemoryReferenceConsents,
  revokeMemoryReferenceConsent,
  runSqliteWriteTransaction,
  setUserProfilePromptState,
  setUserTrustPolicy,
  upsertMemoryRecord,
} from '../../../storage/sqlite/index.js';
import { isUserTrustLevel, USER_TRUST_LEVELS } from '../../../user-context/trust-policy.js';
import {
  buildUserProfileSetup,
  parseUserProfileMarkdown,
  patchUserProfileMarkdown,
  type UserProfileFields,
} from '../../../user-context/profile.js';
import {
  isUserContextRecord,
  isUserContextMemoryKind,
  projectPersonalContextSources,
  projectUserContextRecord,
  recordsDerivedFromPersonalContextSource,
} from '../../../user-context/projection.js';
import { prepareUserContextImport } from '../../../user-context/import.js';
import { buildGoalSourceRecommendations } from '../../../user-context/source-recommendations.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const VISIBLE_STATUSES = new Set<MemoryRecord['status']>(['active', 'candidate', 'needs_review']);
const ACTIONABLE_INSIGHT_KINDS = new Set<MemoryRecord['kind']>([
  'routine',
  'commitment',
  'long_term_goal',
  'derived_insight',
  'task_lesson',
]);
const INSIGHT_ACCEPTED_TAG = 'insight-action:accepted';
const INSIGHT_DISMISSED_TAG = 'insight-action:dismissed';
const PLAYBOOK_IDS = ['communication', 'execution', 'routines'] as const;
type PlaybookId = typeof PLAYBOOK_IDS[number];
const PLAYBOOK_DISABLED_TAG = 'playbook:disabled';
const PLAYBOOK_ORDER_PREFIX = 'playbook:order:';
const PROFILE_FIELD_LIMITS: Record<keyof UserProfileFields, number> = {
  callName: 80,
  pronouns: 80,
  timezone: 100,
  notes: 5_000,
};
const PROFILE_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1_000;
const ALL_MEMORY_STATUSES: MemoryRecord['status'][] = [
  'candidate',
  'active',
  'needs_review',
  'stale',
  'archived',
  'rejected',
];
const MEMORY_SENSITIVITIES = new Set<NonNullable<MemoryRecord['sensitivity']>>(['normal', 'personal', 'secret', 'regulated']);
const MEMORY_DURABILITIES = new Set<MemoryRecord['durability']>(['ephemeral', 'durable', 'recurring']);
const MEMORY_DISCLOSURE_POLICIES = new Set<MemoryRecord['disclosurePolicy']>(['silent', 'referenceable', 'ask_before_reference']);

function listAllUserContextRecords(statuses: MemoryRecord['status'][]): MemoryRecord[] {
  return statuses.flatMap((status) => {
    const records: MemoryRecord[] = [];
    let offset = 0;
    while (true) {
      const page = listMemoryRecords({ status, limit: 500, offset });
      records.push(...page);
      if (page.length < 500) break;
      offset += page.length;
    }
    return records;
  });
}

function projectReferenceConsent(consent: ReturnType<typeof listMemoryReferenceConsents>[number], record: MemoryRecord) {
  return {
    id: consent.id,
    recordId: consent.recordId,
    sessionKey: consent.sessionKey,
    purpose: consent.purpose,
    statement: record.content,
    sourceName: record.source.provider ?? 'local',
    status: consent.status,
    grantScope: consent.grantScope,
    expiresAt: consent.expiresAt,
    createdAt: consent.createdAt,
    updatedAt: consent.updatedAt,
  };
}

function buildConflictGroups(records: MemoryRecord[]) {
  const groups = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    if (!record.conflictGroupId) continue;
    const group = groups.get(record.conflictGroupId) ?? [];
    group.push(record);
    groups.set(record.conflictGroupId, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1 && group.some((record) => VISIBLE_STATUSES.has(record.status)))
    .map(([id, group]) => ({
      id,
      records: group
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .map((record) => ({ ...projectUserContextRecord(record), storedStatus: record.status })),
      unresolved: group.filter((record) => VISIBLE_STATUSES.has(record.status)).length > 1,
    }));
}

async function readProfileBundle(config: Config) {
  const result = await readUserProfileFile();
  const profileContent = result.ok ? result.data.content : '';
  const profile = parseUserProfileMarkdown(profileContent);
  const promptState = getUserProfilePromptState();
  return {
    profileContent,
    profile,
    profileSetup: buildUserProfileSetup({ profile, promptState, config }),
  };
}

function parseProfilePatch(body: unknown): { patch: Partial<UserProfileFields> } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid profile patch' };
  const record = body as Record<string, unknown>;
  const patch: Partial<UserProfileFields> = {};
  for (const field of Object.keys(PROFILE_FIELD_LIMITS) as Array<keyof UserProfileFields>) {
    if (!(field in record)) continue;
    if (typeof record[field] !== 'string') return { error: `${field} must be a string` };
    const value = record[field].trim();
    if (value.length > PROFILE_FIELD_LIMITS[field]) {
      return { error: `${field} is too long` };
    }
    patch[field] = value;
  }
  return Object.keys(patch).length > 0 ? { patch } : { error: 'No profile fields provided' };
}

function playbookForRecord(record: MemoryRecord): PlaybookId | undefined {
  if (record.kind === 'preference' || record.kind === 'boundary' || record.kind === 'tool_preference') return 'communication';
  if (record.kind === 'task_lesson' || record.kind === 'derived_insight') return 'execution';
  if (record.kind === 'routine') return 'routines';
  return undefined;
}

function playbookRuleOrder(record: MemoryRecord): number {
  const tag = record.tags?.find((value) => value.startsWith(PLAYBOOK_ORDER_PREFIX));
  const parsed = tag ? Number.parseInt(tag.slice(PLAYBOOK_ORDER_PREFIX.length), 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 1_000;
}

function patchPlaybookRuleTags(record: MemoryRecord, patch: { enabled?: boolean; order?: number }): string[] {
  let tags = (record.tags ?? []).filter((tag) => !tag.startsWith(PLAYBOOK_ORDER_PREFIX));
  if (patch.enabled === true) tags = tags.filter((tag) => tag !== PLAYBOOK_DISABLED_TAG);
  if (patch.enabled === false) tags.push(PLAYBOOK_DISABLED_TAG);
  if (patch.order !== undefined) tags.push(`${PLAYBOOK_ORDER_PREFIX}${patch.order}`);
  return [...new Set(tags)];
}

export function buildPersonalPlaybooks(records: MemoryRecord[]) {
  return PLAYBOOK_IDS.map((id) => {
    const rules = records
      .filter((record) => playbookForRecord(record) === id)
      .sort((left, right) => playbookRuleOrder(left) - playbookRuleOrder(right) || left.updatedAt.localeCompare(right.updatedAt));
    return {
      id,
      enabled: rules.some((record) => !record.tags?.includes(PLAYBOOK_DISABLED_TAG)),
      rules: rules.map((record) => ({
        id: record.id,
        statement: record.content,
        origin: record.explicitness,
        enabled: !record.tags?.includes(PLAYBOOK_DISABLED_TAG),
        order: playbookRuleOrder(record),
      })),
      updatedAt: rules.map((record) => record.updatedAt).sort().at(-1),
    };
  });
}

export function buildInsightSuggestions(records: MemoryRecord[]) {
  return records
    .filter((record) => record.status === 'active')
    .filter((record) => ACTIONABLE_INSIGHT_KINDS.has(record.kind))
    .filter((record) => !record.tags?.includes(INSIGHT_ACCEPTED_TAG) && !record.tags?.includes(INSIGHT_DISMISSED_TAG))
    .filter((record) => {
      const stability = resolveMemoryStability(record);
      return record.explicitness === 'explicit' || (record.evidence?.length ?? 0) >= 2 || stability.band === 'strong';
    })
    .sort((left, right) => right.importance - left.importance || Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 5)
    .map((record) => ({
      id: record.id,
      insight: record.content,
      kind: record.kind,
      action: record.kind === 'routine' ? 'make_repeatable' as const : 'start_progress' as const,
      evidenceCount: record.evidence?.length ?? 0,
      confidence: record.confidence,
      sourceName: record.source.provider ?? 'local',
    }));
}

export function buildRoutineAutomationDraftHref(record: Pick<MemoryRecord, 'id' | 'content'>): string {
  const params = new URLSearchParams({
    draft: record.content,
    autogenerate: '1',
    insight: record.id,
  });
  return `/automations?${params.toString()}`;
}

function selectedAgentId(config: Config): string {
  return resolveDefaultAgentId(config);
}

function editableRecord(recordId: string): MemoryRecord | null {
  const record = getMemoryRecord(recordId);
  if (
    !record
    || !VISIBLE_STATUSES.has(record.status)
    || !isUserContextRecord(record)
  ) return null;
  return record;
}

function preserveRecord(record: MemoryRecord, patch: Partial<Parameters<typeof upsertMemoryRecord>[0]>) {
  return upsertMemoryRecord({
    id: record.id,
    providerId: record.source.provider ?? 'local',
    kind: record.kind,
    sourceAgentId: record.provenance.sourceAgentId,
    workspaceId: record.scope.workspaceId,
    sessionKey: record.scope.sessionKey,
    projectId: record.scope.projectId,
    content: record.content,
    source: record.source,
    confidence: record.confidence,
    tags: record.tags,
    status: record.status,
    sensitivity: record.sensitivity,
    canonicalKey: record.canonicalKey,
    explicitness: record.explicitness,
    durability: record.durability,
    importance: record.importance,
    disclosurePolicy: record.disclosurePolicy,
    evidence: record.evidence,
    reviewAfter: record.reviewAfter,
    expiresAt: record.expiresAt,
    validFrom: record.validFrom,
    validTo: record.validTo,
    supersedesRecordId: record.supersedesRecordId,
    conflictGroupId: record.conflictGroupId,
    ...patch,
  });
}

export function registerYouRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/you', async (c) => {
    const config = deps.service.currentConfig as Config;
    const agentId = selectedAgentId(config);
    const profileBundle = await readProfileBundle(config);
    const allUserContextRecords = listAllUserContextRecords(ALL_MEMORY_STATUSES)
      .filter(isUserContextRecord);
    const records = allUserContextRecords.filter((record) => VISIBLE_STATUSES.has(record.status));
    const recordById = new Map(allUserContextRecords.map((record) => [record.id, record]));
    const consents = listMemoryReferenceConsents();
    const trustPolicy = getUserTrustPolicy();
    const sourceDefinitions = listConnectorCatalog();
    const sourceInstances = listConnectorInstances(config);
    const sources = projectPersonalContextSources(sourceDefinitions, sourceInstances, allUserContextRecords, {
      sourceItems: listKnowledgeSourceItems({ limit: 500 }),
      syncRuns: listKnowledgeSyncRuns({ limit: 500 }),
      connections: listConnectorConnections({ principalId: 'local-owner' }),
    });
    const activeGoals = new GoalService().list({
      agentId,
      status: ['active', 'paused', 'blocked', 'needs_input'],
      limit: 20,
    });
    return c.json({
      scope: {
        profile: 'global',
        memory: 'global',
        trust: 'global',
      },
      ...profileBundle,
      understanding: records.map(projectUserContextRecord),
      consentRequests: consents.filter((consent) => consent.status === 'pending').flatMap((consent) => {
        const record = recordById.get(consent.recordId);
        return record ? [projectReferenceConsent(consent, record)] : [];
      }),
      referenceGrants: consents.filter((consent) => (
        consent.status === 'granted'
        && (!consent.expiresAt || Date.parse(consent.expiresAt) > Date.now())
      )).flatMap((consent) => {
        const record = recordById.get(consent.recordId);
        return record ? [projectReferenceConsent(consent, record)] : [];
      }),
      conflictGroups: buildConflictGroups(allUserContextRecords),
      insights: buildInsightSuggestions(records),
      playbooks: buildPersonalPlaybooks(records.filter((record) => record.status === 'active')),
      sources,
      sourceRecommendations: buildGoalSourceRecommendations(
        sourceDefinitions.filter((definition) => (
          definition.capabilities.includes('context') || definition.capabilities.includes('memory_source')
        )),
        new Set(sourceInstances.map((instance) => instance.connectorId)),
        activeGoals,
      ),
      controls: {
        mode: config.userContext.memory.mode,
        sensitiveWritePolicy: config.userContext.privacy.sensitiveWritePolicy,
      },
      trust: {
        defaultActionLevel: trustPolicy.defaultActionLevel,
        levels: USER_TRUST_LEVELS,
        autoRequiresExplicitOptIn: true,
      },
    });
  });

  authenticated.get('/api/you/profile', async (c) => {
    return c.json(await readProfileBundle(deps.service.currentConfig as Config));
  });

  authenticated.get('/api/you/export', async (c) => {
    const config = deps.service.currentConfig as Config;
    const profileBundle = await readProfileBundle(config);
    const understanding = listAllUserContextRecords(ALL_MEMORY_STATUSES)
      .filter(isUserContextRecord)
      .map((record) => ({
        statement: record.content,
        kind: record.kind,
        status: record.status,
        sensitivity: record.sensitivity ?? 'normal',
        durability: record.durability,
        disclosurePolicy: record.disclosurePolicy,
        sourceName: record.source.provider ?? 'local',
        updatedAt: record.updatedAt,
      }));
    return c.json({
      version: 2,
      exportedAt: new Date().toISOString(),
      profile: profileBundle.profile,
      understanding,
    });
  });

  authenticated.post('/api/you/import', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.version !== 2 || !Array.isArray(body.understanding)) {
      return c.json({ error: 'Invalid About You export' }, 400);
    }
    if (body.understanding.length > 500) return c.json({ error: 'Import is limited to 500 understandings' }, 400);
    const config = deps.service.currentConfig as Config;
    const agentId = selectedAgentId(config);
    const existingStatements = listAllUserContextRecords(ALL_MEMORY_STATUSES)
      .filter(isUserContextRecord)
      .map((record) => record.content);
    const { imports, skippedCount } = prepareUserContextImport(body.understanding, existingStatements);
    runSqliteWriteTransaction(() => {
      for (const item of imports) {
        upsertMemoryRecord({
          providerId: 'local',
          kind: item.kind,
          sourceAgentId: agentId,
          content: item.statement,
          source: { provider: 'local', path: 'import://about-you' },
          confidence: 1,
          tags: ['user-understanding', 'user-import'],
          status: 'candidate',
          sensitivity: item.sensitivity,
          explicitness: 'explicit',
          durability: item.durability,
          importance: 0.7,
          disclosurePolicy: item.disclosurePolicy,
        });
      }
    });
    return c.json({ ok: true, importedCount: imports.length, skippedCount });
  });

  authenticated.post('/api/you/understanding', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const kind = isUserContextMemoryKind(body.kind) ? body.kind : undefined;
    if (!content || content.length > 5_000) return c.json({ error: 'Understanding content must be 1-5000 characters' }, 400);
    if (!kind) return c.json({ error: 'A valid user understanding kind is required' }, 400);
    const duplicate = listAllUserContextRecords(ALL_MEMORY_STATUSES)
      .filter(isUserContextRecord)
      .find((record) => record.content.trim().toLocaleLowerCase() === content.toLocaleLowerCase());
    if (duplicate) return c.json({ error: 'This understanding already exists', understanding: projectUserContextRecord(duplicate) }, 409);
    const sensitivity = MEMORY_SENSITIVITIES.has(body.sensitivity) ? body.sensitivity : 'normal';
    const durability = MEMORY_DURABILITIES.has(body.durability) ? body.durability : 'durable';
    const disclosurePolicy = MEMORY_DISCLOSURE_POLICIES.has(body.disclosurePolicy)
      ? body.disclosurePolicy
      : 'referenceable';
    const config = deps.service.currentConfig as Config;
    const created = upsertMemoryRecord({
      providerId: 'local',
      kind,
      sourceAgentId: selectedAgentId(config),
      content,
      source: { provider: 'local', path: 'you://manual' },
      confidence: 1,
      tags: ['user-understanding', 'explicit-user-memory'],
      status: 'active',
      sensitivity,
      explicitness: 'explicit',
      durability,
      importance: 0.8,
      disclosurePolicy,
      reviewAfter: nextMemoryReviewAt({ durability, explicitness: 'explicit' }),
    });
    return c.json({ understanding: projectUserContextRecord(created) }, 201);
  });

  authenticated.get('/api/you/understanding/:id/history', (c) => {
    const all = listAllUserContextRecords(ALL_MEMORY_STATUSES).filter(isUserContextRecord);
    const target = all.find((record) => record.id === c.req.param('id'));
    if (!target) return c.json({ error: 'Understanding not found' }, 404);
    const relatedIds = new Set([target.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of all) {
        if (
          (record.supersedesRecordId && relatedIds.has(record.supersedesRecordId))
          || (record.supersedesRecordId && relatedIds.has(record.id))
        ) {
          if (!relatedIds.has(record.id)) { relatedIds.add(record.id); changed = true; }
          if (record.supersedesRecordId && !relatedIds.has(record.supersedesRecordId)) {
            relatedIds.add(record.supersedesRecordId);
            changed = true;
          }
        }
      }
    }
    const history = all
      .filter((record) => relatedIds.has(record.id))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .map((record) => ({ ...projectUserContextRecord(record), storedStatus: record.status }));
    return c.json({ history });
  });

  authenticated.post('/api/you/understanding/batch', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids)
      ? [...new Set<string>(body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 100))]
      : [];
    const action = body.action === 'confirm' || body.action === 'reject' || body.action === 'forget' ? body.action : undefined;
    if (!ids.length || !action) return c.json({ error: 'ids and a valid action are required' }, 400);
    let updatedCount = 0;
    runSqliteWriteTransaction(() => {
      for (const id of ids) {
        const record = editableRecord(id);
        if (!record) continue;
        if (action === 'forget') deleteMemoryRecord(id);
        else preserveRecord(record, {
          status: action === 'confirm' ? 'active' : 'rejected',
          ...(action === 'confirm' ? { reviewAfter: nextMemoryReviewAt(record) } : {}),
        });
        updatedCount += 1;
      }
    });
    return c.json({ ok: true, updatedCount });
  });

  authenticated.post('/api/you/conflicts/:id/resolve', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const winnerId = typeof body.winnerId === 'string' ? body.winnerId : '';
    const group = listAllUserContextRecords(ALL_MEMORY_STATUSES)
      .filter(isUserContextRecord)
      .filter((record) => record.conflictGroupId === c.req.param('id'));
    const winner = group.find((record) => record.id === winnerId && VISIBLE_STATUSES.has(record.status));
    if (group.length < 2 || !winner) return c.json({ error: 'Conflict group or winner not found' }, 404);
    const now = new Date().toISOString();
    runSqliteWriteTransaction(() => {
      for (const record of group) {
        preserveRecord(record, record.id === winnerId
          ? { status: 'active', reviewAfter: nextMemoryReviewAt(record) }
          : { status: 'archived', validTo: record.validTo ?? now });
      }
    });
    return c.json({ ok: true, understanding: projectUserContextRecord(getMemoryRecord(winnerId)!) });
  });

  authenticated.patch('/api/you/profile', deps.strictRateLimitMiddleware, async (c) => {
    const config = deps.service.currentConfig as Config;
    const parsed = parseProfilePatch(await c.req.json().catch(() => null));
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const current = await readUserProfileFile();
    const content = current.ok ? current.data.content : '';
    const nextContent = patchUserProfileMarkdown(content, parsed.patch);
    const saved = await writeUserProfileFile(nextContent);
    if (saved.ok === false) return c.json({ error: saved.error }, saved.status ?? 500);
    if (parsed.patch.callName !== undefined) {
      setUserProfilePromptState({ state: 'active' });
    }
    deps.service.refreshUserProfileContext();
    return c.json(await readProfileBundle(config));
  });

  authenticated.post('/api/you/profile-prompt', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : '';
    if (action !== 'snooze' && action !== 'reset') {
      return c.json({ error: 'Action must be snooze or reset' }, 400);
    }
    const config = deps.service.currentConfig as Config;
    const current = await readProfileBundle(config);
    const suggestionHash = current.profileSetup.callNameSuggestion?.id;
    const promptState = action === 'snooze'
      ? setUserProfilePromptState({
          state: 'snoozed',
          suggestionHash,
          snoozedUntil: new Date(Date.now() + PROFILE_PROMPT_SNOOZE_MS).toISOString(),
        })
      : setUserProfilePromptState({ state: 'active', suggestionHash });
    return c.json({
      profileSetup: buildUserProfileSetup({ profile: current.profile, promptState, config }),
    });
  });

  authenticated.patch('/api/you/trust', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!isUserTrustLevel(body.defaultActionLevel)) {
      return c.json({ error: 'Invalid default action level' }, 400);
    }
    const policy = setUserTrustPolicy(body.defaultActionLevel);
    deps.service.refreshActionTrustPolicy();
    return c.json({
      trust: {
        defaultActionLevel: policy.defaultActionLevel,
        levels: USER_TRUST_LEVELS,
        autoRequiresExplicitOptIn: true,
      },
    });
  });

  authenticated.patch('/api/you/playbooks/:id', deps.strictRateLimitMiddleware, async (c) => {
    const id = c.req.param('id') as PlaybookId;
    if (!PLAYBOOK_IDS.includes(id)) return c.json({ error: 'Playbook not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const enabled = body.enabled;
    if (typeof enabled !== 'boolean') return c.json({ error: 'enabled must be a boolean' }, 400);
    const active = listMemoryRecords({ status: 'active', limit: 500 })
      .filter(isUserContextRecord)
      .filter((record) => playbookForRecord(record) === id);
    runSqliteWriteTransaction(() => {
      for (const record of active) {
        preserveRecord(record, {
          tags: patchPlaybookRuleTags(record, { enabled }),
        });
      }
    });
    const current = active.map((record) => ({ ...record, tags: patchPlaybookRuleTags(record, { enabled }) }));
    return c.json({ ok: true, playbook: buildPersonalPlaybooks(current).find((playbook) => playbook.id === id) });
  });

  authenticated.post('/api/you/playbooks/:id/rules', deps.strictRateLimitMiddleware, async (c) => {
    const id = c.req.param('id') as PlaybookId;
    if (!PLAYBOOK_IDS.includes(id)) return c.json({ error: 'Playbook not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const statement = typeof body.statement === 'string' ? body.statement.trim() : '';
    if (!statement || statement.length > 5_000) return c.json({ error: 'Rule statement is required' }, 400);
    const kind: MemoryRecord['kind'] = id === 'communication' ? 'preference' : id === 'execution' ? 'task_lesson' : 'routine';
    const record = upsertMemoryRecord({
      providerId: 'local',
      kind,
      sourceAgentId: selectedAgentId(deps.service.currentConfig as Config),
      content: statement,
      source: { provider: 'local', path: 'you://playbook' },
      confidence: 1,
      tags: ['user-understanding', 'playbook:explicit', `${PLAYBOOK_ORDER_PREFIX}${Number.isInteger(body.order) ? body.order : 1_000}`],
      status: 'active',
      sensitivity: 'normal',
      explicitness: 'explicit',
      durability: id === 'routines' ? 'recurring' : 'durable',
      importance: 0.85,
      disclosurePolicy: 'referenceable',
    });
    return c.json({
      ok: true,
      rule: buildPersonalPlaybooks([record]).find((playbook) => playbook.id === id)?.rules[0],
    }, 201);
  });

  authenticated.patch('/api/you/playbooks/:id/rules/:recordId', deps.strictRateLimitMiddleware, async (c) => {
    const id = c.req.param('id') as PlaybookId;
    const record = editableRecord(c.req.param('recordId'));
    if (!PLAYBOOK_IDS.includes(id) || !record || playbookForRecord(record) !== id) {
      return c.json({ error: 'Playbook rule not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const content = body.statement === undefined
      ? record.content
      : typeof body.statement === 'string' ? body.statement.trim() : '';
    if (!content || content.length > 5_000) return c.json({ error: 'Rule statement is required' }, 400);
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return c.json({ error: 'enabled must be boolean' }, 400);
    if (body.order !== undefined && (!Number.isInteger(body.order) || body.order < 0 || body.order > 10_000)) {
      return c.json({ error: 'order must be an integer between 0 and 10000' }, 400);
    }
    const updated = preserveRecord(record, {
      content,
      tags: patchPlaybookRuleTags(record, { enabled: body.enabled, order: body.order }),
      explicitness: body.statement === undefined ? record.explicitness : 'explicit',
    });
    return c.json({
      ok: true,
      rule: buildPersonalPlaybooks([updated]).find((playbook) => playbook.id === id)?.rules[0],
    });
  });

  authenticated.delete('/api/you/playbooks/:id/rules/:recordId', deps.strictRateLimitMiddleware, (c) => {
    const id = c.req.param('id') as PlaybookId;
    const record = editableRecord(c.req.param('recordId'));
    if (!PLAYBOOK_IDS.includes(id) || !record || playbookForRecord(record) !== id) {
      return c.json({ error: 'Playbook rule not found' }, 404);
    }
    deleteMemoryRecord(record.id);
    return c.json({ ok: true });
  });

  authenticated.patch('/api/you/insights/:id', deps.strictRateLimitMiddleware, async (c) => {
    const config = deps.service.currentConfig as Config;
    const existing = editableRecord(c.req.param('id'));
    if (!existing || existing.status !== 'active' || !ACTIONABLE_INSIGHT_KINDS.has(existing.kind)) {
      return c.json({ error: 'Insight not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'dismiss') {
      preserveRecord(existing, { tags: [...new Set([...(existing.tags ?? []), INSIGHT_DISMISSED_TAG])] });
      return c.json({ ok: true, status: 'dismissed' });
    }
    if (action === 'complete' && existing.kind === 'routine') {
      preserveRecord(existing, { tags: [...new Set([...(existing.tags ?? []), INSIGHT_ACCEPTED_TAG])] });
      return c.json({ ok: true, status: 'saved' });
    }
    if (action !== 'apply') return c.json({ error: 'Action must be apply, complete, or dismiss' }, 400);

    if (existing.kind === 'routine') {
      return c.json({ ok: true, status: 'drafting', href: buildRoutineAutomationDraftHref(existing) });
    }

    const title = existing.content.trim().split(/\r?\n/)[0]!.slice(0, 72);
    const uiLocale = body.uiLocale === 'zh' ? 'zh' : 'en';
    const contractDraft = await draftGoalContract({
      title,
      context: existing.content,
      uiLocale,
      modelRef: config.goals?.judgeModelRef,
    });
    const goals = new GoalService();
    const goal = goals.create({
      title,
      description: existing.content,
      agentId: selectedAgentId(config),
      priority: 'normal',
      uiLocale,
      source: 'api',
      contract: contractDraft.contract,
      config,
    });
    goals.setContextMessage({ goalId: goal.id, text: existing.content });
    let queued = false;
    try {
      deps.service.enqueueGoalRun(goal.id, { source: 'api' });
      queued = true;
    } catch {
      queued = false;
    } finally {
      preserveRecord(existing, { tags: [...new Set([...(existing.tags ?? []), INSIGHT_ACCEPTED_TAG])] });
    }
    return c.json({ ok: true, status: queued ? 'queued' : 'saved', goal: goals.get(goal.id), href: `/goals/${goal.id}` });
  });

  authenticated.patch('/api/you/controls', deps.strictRateLimitMiddleware, async (c) => {
    const config = deps.service.currentConfig as Config;
    const body = await c.req.json().catch(() => ({}));
    const parsed = UserContextConfigSchema.safeParse({
      ...config.userContext,
      memory: { ...config.userContext.memory, mode: body.mode },
      privacy: { ...config.userContext.privacy, sensitiveWritePolicy: body.sensitiveWritePolicy },
    });
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid personal context controls' }, 400);
    }
    const saved = await deps.service.saveConfig({ ...config, userContext: parsed.data });
    if (!saved.saved) return c.json({ error: saved.error ?? 'save failed' }, 500);
    const updated = (deps.service.currentConfig as Config).userContext;
    return c.json({
      controls: {
        mode: updated.memory.mode,
        sensitiveWritePolicy: updated.privacy.sensitiveWritePolicy,
      },
    });
  });

  authenticated.patch('/api/you/consents/:id', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (!['once', 'session', 'always', 'deny'].includes(decision)) {
      return c.json({ error: 'Decision must be once, session, always, or deny' }, 400);
    }
    const consent = decideMemoryReferenceConsent(
      c.req.param('id'),
      decision as 'once' | 'session' | 'always' | 'deny',
    );
    if (!consent) return c.json({ error: 'Pending consent not found' }, 404);
    return c.json({ ok: true, consent });
  });

  authenticated.delete('/api/you/consents/:id', deps.strictRateLimitMiddleware, (c) => {
    const consent = revokeMemoryReferenceConsent(c.req.param('id'));
    if (!consent) return c.json({ error: 'Active reference grant not found' }, 404);
    return c.json({ ok: true, consent });
  });

  authenticated.delete('/api/you/sources/:instanceId', deps.strictRateLimitMiddleware, async (c) => {
    const config = deps.service.currentConfig as Config;
    const instanceId = c.req.param('instanceId');
    const installedInstances = listConnectorInstances(config);
    const connection = getConnectorConnection(instanceId);
    const instance = installedInstances.find((item) => item.instanceId === instanceId);
    const connectorId = connection?.connectorId ?? instance?.connectorId;
    const definition = connectorId
      ? listConnectorCatalog().find((item) => item.id === connectorId)
      : undefined;
    if ((!instance && !connection) || !definition || !definition.capabilities.some((capability) => (
      capability === 'context' || capability === 'memory_source'
    ))) {
      return c.json({ error: 'Personal context source not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.deleteDerivedUnderstanding !== 'boolean') {
      return c.json({ error: 'deleteDerivedUnderstanding must be a boolean' }, 400);
    }

    try {
      if (connection) {
        await revokeComposioConnection(connection.id);
      } else if (instance) {
        uninstallConnector(config, instance.instanceId);
        const saved = await deps.service.saveConfig(config);
        if (!saved.saved) return c.json({ error: saved.error ?? 'save failed' }, 500);
      }
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }

    let deletedUnderstandingCount = 0;
    if (body.deleteDerivedUnderstanding) {
      const sourceInstanceId = connection
        ? `composio:${connection.connectorId}:${connection.id}`
        : instanceId;
      const targets = recordsDerivedFromPersonalContextSource(
        listAllUserContextRecords(ALL_MEMORY_STATUSES),
        sourceInstanceId,
      );
      runSqliteWriteTransaction(() => {
        for (const record of targets) deleteMemoryRecord(record.id);
      });
      deletedUnderstandingCount = targets.length;
    }
    return c.json({ ok: true, deletedUnderstandingCount });
  });

  authenticated.patch('/api/you/understanding/:id', deps.strictRateLimitMiddleware, async (c) => {
    const existing = editableRecord(c.req.param('id'));
    if (!existing) return c.json({ error: 'Understanding not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'confirm') {
      return c.json({
        understanding: projectUserContextRecord(preserveRecord(existing, {
          status: 'active',
          reviewAfter: nextMemoryReviewAt(existing),
        })),
      });
    }
    if (action === 'reject') {
      return c.json({ understanding: projectUserContextRecord(preserveRecord(existing, { status: 'rejected' })) });
    }
    if (action === 'update') {
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!content) return c.json({ error: 'Updated understanding cannot be empty' }, 400);
      const replacement = upsertMemoryRecord({
        providerId: 'local',
        kind: existing.kind,
        sourceAgentId: existing.provenance.sourceAgentId,
        workspaceId: existing.scope.workspaceId,
        sessionKey: existing.scope.sessionKey,
        projectId: existing.scope.projectId,
        content,
        source: { provider: 'local' },
        confidence: 1,
        tags: [...new Set([...(existing.tags ?? []), 'user-understanding', 'explicit-user-correction'])],
        status: 'active',
        sensitivity: existing.sensitivity,
        explicitness: 'explicit',
        durability: existing.durability,
        importance: Math.max(existing.importance, 0.8),
        disclosurePolicy: existing.disclosurePolicy,
        evidence: existing.evidence,
        reviewAfter: nextMemoryReviewAt({ durability: existing.durability, explicitness: 'explicit' }),
        supersedesRecordId: existing.id,
        conflictGroupId: existing.conflictGroupId,
      });
      preserveRecord(existing, { status: 'archived', validTo: new Date().toISOString() });
      return c.json({ understanding: projectUserContextRecord(replacement) });
    }
    return c.json({ error: 'Action must be confirm, reject, or update' }, 400);
  });

  authenticated.delete('/api/you/understanding/:id', deps.strictRateLimitMiddleware, (c) => {
    const existing = editableRecord(c.req.param('id'));
    if (!existing) return c.json({ error: 'Understanding not found' }, 404);
    deleteMemoryRecord(existing.id);
    return c.json({ ok: true });
  });
}
