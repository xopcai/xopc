import { randomUUID } from 'node:crypto';

import type { WorkflowDefinition } from '../domain/definition.js';
import type { WorkflowEventEnvelope, WorkflowEventPayload, WorkflowEventType } from '../domain/event.js';
import type { WorkflowRun, WorkflowRunError, WorkflowRunMetadata, WorkflowRunSource, WorkflowRunView } from '../domain/run.js';
import type { WorkflowResultEnvelope } from '../domain/result.js';
import { WorkflowEventStore } from '../store/event-store.js';
import { WorkflowRunStore } from '../store/run-store.js';
import { runWorkflowScript } from '../runtime/script-runtime.js';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { WorkflowScriptSubagentRunner } from '../runtime/script-runtime.js';

export interface WorkflowEngineOptions {
  cwd: string;
  eventStore: WorkflowEventStore;
  runStore: WorkflowRunStore;
  runner: WorkflowScriptSubagentRunner;
  onEventAppended?: (event: WorkflowEventEnvelope) => void;
  onRunViewUpdated?: (view: WorkflowRunView) => void;
  resolveModelId?: (modelId: string) => Model<Api>;
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
    await appendEvent('run_started', { startedAtMs: Date.now() });

    try {
      const runtimeResult = await runWorkflowScript<unknown>(
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
            const phaseId = event.phase ? (phaseTitleToId.get(event.phase) ?? normalizePhaseId(event.phase)) : currentPhaseId;
            void appendEvent('agent_queued', {
              agentId: formatRuntimeAgentId(event.id),
              label: event.label,
              phaseId,
              prompt: event.prompt,
            });
          },
          onAgentStart: (event) => {
            void appendEvent('agent_started', { agentId: formatRuntimeAgentId(event.id) });
          },
          onAgentEnd: (event) => {
            const completedStatus = normalizeCompletedAgentStatus(event.status);
            void appendEvent('agent_completed', {
              agentId: formatRuntimeAgentId(event.id),
              status: completedStatus,
              resultPreview: previewWorkflowValue(event.result),
              error: completedStatus === 'error' ? 'Subagent failed' : undefined,
            });
          },
        },
      );

      await eventQueue;
      if (currentPhaseId) {
        await appendEvent('phase_completed', { phaseId: currentPhaseId });
      }
      await appendEvent('run_completed', { result: toWorkflowResultEnvelope(runtimeResult.result) });
    } catch (err) {
      await eventQueue;
      const error = toWorkflowRunError(err, options.signal?.aborted === true);
      if (error.code === 'cancelled') {
        await appendEvent('run_cancelled', { reason: error.message });
      } else {
        await appendEvent('run_failed', { error });
      }
    }

    const view = await this.options.runStore.readRunView(runId);
    if (!view) {
      throw new Error(`workflow run view was not created for ${runId}`);
    }
    return view;
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
