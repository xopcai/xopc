/**
 * Adapter: spawns one isolated child agent per `agent()` call from a workflow.
 *
 * Wraps the existing `createDelegateChildHandle` so the workflow runtime stays
 * decoupled from the LLM stack (it sees only the `SubagentRunner` interface).
 *
 * Key behaviour:
 * - When `opts.schema` is provided, we inject `structured_output` into the child
 *   tool set and unwrap the captured value on success. If the subagent finishes
 *   without ever calling `structured_output`, we treat it as failure (`null`).
 * - Failures and aborts resolve to `null`. The workflow runtime continues — this
 *   matches the pi-dynamic-workflows contract and keeps fan-out pipelines robust.
 * - We do NOT mutate `createDelegateChildHandle` — we just leverage its
 *   `buildChildTools` injection point.
 */

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { Config } from '../../config/schema.js';
import type { MessageBus } from '../../infra/bus/index.js';
import type { SessionStore } from '../../session/store.js';
import { emitSessionTranscriptUpdate } from '../../session/transcript-events.js';
import { createLogger } from '../../utils/logger.js';

import {
  type BuildChildToolsOptions,
  createDelegateChildHandle,
  type DelegateChildHandleOptions,
} from '../child-agent-factory.js';
import {
  DEFAULT_DELEGATE_TOOLS,
  DELEGATE_BLOCKED_TOOLS,
} from '../tools/delegate-tool.js';
import type { ToolExecutorConfig } from '../tools/executor.js';

import {
  createStructuredOutputTool,
  STRUCTURED_OUTPUT_TOOL_NAME,
  type StructuredOutputCapture,
} from './structured-output-tool.js';
import type { SubagentRunOptions, SubagentRunner, SubagentProgressEvent } from './types.js';

const log = createLogger('Agent:WorkflowSubagent');

const DEFAULT_MAX_ITERATIONS = 30;

export interface DelegateSubagentRunnerDeps {
  workspace: string;
  bus: MessageBus;
  /** Resolves the default subagent model (typically the parent agent's primary model). */
  getDefaultModel: () => Model<Api>;
  getConfig: () => Config | undefined;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  sessionStore?: SessionStore;
  /**
   * Provided by the workflow tool from `AgentToolsFactory` — mirrors how
   * `delegate-tool` is wired (avoids importing `tools/factory.ts` here and
   * breaking the existing factory ↔ delegate-tool ↔ child-agent-factory
   * dependency contract).
   */
  buildChildTools: (opts: BuildChildToolsOptions) => AgentTool<any, any>[];
}

export class DelegateSubagentRunner implements SubagentRunner {
  constructor(private readonly deps: DelegateSubagentRunnerDeps) {}

  async run<T = string>(prompt: string, opts: SubagentRunOptions<T>): Promise<T | null> {
    if (opts.signal?.aborted) return null;

    const capture: StructuredOutputCapture<T> = { called: false, value: undefined };
    const wantStructured = Boolean(opts.schema);

    const allowed = resolveAllowedToolNames(opts.allowedToolNames, wantStructured);
    const model = opts.model ?? safeResolveDefaultModel(this.deps.getDefaultModel);
    if (!model) {
      log.warn({ label: opts.label }, 'subagent run skipped: no primary model resolved');
      return null;
    }

    const fullPrompt = buildPrompt(prompt, opts, wantStructured);
    const streamMode = resolveSubagentStreamMode(this.deps.getConfig);

    let transcriptPersistQueue: Promise<void> = Promise.resolve();
    const persistTranscriptSnapshot = opts.sessionKey && this.deps.sessionStore
      ? (messages: Parameters<SessionStore['saveMessages']>[1]) => {
          const store = this.deps.sessionStore;
          const key = opts.sessionKey;
          if (!store || !key) return;
          const snapshot = cloneAgentMessages(messages);
          transcriptPersistQueue = transcriptPersistQueue
            .then(async () => {
              await store.saveMessages(key, snapshot);
              emitSessionTranscriptUpdate({ sessionKey: key });
            })
            .catch((err) => {
              const msg = err instanceof Error ? err.message : String(err);
              log.warn(
                { err, sessionKey: key, errorMessage: msg },
                `Failed to persist workflow subagent transcript snapshot: ${msg}`,
              );
            });
        }
      : undefined;

    const childOptions: DelegateChildHandleOptions = {
      workspace: this.deps.workspace,
      goal: fullPrompt,
      allowedToolNames: allowed,
      maxIterations: opts.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      model,
      bus: this.deps.bus,
      getConfig: this.deps.getConfig,
      toolExecutorConfig: this.deps.toolExecutorConfig,
      buildChildTools: (childOpts) => {
        const base = this.deps.buildChildTools(childOpts);
        if (!wantStructured || !opts.schema) return base;
        // Replace any existing tool with the same name so the per-run capture wins.
        const filtered = base.filter((t) => t.name !== STRUCTURED_OUTPUT_TOOL_NAME);
        return [
          ...filtered,
          createStructuredOutputTool({ schema: opts.schema, capture }) as unknown as AgentTool<any, any>,
        ];
      },
      progressHooks:
        opts.onProgress && streamMode !== 'off'
          ? {
              mode: streamMode === 'full' ? 'full' : 'steps',
              onProgress: (event) => {
                opts.onProgress?.(mapChildProgressEvent(event));
              },
            }
          : undefined,
      onTranscriptSnapshot: persistTranscriptSnapshot,
    };

    if (opts.sessionKey && opts.sessionMetadata && this.deps.sessionStore) {
      await this.preparePersistentSubagentSession(opts.sessionKey, opts.sessionMetadata);
    }

    const handle = createDelegateChildHandle(childOptions);
    const onAbort = () => handle.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const { summary, messages } = await handle.run();
      await transcriptPersistQueue;
      if (opts.sessionKey && this.deps.sessionStore) {
        await this.deps.sessionStore.saveMessages(opts.sessionKey, messages);
        emitSessionTranscriptUpdate({ sessionKey: opts.sessionKey });
      }
      if (opts.signal?.aborted) return null;

      if (wantStructured) {
        if (!capture.called) {
          log.warn({ label: opts.label }, 'subagent finished without calling structured_output');
          return null;
        }
        return capture.value as T;
      }
      return summary as unknown as T;
    } catch (e) {
      if (opts.rethrow) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      log.warn({ err: e, label: opts.label, errorMessage: msg }, `subagent run failed: ${msg}`);
      return null;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async preparePersistentSubagentSession(
    sessionKey: string,
    metadata: NonNullable<SubagentRunOptions['sessionMetadata']>,
  ): Promise<void> {
    const store = this.deps.sessionStore;
    if (!store) return;
    await store.resolveTranscriptPath(sessionKey, {
      metadata: {
        sessionType: 'workflow-subagent',
        hiddenFromSessionList: true,
        parentSessionKey: metadata.parentSessionKey,
        workflowRunId: metadata.workflowRunId,
        workflowDefinitionId: metadata.workflowDefinitionId,
        workflowAgentId: metadata.workflowAgentId,
        workflowAgentLabel: metadata.workflowAgentLabel,
        sourceChannel: 'workflow',
        sourceChatId: metadata.workflowRunId,
        routing: {
          agentId: metadata.workflowAgentId || 'main',
          source: 'workflow',
          accountId: 'default',
          peerKind: 'subagent',
          peerId: metadata.workflowRunId,
        },
      },
    });
    await store.updateMetadata(sessionKey, {
      sessionType: 'workflow-subagent',
      hiddenFromSessionList: true,
      parentSessionKey: metadata.parentSessionKey,
      workflowRunId: metadata.workflowRunId,
      workflowDefinitionId: metadata.workflowDefinitionId,
      workflowAgentId: metadata.workflowAgentId,
      workflowAgentLabel: metadata.workflowAgentLabel,
      name: metadata.workflowAgentLabel,
      tags: ['workflow-subagent', metadata.workflowDefinitionId],
    });
  }
}

function cloneAgentMessages(messages: Parameters<SessionStore['saveMessages']>[1]): Parameters<SessionStore['saveMessages']>[1] {
  return messages.map((message) => structuredClone(message));
}

function resolveAllowedToolNames(
  requested: string[] | undefined,
  wantStructured: boolean,
): string[] {
  const base = requested && requested.length > 0 ? requested : [...DEFAULT_DELEGATE_TOOLS];
  const filtered = base
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0)
    .filter((s) => !DELEGATE_BLOCKED_TOOLS.has(s));
  if (wantStructured && !filtered.includes(STRUCTURED_OUTPUT_TOOL_NAME)) {
    filtered.push(STRUCTURED_OUTPUT_TOOL_NAME);
  }
  return [...new Set(filtered)];
}

function buildPrompt(prompt: string, opts: SubagentRunOptions<unknown>, structured: boolean): string {
  const parts: string[] = [];
  if (opts.instructions?.trim()) parts.push(opts.instructions.trim());
  if (opts.label) parts.push(`Task label: ${opts.label}`);
  if (opts.phase) parts.push(`Workflow phase: ${opts.phase}`);
  parts.push(prompt);
  if (structured) {
    parts.push(
      [
        'Final output contract:',
        '- Your final action MUST be a structured_output tool call.',
        '- The structured_output arguments are the return value of this subagent.',
        '- Do not emit a prose final answer instead of structured_output.',
        '- If you need to inspect files or run commands first, do so, then call structured_output exactly once.',
      ].join('\n'),
    );
  }
  return parts.join('\n\n');
}

function safeResolveDefaultModel(get: () => Model<Api>): Model<Api> | null {
  try {
    return get();
  } catch (e) {
    log.warn({ err: e }, 'failed to resolve default subagent model');
    return null;
  }
}

function resolveSubagentStreamMode(
  getConfig: () => Config | undefined,
): 'off' | 'steps' | 'full' {
  const mode = getConfig()?.agents?.defaults?.workflow?.subagentStream;
  if (mode === 'off' || mode === 'steps' || mode === 'full') return mode;
  return 'steps';
}

function mapChildProgressEvent(event: {
  type: 'tool_start' | 'tool_end' | 'iteration' | 'text_delta' | 'thinking_delta';
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  isError?: boolean;
  resultPreview?: string;
  error?: string;
  count?: number;
  max?: number;
  delta?: string;
}): SubagentProgressEvent {
  switch (event.type) {
    case 'tool_start':
      return {
        type: 'tool_start',
        toolCallId: event.toolCallId ?? '',
        toolName: event.toolName ?? 'tool',
        args: event.args ?? {},
      };
    case 'tool_end':
      return {
        type: 'tool_end',
        toolCallId: event.toolCallId ?? '',
        toolName: event.toolName ?? 'tool',
        isError: Boolean(event.isError),
        resultPreview: event.resultPreview,
        error: event.error,
      };
    case 'iteration':
      return {
        type: 'iteration',
        count: event.count ?? 0,
        max: event.max ?? 0,
      };
    case 'text_delta':
      return { type: 'text_delta', delta: event.delta ?? '' };
    case 'thinking_delta':
      return { type: 'thinking_delta', delta: event.delta ?? '' };
    default:
      return { type: 'text_delta', delta: '' };
  }
}
