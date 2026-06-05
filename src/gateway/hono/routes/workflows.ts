import { randomUUID } from 'node:crypto';

import type { Hono } from 'hono';

import { resolveDefaultAgentId } from '../../../agent/agent-scope.js';
import type { BuildChildToolsOptions } from '../../../agent/child-agent-factory.js';
import { AgentToolsFactory } from '../../../agent/tools/factory.js';
import { createWorkflowCatalog } from '../../../agent/workflow/catalog.js';
import { DelegateSubagentRunner } from '../../../agent/workflow/subagent-runner.js';
import type { WorkflowDefinition, WorkflowRunSource } from '../../../workflows/domain/index.js';
import { WorkflowEngine, WorkflowEventStore, WorkflowRunStore } from '../../../workflows/index.js';
import { extractProfileAgentId } from '../../../config/agent-profile.js';
import { resolveModelRef } from '../../../config/agent-typed-models.js';
import { resolveModel as resolveModelById } from '../../../providers/index.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const DEFAULT_WORKFLOW_CONCURRENCY = 4;
const DEFAULT_WORKFLOW_TIMEOUT_SEC = 30 * 60;
const DEFAULT_WORKFLOW_MAX_SUBAGENTS = 100;

const activeWorkflowRuns = new Map<string, AbortController>();

interface StartWorkflowRunRequestBody {
  definitionId?: string;
  input?: unknown;
  goal?: string;
  agentId?: string;
  sessionKey?: string;
  source?: WorkflowRunSource;
  concurrency?: number;
  maxSubagents?: number;
  tokenBudget?: number | null;
}

export function registerWorkflowRoutes(authenticated: Hono, deps: AuthenticatedRouteDeps): void {
  const { service } = deps;

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

  authenticated.post('/api/workflows/runs', async (c) => {
    const body = await readJsonBody<StartWorkflowRunRequestBody>(c.req.raw);
    const definitionId = body.definitionId?.trim();
    if (!definitionId) {
      return c.json({ error: 'definitionId is required' }, 400);
    }

    const agentId = getAgentId(body.agentId ?? c.req.query('agentId'), service.currentConfig);
    const sessionKey = body.sessionKey?.trim() || `workflow:${agentId}`;
    const catalog = createWorkflowCatalog();
    let definition: WorkflowDefinition;
    try {
      definition = toWorkflowDefinition(catalog.load(definitionId));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Workflow definition not found' }, 404);
    }

    const eventStore = new WorkflowEventStore(service.currentConfig, agentId);
    const runStore = new WorkflowRunStore(service.currentConfig, agentId, eventStore);
    const runId = randomUUID();
    const abortController = new AbortController();
    const engine = createWorkflowEngine({
      deps,
      eventStore,
      runStore,
      sessionKey,
    });

    activeWorkflowRuns.set(runId, abortController);
    void engine.startRun(definition, {
      runId,
      input: body.input,
      goal: body.goal,
      source: body.source ?? { kind: 'webui' },
      signal: abortController.signal,
      concurrency: normalizePositiveInteger(body.concurrency),
      maxSubagents: normalizePositiveInteger(body.maxSubagents),
      tokenBudget: body.tokenBudget,
    }).catch((err) => {
      service.emit('workflow.run.error', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }).finally(() => {
      activeWorkflowRuns.delete(runId);
    });

    return c.json({ runId }, 202);
  });

  authenticated.get('/api/workflows/runs', async (c) => {
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const rawLimit = c.req.query('limit');
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
    const runStore = createRunStore(service.currentConfig, agentId);
    const runs = await runStore.listRunSummaries(Number.isFinite(limit) ? limit : 50);
    return c.json({ runs });
  });

  authenticated.post('/api/workflows/runs/:runId/cancel', async (c) => {
    const runId = c.req.param('runId');
    const controller = activeWorkflowRuns.get(runId);
    if (!controller) {
      return c.json({ error: 'Workflow run is not active' }, 404);
    }
    controller.abort();
    activeWorkflowRuns.delete(runId);
    return c.json({ cancelled: true });
  });

  authenticated.get('/api/workflows/runs/:runId', async (c) => {
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const runId = c.req.param('runId');
    const runStore = createRunStore(service.currentConfig, agentId);
    const view = await runStore.readRunView(runId);
    if (!view) {
      return c.json({ error: 'Workflow run not found' }, 404);
    }
    return c.json({ view });
  });

  authenticated.post('/api/workflows/runs/:runId/rebuild', async (c) => {
    const agentId = getAgentId(c.req.query('agentId'), service.currentConfig);
    const runId = c.req.param('runId');
    const runStore = createRunStore(service.currentConfig, agentId);
    const view = await runStore.rebuildRunView(runId);
    if (!view) {
      return c.json({ error: 'Workflow run not found' }, 404);
    }
    service.emit('workflow.run.updated', { runId, view });
    return c.json({ view });
  });
}

function createRunStore(config: AuthenticatedRouteDeps['service']['currentConfig'], agentId: string): WorkflowRunStore {
  const eventStore = new WorkflowEventStore(config, agentId);
  return new WorkflowRunStore(config, agentId, eventStore);
}

function getAgentId(rawAgentId: string | undefined, config: AuthenticatedRouteDeps['service']['currentConfig']): string {
  const trimmed = rawAgentId?.trim();
  if (trimmed) {
    return trimmed;
  }
  return resolveDefaultAgentId(config);
}

function toWorkflowDefinition(loaded: ReturnType<ReturnType<typeof createWorkflowCatalog>['load']>): WorkflowDefinition {
  const nowMs = Date.now();
  const phases = loaded.meta.phases?.map((phase, index) => ({
    id: normalizeId(phase.title) || `phase-${index + 1}`,
    title: phase.title,
    description: phase.detail,
  })) ?? [];

  return {
    id: loaded.name,
    name: loaded.name,
    title: toTitle(loaded.name),
    description: loaded.meta.description,
    version: '1.0.0',
    phases,
    runtime: {
      kind: 'script',
      source: loaded.script,
    },
    defaults: {
      concurrency: DEFAULT_WORKFLOW_CONCURRENCY,
      timeoutSec: DEFAULT_WORKFLOW_TIMEOUT_SEC,
      maxSubagents: loaded.meta.estimatedAgents?.max ?? DEFAULT_WORKFLOW_MAX_SUBAGENTS,
    },
    metadata: {
      tags: loaded.meta.tags ?? [],
      builtIn: loaded.source === 'builtin',
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    },
  };
}

function createWorkflowEngine(params: {
  deps: AuthenticatedRouteDeps;
  eventStore: WorkflowEventStore;
  runStore: WorkflowRunStore;
  sessionKey: string;
}): WorkflowEngine {
  const { service } = params.deps;
  const runner = new DelegateSubagentRunner({
    workspace: service.currentWorkspacePath,
    bus: service.messageBusInstance,
    getDefaultModel: () => resolveModelById(service.agentService.getModelForSession(params.sessionKey)),
    getConfig: () => service.currentConfig,
    buildChildTools: (childOptions) => buildWorkflowChildTools(childOptions),
  });

  return new WorkflowEngine({
    cwd: service.currentWorkspacePath,
    eventStore: params.eventStore,
    runStore: params.runStore,
    runner,
    resolveModelId: (modelId) => {
      const agentId = extractProfileAgentId(params.sessionKey, service.currentConfig);
      return resolveModelById(resolveModelRef(service.currentConfig, agentId, modelId));
    },
    onEventAppended: (event) => {
      service.emit('workflow.event.appended', { runId: event.runId, event });
    },
    onRunViewUpdated: (view) => {
      service.emit('workflow.run.updated', { runId: view.run.id, view });
    },
  });
}

function buildWorkflowChildTools(childOptions: BuildChildToolsOptions) {
  const childFactory = new AgentToolsFactory({
    workspace: childOptions.workspace,
    bus: childOptions.bus,
    getCurrentContext: () => null,
    getConfig: childOptions.getConfig,
    getPrimaryModel: () => childOptions.model,
    toolExecutorConfig: childOptions.toolExecutorConfig,
  });
  return childFactory.createAllTools({
    workspace: childOptions.workspace,
    getPrimaryModel: () => childOptions.model,
    disabledTools: new Set(['extensions']),
  });
}

async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    return {} as T;
  }
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return Math.floor(value);
}

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toTitle(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
