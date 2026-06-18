import { randomUUID } from 'node:crypto';

import type { WorkflowDefinition } from '../domain/definition.js';
import type { WorkflowEventEnvelope, WorkflowEventPayload, WorkflowEventType } from '../domain/event.js';
import type { WorkflowRun, WorkflowRunError, WorkflowRunMetadata, WorkflowRunSource, WorkflowRunView } from '../domain/run.js';
import type { WorkflowResultEnvelope } from '../domain/result.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { WorkflowRunStore } from '../store/run-store.js';
import { createScriptWorkflowRuntime } from '../runtime/script-workflow-runtime.js';
import type { WorkflowRuntime } from '../runtime/workflow-runtime-port.js';
import type { Api, Model } from '@earendil-works/pi-ai';

import { workflowStepLabel } from '../../agent/workflow/step-labels.js';
import type { SubagentProgressEvent } from '../../agent/workflow/types.js';
import type { WorkflowScriptSubagentRunner } from '../runtime/script-runtime.js';

export interface WorkflowEngineOptions {
  cwd: string;
  eventStore: WorkflowEventStore;
  runStore: WorkflowRunStore;
  runner: WorkflowScriptSubagentRunner;
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
      const runtime = this.options.runtime ?? createScriptWorkflowRuntime();
      const runtimeResult = await runtime.run<unknown>(
        definition.runtime.source,
        {
          runner: this.options.runner,
          resolveModelId: this.options.resolveModelId,
        },
        {
          cwd: this.options.cwd,
          args: options.input,
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
          onAgentQueued: (event) => {
            const agentId = formatRuntimeAgentId(event.id);
            const subagentSessionKey = this.options.subagentSessionKeyFactory?.({ runId, agentId }) ?? defaultSubagentSessionKey(runId, agentId);
            subagentSessionKeys.set(event.id, subagentSessionKey);
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
              label: event.label,
              phaseId,
              prompt: event.prompt,
              sessionKey: subagentSessionKey,
            });
          },
          onAgentStart: (event) => {
            void appendEvent('agent_started', { agentId: formatRuntimeAgentId(event.id) });
          },
          onAgentEnd: (event) => {
            const agentId = formatRuntimeAgentId(event.id);
            const completedStatus = normalizeCompletedAgentStatus(event.status);
            const resultPreview = previewWorkflowValue(event.result);
            progressRecorders.get(event.id)?.completeOpenSteps(completedStatus === 'done' ? 'done' : 'error');
            progressRecorders.delete(event.id);
            void appendEvent('agent_completed', {
              agentId,
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
                workflowAgentLabel: ctx.label,
              },
              onProgress: (event) => recorder.onProgress(event),
            };
          },
        },
      );

      await eventQueue;
      if (currentPhaseId) {
        await appendEvent('phase_completed', { phaseId: currentPhaseId });
      }
      await appendEvent('run_completed', { result: toWorkflowResultEnvelope(runtimeResult.result) });
      await this.callHooks((hook) => hook.afterRun?.({ runId, status: 'succeeded' }));
    } catch (err) {
      await eventQueue;
      const error = toWorkflowRunError(err, options.signal?.aborted === true);
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

function toWorkflowResultEnvelope(value: unknown): WorkflowResultEnvelope {
  if (isWorkflowResultEnvelope(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return {
      summary: truncate(value, 800),
      sections: [{ kind: 'text', title: 'Result', content: value }],
      raw: value,
    };
  }
  return {
    summary: 'Workflow completed.',
    sections: [{ kind: 'json', title: 'Result', value }],
    raw: value,
  };
}

function isWorkflowResultEnvelope(value: unknown): value is WorkflowResultEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<WorkflowResultEnvelope>;
  return typeof record.summary === 'string' && Array.isArray(record.sections);
}

function toWorkflowRunError(err: unknown, wasAborted: boolean): WorkflowRunError {
  const message = err instanceof Error ? err.message : String(err);
  if (wasAborted || /aborted|cancelled/i.test(message)) {
    return {
      code: 'cancelled',
      message: message || 'Workflow run cancelled',
      recoverable: true,
    };
  }
  if (/timeout/i.test(message)) {
    return {
      code: 'timeout',
      message,
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
