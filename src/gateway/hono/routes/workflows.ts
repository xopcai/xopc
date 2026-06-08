import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import { createWorkflowCatalog } from '../../../agent/workflow/catalog.js';
import type {
  WorkflowDefinition,
  WorkflowRunInputEnvelope,
  WorkflowRunSource,
  WorkflowRunSummary,
} from '../../../workflows/domain/index.js';
import { buildWorkflowDefinition, validateWorkflowDefinitionInput } from '../../../workflows/domain/index.js';
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

