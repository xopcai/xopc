import { randomUUID } from 'node:crypto';

import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { BuildChildToolsOptions } from '../../agent/child-agent-factory.js';
import { publishAutomationProductEvent } from '../../automations/product-events.js';
import {
  extractProfileAgentId,
  resolveEffectiveAgentProfileForSession,
} from '../../config/agent-profile.js';
import { preflightWorkflowConnectors } from '../../connectors/workflow-preflight.js';
import { resolveModelRef } from '../../config/agent-typed-models.js';
import type { GatewayWorkflowHost } from '../../gateway/gateway-workflow-host.types.js';
import { GoalService } from '../../goals/index.js';
import { resolveModel as resolveModelById } from '../../providers/index.js';
import { getProjectWorkspacePathForSession } from '../../projects/workspace.js';
import { DelegateSubagentRunner } from '../../agent/workflow/subagent-runner.js';
import { CatalogWorkflowDefinitionRegistry } from '../registry/catalog-workflow-definition-registry.js';
import type { WorkflowDefinitionRegistry } from '../registry/workflow-definition-registry.js';
import { validateWorkflowJsonSchema } from '../domain/schema-validation.js';
import type {
  WorkflowDefinition,
  WorkflowRunDefinitionSnapshot,
  WorkflowRunInputEnvelope,
  WorkflowRunMetadata,
  WorkflowRunSource,
} from '../domain/index.js';
import { isTerminalWorkflowRunStatus } from '../domain/index.js';
import { WorkflowEngine } from '../engine/index.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { WorkflowRunStore } from '../store/run-store.js';
import type { WorkflowSessionBridge } from './workflow-session-bridge.js';
export type {
  CancelWorkflowRunResult,
  CancelWorkflowRunServiceParams,
  CancelWorkflowRunServiceResult,
  ReplayWorkflowRunServiceParams,
  RetryWorkflowRunServiceParams,
  StartWorkflowRunServiceParams,
  StartWorkflowRunServiceResult,
  WorkflowRunServiceErrorCode,
  WorkflowRunServiceErrorResult,
  WorkflowRunServiceResult,
} from './workflow-run-service.types.js';

import type {
  CancelWorkflowRunResult,
  CancelWorkflowRunServiceParams,
  ReplayWorkflowRunServiceParams,
  RetryWorkflowRunServiceParams,
  StartWorkflowRunServiceParams,
  WorkflowRunServiceResult,
} from './workflow-run-service.types.js';
import type { WorkflowRunReplayMetadata, WorkflowRunReplayScope, WorkflowRunView } from '../domain/run.js';
import type { WorkflowReplayAgentTarget } from '../engine/index.js';

export interface WorkflowRunServiceOptions {
  service: GatewayWorkflowHost;
  sessionBridge: WorkflowSessionBridge;
  buildChildTools: (childOptions: BuildChildToolsOptions) => AgentTool<any, any>[];
  definitionRegistry?: WorkflowDefinitionRegistry;
}

export class WorkflowRunService {
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly definitionRegistry: WorkflowDefinitionRegistry;
  private readonly emittedTerminalAutomationEvents = new Set<string>();

  constructor(private readonly options: WorkflowRunServiceOptions) {
    this.definitionRegistry = options.definitionRegistry ?? new CatalogWorkflowDefinitionRegistry();
  }

  async startWorkflowRun(params: StartWorkflowRunServiceParams): Promise<WorkflowRunServiceResult> {
    const definition = await this.loadDefinition(params.definitionId);
    if (!definition) {
      return {
        ok: false,
        code: 'definition_not_found',
        message: 'Workflow definition not found',
        httpStatus: 404,
      };
    }

    const connectorPreflight = preflightWorkflowConnectors({
      definition,
      config: this.options.service.currentConfig,
      agentId: params.agentId,
    });
    if (!connectorPreflight.ok) {
      return {
        ok: false,
        code: 'connector_preflight_failed',
        message: connectorPreflight.issues.map((entry) => entry.message).join(' '),
        httpStatus: 409,
        details: connectorPreflight,
      };
    }

    const inputEnvelope = params.inputEnvelope ?? buildWorkflowRunInputEnvelope(params.input, params.goal);
    const inputValidation = validateWorkflowJsonSchema(definition.inputSchema, inputEnvelope.payload);
    if (!inputValidation.ok) {
      return {
        ok: false,
        code: 'invalid_input',
        message: inputValidation.message ?? 'Workflow input did not match input schema',
        httpStatus: 400,
      };
    }

    const existingRun = params.idempotencyKey
      ? await this.findRunByIdempotencyKey(params.agentId, params.idempotencyKey)
      : null;
    if (existingRun) {
      return {
        ok: true,
        runId: existingRun.run.id,
        sessionKey: existingRun.run.metadata?.sessionKey ?? '',
      };
    }

    const runId = randomUUID();
    const goal = params.goal ?? '';
    const projectId =
      params.projectId?.trim() ||
      (params.goalId ? new GoalService().get(params.goalId)?.projectId : undefined) ||
      (params.parentSessionKey?.trim()
        ? (await this.options.service.sessionIndexInstance.getStore().getMetadata(params.parentSessionKey.trim()))?.projectId
        : undefined);
    const { sessionKey } = await this.options.sessionBridge.prepareRunSession({
      runId,
      agentId: params.agentId,
      definitionId: params.definitionId,
      definitionTitle: definition.title,
      goal,
      parentSessionKey: params.parentSessionKey,
      projectId,
    });
    const source = normalizeWorkflowRunSourceForSession(params.source, sessionKey, params.parentSessionKey);
    const abortController = new AbortController();
    const eventStore = new WorkflowEventStore(this.options.service.currentConfig, params.agentId);
    const runStore = new WorkflowRunStore(this.options.service.currentConfig, params.agentId, eventStore);
    const engine = this.createWorkflowEngine({
      eventStore,
      runStore,
      sessionKey,
      projectId,
    });
    const limits = resolveWorkflowRunLimits({
      config: this.options.service.currentConfig,
      definition,
      concurrency: params.concurrency,
      maxSubagents: params.maxSubagents,
    });

    this.activeRuns.set(runId, abortController);
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error(`workflow timed out after ${limits.timeoutSec}s`));
    }, limits.timeoutSec * 1000);
    this.timeoutHandles.set(runId, timeoutHandle);
    void engine.startRun(definition, {
      runId,
      input: inputEnvelope.payload,
      goal: inputEnvelope.goal ?? params.goal,
      source,
      metadata: buildWorkflowRunMetadata({
        definition,
        agentId: params.agentId,
        goalId: params.goalId,
        projectId,
        workItemId: params.workItemId,
        contextRefs: params.contextRefs,
        writebackPolicy: params.writebackPolicy,
        sessionKey,
        source,
        input: inputEnvelope,
        retryOfRunId: params.retryOfRunId,
        idempotencyKey: params.idempotencyKey,
      }),
      signal: abortController.signal,
      concurrency: limits.concurrency,
      maxSubagents: limits.maxSubagents,
      tokenBudget: params.tokenBudget,
      timeoutSec: limits.timeoutSec,
    }).catch((err) => {
      this.options.service.emit('workflow.run.error', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }).finally(() => {
      this.activeRuns.delete(runId);
      const handle = this.timeoutHandles.get(runId);
      if (handle) clearTimeout(handle);
      this.timeoutHandles.delete(runId);
    });

    return { ok: true, runId, sessionKey };
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

    const parentSessionKey =
      existing.run.source.kind === 'chat' ? existing.run.source.sessionKey : undefined;
    const projectId = params.projectId?.trim() || existing.run.metadata?.projectId;

    return this.startWorkflowRun({
      agentId: params.agentId,
      definitionId: existing.run.definitionId,
      goalId: existing.run.metadata?.goalId,
      projectId,
      workItemId: existing.run.metadata?.workItemId,
      contextRefs: existing.run.metadata?.contextRefs,
      writebackPolicy: existing.run.metadata?.writebackPolicy,
      input: existing.run.metadata?.input ? undefined : existing.run.input,
      inputEnvelope: existing.run.metadata?.input,
      goal: existing.run.goal,
      source: existing.run.source,
      parentSessionKey,
      retryOfRunId: existing.run.id,
    });
  }

  async replayWorkflowRun(params: ReplayWorkflowRunServiceParams): Promise<WorkflowRunServiceResult> {
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

    const definition = await this.loadDefinition(existing.run.definitionId);
    if (!definition) {
      return {
        ok: false,
        code: 'definition_not_found',
        message: 'Workflow definition not found',
        httpStatus: 404,
      };
    }

    const targets = resolveWorkflowReplayTargets(existing, params.scope);
    if (targets.targets.length === 0) {
      return {
        ok: false,
        code: 'invalid_state',
        message: params.scope === 'failed_phases'
          ? 'No failed workflow phase is available to replay'
          : 'No failed workflow agent is available to replay',
        httpStatus: 409,
      };
    }

    const replayRunId = randomUUID();
    const goal = buildReplayGoal(existing, params.scope, targets.targets.length);
    const parentSessionKey =
      existing.run.source.kind === 'chat' ? existing.run.source.sessionKey : undefined;
    const projectId = existing.run.metadata?.projectId;
    const { sessionKey } = await this.options.sessionBridge.prepareRunSession({
      runId: replayRunId,
      agentId: params.agentId,
      definitionId: existing.run.definitionId,
      definitionTitle: `${definition.title} replay`,
      goal,
      parentSessionKey,
      projectId,
    });
    const source = normalizeWorkflowRunSourceForSession(existing.run.source, sessionKey, parentSessionKey);
    const abortController = new AbortController();
    const eventStore = new WorkflowEventStore(this.options.service.currentConfig, params.agentId);
    const replayRunStore = new WorkflowRunStore(this.options.service.currentConfig, params.agentId, eventStore);
    const engine = this.createWorkflowEngine({
      eventStore,
      runStore: replayRunStore,
      sessionKey,
      projectId,
    });
    const limits = resolveWorkflowRunLimits({
      config: this.options.service.currentConfig,
      definition,
    });
    const inputEnvelope = existing.run.metadata?.input ?? buildWorkflowRunInputEnvelope(existing.run.input, existing.run.goal);

    this.activeRuns.set(replayRunId, abortController);
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new Error(`workflow timed out after ${limits.timeoutSec}s`));
    }, limits.timeoutSec * 1000);
    this.timeoutHandles.set(replayRunId, timeoutHandle);
    void engine.startReplayRun(definition, {
      runId: replayRunId,
      input: inputEnvelope.payload,
      goal,
      source,
      metadata: buildWorkflowRunMetadata({
        definition,
        agentId: params.agentId,
        goalId: existing.run.metadata?.goalId,
        projectId,
        workItemId: existing.run.metadata?.workItemId,
        contextRefs: existing.run.metadata?.contextRefs,
        writebackPolicy: existing.run.metadata?.writebackPolicy,
        sessionKey,
        source,
        input: inputEnvelope,
        retryOfRunId: existing.run.id,
        replay: {
          sourceRunId: existing.run.id,
          scope: params.scope,
          phaseIds: targets.phaseIds,
          agentIds: targets.targets.map((target) => target.agentId),
          targetCount: targets.targets.length,
          createdAtMs: Date.now(),
        },
      }),
      signal: abortController.signal,
      concurrency: limits.concurrency,
      maxSubagents: limits.maxSubagents,
      timeoutSec: limits.timeoutSec,
      sourceRunId: existing.run.id,
      replayScope: params.scope,
      targets: targets.targets,
    }).catch((err) => {
      this.options.service.emit('workflow.run.error', {
        runId: replayRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }).finally(() => {
      this.activeRuns.delete(replayRunId);
      const handle = this.timeoutHandles.get(replayRunId);
      if (handle) clearTimeout(handle);
      this.timeoutHandles.delete(replayRunId);
    });

    return { ok: true, runId: replayRunId, sessionKey };
  }

  async cancelWorkflowRun(params: CancelWorkflowRunServiceParams): Promise<CancelWorkflowRunResult> {
    const controller = this.activeRuns.get(params.runId);
    if (controller) {
      controller.abort();
      this.activeRuns.delete(params.runId);
      const handle = this.timeoutHandles.get(params.runId);
      if (handle) clearTimeout(handle);
      this.timeoutHandles.delete(params.runId);
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
      void this.options.sessionBridge.handleRunViewUpdated(updated);
    }
    return { ok: true, cancelled: true };
  }

  createRunStore(agentId: string): WorkflowRunStore {
    const eventStore = new WorkflowEventStore(this.options.service.currentConfig, agentId);
    return new WorkflowRunStore(this.options.service.currentConfig, agentId, eventStore);
  }

  async readWorkflowRunView(agentId: string, runId: string) {
    return this.createRunStore(agentId).readRunView(runId);
  }

  async reconcileInterruptedRuns(agentId: string): Promise<number> {
    const runStore = this.createRunStore(agentId);
    const summaries = await runStore.listRunSummaries(500);
    let reconciled = 0;

    for (const summary of summaries) {
      if (isTerminalWorkflowRunStatus(summary.status) || this.activeRuns.has(summary.id)) {
        continue;
      }

      const eventStore = new WorkflowEventStore(this.options.service.currentConfig, agentId);
      await eventStore.append({
        runId: summary.id,
        type: 'run_failed',
        payload: {
          error: {
            code: 'runtime_error',
            message: 'Workflow run interrupted by gateway restart',
            recoverable: true,
          },
        },
      });
      const updated = await runStore.rebuildRunView(summary.id);
      if (updated) {
        this.options.service.emit('workflow.run.updated', { runId: summary.id, view: updated });
        void this.options.sessionBridge.handleRunViewUpdated(updated);
      }
      reconciled += 1;
    }

    return reconciled;
  }

  private loadDefinition(definitionId: string): Promise<WorkflowDefinition | null> {
    return this.definitionRegistry.get(definitionId);
  }

  private async findRunByIdempotencyKey(agentId: string, idempotencyKey: string) {
    const runStore = this.createRunStore(agentId);
    const summaries = await runStore.listRunSummaries(500);
    for (const summary of summaries) {
      if (summary.metadata?.correlation?.idempotencyKey !== idempotencyKey) {
        continue;
      }
      return runStore.readRunView(summary.id);
    }
    return null;
  }

  private createWorkflowEngine(params: {
    eventStore: WorkflowEventStore;
    runStore: WorkflowRunStore;
    sessionKey: string;
    projectId?: string;
  }): WorkflowEngine {
    const gatewayService = this.options.service;
    const profileAgentId = extractProfileAgentId(params.sessionKey, gatewayService.currentConfig);
    const agentWorkspace = gatewayService.currentConfig.agents?.list
      ? resolveEffectiveAgentProfileForSession(
          gatewayService.currentConfig,
          params.sessionKey,
        ).resolvedWorkspacePath
      : gatewayService.currentWorkspacePath;
    const workspace = getProjectWorkspacePathForSession(params.sessionKey)
      ?? agentWorkspace;
    const runner = new DelegateSubagentRunner({
      workspace,
      bus: gatewayService.messageBusInstance,
      agentId: profileAgentId,
      getDefaultModel: () => resolveModelById(gatewayService.agentService.getModelForSession(params.sessionKey)),
      getConfig: () => gatewayService.currentConfig,
      sessionStore: gatewayService.sessionIndexInstance.getStore(),
      buildChildTools: (childOptions) => this.options.buildChildTools(childOptions),
    });

    return new WorkflowEngine({
      cwd: workspace,
      projectId: params.projectId,
      eventStore: params.eventStore,
      runStore: params.runStore,
      runner,
      resolveModelId: (modelId) => {
        return resolveModelById(resolveModelRef(gatewayService.currentConfig, profileAgentId, modelId));
      },
      parentSessionKey: params.sessionKey,
      subagentSessionKeyFactory: ({ runId, agentId }) => {
        return `agent:${profileAgentId}:workflow:${runId}:subagent:${agentId}`;
      },
      onEventAppended: (event) => {
        gatewayService.emit('workflow.event.appended', { runId: event.runId, event });
      },
      onRunViewUpdated: (view) => {
        gatewayService.emit('workflow.run.updated', { runId: view.run.id, view });
        this.publishTerminalWorkflowAutomationEvent(view);
        void this.options.sessionBridge.handleRunViewUpdated(view);
      },
    });
  }

  private publishTerminalWorkflowAutomationEvent(view: WorkflowRunView): void {
    if (!isTerminalWorkflowRunStatus(view.run.status)) return;
    if (this.emittedTerminalAutomationEvents.has(view.run.id)) return;
    this.emittedTerminalAutomationEvents.add(view.run.id);
    publishAutomationProductEvent({
      type: 'workflow.run.completed',
      source: 'workflows',
      payload: {
        runId: view.run.id,
        status: view.run.status,
        definitionId: view.run.definitionId,
        title: view.run.title,
        sessionKey: view.run.metadata?.sessionKey,
        sourceKind: view.run.source.kind,
      },
      occurredAtMs: view.run.completedAtMs ?? Date.now(),
    });
  }
}

function normalizeWorkflowRunSourceForSession(
  source: WorkflowRunSource,
  workflowSessionKey: string,
  parentSessionKey?: string,
): WorkflowRunSource {
  if (parentSessionKey?.trim()) {
    return { kind: 'chat', sessionKey: parentSessionKey.trim() };
  }
  if (source.kind === 'webui') {
    return { ...source, sessionKey: workflowSessionKey };
  }
  if (source.kind === 'chat') {
    return source;
  }
  return source;
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
  goalId?: string;
  projectId?: string;
  workItemId?: string;
  contextRefs?: WorkflowRunMetadata['contextRefs'];
  writebackPolicy?: WorkflowRunMetadata['writebackPolicy'];
  sessionKey: string;
  source: WorkflowRunSource;
  input: WorkflowRunInputEnvelope;
  retryOfRunId?: string;
  idempotencyKey?: string;
  replay?: WorkflowRunReplayMetadata;
}): WorkflowRunMetadata {
  const goalId = params.goalId?.trim() || undefined;
  const projectId = params.projectId?.trim() || undefined;
  const workItemId = params.workItemId?.trim() || undefined;
  const contextRefs = params.contextRefs ?? buildDefaultWorkflowContextRefs({ projectId, goalId, workItemId, source: params.source });
  const writebackPolicy = params.writebackPolicy ?? buildDefaultWorkflowWritebackPolicy({ projectId, goalId, workItemId });
  return {
    sessionKey: params.sessionKey,
    triggerSource: params.source.kind,
    agentId: params.agentId,
    projectId,
    workItemId,
    contextRefs,
    writebackPolicy,
    retryOfRunId: params.retryOfRunId,
    replay: params.replay,
    definition: buildWorkflowRunDefinitionSnapshot(params.definition),
    input: params.input,
    correlation: {
      idempotencyKey: params.idempotencyKey,
    },
    origin: buildWorkflowRunOrigin(params.source),
    schedule: params.source.kind === 'automation'
      ? { automationId: params.source.automationId, runId: params.source.runId, scheduledAtMs: params.source.scheduledAtMs }
      : undefined,
    goalId,
  };
}

function buildDefaultWorkflowContextRefs(params: {
  projectId?: string;
  goalId?: string;
  workItemId?: string;
  source: WorkflowRunSource;
}): WorkflowRunMetadata['contextRefs'] {
  const refs: NonNullable<WorkflowRunMetadata['contextRefs']> = [];
  if (params.projectId) refs.push({ kind: 'project', id: params.projectId, role: 'scope' });
  if (params.goalId) refs.push({ kind: 'goal', id: params.goalId, role: 'objective' });
  if (params.workItemId) refs.push({ kind: 'work_item', id: params.workItemId, role: 'work_object' });
  if (params.source.kind === 'chat') refs.push({ kind: 'session', id: params.source.sessionKey, role: 'parent_session' });
  return refs;
}

function buildDefaultWorkflowWritebackPolicy(params: {
  projectId?: string;
  goalId?: string;
  workItemId?: string;
}): WorkflowRunMetadata['writebackPolicy'] {
  const targets: NonNullable<WorkflowRunMetadata['writebackPolicy']>['targets'] = [];
  if (params.projectId) targets.push({ kind: 'project', id: params.projectId, mode: 'record' });
  if (params.goalId) targets.push({ kind: 'goal', id: params.goalId, mode: 'evaluate' });
  if (params.workItemId) targets.push({ kind: 'work_item', id: params.workItemId, mode: 'suggest' });
  return { targets };
}

export function resolveWorkflowReplayTargets(
  view: WorkflowRunView,
  scope: WorkflowRunReplayScope,
): { targets: WorkflowReplayAgentTarget[]; phaseIds?: string[] } {
  const phaseTitleById = new Map(view.phases.map((phase) => [phase.id, phase.title]));
  const failedStatuses = new Set(['error', 'skipped']);

  if (scope === 'failed_agents') {
    return {
      targets: view.agents
        .filter((agent) => failedStatuses.has(agent.status) && workflowAgentReplayPrompt(agent))
        .map((agent) => ({
          agentId: agent.id,
          label: agent.label,
          phaseId: agent.phaseId,
          phaseTitle: agent.phaseId ? phaseTitleById.get(agent.phaseId) : undefined,
          prompt: workflowAgentReplayPrompt(agent) ?? '',
          invocation: agent.invocation,
        })),
    };
  }

  const failedPhaseIds = view.phases
    .filter((phase) => phase.status === 'failed')
    .map((phase) => phase.id);
  const phaseIds = failedPhaseIds.length > 0
    ? failedPhaseIds
    : [...new Set(view.agents.filter((agent) => failedStatuses.has(agent.status) && agent.phaseId).map((agent) => agent.phaseId as string))];
  const phaseIdSet = new Set(phaseIds);

  return {
    phaseIds,
    targets: view.agents
      .filter((agent) => agent.phaseId && phaseIdSet.has(agent.phaseId) && workflowAgentReplayPrompt(agent))
      .map((agent) => ({
        agentId: agent.id,
        label: agent.label,
        phaseId: agent.phaseId,
        phaseTitle: agent.phaseId ? phaseTitleById.get(agent.phaseId) : undefined,
        prompt: workflowAgentReplayPrompt(agent) ?? '',
        invocation: agent.invocation,
      })),
  };
}

function workflowAgentReplayPrompt(agent: WorkflowRunView['agents'][number]): string | undefined {
  const invocationPrompt = agent.invocation?.prompt?.trim();
  if (invocationPrompt) return invocationPrompt;
  const prompt = agent.prompt?.trim();
  return prompt || undefined;
}

export function buildWorkflowRunDefinitionSnapshot(definition: WorkflowDefinition): WorkflowRunDefinitionSnapshot {
  const snapshot: WorkflowRunDefinitionSnapshot = {
    id: definition.id,
    name: definition.name,
    title: definition.title,
    version: definition.version,
    revision: definition.revision,
    graph: structuredClone(definition.graph),
    source: definition.metadata.source,
    tags: [...definition.metadata.tags],
    phaseCount: definition.phases.length,
    defaults: { ...definition.defaults },
    estimatedAgents: definition.metadata.estimatedAgents,
  };
  if (definition.contentHash) snapshot.contentHash = definition.contentHash;
  if (definition.permissions) snapshot.permissions = structuredClone(definition.permissions);
  if (definition.resources) snapshot.resources = structuredClone(definition.resources);
  return snapshot;
}

function resolveWorkflowRunLimits(params: {
  config: import('../../config/schema.js').Config;
  definition: WorkflowDefinition;
  concurrency?: number;
  maxSubagents?: number;
}): { concurrency: number; maxSubagents: number; timeoutSec: number } {
  const configuredMaxConcurrency = normalizePositiveInt(
    undefined,
    params.definition.defaults.concurrency,
  );
  const configuredMaxSubagents = normalizePositiveInt(
    undefined,
    params.definition.defaults.maxSubagents,
  );
  const configuredTimeoutSec = normalizePositiveInt(
    undefined,
    params.definition.defaults.timeoutSec,
  );

  return {
    concurrency: Math.max(
      1,
      Math.min(
        normalizePositiveInt(params.concurrency, params.definition.defaults.concurrency),
        configuredMaxConcurrency,
      ),
    ),
    maxSubagents: Math.max(
      1,
      Math.min(
        normalizePositiveInt(params.maxSubagents, params.definition.defaults.maxSubagents),
        configuredMaxSubagents,
      ),
    ),
    timeoutSec: Math.max(1, Math.min(params.definition.defaults.timeoutSec, configuredTimeoutSec)),
  };
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

function buildReplayGoal(view: WorkflowRunView, scope: WorkflowRunReplayScope, targetCount: number): string {
  const scopeLabel = scope === 'failed_phases' ? 'failed phase' : 'failed agent';
  return `Replay ${targetCount} ${scopeLabel}${targetCount === 1 ? '' : 's'} from workflow run ${view.run.id}: ${view.run.goal}`;
}

export function extractWorkflowRunSessionKey(source: WorkflowRunSource): string | null {
  if ('sessionKey' in source && typeof source.sessionKey === 'string' && source.sessionKey.trim()) {
    return source.sessionKey.trim();
  }
  return null;
}

function buildWorkflowRunOrigin(source: WorkflowRunSource): WorkflowRunMetadata['origin'] {
  switch (source.kind) {
    case 'chat':
      return { channel: 'chat', sessionKey: source.sessionKey, messageId: source.messageId };
    case 'webui':
      return { channel: 'webui', sessionKey: source.sessionKey };
    case 'automation':
      return { channel: 'automation', automationId: source.automationId, runId: source.runId };
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
