import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import type { MemoryRecord } from '../../../agent/memory/types.js';
import { nextMemoryReviewAt, resolveMemoryStability } from '../../../agent/memory/lifecycle.js';
import { MemoryPolicySchema } from '../../../agent-manifest/schema.js';
import { resolveEffectiveAgentManifestForAgent } from '../../../config/agent-profile.js';
import type { Config } from '../../../config/schema.js';
import { listConnectorCatalog } from '../../../connectors/catalog.js';
import { listConnectorInstances } from '../../../connectors/instances.js';
import { uninstallConnector } from '../../../connectors/install.js';
import { draftGoalContract, GoalService } from '../../../goals/index.js';
import { prepareUpdateAgent, readUserProfileFile, writeUserProfileFile } from '../../agents-admin.js';
import {
  deleteMemoryRecord,
  getMemoryRecord,
  getUserProfilePromptState,
  getUserTrustPolicy,
  listKnowledgeSourceItems,
  listKnowledgeSyncRuns,
  listMemoryRecords,
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

function listAllAgentMemoryRecords(agentId: string, statuses: MemoryRecord['status'][]): MemoryRecord[] {
  return statuses.flatMap((status) => {
    const records: MemoryRecord[] = [];
    let offset = 0;
    while (true) {
      const page = listMemoryRecords({ agentId, status, limit: 500, offset });
      records.push(...page);
      if (page.length < 500) break;
      offset += page.length;
    }
    return records;
  });
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

export function buildPersonalPlaybooks(records: MemoryRecord[]) {
  return PLAYBOOK_IDS.flatMap((id) => {
    const rules = records.filter((record) => playbookForRecord(record) === id);
    if (rules.length === 0) return [];
    return [{
      id,
      enabled: rules.some((record) => record.status === 'active'),
      rules: rules.map((record) => ({
        id: record.id,
        statement: record.content,
        origin: record.explicitness,
      })),
      updatedAt: rules.map((record) => record.updatedAt).sort().at(-1),
    }];
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

function selectedAgentId(config: Config): string {
  return resolveDefaultAgentId(config);
}

function editableRecord(recordId: string, config: Config): MemoryRecord | null {
  const record = getMemoryRecord(recordId);
  if (
    !record
    || record.scope.agentId !== selectedAgentId(config)
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
    agentId: record.scope.agentId,
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
    const allUserContextRecords = listAllAgentMemoryRecords(agentId, ALL_MEMORY_STATUSES)
      .filter(isUserContextRecord);
    const records = allUserContextRecords.filter((record) => VISIBLE_STATUSES.has(record.status));
    const pausedPlaybookRecords = listMemoryRecords({ agentId, status: 'archived', limit: 200 })
      .filter(isUserContextRecord)
      .filter((record) => record.tags?.some((tag) => tag.startsWith('playbook:paused:')));
    const manifest = resolveEffectiveAgentManifestForAgent(config, agentId);
    const trustPolicy = getUserTrustPolicy();
    const sourceDefinitions = listConnectorCatalog();
    const sourceInstances = listConnectorInstances(config);
    const sources = projectPersonalContextSources(sourceDefinitions, sourceInstances, allUserContextRecords, {
      sourceItems: listKnowledgeSourceItems({ limit: 500 }),
      syncRuns: listKnowledgeSyncRuns({ limit: 500 }),
    });
    const activeGoals = new GoalService().list({
      agentId,
      status: ['active', 'paused', 'blocked', 'needs_input'],
      limit: 20,
    });
    return c.json({
      agentId,
      scope: {
        profile: 'global',
        memory: 'agent',
        trust: 'global',
        agentId,
      },
      ...profileBundle,
      understanding: records.map(projectUserContextRecord),
      insights: buildInsightSuggestions(records),
      playbooks: buildPersonalPlaybooks([...records.filter((record) => record.status === 'active'), ...pausedPlaybookRecords]),
      sources,
      sourceRecommendations: buildGoalSourceRecommendations(
        sourceDefinitions.filter((definition) => (
          definition.capabilities.includes('context') || definition.capabilities.includes('memory_source')
        )),
        new Set(sourceInstances.map((instance) => instance.connectorId)),
        activeGoals,
      ),
      controls: {
        mode: manifest.memory.mode,
        sensitiveWritePolicy: manifest.memory.privacy?.sensitiveWritePolicy ?? 'confirm',
        crossAgentSharing: manifest.memory.privacy?.crossAgentSharing ?? 'deny',
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
    const agentId = selectedAgentId(config);
    const profileBundle = await readProfileBundle(config);
    const understanding = listAllAgentMemoryRecords(agentId, ALL_MEMORY_STATUSES)
      .filter(isUserContextRecord)
      .map((record) => ({
        statement: record.content,
        kind: record.kind,
        status: record.status,
        sensitivity: record.sensitivity ?? 'normal',
        durability: record.durability,
        canReference: record.disclosurePolicy !== 'silent',
        sourceName: record.source.provider ?? 'local',
        updatedAt: record.updatedAt,
      }));
    return c.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      agentId,
      profile: profileBundle.profile,
      understanding,
    });
  });

  authenticated.post('/api/you/import', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.version !== 1 || !Array.isArray(body.understanding)) {
      return c.json({ error: 'Invalid About You export' }, 400);
    }
    if (body.understanding.length > 500) return c.json({ error: 'Import is limited to 500 understandings' }, 400);
    const config = deps.service.currentConfig as Config;
    const agentId = selectedAgentId(config);
    const existingStatements = listAllAgentMemoryRecords(agentId, ALL_MEMORY_STATUSES)
      .filter(isUserContextRecord)
      .map((record) => record.content);
    const { imports, skippedCount } = prepareUserContextImport(body.understanding, existingStatements);
    runSqliteWriteTransaction(() => {
      for (const item of imports) {
        upsertMemoryRecord({
          providerId: 'local',
          kind: item.kind,
          agentId,
          content: item.statement,
          source: { provider: 'local', path: 'import://about-you' },
          confidence: 1,
          tags: ['user-understanding', 'user-import'],
          status: 'candidate',
          sensitivity: item.sensitivity,
          explicitness: 'explicit',
          durability: item.durability,
          importance: 0.7,
          disclosurePolicy: item.canReference ? 'referenceable' : 'silent',
        });
      }
    });
    return c.json({ ok: true, importedCount: imports.length, skippedCount });
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
    const config = deps.service.currentConfig as Config;
    const agentId = selectedAgentId(config);
    const pauseTag = `playbook:paused:${id}`;
    const active = listMemoryRecords({ agentId, status: 'active', limit: 500 })
      .filter(isUserContextRecord)
      .filter((record) => playbookForRecord(record) === id);
    const paused = listMemoryRecords({ agentId, status: 'archived', limit: 500 })
      .filter(isUserContextRecord)
      .filter((record) => record.tags?.includes(pauseTag));
    const targets = enabled ? paused : active;
    runSqliteWriteTransaction(() => {
      for (const record of targets) {
        preserveRecord(record, {
          status: enabled ? 'active' : 'archived',
          tags: enabled
            ? (record.tags ?? []).filter((tag) => tag !== pauseTag)
            : [...new Set([...(record.tags ?? []), pauseTag])],
        });
      }
    });
    const current = active.concat(paused);
    return c.json({ ok: true, playbook: buildPersonalPlaybooks(current.map((record) => ({
      ...record,
      status: enabled ? 'active' : 'archived',
    })))[0] });
  });

  authenticated.patch('/api/you/insights/:id', deps.strictRateLimitMiddleware, async (c) => {
    const config = deps.service.currentConfig as Config;
    const existing = editableRecord(c.req.param('id'), config);
    if (!existing || existing.status !== 'active' || !ACTIONABLE_INSIGHT_KINDS.has(existing.kind)) {
      return c.json({ error: 'Insight not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'dismiss') {
      preserveRecord(existing, { tags: [...new Set([...(existing.tags ?? []), INSIGHT_DISMISSED_TAG])] });
      return c.json({ ok: true, status: 'dismissed' });
    }
    if (action !== 'apply') return c.json({ error: 'Action must be apply or dismiss' }, 400);

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
    const agentId = selectedAgentId(config);
    const manifest = resolveEffectiveAgentManifestForAgent(config, agentId);
    const body = await c.req.json().catch(() => ({}));
    const parsed = MemoryPolicySchema.safeParse({
      ...manifest.memory,
      mode: body.mode,
      privacy: {
        ...manifest.memory.privacy,
        sensitiveWritePolicy: body.sensitiveWritePolicy,
        crossAgentSharing: body.crossAgentSharing,
      },
    });
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid personal context controls' }, 400);
    }
    const prep = prepareUpdateAgent(config, agentId, { memory: parsed.data });
    if (prep.ok === false) return c.json({ error: prep.error }, prep.status ?? 400);
    const saved = await deps.service.saveConfig(prep.data.nextConfig);
    if (!saved.saved) return c.json({ error: saved.error ?? 'save failed' }, 500);
    const updated = resolveEffectiveAgentManifestForAgent(deps.service.currentConfig as Config, agentId);
    return c.json({
      controls: {
        mode: updated.memory.mode,
        sensitiveWritePolicy: updated.memory.privacy?.sensitiveWritePolicy ?? 'confirm',
        crossAgentSharing: updated.memory.privacy?.crossAgentSharing ?? 'deny',
      },
    });
  });

  authenticated.delete('/api/you/sources/:instanceId', deps.strictRateLimitMiddleware, async (c) => {
    const config = deps.service.currentConfig as Config;
    const instanceId = c.req.param('instanceId');
    const installedInstances = listConnectorInstances(config);
    const instance = installedInstances.find((item) => item.instanceId === instanceId);
    const definition = instance
      ? listConnectorCatalog().find((item) => item.id === instance.connectorId)
      : undefined;
    if (!instance || !definition || !definition.capabilities.some((capability) => (
      capability === 'context' || capability === 'memory_source'
    ))) {
      return c.json({ error: 'Personal context source not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.deleteDerivedUnderstanding !== 'boolean') {
      return c.json({ error: 'deleteDerivedUnderstanding must be a boolean' }, 400);
    }

    try {
      const sourceInstances = installedInstances.filter((item) => item.connectorId === instance.connectorId);
      for (const sourceInstance of sourceInstances) {
        uninstallConnector(config, sourceInstance.instanceId);
      }
      const saved = await deps.service.saveConfig(config);
      if (!saved.saved) return c.json({ error: saved.error ?? 'save failed' }, 500);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }

    let deletedUnderstandingCount = 0;
    if (body.deleteDerivedUnderstanding) {
      const agentId = selectedAgentId(config);
      const targets = recordsDerivedFromPersonalContextSource(
        listAllAgentMemoryRecords(agentId, ALL_MEMORY_STATUSES),
        agentId,
        instance.connectorId,
      );
      runSqliteWriteTransaction(() => {
        for (const record of targets) deleteMemoryRecord(record.id);
      });
      deletedUnderstandingCount = targets.length;
    }
    return c.json({ ok: true, deletedUnderstandingCount });
  });

  authenticated.patch('/api/you/understanding/:id', deps.strictRateLimitMiddleware, async (c) => {
    const config = deps.service.currentConfig as Config;
    const existing = editableRecord(c.req.param('id'), config);
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
        agentId: existing.scope.agentId,
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
    const config = deps.service.currentConfig as Config;
    const existing = editableRecord(c.req.param('id'), config);
    if (!existing) return c.json({ error: 'Understanding not found' }, 404);
    deleteMemoryRecord(existing.id);
    return c.json({ ok: true });
  });
}
