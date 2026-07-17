import type { Hono } from 'hono';

import { BuiltinMemoryStore } from '../../../agent/memory/builtin-memory-store.js';
import { createMemoryManagerFromConfig } from '../../../agent/memory/create-memory-manager.js';
import { resolveBuiltinMemoryStoreConfig } from '../../../agent/memory/memory-config.js';
import { discoverMemoryPlugins } from '../../../agent/memory/plugin-discovery.js';
import { resolveAdaptiveUnderstandingCadence } from '../../../agent/memory/understanding/quality.js';
import type {
  MemoryDisclosurePolicy,
  MemoryDurability,
  MemoryExplicitness,
  MemoryKind,
  MemorySensitivity,
  MemoryStatus,
} from '../../../agent/memory/types.js';
import { MemoryPolicySchema } from '../../../agent-manifest/schema.js';
import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import { resolveEffectiveAgentManifestForAgent } from '../../../config/agent-profile.js';
import type { Config } from '../../../config/schema.js';
import type { KnowledgeSynthesisStatus } from '../../../knowledge/types.js';
import { prepareUpdateAgent } from '../../agents-admin.js';
import {
  appendMemorySignal,
  appendMemoryTraceEvent,
  deleteMemoryRecord,
  findLatestMemoryInjectTrace,
  getMemoryRecord,
  listKnowledgeSourceItems,
  listKnowledgeSyncRuns,
  listMemoryRecords,
  listMemorySignals,
  listMemoryTraceEvents,
  searchMemoryRecords,
  setMemoryTraceFeedback,
  setLatestMemoryInjectFeedback,
  summarizeMemoryRecallFeedback,
  summarizeUserUnderstandingQuality,
  upsertMemoryRecord,
} from '../../../storage/sqlite/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const MEMORY_KINDS = new Set<MemoryKind>([
  'user_profile',
  'preference',
  'boundary',
  'relationship',
  'project_context',
  'commitment',
  'routine',
  'personal_logistics',
  'open_question',
  'milestone',
  'current_state',
  'agent_note',
  'workspace_fact',
  'daily_note',
  'session_summary',
  'derived_insight',
  'task_lesson',
  'tool_preference',
  'long_term_goal',
]);

const MEMORY_EXPLICITNESS = new Set<MemoryExplicitness>(['explicit', 'observed', 'inferred']);
const MEMORY_DURABILITY = new Set<MemoryDurability>(['ephemeral', 'durable', 'recurring']);
const MEMORY_DISCLOSURE_POLICIES = new Set<MemoryDisclosurePolicy>([
  'silent', 'referenceable', 'ask_before_reference',
]);

const MEMORY_STATUSES = new Set<MemoryStatus>([
  'candidate',
  'active',
  'needs_review',
  'stale',
  'archived',
  'rejected',
]);

const MEMORY_SENSITIVITIES = new Set<MemorySensitivity>([
  'normal',
  'personal',
  'secret',
  'regulated',
]);

const MEMORY_TRACE_FEEDBACK_OUTCOMES = new Set([
  'helpful',
  'not_helpful',
  'mixed',
  'irrelevant',
]);

const KNOWLEDGE_SYNTHESIS_STATUSES = new Set<KnowledgeSynthesisStatus>([
  'pending', 'processing', 'completed', 'failed', 'ignored',
]);

function parseLimit(raw: string | undefined, fallback = 100): number {
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, parsed)) : fallback;
}

function parseFeedbackSummaryLimit(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 1000;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5000, parsed)) : 1000;
}

function parseWindowDays(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 30;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(365, parsed)) : 30;
}

function parseKind(raw: unknown): MemoryKind | undefined {
  return typeof raw === 'string' && MEMORY_KINDS.has(raw as MemoryKind)
    ? (raw as MemoryKind)
    : undefined;
}

function parseStatus(raw: unknown): MemoryStatus | undefined {
  return typeof raw === 'string' && MEMORY_STATUSES.has(raw as MemoryStatus)
    ? (raw as MemoryStatus)
    : undefined;
}

function parseSensitivity(raw: unknown): MemorySensitivity | undefined {
  return typeof raw === 'string' && MEMORY_SENSITIVITIES.has(raw as MemorySensitivity)
    ? (raw as MemorySensitivity)
    : undefined;
}

function parseEnum<T extends string>(raw: unknown, allowed: Set<T>): T | undefined {
  return typeof raw === 'string' && allowed.has(raw as T) ? raw as T : undefined;
}

export function registerMemoryRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  authenticated.get('/api/memory/providers', async (c) => {
    const cfg = deps.service.currentConfig as Config;
    const plugins = await discoverMemoryPlugins(cfg);
    return c.json({
      providers: [
        {
          id: 'local',
          displayName: 'Local Knowledge Store',
          available: true,
          configured: true,
          capabilities: {
            search: true,
            read: true,
            write: true,
            update: true,
            delete: true,
            keywordSearch: true,
            semanticSearch: false,
            hybridSearch: false,
            citations: true,
            sync: false,
            local: true,
          },
        },
        ...plugins.map((plugin) => ({
          id: plugin.manifest?.id ?? plugin.name,
          displayName: plugin.manifest?.displayName ?? plugin.name,
          available: plugin.available,
          configured: false,
          capabilities: plugin.manifest?.capabilities ?? {},
        })),
      ],
    });
  });

  authenticated.get('/api/memory/config', (c) => {
    const cfg = deps.service.currentConfig as Config;
    const agentId = c.req.query('agentId') || resolveDefaultAgentId(cfg);
    const manifest = resolveEffectiveAgentManifestForAgent(cfg, agentId);
    return c.json({ agentId: manifest.id, memory: manifest.memory });
  });

  authenticated.patch('/api/memory/config', deps.strictRateLimitMiddleware, async (c) => {
    const cfg = deps.service.currentConfig as Config;
    const body = await c.req.json().catch(() => ({}));
    const agentId = typeof body.agentId === 'string' && body.agentId.trim()
      ? body.agentId.trim()
      : resolveDefaultAgentId(cfg);
    const parsed = MemoryPolicySchema.safeParse(body.memory);
    if (!parsed.success) {
      return c.json({ error: `memory ${parsed.error.issues[0]?.message ?? 'is invalid'}` }, 400);
    }
    const prep = prepareUpdateAgent(cfg, agentId, { memory: parsed.data });
    if (prep.ok === false) {
      return c.json({ error: prep.error }, prep.status ?? 400);
    }
    const save = await deps.service.saveConfig(prep.data.nextConfig);
    if (!save.saved) return c.json({ error: save.error ?? 'save failed' }, 500);
    const manifest = resolveEffectiveAgentManifestForAgent(deps.service.currentConfig as Config, agentId);
    return c.json({ agentId: manifest.id, memory: manifest.memory });
  });

  authenticated.get('/api/memory/records', (c) => {
    const agentId = c.req.query('agentId') || resolveDefaultAgentId(deps.service.currentConfig as Config);
    const records = listMemoryRecords({
      providerId: c.req.query('providerId') || undefined,
      agentId,
      workspaceId: c.req.query('workspaceId') || undefined,
      projectId: c.req.query('projectId') || undefined,
      kind: parseKind(c.req.query('kind')),
      status: parseStatus(c.req.query('status')),
      limit: parseLimit(c.req.query('limit')),
      offset: c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0,
    });
    return c.json({ records });
  });

  authenticated.post('/api/memory/search', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return c.json({ error: 'Missing required field: query' }, 400);
    }
    const agentId = typeof body.agentId === 'string' && body.agentId.trim()
      ? body.agentId.trim()
      : resolveDefaultAgentId(deps.service.currentConfig as Config);
    const records = searchMemoryRecords({
      query,
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      agentId,
      workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
      projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
      kinds: Array.isArray(body.kinds)
        ? body.kinds.map(parseKind).filter((v): v is MemoryKind => Boolean(v))
        : undefined,
      statuses: Array.isArray(body.statuses)
        ? body.statuses.map(parseStatus).filter((v): v is MemoryStatus => Boolean(v))
        : undefined,
      maxResults: typeof body.maxResults === 'number' ? body.maxResults : undefined,
      minScore: typeof body.minScore === 'number' ? body.minScore : undefined,
    });
    return c.json({ results: records });
  });

  authenticated.post('/api/memory/records', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const kind = parseKind(body.kind);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const agentId = typeof body.agentId === 'string' && body.agentId.trim()
      ? body.agentId.trim()
      : resolveDefaultAgentId(deps.service.currentConfig as Config);
    if (!kind || !content) {
      return c.json({ error: 'Missing required fields: kind, content' }, 400);
    }
    const record = upsertMemoryRecord({
      id: typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined,
      providerId: typeof body.providerId === 'string' && body.providerId.trim() ? body.providerId.trim() : 'local',
      kind,
      agentId,
      workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : deps.service.currentWorkspacePath,
      sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey : undefined,
      projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
      content,
      source: body.source && typeof body.source === 'object' ? body.source : undefined,
      confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
      status: parseStatus(body.status),
      sensitivity: parseSensitivity(body.sensitivity),
      canonicalKey: typeof body.canonicalKey === 'string' ? body.canonicalKey : undefined,
      explicitness: parseEnum(body.explicitness, MEMORY_EXPLICITNESS),
      durability: parseEnum(body.durability, MEMORY_DURABILITY),
      importance: typeof body.importance === 'number' ? body.importance : undefined,
      disclosurePolicy: parseEnum(body.disclosurePolicy, MEMORY_DISCLOSURE_POLICIES),
      evidence: Array.isArray(body.evidence)
        ? body.evidence.filter((item: unknown): item is NonNullable<Parameters<typeof upsertMemoryRecord>[0]['evidence']>[number] =>
            Boolean(item) && typeof item === 'object',
          )
        : undefined,
      reviewAfter: typeof body.reviewAfter === 'string' ? body.reviewAfter : undefined,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
      validFrom: typeof body.validFrom === 'string' ? body.validFrom : undefined,
      validTo: typeof body.validTo === 'string' ? body.validTo : undefined,
      supersedesRecordId: typeof body.supersedesRecordId === 'string' ? body.supersedesRecordId : undefined,
      conflictGroupId: typeof body.conflictGroupId === 'string' ? body.conflictGroupId : undefined,
    });
    return c.json({ record }, 201);
  });

  authenticated.patch('/api/memory/records/:id', async (c) => {
    const existing = getMemoryRecord(c.req.param('id'));
    if (!existing) return c.json({ error: 'Memory record not found' }, 404);
    const selectedAgentId = c.req.query('agentId') || resolveDefaultAgentId(deps.service.currentConfig as Config);
    if (existing.scope.agentId !== selectedAgentId) {
      return c.json({ error: 'Memory record not found for selected agent' }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const record = upsertMemoryRecord({
      id: existing.id,
      providerId: existing.source.provider ?? 'local',
      kind: parseKind(body.kind) ?? existing.kind,
      agentId: existing.scope.agentId,
      workspaceId: existing.scope.workspaceId,
      sessionKey: existing.scope.sessionKey,
      projectId: typeof body.projectId === 'string' ? body.projectId : existing.scope.projectId,
      content: typeof body.content === 'string' ? body.content : existing.content,
      source: body.source && typeof body.source === 'object' ? body.source : existing.source,
      confidence: typeof body.confidence === 'number' ? body.confidence : existing.confidence,
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === 'string') : existing.tags,
      status: parseStatus(body.status) ?? existing.status,
      sensitivity: parseSensitivity(body.sensitivity) ?? existing.sensitivity,
      canonicalKey: typeof body.canonicalKey === 'string' ? body.canonicalKey : existing.canonicalKey,
      explicitness: parseEnum(body.explicitness, MEMORY_EXPLICITNESS) ?? existing.explicitness,
      durability: parseEnum(body.durability, MEMORY_DURABILITY) ?? existing.durability,
      importance: typeof body.importance === 'number' ? body.importance : existing.importance,
      disclosurePolicy: parseEnum(body.disclosurePolicy, MEMORY_DISCLOSURE_POLICIES) ?? existing.disclosurePolicy,
      evidence: Array.isArray(body.evidence)
        ? body.evidence.filter((item: unknown): item is NonNullable<Parameters<typeof upsertMemoryRecord>[0]['evidence']>[number] =>
            Boolean(item) && typeof item === 'object',
          )
        : existing.evidence,
      reviewAfter: typeof body.reviewAfter === 'string' ? body.reviewAfter : existing.reviewAfter,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : existing.expiresAt,
      validFrom: typeof body.validFrom === 'string' ? body.validFrom : existing.validFrom,
      validTo: typeof body.validTo === 'string' ? body.validTo : existing.validTo,
      supersedesRecordId: typeof body.supersedesRecordId === 'string' ? body.supersedesRecordId : existing.supersedesRecordId,
      conflictGroupId: typeof body.conflictGroupId === 'string' ? body.conflictGroupId : existing.conflictGroupId,
    });
    return c.json({ record });
  });

  authenticated.delete('/api/memory/records/:id', (c) => {
    const existing = getMemoryRecord(c.req.param('id'));
    const selectedAgentId = c.req.query('agentId') || resolveDefaultAgentId(deps.service.currentConfig as Config);
    if (!existing || existing.scope.agentId !== selectedAgentId) {
      return c.json({ error: 'Memory record not found for selected agent' }, 404);
    }
    const deleted = deleteMemoryRecord(c.req.param('id'));
    if (!deleted) return c.json({ error: 'Memory record not found' }, 404);
    return c.json({ ok: true });
  });

  authenticated.get('/api/memory/signals', (c) => {
    const agentId = c.req.query('agentId') || resolveDefaultAgentId(deps.service.currentConfig as Config);
    const signals = listMemorySignals({
      recordId: c.req.query('recordId') || undefined,
      providerId: c.req.query('providerId') || undefined,
      agentId,
      workspaceId: c.req.query('workspaceId') || undefined,
      limit: parseLimit(c.req.query('limit')),
    });
    return c.json({ signals });
  });

  authenticated.get('/api/knowledge/source-items', (c) => {
    const sourceItems = listKnowledgeSourceItems({
      sourceInstanceId: c.req.query('sourceInstanceId') || undefined,
      synthesisStatus: parseEnum(c.req.query('synthesisStatus'), KNOWLEDGE_SYNTHESIS_STATUSES),
      includeDeleted: c.req.query('includeDeleted') === 'true',
      limit: parseLimit(c.req.query('limit')),
      offset: c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0,
    });
    return c.json({ sourceItems });
  });

  authenticated.get('/api/knowledge/sync-runs', (c) => {
    const syncRuns = listKnowledgeSyncRuns({
      sourceInstanceId: c.req.query('sourceInstanceId') || undefined,
      limit: parseLimit(c.req.query('limit')),
    });
    return c.json({ syncRuns });
  });

  authenticated.get('/api/memory/traces', (c) => {
    const agentId = c.req.query('agentId') || resolveDefaultAgentId(deps.service.currentConfig as Config);
    const traces = listMemoryTraceEvents({
      providerId: c.req.query('providerId') || undefined,
      agentId,
      sessionKey: c.req.query('sessionKey') || undefined,
      phase: c.req.query('phase') || undefined,
      limit: parseLimit(c.req.query('limit')),
    });
    return c.json({ traces });
  });

  authenticated.patch('/api/memory/traces/:traceId/feedback', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const outcome = typeof body.outcome === 'string' && MEMORY_TRACE_FEEDBACK_OUTCOMES.has(body.outcome)
      ? body.outcome
      : undefined;
    if (!outcome) {
      return c.json({ error: 'Missing or invalid required field: outcome' }, 400);
    }
    const source = body.source === 'user' || body.source === 'evaluator' || body.source === 'system'
      ? body.source
      : undefined;
    const trace = setMemoryTraceFeedback({
      traceId: c.req.param('traceId'),
      feedback: {
        outcome,
        ...(typeof body.score === 'number' ? { score: body.score } : {}),
        ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
        ...(source ? { source } : {}),
      },
    });
    if (!trace) return c.json({ error: 'Memory trace not found' }, 404);
    return c.json({ trace });
  });

  authenticated.get('/api/memory/feedback-summary', (c) => {
    const agentId = c.req.query('agentId') || resolveDefaultAgentId(deps.service.currentConfig as Config);
    const summaries = summarizeMemoryRecallFeedback({
      recordId: c.req.query('recordId') || undefined,
      providerId: c.req.query('providerId') || undefined,
      agentId,
      sessionKey: c.req.query('sessionKey') || undefined,
      limit: parseFeedbackSummaryLimit(c.req.query('limit')),
    });
    return c.json({ summaries });
  });

  authenticated.get('/api/memory/understanding/quality', (c) => {
    const cfg = deps.service.currentConfig as Config;
    const agentId = c.req.query('agentId') || resolveDefaultAgentId(cfg);
    const manifest = resolveEffectiveAgentManifestForAgent(cfg, agentId);
    const metrics = summarizeUserUnderstandingQuality({
      agentId: manifest.id,
      windowDays: parseWindowDays(c.req.query('windowDays')),
    });
    const baseIntervalTurns = manifest.memory.understanding?.reviewIntervalTurns ?? 10;
    const cadence = resolveAdaptiveUnderstandingCadence(
      baseIntervalTurns,
      metrics,
      manifest.memory.understanding?.adaptiveCadence ?? true,
    );
    return c.json({ metrics, cadence });
  });

  authenticated.patch(
    '/api/memory/understanding/response-feedback',
    deps.strictRateLimitMiddleware,
    async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : '';
      const assistantTimestamp = typeof body.assistantTimestamp === 'number'
        ? body.assistantTimestamp
        : Number.NaN;
      const outcome = body.outcome === 'helpful' || body.outcome === 'not_helpful'
        ? body.outcome
        : undefined;
      if (!sessionKey || !Number.isFinite(assistantTimestamp) || assistantTimestamp <= 0 || !outcome) {
        return c.json({ error: 'sessionKey, assistantTimestamp, and a valid outcome are required' }, 400);
      }
      const trace = setLatestMemoryInjectFeedback({
        sessionKey,
        beforeMs: assistantTimestamp,
        feedback: {
          outcome,
          source: 'user',
          reason: 'assistant_response_feedback',
        },
      });
      return c.json({
        matched: Boolean(trace),
        attributedRecordCount: trace?.selectedRecordIds.length ?? 0,
        feedback: trace?.feedback ?? null,
        remediation: trace?.remediation ?? null,
      });
    },
  );

  authenticated.get('/api/memory/understanding/response-feedback', (c) => {
    const sessionKey = c.req.query('sessionKey')?.trim() ?? '';
    const assistantTimestamp = Number(c.req.query('assistantTimestamp'));
    if (!sessionKey || !Number.isFinite(assistantTimestamp) || assistantTimestamp <= 0) {
      return c.json({ error: 'sessionKey and assistantTimestamp are required' }, 400);
    }
    const trace = findLatestMemoryInjectTrace({
      sessionKey,
      beforeMs: assistantTimestamp,
    });
    return c.json({
      matched: Boolean(trace),
      attributedRecordCount: trace?.selectedRecordIds.length ?? 0,
      feedback: trace?.feedback ?? null,
    });
  });

  authenticated.post('/api/memory/signals', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const source = typeof body.source === 'string' ? body.source : '';
    if (!source) return c.json({ error: 'Missing required field: source' }, 400);
    const signalId = appendMemorySignal({
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
      workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
      sessionKey: typeof body.sessionKey === 'string' ? body.sessionKey : undefined,
      signal: {
        source: source as never,
        recordId: typeof body.recordId === 'string' ? body.recordId : undefined,
        score: typeof body.score === 'number' ? body.score : undefined,
        content: typeof body.content === 'string' ? body.content : undefined,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
      },
    });
    return c.json({ signalId }, 201);
  });

  authenticated.post('/api/memory/providers/:id/test', deps.strictRateLimitMiddleware, async (c) => {
    const providerId = c.req.param('id');
    const cfg = deps.service.currentConfig as Config;
    const workspace = deps.service.currentWorkspacePath;
    const store = new BuiltinMemoryStore(resolveBuiltinMemoryStoreConfig(workspace, cfg));
    const manager = createMemoryManagerFromConfig(workspace, store, cfg);
    await manager.initializeAll(`memory-provider-test-${Date.now()}`, { workspace, agentId: resolveDefaultAgentId(cfg) });
    const provider = manager.providersList.find((p) => p.id === providerId);
    if (!provider) return c.json({ providerId, available: false, checks: [{ name: 'load', ok: false, message: 'Provider not loaded' }] }, 404);

    const token = `xopc-memory-smoke-${Date.now()}`;
    const checks: Array<{ name: string; ok: boolean; message?: string; resultCount?: number }> = [
      { name: 'load', ok: true },
      { name: 'available', ok: provider.isAvailable() },
    ];
    const started = Date.now();
    try {
      const write = await manager.write({
        kind: 'workspace_fact',
        content: `Smoke test record for ${providerId}: ${token}`,
        scope: { agentId: resolveDefaultAgentId(cfg) },
        tags: ['xopc-smoke-test'],
      });
      checks.push({ name: 'write', ok: write.success, message: write.error ?? write.message });
      const results = await manager.search({ query: token, scope: { agentId: resolveDefaultAgentId(cfg) }, maxResults: 10 });
      const ownResults = results.filter((result) => result.citation.providerId === providerId);
      checks.push({ name: 'search', ok: ownResults.length > 0, resultCount: ownResults.length });
      const recordId = ownResults[0]?.record.id ?? write.record?.id;
      if (recordId) {
        const read = await manager.read({ id: recordId, scope: { agentId: resolveDefaultAgentId(cfg) } });
        checks.push({ name: 'read', ok: Boolean(read), message: read ? undefined : 'Record was not readable' });
      } else {
        checks.push({ name: 'read', ok: false, message: 'No record id available' });
      }
      manager.recordSignal({ source: 'search_recall', content: `Smoke signal for ${providerId}: ${token}` });
      checks.push({ name: 'sync', ok: true });
    } catch (err) {
      checks.push({ name: 'error', ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      appendMemoryTraceEvent({
        phase: 'test',
        providerId,
        request: { token },
        resultCount: checks.filter((check) => check.ok).length,
        error: checks.some((check) => !check.ok) ? 'one or more checks failed' : undefined,
        durationMs: Date.now() - started,
      });
      await manager.shutdownAll();
    }
    return c.json({ providerId, available: provider.isAvailable(), checks });
  });
}
