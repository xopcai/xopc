import { randomUUID } from 'node:crypto';

import type { BuildChildToolsOptions } from '../../agent/child-agent-factory.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';
import { resolveModelRef } from '../../config/agent-typed-models.js';
import type { GatewayService } from '../../gateway/service.js';
import { resolveModel as resolveModelById } from '../../providers/index.js';
import { AgentToolsFactory } from '../../agent/tools/factory.js';
import { createWorkflowCatalog } from '../../agent/workflow/catalog.js';
import { DelegateSubagentRunner } from '../../agent/workflow/subagent-runner.js';
import type {
  WorkflowDefinition,
  WorkflowRunDefinitionSnapshot,
  WorkflowRunInputEnvelope,
  WorkflowRunMetadata,
  WorkflowRunSource,
} from '../domain/index.js';
import { buildWorkflowDefinition, isTerminalWorkflowRunStatus } from '../domain/index.js';
import { WorkflowEngine } from '../engine/index.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { WorkflowRunStore } from '../store/run-store.js';

export interface WorkflowRunServiceOptions {
  service: GatewayService;
}

export interface StartWorkflowRunServiceParams {
  agentId: string;
  sessionKey: string;
  definitionId: string;
  input?: unknown;
  inputEnvelope?: WorkflowRunInputEnvelope;
  goal?: string;
  source: WorkflowRunSource;
  concurrency?: number;
  maxSubagents?: number;
  tokenBudget?: number | null;
  retryOfRunId?: string;
  idempotencyKey?: string;
}

export interface StartWorkflowRunServiceResult {
  ok: true;
  runId: string;
}

export interface WorkflowRunServiceErrorResult {
  ok: false;
  code: WorkflowRunServiceErrorCode;
  message: string;
  httpStatus: 400 | 404 | 409;
}

export type WorkflowRunServiceResult = StartWorkflowRunServiceResult | WorkflowRunServiceErrorResult;

export type WorkflowRunServiceErrorCode =
  | 'definition_not_found'
  | 'run_not_found'
  | 'invalid_state';

export interface RetryWorkflowRunServiceParams {
  agentId: string;
  runId: string;
}

export interface CancelWorkflowRunServiceParams {
  agentId: string;
  runId: string;
  reason?: string;
}

export interface CancelWorkflowRunServiceResult {
  ok: true;
  cancelled: boolean;
  alreadyFinished?: boolean;
}

export type CancelWorkflowRunResult = CancelWorkflowRunServiceResult | WorkflowRunServiceErrorResult;

export class WorkflowRunService {
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(private readonly options: WorkflowRunServiceOptions) {}

  async startWorkflowRun(params: StartWorkflowRunServiceParams): Promise<WorkflowRunServiceResult> {
    const definition = this.loadDefinition(params.definitionId);
    if (!definition) {
      return {
        ok: false,
        code: 'definition_not_found',
        message: 'Workflow definition not found',
        httpStatus: 404,
      };
    }

    const runId = randomUUID();
    const abortController = new AbortController();
    const eventStore = new WorkflowEventStore(this.options.service.currentConfig, params.agentId);
    const runStore = new WorkflowRunStore(this.options.service.currentConfig, params.agentId, eventStore);
    const engine = this.createWorkflowEngine({
      eventStore,
      runStore,
      sessionKey: params.sessionKey,
    });
    const inputEnvelope = params.inputEnvelope ?? buildWorkflowRunInputEnvelope(params.input, params.goal);

    this.activeRuns.set(runId, abortController);
    void engine.startRun(definition, {
      runId,
      input: inputEnvelope.payload,
      goal: inputEnvelope.goal ?? params.goal,
      source: params.source,
      metadata: buildWorkflowRunMetadata({
        definition,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        source: params.source,
        input: inputEnvelope,
        retryOfRunId: params.retryOfRunId,
        idempotencyKey: params.idempotencyKey,
      }),
      signal: abortController.signal,
      concurrency: params.concurrency,
      maxSubagents: params.maxSubagents,
      tokenBudget: params.tokenBudget,
    }).catch((err) => {
      this.options.service.emit('workflow.run.error', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }).finally(() => {
      this.activeRuns.delete(runId);
    });

    return { ok: true, runId };
  }

  async retryWorkflowRun(params: RetryWorkflowRunServiceParams): Promise<WorkflowRunServiceResult> {
    const runStore = this.createRunStore(params.agentId);
    const existing = await runStore.readRunView(params.runId);
    if (!existing) {
      return {
        ok: false,
        code: 'run_not_found',
        message: 'Workflow run not found',
        httpStatus: 404,
      };
    }

    const sessionKey = existing.run.metadata?.sessionKey
      ?? extractWorkflowRunSessionKey(existing.run.source)
      ?? `workflow:${params.agentId}`;

    return this.startWorkflowRun({
      agentId: params.agentId,
      sessionKey,
      definitionId: existing.run.definitionId,
      input: existing.run.input,
      goal: existing.run.goal,
      source: { kind: 'webui', sessionKey },
      retryOfRunId: existing.run.id,
    });
  }

  async cancelWorkflowRun(params: CancelWorkflowRunServiceParams): Promise<CancelWorkflowRunResult> {
    const controller = this.activeRuns.get(params.runId);
    if (controller) {
      controller.abort();
      this.activeRuns.delete(params.runId);
      return { ok: true, cancelled: true };
    }

    const runStore = this.createRunStore(params.agentId);
    const view = await runStore.readRunView(params.runId);
    if (!view) {
      return {
        ok: false,
        code: 'run_not_found',
        message: 'Workflow run not found',
        httpStatus: 404,
      };
    }

    if (isTerminalWorkflowRunStatus(view.run.status)) {
      return { ok: true, cancelled: true, alreadyFinished: true };
    }

    const eventStore = new WorkflowEventStore(this.options.service.currentConfig, params.agentId);
    await eventStore.append({
      runId: params.runId,
      type: 'run_cancelled',
      payload: { reason: params.reason ?? 'Cancelled by user' },
    });
    const updated = await runStore.rebuildRunView(params.runId);
    if (updated) {
      this.options.service.emit('workflow.run.updated', { runId: params.runId, view: updated });
    }
    return { ok: true, cancelled: true };
  }

  createRunStore(agentId: string): WorkflowRunStore {
    const eventStore = new WorkflowEventStore(this.options.service.currentConfig, agentId);
    return new WorkflowRunStore(this.options.service.currentConfig, agentId, eventStore);
  }

  private loadDefinition(definitionId: string): WorkflowDefinition | null {
    const catalog = createWorkflowCatalog();
    try {
      const loaded = catalog.load(definitionId);
      return buildWorkflowDefinition({
        name: loaded.name,
        source: loaded.source,
        script: loaded.script,
        meta: loaded.meta,
      });
    } catch {
      return null;
    }
  }

  private createWorkflowEngine(params: {
    eventStore: WorkflowEventStore;
    runStore: WorkflowRunStore;
    sessionKey: string;
  }): WorkflowEngine {
    const gatewayService = this.options.service;
    const runner = new DelegateSubagentRunner({
      workspace: gatewayService.currentWorkspacePath,
      bus: gatewayService.messageBusInstance,
      getDefaultModel: () => resolveModelById(gatewayService.agentService.getModelForSession(params.sessionKey)),
      getConfig: () => gatewayService.currentConfig,
      buildChildTools: (childOptions) => buildWorkflowChildTools(childOptions),
    });

    return new WorkflowEngine({
      cwd: gatewayService.currentWorkspacePath,
      eventStore: params.eventStore,
      runStore: params.runStore,
      runner,
      resolveModelId: (modelId) => {
        const agentId = extractProfileAgentId(params.sessionKey, gatewayService.currentConfig);
        return resolveModelById(resolveModelRef(gatewayService.currentConfig, agentId, modelId));
      },
      onEventAppended: (event) => {
        gatewayService.emit('workflow.event.appended', { runId: event.runId, event });
      },
      onRunViewUpdated: (view) => {
        gatewayService.emit('workflow.run.updated', { runId: view.run.id, view });
      },
    });
  }
}

export function buildWorkflowRunInputEnvelope(input: unknown, goal?: string): WorkflowRunInputEnvelope {
  if (isWorkflowRunInputEnvelope(input)) {
    return input;
  }
  return {
    payload: input ?? {},
    goal,
  };
}

export function buildWorkflowRunMetadata(params: {
  definition: WorkflowDefinition;
  agentId: string;
  sessionKey: string;
  source: WorkflowRunSource;
  input: WorkflowRunInputEnvelope;
  retryOfRunId?: string;
  idempotencyKey?: string;
}): WorkflowRunMetadata {
  return {
    sessionKey: params.sessionKey,
    triggerSource: params.source.kind,
    agentId: params.agentId,
    retryOfRunId: params.retryOfRunId,
    definition: buildWorkflowRunDefinitionSnapshot(params.definition),
    input: params.input,
    correlation: {
      idempotencyKey: params.idempotencyKey,
    },
    origin: buildWorkflowRunOrigin(params.source),
    schedule: params.source.kind === 'cron'
      ? { scheduleId: params.source.scheduleId, fireId: params.source.fireId }
      : undefined,
  };
}

export function buildWorkflowRunDefinitionSnapshot(definition: WorkflowDefinition): WorkflowRunDefinitionSnapshot {
  return {
    id: definition.id,
    name: definition.name,
    title: definition.title,
    version: definition.version,
    source: definition.metadata.source,
    tags: [...definition.metadata.tags],
    phaseCount: definition.phases.length,
    estimatedAgents: definition.metadata.estimatedAgents,
  };
}

export function extractWorkflowRunSessionKey(source: WorkflowRunSource): string | null {
  if ('sessionKey' in source && typeof source.sessionKey === 'string' && source.sessionKey.trim()) {
    return source.sessionKey.trim();
  }
  return null;
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

function buildWorkflowRunOrigin(source: WorkflowRunSource): WorkflowRunMetadata['origin'] {
  switch (source.kind) {
    case 'chat':
      return { channel: 'chat', sessionKey: source.sessionKey, messageId: source.messageId };
    case 'webui':
      return { channel: 'webui', sessionKey: source.sessionKey };
    case 'cron':
      return { channel: 'cron', scheduleId: source.scheduleId, fireId: source.fireId };
    case 'api':
      return { channel: 'api', requestId: source.requestId };
    case 'im':
      return { channel: source.channel, chatId: source.chatId, messageId: source.messageId };
  }
}

function isWorkflowRunInputEnvelope(input: unknown): input is WorkflowRunInputEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return false;
  }
  return 'payload' in input || 'variables' in input || 'context' in input;
}
