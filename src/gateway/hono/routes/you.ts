import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import type { MemoryRecord } from '../../../agent/memory/types.js';
import { nextMemoryReviewAt } from '../../../agent/memory/lifecycle.js';
import { resolveDreamingSettings } from '../../../agent/memory/dreaming/config.js';
import { runDreamingPhase } from '../../../agent/memory/dreaming/runner.js';
import { nextDreamingRunTimes } from '../../../agent/memory/dreaming/schedule.js';
import { resolveDreamingAgentScope } from '../../../agent/memory/dreaming/scope.js';
import type { Config } from '../../../config/schema.js';
import { DreamingSettingsSchema, UserContextConfigSchema } from '../../../user-context/config.js';
import { listConnectorCatalog } from '../../../connectors/catalog.js';
import { listConnectorInstances } from '../../../connectors/instances.js';
import { uninstallConnector } from '../../../connectors/install.js';
import { revokeComposioConnection } from '../../../connectors/composio.js';
import { TaskRepository } from '../../../tasks/index.js';
import { TaskContextRepository } from '../../../tasks/task-context-repository.js';
import { renderUserClaim } from '../../../knowledge/connected-understanding-pipeline.js';
import { readUserProfileFile, writeUserProfileFile } from '../../agents-admin.js';
import {
  decideMemoryReferenceConsent,
  deleteMemoryRecord,
  getMemoryRecord,
  getDreamingRun,
  getMemoryTurnFeedback,
  getUserClaim,
  getRelationshipSettings,
  getUserProfilePromptState,
  getUserTrustPolicy,
  listKnowledgeSourceItems,
  listKnowledgeSyncRuns,
  listConnectorLearningJobs,
  getConnectorAccount,
  listConnectorConnections,
  listMemoryRecords,
  listMemorySignals,
  listDreamingRuns,
  listDreamingDecisions,
  listMemoryReferenceConsents,
  listUserClaims,
  listUserClaimEvidence,
  listUserClaimStatsBySource,
  linkUserClaimMemoryRecord,
  removeUserClaimEvidenceForSource,
  revokeMemoryReferenceConsent,
  runSqliteWriteTransaction,
  setUserProfilePromptState,
  setUserTrustPolicy,
  setUserClaimDecision,
  setInteractionState,
  setMemoryTurnFeedback,
  updateRelationshipSettings,
  upsertMemoryRecord,
} from '../../../storage/sqlite/index.js';
import { isUserTrustLevel, USER_TRUST_LEVELS } from '../../../user-context/trust-policy.js';
import {
  PERSONAL_PLAYBOOK_DISABLED_TAG as PLAYBOOK_DISABLED_TAG,
  PERSONAL_PLAYBOOK_ORDER_PREFIX as PLAYBOOK_ORDER_PREFIX,
  PERSONAL_PLAYBOOK_RULE_TAG as PLAYBOOK_RULE_TAG,
  patchPersonalPlaybookContextTags,
  personalPlaybookContext,
  type PersonalPlaybookContext,
} from '../../../user-context/personal-playbook.js';
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
import { createManualUnderstanding } from '../../../user-context/manual-understanding.js';
import { buildTaskSourceRecommendations } from '../../../user-context/source-recommendations.js';
import {
  buildActionableInsightSuggestions,
  INSIGHT_ACCEPTED_TAG,
  INSIGHT_DISMISSED_TAG,
  USER_CONFIRMED_MEMORY_TAG,
} from '../../../user-context/actionableInsights.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const VISIBLE_STATUSES = new Set<MemoryRecord['status']>(['active', 'candidate', 'needs_review']);
const FEEDBACK_RATINGS = new Set([
  'helpful', 'not_helpful', 'mixed', 'irrelevant', 'incorrect', 'outdated', 'sensitive',
]);
const PLAYBOOK_IDS = ['communication', 'execution', 'routines'] as const;
type PlaybookId = typeof PLAYBOOK_IDS[number];
const PLAYBOOK_SUPPORT_NEEDS = new Set(['listen', 'clarify', 'advise', 'act', 'unknown']);
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
  if (!record.tags?.includes(PLAYBOOK_RULE_TAG)) return undefined;
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

function parsePlaybookContext(value: unknown): { context: PersonalPlaybookContext } | { error: string } {
  if (value === undefined) return { context: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'context must be an object' };
  const input = value as Record<string, unknown>;
  const context: PersonalPlaybookContext = {};
  if ('channel' in input) {
    if (input.channel !== null && (typeof input.channel !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(input.channel))) {
      return { error: 'context.channel is invalid' };
    }
    context.channel = input.channel === null ? undefined : String(input.channel);
  }
  if ('supportNeed' in input) {
    if (input.supportNeed !== null && !PLAYBOOK_SUPPORT_NEEDS.has(String(input.supportNeed))) {
      return { error: 'context.supportNeed is invalid' };
    }
    context.supportNeed = input.supportNeed === null
      ? undefined
      : input.supportNeed as PersonalPlaybookContext['supportNeed'];
  }
  return { context };
}

export function buildPersonalPlaybooks(records: MemoryRecord[]) {
  return PLAYBOOK_IDS.map((id) => {
    const rules = records
      .filter((record) => record.status === 'active' && playbookForRecord(record) === id)
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
        context: personalPlaybookContext(record),
        versions: playbookVersionChain(records, record.id).map((version) => ({
          id: version.id,
          statement: version.content,
          updatedAt: version.updatedAt,
          current: version.id === record.id,
        })),
      })),
      updatedAt: rules.map((record) => record.updatedAt).sort().at(-1),
    };
  });
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

function memoryRecordInput(record: MemoryRecord): Parameters<typeof upsertMemoryRecord>[0] {
  return {
    providerId: record.providerId,
    kind: record.kind,
    userId: record.scope.userId,
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
  };
}

function preserveRecord(record: MemoryRecord, patch: Partial<Parameters<typeof upsertMemoryRecord>[0]>) {
  return upsertMemoryRecord({ ...memoryRecordInput(record), ...patch, id: record.id });
}

function playbookVersionChain(records: MemoryRecord[], recordId: string): MemoryRecord[] {
  const relatedIds = new Set([recordId]);
  let previousSize = 0;
  while (previousSize !== relatedIds.size) {
    previousSize = relatedIds.size;
    for (const record of records) {
      if (!record.supersedesRecordId) continue;
      if (relatedIds.has(record.id) || relatedIds.has(record.supersedesRecordId)) {
        relatedIds.add(record.id);
        relatedIds.add(record.supersedesRecordId);
      }
    }
  }
  return records
    .filter((record) => relatedIds.has(record.id) && playbookForRecord(record) !== undefined)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function versionPlaybookRule(
  record: MemoryRecord,
  patch: Partial<Parameters<typeof upsertMemoryRecord>[0]>,
): MemoryRecord {
  return upsertMemoryRecord({
    ...memoryRecordInput(record),
    ...patch,
    status: 'active',
    supersedesRecordId: record.id,
    source: { provider: 'local', path: 'you://playbook/version' },
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
    const sources = projectPersonalContextSources(sourceDefinitions, sourceInstances, {
      sourceItems: listKnowledgeSourceItems({ limit: 500 }),
      syncRuns: listKnowledgeSyncRuns({ limit: 500 }),
      connections: listConnectorConnections({ principalId: 'local-owner' }),
      learningJobs: listConnectorLearningJobs({ limit: 500 }),
      claimStatsBySource: listUserClaimStatsBySource(),
    });
    const openTasks = new TaskRepository().list({ limit: 500 }).filter((task) => (
      task.delegateAgentId === agentId && task.phase !== 'closed'
    ));
    const activeTasks = openTasks.slice(0, 20).map((task) => {
      return { id: task.id, title: task.title, body: task.body };
    });
    return c.json({
      scope: {
        profile: 'global',
        memory: 'global',
        trust: 'global',
      },
      ...profileBundle,
      understanding: records.map(projectUserContextRecord),
      connectedClaims: listUserClaims({ agentId, limit: 100 }).map((claim) => ({
        ...claim,
        evidence: listUserClaimEvidence(claim.id),
      })),
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
      insights: buildActionableInsightSuggestions(
        records,
        openTasks.map((task) => [task.title, task.body].filter(Boolean).join('\n')),
      ).map((insight) => ({ ...insight, delegateAgentId: agentId })),
      playbooks: buildPersonalPlaybooks(allUserContextRecords),
      sources,
      sourceRecommendations: buildTaskSourceRecommendations(
        sourceDefinitions,
        new Set(sourceInstances.map((instance) => instance.connectorId)),
        activeTasks,
      ),
      controls: {
        mode: config.userContext.memory.mode,
        sensitiveWritePolicy: config.userContext.privacy.sensitiveWritePolicy,
      },
      relationship: getRelationshipSettings(),
      trust: {
        defaultActionLevel: trustPolicy.defaultActionLevel,
        levels: USER_TRUST_LEVELS,
        autoRequiresExplicitOptIn: true,
      },
    });
  });

  authenticated.get('/api/you/feedback/:turnId', (c) => {
    const trace = getMemoryTurnFeedback(c.req.param('turnId'));
    if (!trace) return c.json({ error: 'Turn context not found' }, 404);
    const personalContext = trace.selectedRecordIds
      .map((id) => getMemoryRecord(id))
      .filter((record): record is MemoryRecord => Boolean(record) && isUserContextRecord(record))
      .map(projectUserContextRecord);
    return c.json({ trace, personalContext });
  });

  authenticated.put('/api/you/feedback/:turnId', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Invalid feedback' }, 400);
    }
    const input = body as Record<string, unknown>;
    if (typeof input.rating !== 'string' || !FEEDBACK_RATINGS.has(input.rating)) {
      return c.json({ error: 'Invalid rating' }, 400);
    }
    const records = Array.isArray(input.records)
      ? input.records.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const item = value as Record<string, unknown>;
          if (typeof item.recordId !== 'string' || typeof item.rating !== 'string' || !FEEDBACK_RATINGS.has(item.rating)) return [];
          return [{
            recordId: item.recordId,
            rating: item.rating as Parameters<typeof setMemoryTurnFeedback>[0]['rating'],
            ...(typeof item.reasonCode === 'string' ? { reasonCode: item.reasonCode } : {}),
            ...(typeof item.note === 'string' ? { note: item.note } : {}),
          }];
        })
      : undefined;
    const trace = setMemoryTurnFeedback({
      turnId: c.req.param('turnId'),
      rating: input.rating as Parameters<typeof setMemoryTurnFeedback>[0]['rating'],
      source: 'user',
      ...(typeof input.score === 'number' ? { score: input.score } : {}),
      ...(typeof input.reasonCode === 'string' ? { reasonCode: input.reasonCode } : {}),
      ...(typeof input.note === 'string' ? { note: input.note } : {}),
      ...(records ? { records } : {}),
    });
    if (!trace) return c.json({ error: 'Turn context not found' }, 404);
    if (trace.sessionKey && input.rating === 'not_helpful' && input.reasonCode === 'tone_mismatch') {
      setInteractionState({
        sessionKey: trace.sessionKey,
        signal: { supportNeed: 'unknown', confidence: 1, source: 'explicit', repairStatus: 'needed', repairReason: 'tone_mismatch' },
      });
    }
    const personalContext = trace.selectedRecordIds
      .map((id) => getMemoryRecord(id))
      .filter((record): record is MemoryRecord => Boolean(record) && isUserContextRecord(record))
      .map(projectUserContextRecord);
    return c.json({ trace, personalContext });
  });

  authenticated.get('/api/you/dreaming', (c) => {
    const config = deps.service.currentConfig as Config;
    const scope = resolveDreamingAgentScope(config);
    const settings = resolveDreamingSettings(config);
    const signals = listMemorySignals({ workspaceId: scope.workspaceDir, limit: 500 });
    return c.json({
      agentId: scope.agentId,
      settings,
      config: {
        ...scope.config,
        phases: {
          light: {
            ...scope.config.phases.light,
            nextRunsAt: nextDreamingRunTimes(scope.config.phases.light.schedule, scope.config.timezone),
          },
          deep: {
            ...scope.config.phases.deep,
            nextRunsAt: nextDreamingRunTimes(scope.config.phases.deep.schedule, scope.config.timezone),
          },
          rem: {
            ...scope.config.phases.rem,
            nextRunsAt: nextDreamingRunTimes(scope.config.phases.rem.schedule, scope.config.timezone),
          },
        },
      },
      readiness: scope.readiness,
      runs: listDreamingRuns({ agentId: scope.agentId, limit: 50 }),
      signalCount: signals.filter((signal) => signal.source === 'dreaming').length,
    });
  });

  authenticated.put('/api/you/dreaming', deps.strictRateLimitMiddleware, async (c) => {
    const config = deps.service.currentConfig as Config;
    const body = await c.req.json().catch(() => ({}));
    const settings = DreamingSettingsSchema.safeParse(body);
    if (!settings.success) return c.json({ error: settings.error.issues[0]?.message ?? 'Invalid Dreaming settings' }, 400);
    const currentPhases = config.userContext.dreaming.phases ?? {};
    const parsed = UserContextConfigSchema.safeParse({
      ...config.userContext,
      dreaming: {
        ...config.userContext.dreaming,
        mode: settings.data.mode,
        timezone: settings.data.timezone,
        phases: {
          light: { ...currentPhases.light, ...settings.data.phases.light },
          deep: { ...currentPhases.deep, ...settings.data.phases.deep },
          rem: { ...currentPhases.rem, ...settings.data.phases.rem },
        },
      },
    });
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid Dreaming settings' }, 400);
    const saved = await deps.service.saveConfig({ ...config, userContext: parsed.data });
    if (!saved.saved) return c.json({ error: saved.error ?? 'save failed' }, 500);
    const savedConfig = deps.service.currentConfig as Config;
    return c.json({ settings: resolveDreamingSettings(savedConfig) });
  });

  authenticated.get('/api/you/readiness', (c) => {
    return c.json(resolveDreamingAgentScope(deps.service.currentConfig as Config).readiness);
  });

  authenticated.post('/api/you/dreaming/runs', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const phase = body.phase === 'light' || body.phase === 'deep' || body.phase === 'rem'
      ? body.phase
      : 'deep';
    try {
      const result = await runDreamingPhase({
        config: deps.service.currentConfig as Config,
        phase,
        triggerKind: 'manual',
      });
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  authenticated.get('/api/you/dreaming/runs/:runId', (c) => {
    const scope = resolveDreamingAgentScope(deps.service.currentConfig as Config);
    const run = getDreamingRun(c.req.param('runId'));
    if (!run || run.agentId !== scope.agentId || run.workspaceId !== scope.workspaceDir) {
      return c.json({ error: 'Dreaming run not found' }, 404);
    }
    return c.json({ run, decisions: listDreamingDecisions(run.runId) });
  });

  authenticated.patch('/api/you/relationship', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Invalid relationship settings' }, 400);
    const input = body as Record<string, unknown>;
    const patch: Parameters<typeof updateRelationshipSettings>[0] = {};
    if ('supportMode' in input) {
      if (!['efficient', 'coach', 'companion', 'auto'].includes(String(input.supportMode))) return c.json({ error: 'Invalid supportMode' }, 400);
      patch.supportMode = input.supportMode as 'efficient' | 'coach' | 'companion' | 'auto';
    }
    if ('proactiveEnabled' in input) {
      if (typeof input.proactiveEnabled !== 'boolean') return c.json({ error: 'proactiveEnabled must be boolean' }, 400);
      patch.proactiveEnabled = input.proactiveEnabled;
    }
    for (const field of ['quietStart', 'quietEnd'] as const) {
      if (!(field in input)) continue;
      const value = input[field];
      if (value !== null && (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) {
        return c.json({ error: `${field} must use HH:mm` }, 400);
      }
      patch[field] = value === null ? undefined : String(value);
    }
    for (const field of ['allowedTopics', 'blockedTopics'] as const) {
      if (!(field in input)) continue;
      if (!Array.isArray(input[field]) || input[field].length > 20 || input[field].some((value) => typeof value !== 'string' || !value.trim() || value.length > 80)) {
        return c.json({ error: `${field} must contain up to 20 short topics` }, 400);
      }
      patch[field] = [...new Set(input[field].map((value) => value.trim()))];
    }
    if (Object.keys(patch).length === 0) return c.json({ error: 'No relationship settings provided' }, 400);
    return c.json({ ok: true, relationship: updateRelationshipSettings(patch) });
  });

  authenticated.patch('/api/you/claims/:id', deps.strictRateLimitMiddleware, async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const action = body.action === 'confirm' || body.action === 'reject' ? body.action : undefined;
    if (!action) return c.json({ error: 'Action must be confirm or reject' }, 400);
    const claim = runSqliteWriteTransaction(() => {
      const updated = setUserClaimDecision(c.req.param('id'), action === 'confirm' ? 'confirmed' : 'rejected');
      if (!updated) return updated;
      const existing = updated.memoryRecordId ? getMemoryRecord(updated.memoryRecordId) : undefined;
      if (existing) {
        preserveRecord(existing, {
          status: action === 'confirm' ? 'active' : 'rejected',
          ...(action === 'confirm' ? { reviewAfter: nextMemoryReviewAt(existing) } : {}),
        });
      } else if (action === 'confirm') {
        const candidate = renderUserClaim(updated);
        const evidence = listUserClaimEvidence(updated.id);
        const record = upsertMemoryRecord({
          providerId: 'local',
          kind: candidate.kind,
          sourceAgentId: updated.agentId,
          content: candidate.content,
          canonicalKey: candidate.canonicalKey,
          source: { provider: 'connected-sources' },
          confidence: 1,
          status: 'active',
          sensitivity: candidate.sensitivity,
          explicitness: 'explicit',
          durability: candidate.durability,
          importance: candidate.importance,
          disclosurePolicy: candidate.disclosurePolicy,
          tags: [...new Set(['user-understanding', ...(candidate.tags ?? []), USER_CONFIRMED_MEMORY_TAG])],
          evidence: evidence.map((item) => ({
            sourceItemId: item.sourceItemId,
            relation: item.relation === 'contradicts' ? 'contradicts' : 'supports',
            observedAt: item.observedAt,
            confidence: updated.confidence,
          })),
          reviewAfter: nextMemoryReviewAt({ durability: candidate.durability, explicitness: 'explicit' }),
        });
        linkUserClaimMemoryRecord(updated.id, record.id);
      }
      return getUserClaim(updated.id);
    });
    if (!claim) return c.json({ error: 'Connected claim not found' }, 404);
    return c.json({ ok: true, claim: { ...claim, evidence: listUserClaimEvidence(claim.id) } });
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
    const scope = body.scope === 'session'
      ? { type: 'session' as const, sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '' }
      : body.scope === undefined || body.scope === 'global'
        ? { type: 'global' as const }
        : null;
    if (!scope || (scope.type === 'session' && !scope.sessionKey)) {
      return c.json({ error: 'scope must be global or a session with sessionKey' }, 400);
    }
    const sensitivity = MEMORY_SENSITIVITIES.has(body.sensitivity) ? body.sensitivity : 'normal';
    const durability = MEMORY_DURABILITIES.has(body.durability) ? body.durability : 'durable';
    const disclosurePolicy = MEMORY_DISCLOSURE_POLICIES.has(body.disclosurePolicy)
      ? body.disclosurePolicy
      : 'referenceable';
    const config = deps.service.currentConfig as Config;
    const result = createManualUnderstanding({
      agentId: selectedAgentId(config),
      content,
      kind,
      scope,
      sensitivity,
      durability,
      disclosurePolicy,
    });
    if (!result.created) {
      return c.json({
        error: 'This understanding already exists in the selected scope',
        understanding: projectUserContextRecord(result.record),
      }, 409);
    }
    return c.json({ understanding: projectUserContextRecord(result.record) }, 201);
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
          ...(action === 'confirm' ? {
            reviewAfter: nextMemoryReviewAt(record),
            tags: [...new Set([...(record.tags ?? []), USER_CONFIRMED_MEMORY_TAG])],
          } : {}),
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
          ? {
              status: 'active',
              reviewAfter: nextMemoryReviewAt(record),
              tags: [...new Set([...(record.tags ?? []), USER_CONFIRMED_MEMORY_TAG])],
            }
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
        versionPlaybookRule(record, {
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
    const parsedContext = parsePlaybookContext(body.context);
    if ('error' in parsedContext) return c.json({ error: parsedContext.error }, 400);
    const kind: MemoryRecord['kind'] = id === 'communication' ? 'preference' : id === 'execution' ? 'task_lesson' : 'routine';
    const record = upsertMemoryRecord({
      providerId: 'local',
      kind,
      sourceAgentId: selectedAgentId(deps.service.currentConfig as Config),
      content: statement,
      source: { provider: 'local', path: 'you://playbook' },
      confidence: 1,
      tags: patchPersonalPlaybookContextTags(
        ['user-understanding', PLAYBOOK_RULE_TAG, `${PLAYBOOK_ORDER_PREFIX}${Number.isInteger(body.order) ? body.order : 1_000}`],
        parsedContext.context,
      ),
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
    const parsedContext = parsePlaybookContext(body.context);
    if ('error' in parsedContext) return c.json({ error: parsedContext.error }, 400);
    const ruleTags = patchPlaybookRuleTags(record, { enabled: body.enabled, order: body.order });
    const updated = versionPlaybookRule(record, {
      content,
      tags: patchPersonalPlaybookContextTags(ruleTags, parsedContext.context),
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
    preserveRecord(record, { status: 'archived', validTo: new Date().toISOString() });
    return c.json({ ok: true });
  });

  authenticated.post('/api/you/playbooks/:id/rules/:recordId/rollback', deps.strictRateLimitMiddleware, async (c) => {
    const id = c.req.param('id') as PlaybookId;
    const current = editableRecord(c.req.param('recordId'));
    if (!PLAYBOOK_IDS.includes(id) || !current || playbookForRecord(current) !== id) {
      return c.json({ error: 'Playbook rule not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const versionId = typeof body.versionId === 'string' ? body.versionId : '';
    const all = listAllUserContextRecords(ALL_MEMORY_STATUSES);
    const target = playbookVersionChain(all, current.id).find((record) => record.id === versionId);
    if (!target || target.id === current.id) return c.json({ error: 'Previous version not found' }, 404);
    const rolledBack = versionPlaybookRule(current, {
      content: target.content,
      tags: target.tags,
      evidence: target.evidence,
      explicitness: 'explicit',
    });
    return c.json({
      ok: true,
      rule: buildPersonalPlaybooks([...all, rolledBack]).find((playbook) => playbook.id === id)?.rules
        .find((rule) => rule.id === rolledBack.id),
    });
  });

  authenticated.post('/api/you/insights/:id/apply', deps.strictRateLimitMiddleware, async (c) => {
    const config = deps.service.currentConfig as Config;
    const existing = editableRecord(c.req.param('id'));
    const suggestion = existing ? buildActionableInsightSuggestions([existing], [])[0] : undefined;
    if (!existing || !suggestion) return c.json({ error: 'Insight not found' }, 404);
    if (suggestion.action === 'start_progress') {
      return c.json({ error: 'Progress insights must be reviewed as task drafts' }, 400);
    }

    if (existing.kind === 'routine') {
      preserveRecord(existing, { tags: [...new Set([...(existing.tags ?? []), INSIGHT_ACCEPTED_TAG])] });
      return c.json({ ok: true, status: 'drafting', href: buildRoutineAutomationDraftHref(existing) });
    }

    upsertMemoryRecord({
      providerId: 'local',
      kind: 'task_lesson',
      sourceAgentId: selectedAgentId(config),
      content: existing.content,
      source: { provider: 'local', path: 'you://insight-proposal' },
      confidence: 1,
      tags: [
        'user-understanding',
        USER_CONFIRMED_MEMORY_TAG,
        PLAYBOOK_RULE_TAG,
        `${PLAYBOOK_ORDER_PREFIX}1000`,
      ],
      status: 'active',
      sensitivity: existing.sensitivity,
      explicitness: 'explicit',
      durability: 'durable',
      importance: existing.importance,
      disclosurePolicy: existing.disclosurePolicy,
      evidence: existing.evidence,
    });
    preserveRecord(existing, { tags: [...new Set([...(existing.tags ?? []), INSIGHT_ACCEPTED_TAG])] });
    return c.json({ ok: true, status: 'saved' });
  });

  authenticated.delete('/api/you/insights/:id', deps.strictRateLimitMiddleware, (c) => {
    const existing = editableRecord(c.req.param('id'));
    const suggestion = existing ? buildActionableInsightSuggestions([existing], [])[0] : undefined;
    if (!existing || !suggestion) return c.json({ error: 'Insight not found' }, 404);
    preserveRecord(existing, { tags: [...new Set([...(existing.tags ?? []), INSIGHT_DISMISSED_TAG])] });
    return c.json({ ok: true, status: 'dismissed' });
  });

  authenticated.post('/api/you/insights/:id/complete', deps.strictRateLimitMiddleware, async (c) => {
    const existing = editableRecord(c.req.param('id'));
    const suggestion = existing ? buildActionableInsightSuggestions([existing], [])[0] : undefined;
    if (!existing || suggestion?.action !== 'start_progress') return c.json({ error: 'Insight not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
    const task = taskId ? new TaskRepository().get(taskId) : null;
    const linked = task && new TaskContextRepository().list(task.id).some((edge) => (
      edge.targetKind === 'memory' && edge.targetId === existing.id
    ));
    if (!task || !linked) return c.json({ error: 'A linked task draft is required' }, 400);
    preserveRecord(existing, { tags: [...new Set([...(existing.tags ?? []), INSIGHT_ACCEPTED_TAG])] });
    return c.json({ ok: true, status: 'saved', taskId: task.id });
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
    const account = getConnectorAccount(instanceId);
    const accountConnections = account
      ? listConnectorConnections({ principalId: account.principalId, connectorId: account.connectorId })
        .filter((connection) => connection.accountId === account.id)
      : [];
    const instance = installedInstances.find((item) => item.instanceId === instanceId);
    const connectorId = account?.connectorId ?? instance?.connectorId;
    const definition = connectorId
      ? listConnectorCatalog().find((item) => item.id === connectorId)
      : undefined;
    if ((!instance && !account) || !definition || !definition.capabilities.some((capability) => (
      capability === 'context' || capability === 'memory_source'
    ))) {
      return c.json({ error: 'Personal context source not found' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const understandingPolicy = body.understandingPolicy === 'keep' || body.understandingPolicy === 'delete'
      ? body.understandingPolicy
      : undefined;
    if (!understandingPolicy) {
      return c.json({ error: 'understandingPolicy must be keep or delete' }, 400);
    }

    try {
      if (account) {
        for (const connection of accountConnections.filter((candidate) => candidate.status !== 'revoked')) {
          await revokeComposioConnection(connection.id);
        }
      } else if (instance) {
        uninstallConnector(config, instance.instanceId);
        const saved = await deps.service.saveConfig(config);
        if (!saved.saved) return c.json({ error: saved.error ?? 'save failed' }, 500);
      }
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }

    let deletedUnderstandingCount = 0;
    let deletedClaimCount = 0;
    if (understandingPolicy === 'delete') {
      const sourceInstanceId = account
        ? `composio:${account.connectorId}:${account.id}`
        : instanceId;
      const targets = recordsDerivedFromPersonalContextSource(
        listAllUserContextRecords(ALL_MEMORY_STATUSES),
        sourceInstanceId,
      );
      runSqliteWriteTransaction(() => {
        const claimRemoval = removeUserClaimEvidenceForSource(sourceInstanceId);
        deletedClaimCount = claimRemoval.deletedClaimCount;
        const retainedMemoryIds = new Set(claimRemoval.retainedClaims.map((claim) => claim.memoryRecordId));
        const deleteIds = new Set([
          ...claimRemoval.deletedMemoryRecordIds,
          ...targets.filter((record) => !retainedMemoryIds.has(record.id)).map((record) => record.id),
        ]);
        for (const recordId of deleteIds) deleteMemoryRecord(recordId);
        for (const retained of claimRemoval.retainedClaims) {
          if (retained.state === 'active') continue;
          const record = getMemoryRecord(retained.memoryRecordId);
          if (record) preserveRecord(record, { status: retained.state === 'rejected' ? 'rejected' : 'stale' });
        }
        deletedUnderstandingCount = deleteIds.size;
      });
    }
    return c.json({ ok: true, deletedUnderstandingCount, deletedClaimCount });
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
          tags: [...new Set([...(existing.tags ?? []), USER_CONFIRMED_MEMORY_TAG])],
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
        tags: [...new Set([
          ...(existing.tags ?? []),
          'user-understanding',
          'explicit-user-correction',
          USER_CONFIRMED_MEMORY_TAG,
        ])],
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
