import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import { createWorkflowCatalog } from '../../../agent/workflow/catalog.js';
import { messagesToClientHistory } from '../../../session/client-history.js';
import type {
  WorkflowDefinition,
  WorkflowArtifactRef,
  WorkflowRunInputEnvelope,
  WorkflowRunSource,
  WorkflowRunSummary,
  WorkflowRunView,
} from '../../../workflows/domain/index.js';
import { buildWorkflowDefinition, validateWorkflowDefinitionInput } from '../../../workflows/domain/index.js';
import { resolveWorkflowRunArtifactsDir } from '../../../workflows/store/paths.js';
import type { AuthenticatedRouteDeps } from './deps.js';

interface StartWorkflowRunRequestBody {
  definitionId?: string;
  input?: unknown;
  inputEnvelope?: WorkflowRunInputEnvelope;
  goal?: string;
  agentId?: string;
  parentSessionKey?: string;
  source?: WorkflowRunSource;
  concurrency?: number;
  maxSubagents?: number;
  tokenBudget?: number | null;
  idempotencyKey?: string;
}

interface ReplayWorkflowRunRequestBody {
  scope?: 'failed_agents' | 'failed_phases';
}

interface WorkflowRunComparison {
  sourceRunId: string;
  replayRunId: string;
  sourceStatus: WorkflowRunView['run']['status'];
  replayStatus: WorkflowRunView['run']['status'];
  statusChanged: boolean;
  durationDeltaMs: number | null;
  failedAgentsBefore: number;
  failedAgentsAfter: number;
  fixedAgentIds: string[];
  stillFailingAgentIds: string[];
  targetAgents: Array<{
    agentId: string;
    label: string;
    beforeStatus?: string;
    afterStatus?: string;
    beforeError?: string;
    afterError?: string;
    beforePreview?: string;
    afterPreview?: string;
  }>;
}

interface SaveWorkflowDefinitionRequestBody {
  name?: string;
  script?: string;
}

export function registerWorkflowRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;
  const workflowRunService = service.createWorkflowRunService();

  authenticated.get('/api/workflows/definitions', (c) => {
    const catalog = createWorkflowCatalog();
    const definitions = catalog.list().map((entry) => {
      try {
        return toWorkflowDefinition(catalog.load(entry.name));
      } catch {
        return null;
      }
    }).filter((definition): definition is WorkflowDefinition => Boolean(definition));

    return c.json({ definitions });
  });

  authenticated.get('/api/workflows/definitions/:id', (c) => {
    const id = c.req.param('id');
    const catalog = createWorkflowCatalog();
    try {
      const definition = toWorkflowDefinition(catalog.load(id));
      return c.json({ definition });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Workflow definition not found' }, 404);
    }
  });

  authenticated.post('/api/workflows/definitions/validate', async (c) => {
    const body = await readJsonBody<SaveWorkflowDefinitionRequestBody>(c.req.raw);
    const result = validateWorkflowDefinitionInput({
      name: body.name,
      script: body.script,
    });
    return c.json(result);
  });

  authenticated.post('/api/workflows/definitions', async (c) => {
    const body = await readJsonBody<SaveWorkflowDefinitionRequestBody>(c.req.raw);
    const validation = validateWorkflowDefinitionInput({
      name: body.name,
      script: body.script,
    });
    if (!validation.valid) {
      return c.json({ error: validation.errors[0]?.message ?? 'Invalid workflow definition', validation }, 400);
    }

    const name = body.name?.trim() ?? '';
    const script = body.script ?? '';
    const catalog = createWorkflowCatalog();
    try {
      catalog.save(name, script);
      const definition = toWorkflowDefinition(catalog.load(name));
      return c.json({ definition }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to save workflow' }, 400);
    }
  });

  authenticated.delete('/api/workflows/definitions/:id', (c) => {
    const id = c.req.param('id').trim();
    if (!id) {
      return c.json({ error: 'id is required' }, 400);
    }

    const catalog = createWorkflowCatalog();
    try {
      const removed = catalog.remove(id);
      if (!removed) {
        return c.json({ error: 'User workflow not found or cannot delete built-in workflow' }, 404);
      }
      return c.json({ removed: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to delete workflow' }, 400);
    }
  });

  authenticated.get('/api/workflows/stats', async (c) => {
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const definitionId = c.req.query('definitionId')?.trim();
    const runStore = workflowRunService.createRunStore(agentId);
    const runs = await runStore.listRunSummaries(500);
    const filteredRuns = definitionId ? runs.filter((run) => run.definitionId === definitionId) : runs;
    return c.json({ stats: buildWorkflowStats(filteredRuns) });
  });

  authenticated.post('/api/workflows/runs', async (c) => {
    const body = await readJsonBody<StartWorkflowRunRequestBody>(c.req.raw);
    const definitionId = body.definitionId?.trim();
    if (!definitionId) {
      return c.json({ error: 'definitionId is required' }, 400);
    }

    const agentId = getAgentId(body.agentId ?? c.req.query('agentId'), service.currentConfig);
    const parentSessionKey = body.parentSessionKey?.trim() || undefined;
    const result = await workflowRunService.startWorkflowRun({
      agentId,
      definitionId,
      input: body.input,
      inputEnvelope: body.inputEnvelope,
      goal: body.goal,
      parentSessionKey,
      source: normalizeWorkflowRunSource(body.source),
      concurrency: normalizePositiveInteger(body.concurrency),
      maxSubagents: normalizePositiveInteger(body.maxSubagents),
      tokenBudget: body.tokenBudget,
      idempotencyKey: body.idempotencyKey,
    });

    if (result.ok === false) {
      return c.json({ error: result.message, code: result.code }, result.httpStatus);
    }

    return c.json({ runId: result.runId, sessionKey: result.sessionKey }, 202);
  });

  authenticated.get('/api/workflows/runs', async (c) => {
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const rawLimit = c.req.query('limit');
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
    const runStore = workflowRunService.createRunStore(agentId);
    const runs = await runStore.listRunSummaries(Number.isFinite(limit) ? limit : 50);
    return c.json({ runs });
  });

  authenticated.post('/api/workflows/runs/:runId/cancel', async (c) => {
    const runId = c.req.param('runId');
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const result = await workflowRunService.cancelWorkflowRun({
      agentId,
      runId,
      reason: 'Cancelled by user',
    });
    if (result.ok === false) {
      return c.json({ error: result.message, code: result.code }, result.httpStatus);
    }
    return c.json({
      cancelled: result.cancelled,
      alreadyFinished: result.alreadyFinished,
    });
  });

  authenticated.get('/api/workflows/runs/:runId/agents/:agentId/session', async (c) => {
    const ownerAgentId = getAgentId(c.req.query('ownerAgentId') ?? c.req.query('agentId'), service.currentConfig);
    const runId = c.req.param('runId');
    const workflowAgentId = c.req.param('agentId');
    const runStore = workflowRunService.createRunStore(ownerAgentId);
    const view = await runStore.readRunView(runId);
    if (!view) {
      return c.json({ error: 'Workflow run not found' }, 404);
    }
    const normalizedWorkflowAgentId = workflowAgentId.startsWith('agent-')
      ? workflowAgentId
      : `agent-${workflowAgentId}`;
    const agent = view.agents.find(
      (item) => item.id === workflowAgentId || item.id === normalizedWorkflowAgentId,
    );
    if (!agent) {
      return c.json({ error: 'Workflow agent not found' }, 404);
    }
    const session = await service.sessions.getSession(agent.sessionKey);
    if (!session || session.sessionType !== 'workflow-subagent') {
      return c.json({ error: 'Workflow agent session not found' }, 404);
    }
    return c.json({
      sessionKey: agent.sessionKey,
      metadata: {
        sessionType: session.sessionType,
        workflowRunId: session.workflowRunId,
        workflowAgentId: session.workflowAgentId,
        workflowAgentLabel: session.workflowAgentLabel,
      },
      messages: messagesToClientHistory(session.messages),
    });
  });

  authenticated.get('/api/workflows/runs/:runId/comparison', async (c) => {
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const runId = c.req.param('runId');
    const runStore = workflowRunService.createRunStore(agentId);
    const replayView = await runStore.readRunView(runId);
    if (!replayView) {
      return c.json({ error: 'Workflow run not found' }, 404);
    }
    const sourceRunId = c.req.query('sourceRunId')?.trim() || replayView.run.metadata?.replay?.sourceRunId;
    if (!sourceRunId) {
      return c.json({ error: 'Workflow run is not a replay run' }, 409);
    }
    const sourceView = await runStore.readRunView(sourceRunId);
    if (!sourceView) {
      return c.json({ error: 'Source workflow run not found' }, 404);
    }
    return c.json({ comparison: buildWorkflowRunComparison(sourceView, replayView) });
  });

  authenticated.get('/api/workflows/runs/:runId', async (c) => {
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const runId = c.req.param('runId');
    const runStore = workflowRunService.createRunStore(agentId);
    const view = await runStore.readRunView(runId);
    if (!view) {
      return c.json({ error: 'Workflow run not found' }, 404);
    }
    return c.json({ view });
  });

  authenticated.get('/api/workflows/runs/:runId/artifacts/:artifactId', async (c) => {
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const runId = c.req.param('runId');
    const artifactId = c.req.param('artifactId');
    const runStore = workflowRunService.createRunStore(agentId);
    const view = await runStore.readRunView(runId);
    if (!view) {
      return c.json({ error: 'Workflow run not found' }, 404);
    }

    const artifact = findWorkflowArtifact(view, artifactId);
    if (!artifact) {
      return c.json({ error: 'Workflow artifact not found' }, 404);
    }

    const artifactPath = join(resolveWorkflowRunArtifactsDir(service.currentConfig, agentId, runId), basename(artifact.name));
    let file: Buffer;
    try {
      const info = await stat(artifactPath);
      if (!info.isFile()) {
        return c.json({ error: 'Workflow artifact not found' }, 404);
      }
      file = await readFile(artifactPath);
    } catch {
      return c.json({ error: 'Workflow artifact not found' }, 404);
    }

    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': artifact.mimeType || 'application/octet-stream',
        'Content-Length': String(file.byteLength),
        'Content-Disposition': `attachment; filename="${encodeHeaderFilename(artifact.name)}"`,
      },
    });
  });

  authenticated.post('/api/workflows/runs/:runId/rebuild', async (c) => {
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const runId = c.req.param('runId');
    const runStore = workflowRunService.createRunStore(agentId);
    const view = await runStore.rebuildRunView(runId);
    if (!view) {
      return c.json({ error: 'Workflow run not found' }, 404);
    }
    service.emit('workflow.run.updated', { runId, view });
    return c.json({ view });
  });

  authenticated.post('/api/workflows/runs/:runId/retry', async (c) => {
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const runId = c.req.param('runId');
    const result = await workflowRunService.retryWorkflowRun({ agentId, runId });
    if (result.ok === false) {
      return c.json({ error: result.message, code: result.code }, result.httpStatus);
    }

    return c.json({ runId: result.runId, sessionKey: result.sessionKey }, 202);
  });

  authenticated.post('/api/workflows/runs/:runId/replay', async (c) => {
    const body = await readJsonBody<ReplayWorkflowRunRequestBody>(c.req.raw);
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const runId = c.req.param('runId');
    const scope = body.scope === 'failed_phases' ? 'failed_phases' : 'failed_agents';
    const result = await workflowRunService.replayWorkflowRun({ agentId, runId, scope });
    if (result.ok === false) {
      return c.json({ error: result.message, code: result.code }, result.httpStatus);
    }

    return c.json({ runId: result.runId, sessionKey: result.sessionKey }, 202);
  });
}

function buildWorkflowRunComparison(sourceView: WorkflowRunView, replayView: WorkflowRunView): WorkflowRunComparison {
  const targetAgentIds = replayView.run.metadata?.replay?.agentIds ?? replayView.agents.map((agent) => agent.id);
  const sourceAgents = new Map(sourceView.agents.map((agent) => [agent.id, agent]));
  const replayAgents = new Map(replayView.agents.map((agent) => [agent.id, agent]));
  const targetAgents = targetAgentIds.map((agentId) => {
    const before = sourceAgents.get(agentId);
    const after = replayAgents.get(agentId);
    return {
      agentId,
      label: after?.label ?? before?.label ?? agentId,
      beforeStatus: before?.status,
      afterStatus: after?.status,
      beforeError: before?.error,
      afterError: after?.error,
      beforePreview: before?.resultPreview,
      afterPreview: after?.resultPreview,
    };
  });
  const fixedAgentIds = targetAgents
    .filter((agent) => (agent.beforeStatus === 'error' || agent.beforeStatus === 'skipped') && agent.afterStatus === 'done')
    .map((agent) => agent.agentId);
  const stillFailingAgentIds = targetAgents
    .filter((agent) => agent.afterStatus === 'error' || agent.afterStatus === 'skipped')
    .map((agent) => agent.agentId);
  const durationDeltaMs =
    typeof sourceView.run.metrics.durationMs === 'number' && typeof replayView.run.metrics.durationMs === 'number'
      ? replayView.run.metrics.durationMs - sourceView.run.metrics.durationMs
      : null;

  return {
    sourceRunId: sourceView.run.id,
    replayRunId: replayView.run.id,
    sourceStatus: sourceView.run.status,
    replayStatus: replayView.run.status,
    statusChanged: sourceView.run.status !== replayView.run.status,
    durationDeltaMs,
    failedAgentsBefore: targetAgents.filter((agent) => agent.beforeStatus === 'error' || agent.beforeStatus === 'skipped').length,
    failedAgentsAfter: stillFailingAgentIds.length,
    fixedAgentIds,
    stillFailingAgentIds,
    targetAgents,
  };
}

function getAgentId(rawAgentId: string | undefined, config: AuthenticatedRouteDeps['service']['currentConfig']): string {
  const trimmed = rawAgentId?.trim();
  if (trimmed) {
    return trimmed;
  }
  return resolveDefaultAgentId(config);
}

function toWorkflowDefinition(loaded: ReturnType<ReturnType<typeof createWorkflowCatalog>['load']>): WorkflowDefinition {
  return buildWorkflowDefinition({
    name: loaded.name,
    source: loaded.source,
    script: loaded.script,
    meta: loaded.meta,
    manifest: loaded.manifest,
  });
}

function buildWorkflowStats(runs: WorkflowRunSummary[]): {
  totalRuns: number;
  activeRuns: number;
  succeededRuns: number;
  failedRuns: number;
  averageDurationMs: number | null;
  topDefinitions: Array<{ definitionId: string; count: number }>;
} {
  const activeStatuses = new Set(['queued', 'running']);
  const succeededStatuses = new Set(['succeeded']);
  const failedStatuses = new Set(['failed', 'timeout', 'cancelled']);

  let durationTotal = 0;
  let durationCount = 0;
  const definitionCounts = new Map<string, number>();

  for (const run of runs) {
    definitionCounts.set(run.definitionId, (definitionCounts.get(run.definitionId) ?? 0) + 1);
    if (run.metrics.durationMs != null && Number.isFinite(run.metrics.durationMs)) {
      durationTotal += run.metrics.durationMs;
      durationCount += 1;
    }
  }

  const topDefinitions = [...definitionCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([definitionId, count]) => ({ definitionId, count }));

  return {
    totalRuns: runs.length,
    activeRuns: runs.filter((run) => activeStatuses.has(run.status)).length,
    succeededRuns: runs.filter((run) => succeededStatuses.has(run.status)).length,
    failedRuns: runs.filter((run) => failedStatuses.has(run.status)).length,
    averageDurationMs: durationCount > 0 ? Math.round(durationTotal / durationCount) : null,
    topDefinitions,
  };
}

async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    return {} as T;
  }
}

function normalizeWorkflowRunSource(source: WorkflowRunSource | undefined): WorkflowRunSource {
  if (!source) {
    return { kind: 'webui' };
  }
  return source;
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return Math.floor(value);
}

function findWorkflowArtifact(
  view: { artifacts?: WorkflowArtifactRef[]; run?: { result?: unknown } },
  artifactId: string,
): WorkflowArtifactRef | null {
  const all = [...(view.artifacts ?? []), ...extractResultArtifacts(view.run?.result)];
  return all.find((artifact) => artifact.id === artifactId) ?? null;
}

function extractResultArtifacts(result: unknown): WorkflowArtifactRef[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return [];
  }
  const maybeArtifacts = (result as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(maybeArtifacts)) {
    return [];
  }
  return maybeArtifacts.filter(isWorkflowArtifactRef);
}

function isWorkflowArtifactRef(value: unknown): value is WorkflowArtifactRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<WorkflowArtifactRef>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.mimeType === 'string'
  );
}

function encodeHeaderFilename(value: string): string {
  return basename(value).replace(/["\\\r\n]/g, '_');
}
