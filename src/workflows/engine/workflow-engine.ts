import { randomUUID } from 'node:crypto';

import type { WorkflowDefinition } from '../domain/definition.js';
import type { WorkflowEventEnvelope, WorkflowEventPayload, WorkflowEventType } from '../domain/event.js';
import type { WorkflowAgentStatus, WorkflowRun, WorkflowRunError, WorkflowRunMetadata, WorkflowRunSource, WorkflowRunView } from '../domain/run.js';
import type { WorkflowResultEnvelope } from '../domain/result.js';
import { validateWorkflowJsonSchema } from '../domain/schema-validation.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { WorkflowRunStore } from '../store/run-store.js';
import { createGraphWorkflowRuntime } from '../runtime/graph-workflow-runtime.js';
import type { WorkflowRuntime, WorkflowRuntimeSubagentRunner } from '../runtime/workflow-runtime-port.js';
import type { Api, Model } from '@earendil-works/pi-ai';

import { workflowStepLabel } from '../../agent/workflow/step-labels.js';
import type { SubagentProgressEvent } from '../../agent/workflow/types.js';
import type { WorkflowAgentInvocationSnapshot } from '../domain/index.js';

export interface WorkflowEngineOptions {
  cwd: string;
  eventStore: WorkflowEventStore;
  runStore: WorkflowRunStore;
  runner: WorkflowRuntimeSubagentRunner;
  runtime?: WorkflowRuntime;
  hooks?: WorkflowEngineHook[];
  subagentSessionKeyFactory?: (ctx: { runId: string; agentId: string }) => string;
  parentSessionKey?: string;
  onEventAppended?: (event: WorkflowEventEnvelope) => void;
  onRunViewUpdated?: (view: WorkflowRunView) => void;
  resolveModelId?: (modelId: string) => Model<Api>;
}

export interface WorkflowEngineHook {
  beforeRun?(ctx: WorkflowRunHookContext): Promise<void> | void;
  beforeAgent?(ctx: WorkflowAgentHookContext): Promise<void> | void;
  afterAgent?(ctx: WorkflowAgentCompletedHookContext): Promise<void> | void;
  afterRun?(ctx: WorkflowRunCompletedHookContext): Promise<void> | void;
}

export interface WorkflowRunHookContext {
  definition: WorkflowDefinition;
  run: WorkflowRun;
}

export interface WorkflowAgentHookContext {
  runId: string;
  agentId: string;
  label: string;
  phaseId?: string;
  prompt: string;
}

export interface WorkflowAgentCompletedHookContext {
  runId: string;
  agentId: string;
  status: 'done' | 'error' | 'skipped';
  resultPreview?: string;
}

export interface WorkflowRunCompletedHookContext {
  runId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
}

export interface StartWorkflowRunOptions {
  input?: unknown;
  source: WorkflowRunSource;
  metadata?: WorkflowRunMetadata;
  goal?: string;
  runId?: string;
  signal?: AbortSignal;
  concurrency?: number;
  maxSubagents?: number;
  tokenBudget?: number | null;
  timeoutSec?: number;
}

export interface WorkflowReplayAgentTarget {
  agentId: string;
  label: string;
  phaseId?: string;
  phaseTitle?: string;
  prompt: string;
  invocation?: WorkflowAgentInvocationSnapshot;
}

export interface StartWorkflowReplayRunOptions extends StartWorkflowRunOptions {
  sourceRunId: string;
  replayScope: 'failed_agents' | 'failed_phases';
  targets: WorkflowReplayAgentTarget[];
}

export class WorkflowEngine {
  constructor(private readonly options: WorkflowEngineOptions) {}

  async startRun(definition: WorkflowDefinition, options: StartWorkflowRunOptions): Promise<WorkflowRunView> {
    const runId = options.runId ?? randomUUID();
    const createdAtMs = Date.now();
    const phaseTitleToId = buildPhaseTitleToId(definition);
    let currentPhaseId: string | undefined;
    let eventQueue = Promise.resolve();
    const progressRecorders = new Map<number, AgentProgressRecorder>();
    const runtimeAgentStatuses = new Map<number, WorkflowAgentStatus | 'queued'>();
    const subagentSessionKeys = new Map<number, string>();

    const run: WorkflowRun = {
      id: runId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      title: definition.title,
      goal: options.goal ?? definition.description,
      input: options.input ?? {},
      status: 'queued',
      source: options.source,
      metadata: options.metadata,
      metrics: {
        agentCount: 0,
        doneAgentCount: 0,
        errorAgentCount: 0,
        skippedAgentCount: 0,
        artifactCount: 0,
      },
      createdAtMs,
    };

    const appendEvent = (type: WorkflowEventType, payload: WorkflowEventPayload, createdAtMsOverride?: number) => {
      eventQueue = eventQueue
        .then(() =>
          this.options.eventStore.append({
            runId,
            type,
            payload,
            createdAtMs: createdAtMsOverride,
          }),
        )
        .then(async (event) => {
          this.options.onEventAppended?.(event);
          const view = await this.options.runStore.rebuildRunView(runId);
          if (view) {
            this.options.onRunViewUpdated?.(view);
          }
        });
      return eventQueue;
    };

    await appendEvent('run_queued', { run }, createdAtMs);
    await this.callHooks((hook) => hook.beforeRun?.({ definition, run }));
    await appendEvent('run_started', { startedAtMs: Date.now() });

    try {
      const runtime = this.options.runtime ?? createGraphWorkflowRuntime();
      const runtimeResult = await withWorkflowTimeout(
        runtime.run<unknown>(
          definition.graph,
          {
            runner: this.options.runner,
            resolveModelId: this.options.resolveModelId,
          },
          {
            cwd: this.options.cwd,
            args: options.input,
            goal: options.goal ?? definition.description,
            signal: options.signal,
            concurrency: options.concurrency ?? definition.defaults.concurrency,
            maxSubagents: options.maxSubagents ?? definition.defaults.maxSubagents,
            tokenBudget: options.tokenBudget,
            onPhase: (title) => {
              const nextPhaseId = phaseTitleToId.get(title) ?? normalizePhaseId(title);
              if (currentPhaseId && currentPhaseId !== nextPhaseId) {
                void appendEvent('phase_completed', { phaseId: currentPhaseId });
              }
              currentPhaseId = nextPhaseId;
              void appendEvent('phase_started', { phaseId: nextPhaseId, title });
            },
            onLog: (message) => {
              void appendEvent('log_appended', { message });
            },
            onNodeStart: (event) => {
              void appendEvent('node_started', event);
            },
            onNodeEnd: (event) => {
              void appendEvent('node_completed', {
                nodeId: event.nodeId,
                kind: event.kind,
                title: event.title,
                status: event.status,
                resultPreview: previewWorkflowValue(event.result),
                error: event.error,
              });
            },
            onAgentQueued: (event) => {
              const agentId = formatRuntimeAgentId(event.id);
              const subagentSessionKey = this.options.subagentSessionKeyFactory?.({ runId, agentId }) ?? defaultSubagentSessionKey(runId, agentId);
              subagentSessionKeys.set(event.id, subagentSessionKey);
              runtimeAgentStatuses.set(event.id, 'queued');
              const phaseId = event.phase ? (phaseTitleToId.get(event.phase) ?? normalizePhaseId(event.phase)) : currentPhaseId;
              void this.callHooks((hook) => hook.beforeAgent?.({
                runId,
                agentId,
                label: event.label,
                phaseId,
                prompt: event.prompt,
              }));
              void appendEvent('agent_queued', {
                agentId,
                nodeId: event.nodeId,
                label: event.label,
                phaseId,
                prompt: event.prompt,
                sessionKey: subagentSessionKey,
                invocation: event.invocation,
              });
            },
            onAgentStart: (event) => {
              const currentStatus = runtimeAgentStatuses.get(event.id);
              if (currentStatus && currentStatus !== 'queued' && currentStatus !== 'running') {
                return;
              }
              runtimeAgentStatuses.set(event.id, 'running');
              void appendEvent('agent_started', { agentId: formatRuntimeAgentId(event.id), nodeId: event.nodeId });
            },
            onAgentEnd: (event) => {
              const currentStatus = runtimeAgentStatuses.get(event.id);
              if (currentStatus && currentStatus !== 'queued' && currentStatus !== 'running') {
                return;
              }
              const agentId = formatRuntimeAgentId(event.id);
              const completedStatus = normalizeCompletedAgentStatus(event.status);
              runtimeAgentStatuses.set(event.id, completedStatus);
              const resultPreview = previewWorkflowValue(event.result);
              progressRecorders.get(event.id)?.completeOpenSteps(completedStatus === 'done' ? 'done' : 'error');
              progressRecorders.delete(event.id);
              void appendEvent('agent_completed', {
                agentId,
                nodeId: event.nodeId,
                status: completedStatus,
                resultPreview,
                error: completedStatus === 'error' ? 'Subagent failed' : undefined,
              }).then(() => this.callHooks((hook) => hook.afterAgent?.({
                runId,
                agentId,
                status: completedStatus,
                resultPreview,
              })).catch(() => undefined));
            },
            enhanceSubagentRun: (ctx) => {
              const recorder = new AgentProgressRecorder({
                agentId: formatRuntimeAgentId(ctx.id),
                appendEvent,
              });
              progressRecorders.set(ctx.id, recorder);
              const agentId = formatRuntimeAgentId(ctx.id);
              const sessionKey = subagentSessionKeys.get(ctx.id)
                ?? this.options.subagentSessionKeyFactory?.({ runId, agentId })
                ?? defaultSubagentSessionKey(runId, agentId);
              subagentSessionKeys.set(ctx.id, sessionKey);
              return {
                sessionKey,
                sessionMetadata: {
                  parentSessionKey: this.options.parentSessionKey,
                  workflowRunId: runId,
                  workflowDefinitionId: definition.id,
                  workflowAgentId: agentId,
                  workflowNodeId: ctx.nodeId,
                  workflowAgentLabel: ctx.label,
                },
                onProgress: (event) => recorder.onProgress(event),
              };
            },
          },
        ),
        options.timeoutSec ?? definition.defaults.timeoutSec,
      );

      await eventQueue;
      if (currentPhaseId) {
        await appendEvent('phase_completed', { phaseId: currentPhaseId });
      }
      const result = requireWorkflowResultEnvelope(runtimeResult.result);
      assertWorkflowOutput(definition, result.data === undefined ? result.summary : result.data);
      await appendEvent('run_completed', { result });
      await this.callHooks((hook) => hook.afterRun?.({ runId, status: 'succeeded' }));
    } catch (err) {
      await eventQueue;
      const error = toWorkflowRunError(err, options.signal?.aborted === true, options.signal?.reason);
      const terminalAgentStatus: WorkflowAgentStatus = error.code === 'cancelled' || error.code === 'timeout' ? 'skipped' : 'error';
      await this.completeOutstandingRuntimeAgents({
        runId,
        statuses: runtimeAgentStatuses,
        progressRecorders,
        appendEvent,
        status: terminalAgentStatus,
        error: terminalAgentStatus === 'error' ? error.message : undefined,
      });
      if (error.code === 'cancelled') {
        await appendEvent('run_cancelled', { reason: error.message });
        await this.callHooks((hook) => hook.afterRun?.({ runId, status: 'cancelled' }));
      } else {
        await appendEvent('run_failed', { error });
        await this.callHooks((hook) => hook.afterRun?.({ runId, status: 'failed' }));
      }
    }

    const view = await this.options.runStore.readRunView(runId);
    if (!view) {
      throw new Error(`workflow run view was not created for ${runId}`);
    }
    return view;
  }

  async startReplayRun(definition: WorkflowDefinition, options: StartWorkflowReplayRunOptions): Promise<WorkflowRunView> {
    const runId = options.runId ?? randomUUID();
    const createdAtMs = Date.now();
    let eventQueue = Promise.resolve();
    const progressRecorders = new Map<string, AgentProgressRecorder>();

    const run: WorkflowRun = {
      id: runId,
      definitionId: definition.id,
      definitionVersion: definition.version,
      title: `${definition.title} replay`,
      goal: options.goal ?? definition.description,
      input: options.input ?? {},
      status: 'queued',
      source: options.source,
      metadata: options.metadata,
      metrics: {
        agentCount: 0,
        doneAgentCount: 0,
        errorAgentCount: 0,
        skippedAgentCount: 0,
        artifactCount: 0,
      },
      createdAtMs,
    };

    const appendEvent = (type: WorkflowEventType, payload: WorkflowEventPayload, createdAtMsOverride?: number) => {
      eventQueue = eventQueue
        .then(() =>
          this.options.eventStore.append({
            runId,
            type,
            payload,
            createdAtMs: createdAtMsOverride,
          }),
        )
        .then(async (event) => {
          this.options.onEventAppended?.(event);
          const view = await this.options.runStore.rebuildRunView(runId);
          if (view) {
            this.options.onRunViewUpdated?.(view);
          }
        });
      return eventQueue;
    };

    await appendEvent('run_queued', { run }, createdAtMs);
    await this.callHooks((hook) => hook.beforeRun?.({ definition, run }));
    await appendEvent('run_started', { startedAtMs: Date.now() });

    try {
      const result = await withWorkflowTimeout(
        this.runReplayTargets({
          definition,
          runId,
          targets: options.targets,
          signal: options.signal,
          appendEvent,
          progressRecorders,
        }),
        options.timeoutSec ?? definition.defaults.timeoutSec,
      );

      await eventQueue;
      if (result.errors.length > 0) {
        await appendEvent('run_failed', {
          error: {
            code: 'runtime_error',
            message: `Replay completed with ${result.errors.length} failed target${result.errors.length === 1 ? '' : 's'}.`,
            detail: result.errors.join('\n'),
            recoverable: true,
          },
        });
        await this.callHooks((hook) => hook.afterRun?.({ runId, status: 'failed' }));
      } else {
        await appendEvent('run_completed', { result: buildReplayResultEnvelope(options, result.results) });
        await this.callHooks((hook) => hook.afterRun?.({ runId, status: 'succeeded' }));
      }
    } catch (err) {
      await eventQueue;
      const error = toWorkflowRunError(err, options.signal?.aborted === true, options.signal?.reason);
      if (error.code === 'cancelled') {
        await appendEvent('run_cancelled', { reason: error.message });
        await this.callHooks((hook) => hook.afterRun?.({ runId, status: 'cancelled' }));
      } else {
        await appendEvent('run_failed', { error });
        await this.callHooks((hook) => hook.afterRun?.({ runId, status: 'failed' }));
      }
    }

    const view = await this.options.runStore.readRunView(runId);
    if (!view) {
      throw new Error(`workflow replay run view was not created for ${runId}`);
    }
    return view;
  }

  private async runReplayTargets(params: {
    definition: WorkflowDefinition;
    runId: string;
    targets: WorkflowReplayAgentTarget[];
    signal?: AbortSignal;
    appendEvent: AppendWorkflowEvent;
    progressRecorders: Map<string, AgentProgressRecorder>;
  }): Promise<{ results: WorkflowReplayTargetResult[]; errors: string[] }> {
    const results: WorkflowReplayTargetResult[] = [];
    const errors: string[] = [];
    const targetsByPhase = groupReplayTargetsByPhase(params.targets);

    for (const group of targetsByPhase) {
      throwIfSignalAborted(params.signal);
      if (group.phaseId && group.phaseTitle) {
        await params.appendEvent('phase_started', { phaseId: group.phaseId, title: group.phaseTitle });
      }

      const phaseResults = await Promise.all(
        group.targets.map((target) => this.runReplayTarget({ ...params, target })),
      );
      results.push(...phaseResults);
      errors.push(...phaseResults.filter((item) => item.status === 'error').map((item) => `${item.label}: ${item.error ?? 'failed'}`));

      if (group.phaseId && phaseResults.every((item) => item.status === 'done')) {
        await params.appendEvent('phase_completed', { phaseId: group.phaseId });
      }
    }

    return { results, errors };
  }

  private async runReplayTarget(params: {
    definition: WorkflowDefinition;
    runId: string;
    target: WorkflowReplayAgentTarget;
    signal?: AbortSignal;
    appendEvent: AppendWorkflowEvent;
    progressRecorders: Map<string, AgentProgressRecorder>;
  }): Promise<WorkflowReplayTargetResult> {
    const { target } = params;
    const invocation = normalizeReplayInvocation(target);
    const sessionKey = this.options.subagentSessionKeyFactory?.({ runId: params.runId, agentId: target.agentId })
      ?? defaultSubagentSessionKey(params.runId, target.agentId);
    await this.callHooks((hook) => hook.beforeAgent?.({
      runId: params.runId,
      agentId: target.agentId,
      label: invocation.label,
      phaseId: target.phaseId,
      prompt: invocation.prompt,
    }));
    await params.appendEvent('agent_queued', {
      agentId: target.agentId,
      label: invocation.label,
      phaseId: target.phaseId,
      prompt: invocation.prompt,
      sessionKey,
      invocation,
    });
    await params.appendEvent('agent_started', { agentId: target.agentId });

    const recorder = new AgentProgressRecorder({
      agentId: target.agentId,
      appendEvent: params.appendEvent,
    });
    params.progressRecorders.set(target.agentId, recorder);

    try {
      throwIfSignalAborted(params.signal);
      const model = resolveReplayModel(invocation, this.options.resolveModelId);
      const result = await this.options.runner.run<unknown>(invocation.prompt, {
        label: invocation.label,
        schema: invocation.schema as never,
        allowedToolNames: invocation.toolset,
        maxIterations: invocation.maxIterations,
        phase: invocation.phase ?? target.phaseTitle,
        signal: params.signal,
        model,
        sessionKey,
        sessionMetadata: {
          parentSessionKey: this.options.parentSessionKey,
          workflowRunId: params.runId,
          workflowDefinitionId: params.definition.id,
          workflowAgentId: target.agentId,
          workflowAgentLabel: invocation.label,
        },
        onProgress: (event) => recorder.onProgress(event),
      });
      throwIfSignalAborted(params.signal);
      const status = result === null ? 'error' : 'done';
      const resultPreview = previewWorkflowValue(result);
      recorder.completeOpenSteps(status === 'done' ? 'done' : 'error');
      await params.appendEvent('agent_completed', {
        agentId: target.agentId,
        status,
        resultPreview,
        error: status === 'error' ? 'Replay target failed' : undefined,
      });
      await this.callHooks((hook) => hook.afterAgent?.({
        runId: params.runId,
        agentId: target.agentId,
        status,
        resultPreview,
      }));
      return { agentId: target.agentId, label: invocation.label, phaseId: target.phaseId, status, resultPreview };
    } catch (err) {
      if (params.signal?.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      recorder.completeOpenSteps('error');
      await params.appendEvent('agent_completed', {
        agentId: target.agentId,
        status: 'error',
        error: message,
      });
      await this.callHooks((hook) => hook.afterAgent?.({
        runId: params.runId,
        agentId: target.agentId,
        status: 'error',
      }));
      return { agentId: target.agentId, label: invocation.label, phaseId: target.phaseId, status: 'error', error: message };
    } finally {
      params.progressRecorders.delete(target.agentId);
    }
  }

  private async completeOutstandingRuntimeAgents(params: {
    runId: string;
    statuses: Map<number, WorkflowAgentStatus | 'queued'>;
    progressRecorders: Map<number, AgentProgressRecorder>;
    appendEvent: AppendWorkflowEvent;
    status: Extract<WorkflowAgentStatus, 'done' | 'error' | 'skipped'>;
    error?: string;
  }): Promise<void> {
    for (const [id, currentStatus] of params.statuses) {
      if (currentStatus !== 'queued' && currentStatus !== 'running') {
        continue;
      }
      params.statuses.set(id, params.status);
      const recorder = params.progressRecorders.get(id);
      recorder?.completeOpenSteps(params.status === 'done' ? 'done' : 'error');
      params.progressRecorders.delete(id);
      const agentId = formatRuntimeAgentId(id);
      await params.appendEvent('agent_completed', {
        agentId,
        status: params.status,
        error: params.error,
      });
      await this.callHooks((hook) => hook.afterAgent?.({
        runId: params.runId,
        agentId,
        status: params.status,
      }));
    }
  }

  private async callHooks(call: (hook: WorkflowEngineHook) => Promise<void> | void | undefined): Promise<void> {
    for (const hook of this.options.hooks ?? []) {
      try {
        await call(hook);
      } catch {
        // Hooks are extension points; workflow execution remains authoritative.
      }
    }
  }
}

interface WorkflowReplayTargetResult {
  agentId: string;
  label: string;
  phaseId?: string;
  status: 'done' | 'error';
  resultPreview?: string;
  error?: string;
}

class WorkflowEngineRunError extends Error {
  constructor(
    readonly code: WorkflowRunError['code'],
    message: string,
    readonly recoverable: boolean,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'WorkflowEngineRunError';
  }
}

type AppendWorkflowEvent = (
  type: WorkflowEventType,
  payload: WorkflowEventPayload,
  createdAtMsOverride?: number,
) => Promise<void>;

class AgentProgressRecorder {
  private readonly activeToolStepIds = new Map<string, string>();
  private activeIterationStepId: string | null = null;
  private activeThinkingStepId: string | null = null;
  private activeLlmStepId: string | null = null;
  private sequence = 0;

  constructor(
    private readonly options: {
      agentId: string;
      appendEvent: AppendWorkflowEvent;
    },
  ) {}

  onProgress(event: SubagentProgressEvent): void {
    switch (event.type) {
      case 'tool_start':
        this.startToolStep(event);
        return;
      case 'tool_end':
        this.completeToolStep(event);
        return;
      case 'iteration':
        this.replaceSingletonStep('iteration', this.buildIterationLabel(event.count, event.max), 'llm');
        return;
      case 'thinking_delta':
        this.ensureSingletonStep('thinking', 'Thinking', 'thinking');
        return;
      case 'text_delta':
        this.ensureSingletonStep('llm', 'Writing response', 'llm');
        return;
      default:
        return;
    }
  }

  completeOpenSteps(status: 'done' | 'error'): void {
    for (const stepId of this.activeToolStepIds.values()) {
      void this.options.appendEvent('agent_step_completed', {
        agentId: this.options.agentId,
        stepId,
        status,
      });
    }
    this.activeToolStepIds.clear();
    this.completeSingletonStep('iteration', status);
    this.completeSingletonStep('thinking', status);
    this.completeSingletonStep('llm', status);
  }

  private startToolStep(event: Extract<SubagentProgressEvent, { type: 'tool_start' }>): void {
    const stepId = this.nextStepId('tool');
    const { label, detail } = workflowStepLabel(event.toolName, event.args);
    this.activeToolStepIds.set(event.toolCallId, stepId);
    void this.options.appendEvent('agent_step_started', {
      agentId: this.options.agentId,
      stepId,
      label,
      kind: 'tool',
      toolName: event.toolName,
      detail: detail ?? previewWorkflowValue(event.args),
    });
  }

  private completeToolStep(event: Extract<SubagentProgressEvent, { type: 'tool_end' }>): void {
    const stepId = this.activeToolStepIds.get(event.toolCallId);
    if (!stepId) return;
    this.activeToolStepIds.delete(event.toolCallId);
    void this.options.appendEvent('agent_step_completed', {
      agentId: this.options.agentId,
      stepId,
      status: event.isError ? 'error' : 'done',
      resultPreview: event.resultPreview,
      error: event.error,
    });
  }

  private replaceSingletonStep(
    slot: 'iteration' | 'thinking' | 'llm',
    label: string,
    kind: 'tool' | 'llm' | 'thinking',
  ): void {
    this.completeSingletonStep(slot, 'done');
    this.ensureSingletonStep(slot, label, kind);
  }

  private ensureSingletonStep(
    slot: 'iteration' | 'thinking' | 'llm',
    label: string,
    kind: 'tool' | 'llm' | 'thinking',
  ): void {
    if (this.getSingletonStepId(slot)) return;
    const stepId = this.nextStepId(slot);
    this.setSingletonStepId(slot, stepId);
    void this.options.appendEvent('agent_step_started', {
      agentId: this.options.agentId,
      stepId,
      label,
      kind,
    });
  }

  private completeSingletonStep(slot: 'iteration' | 'thinking' | 'llm', status: 'done' | 'error'): void {
    const stepId = this.getSingletonStepId(slot);
    if (!stepId) return;
    this.setSingletonStepId(slot, null);
    void this.options.appendEvent('agent_step_completed', {
      agentId: this.options.agentId,
      stepId,
      status,
    });
  }

  private getSingletonStepId(slot: 'iteration' | 'thinking' | 'llm'): string | null {
    if (slot === 'iteration') return this.activeIterationStepId;
    if (slot === 'thinking') return this.activeThinkingStepId;
    return this.activeLlmStepId;
  }

  private setSingletonStepId(slot: 'iteration' | 'thinking' | 'llm', stepId: string | null): void {
    if (slot === 'iteration') {
      this.activeIterationStepId = stepId;
      return;
    }
    if (slot === 'thinking') {
      this.activeThinkingStepId = stepId;
      return;
    }
    this.activeLlmStepId = stepId;
  }

  private buildIterationLabel(count: number, max: number): string {
    if (max > 0) return `Iteration ${count}/${max}`;
    return `Iteration ${count}`;
  }

  private nextStepId(kind: string): string {
    this.sequence += 1;
    return `${this.options.agentId}-${kind}-${this.sequence}`;
  }
}

function buildPhaseTitleToId(definition: WorkflowDefinition): Map<string, string> {
  const phaseTitleToId = new Map<string, string>();
  for (const phase of definition.phases) {
    phaseTitleToId.set(phase.title, phase.id);
  }
  return phaseTitleToId;
}

function normalizePhaseId(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'phase';
}

function withWorkflowTimeout<T>(promise: Promise<T>, timeoutSec: number | undefined): Promise<T> {
  if (typeof timeoutSec !== 'number' || !Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    return promise;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`workflow timed out after ${timeoutSec}s`));
    }, timeoutSec * 1000);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function throwIfSignalAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  if (reason) throw new Error(String(reason));
  throw new Error('workflow aborted');
}

function groupReplayTargetsByPhase(targets: WorkflowReplayAgentTarget[]): Array<{
  phaseId?: string;
  phaseTitle?: string;
  targets: WorkflowReplayAgentTarget[];
}> {
  const groups: Array<{
    key: string;
    phaseId?: string;
    phaseTitle?: string;
    targets: WorkflowReplayAgentTarget[];
  }> = [];

  for (const target of targets) {
    const key = target.phaseId ?? '';
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = {
        key,
        phaseId: target.phaseId,
        phaseTitle: target.phaseTitle,
        targets: [],
      };
      groups.push(group);
    }
    group.targets.push(target);
  }

  return groups.map(({ key: _key, ...group }) => group);
}

function buildReplayResultEnvelope(
  options: StartWorkflowReplayRunOptions,
  results: WorkflowReplayTargetResult[],
): WorkflowResultEnvelope {
  const done = results.filter((item) => item.status === 'done').length;
  return {
    summary: `Replay completed for ${done}/${results.length} target${results.length === 1 ? '' : 's'}.`,
    data: {
      replay: {
        sourceRunId: options.sourceRunId,
        scope: options.replayScope,
        targets: results,
      },
    },
  };
}

function normalizeReplayInvocation(target: WorkflowReplayAgentTarget): WorkflowAgentInvocationSnapshot {
  return {
    prompt: target.invocation?.prompt ?? target.prompt,
    label: target.invocation?.label ?? target.label,
    phase: target.invocation?.phase ?? target.phaseTitle,
    modelRef: target.invocation?.modelRef,
    resolvedModelRef: target.invocation?.resolvedModelRef,
    schema: target.invocation?.schema,
    toolset: target.invocation?.toolset ? [...target.invocation.toolset] : undefined,
    maxIterations: target.invocation?.maxIterations,
  };
}

function resolveReplayModel(
  invocation: WorkflowAgentInvocationSnapshot,
  resolveModelId: ((modelId: string) => Model<Api>) | undefined,
): Model<Api> | undefined {
  const modelRef = invocation.resolvedModelRef ?? invocation.modelRef;
  if (!modelRef) return undefined;
  if (!resolveModelId) {
    throw new Error(`workflow replay missing resolveModelId; cannot resolve model '${modelRef}'`);
  }
  return resolveModelId(modelRef);
}

function formatRuntimeAgentId(id: number): string {
  return `agent-${id}`;
}

function defaultSubagentSessionKey(runId: string, agentId: string): string {
  return `workflow:${runId}:subagent:${agentId}`;
}

function normalizeCompletedAgentStatus(status: string): 'done' | 'error' | 'skipped' {
  if (status === 'done' || status === 'error' || status === 'skipped') {
    return status;
  }
  return 'error';
}

function previewWorkflowValue(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return truncate(value, 300);
  }
  if (isWorkflowResultEnvelope(value)) {
    return truncate(value.summary, 1_200);
  }
  try {
    return truncate(JSON.stringify(value), 300);
  } catch {
    return truncate(String(value), 300);
  }
}

function truncate(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function assertWorkflowOutput(definition: WorkflowDefinition, value: unknown): void {
  const validation = validateWorkflowJsonSchema(definition.outputSchema, value);
  if (validation.ok) return;
  throw new WorkflowEngineRunError(
    'result_validation_failed',
    validation.message ?? 'Workflow result did not match output schema',
    false,
    JSON.stringify(validation.errors ?? []),
  );
}

function isWorkflowResultEnvelope(value: unknown): value is WorkflowResultEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<WorkflowResultEnvelope>;
  return typeof record.summary === 'string';
}

function requireWorkflowResultEnvelope(value: unknown): WorkflowResultEnvelope {
  if (isWorkflowResultEnvelope(value)) {
    return value;
  }
  throw new WorkflowEngineRunError(
    'result_validation_failed',
    'Workflow output node must return a result envelope with summary.',
    false,
  );
}

function toWorkflowRunError(err: unknown, wasAborted: boolean, abortReason?: unknown): WorkflowRunError {
  if (err instanceof WorkflowEngineRunError) {
    return {
      code: err.code,
      message: err.message,
      detail: err.detail,
      recoverable: err.recoverable,
    };
  }
  const abortMessage = abortReason instanceof Error ? abortReason.message : abortReason ? String(abortReason) : '';
  const message = abortMessage || (err instanceof Error ? err.message : String(err));
  if (/timeout|timed out/i.test(message)) {
    return {
      code: 'timeout',
      message,
      recoverable: true,
    };
  }
  if (wasAborted || /aborted|cancelled/i.test(message)) {
    return {
      code: 'cancelled',
      message: message || 'Workflow run cancelled',
      recoverable: true,
    };
  }
  if (/quota/i.test(message)) {
    return {
      code: 'agent_quota_exceeded',
      message,
      recoverable: true,
    };
  }
  return {
    code: 'runtime_error',
    message,
    recoverable: false,
  };
}
