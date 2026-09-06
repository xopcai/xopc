import { randomUUID } from 'node:crypto';

import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { Config } from '../config/schema.js';
import type { MessageBus } from '../infra/bus/index.js';
import { runXopcEmbeddedTurn } from './embedded/run-turn.js';
import { evictEmbeddedSessionRunner } from './embedded/session-runner.js';
import { InMemoryTranscriptRuntime, type EmbeddedTranscriptRuntime } from './embedded/transcript-runtime.js';
import { createAgentTurnPolicy } from './orchestration/agent-turn-policy.js';
import type { RunVerification } from './coding/run-verification.js';
import { buildSubagentSystemPrompt } from './prompt/subagent-context.js';
import { resolveResponseLanguageForSession } from './prompt/response-language.js';
import type { ToolExecutorConfig } from './tools/executor.js';

export interface BuildChildToolsOptions {
  workspace: string;
  bus: MessageBus;
  model: Model<Api>;
  agentId?: string;
  getConfig: () => Config | undefined;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
}

export interface DelegateChildProgressHooks {
  mode: 'steps' | 'full';
  onProgress: (event: {
    type: 'tool_start' | 'tool_end' | 'iteration' | 'text_delta' | 'thinking_delta';
    toolCallId?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    isError?: boolean;
    count?: number;
    max?: number;
    delta?: string;
  }) => void;
}

export interface DelegateChildHandleOptions {
  workspace: string;
  goal: string;
  context?: string;
  requesterSessionKey?: string;
  allowedToolNames: string[];
  maxIterations: number;
  model: Model<Api>;
  bus: MessageBus;
  agentId?: string;
  getConfig: () => Config | undefined;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  /**
   * Construct the child agent's tool set. Injected by the caller (delegate-tool)
   * so this module does not import `tools/factory.js` (which would form a
   * factory ↔ delegate-tool ↔ child-agent-factory cycle).
   */
  buildChildTools: (opts: BuildChildToolsOptions) => AgentTool<any, any>[];
  /** Optional live progress for workflow subagents. */
  progressHooks?: DelegateChildProgressHooks;
  transcriptRuntime?: EmbeddedTranscriptRuntime;
  sessionKey?: string;
  timeoutMs?: number;
  verifyChanges?: boolean;
}

export interface DelegateChildRunResult {
  summary: string;
  toolIterations: number;
  messages: AgentMessage[];
  status: 'success' | 'failed' | 'cancelled' | 'partial';
  verification?: Awaited<ReturnType<RunVerification['summary']>>;
}

export interface DelegateChildHandle {
  run(): Promise<DelegateChildRunResult>;
  abort(): void;
}

/** Leaf workers use the same execution, transcript and verification harness as foreground turns. */
export function createDelegateChildHandle(options: DelegateChildHandleOptions): DelegateChildHandle {
  const controller = new AbortController();
  const sessionKey = options.sessionKey ?? `agent:subagent:internal:${randomUUID()}`;
  const runtime = options.transcriptRuntime ?? new InMemoryTranscriptRuntime({ runtimeId: sessionKey, cwd: options.workspace });
  let started = false;
  return {
    abort: () => controller.abort(new Error('Sub-agent cancelled')),
    async run() {
      if (started) throw new Error('A child handle can only run once');
      started = true;
      controller.signal.throwIfAborted();
      const allow = new Set(options.allowedToolNames);
      const tools = options.buildChildTools({ workspace: options.workspace, bus: options.bus,
        model: options.model, agentId: options.agentId, getConfig: options.getConfig,
        toolExecutorConfig: options.toolExecutorConfig }).filter(tool => allow.has(tool.name));
      const limit = Math.min(60, Math.max(1, Math.floor(options.maxIterations)));
      let toolIterations = 0, exhausted = false, tokens = 0;
      const policy = createAgentTurnPolicy({ maxTurns: limit + 1, maxToolFailures: 5,
        authorizeToolCall: async () => {
          if (toolIterations >= limit || tokens >= 100_000) {
            exhausted = true;
            return { block: true, terminate: true, reason: 'Sub-agent budget exhausted.' };
          }
          toolIterations++;
          return undefined;
        },
      });
      const baseStop = policy.shouldStopAfterTurn;
      policy.shouldStopAfterTurn = context => {
        const stop = baseStop(context) || tokens >= 100_000;
        if (stop) exhausted = true;
        return stop;
      };
      try {
        const result = await runXopcEmbeddedTurn({
          sessionKey, runId: randomUUID(), workspaceDir: options.workspace,
          userMessage: { role: 'user', content: options.goal, timestamp: Date.now() },
          model: options.model, modelRef: `${options.model.provider}/${options.model.id}`,
          tools, transcriptRuntime: runtime, turnPolicy: policy, abortSignal: controller.signal,
          timeoutMs: Math.min(options.timeoutMs ?? 300_000, 300_000), thinkingLevel: 'medium',
          verifyChanges: options.verifyChanges,
          systemPrompt: buildSubagentSystemPrompt({ goal: options.goal, context: options.context,
            workspace: options.workspace, toolNames: tools.map(tool => tool.name),
            responseLanguage: resolveResponseLanguageForSession(options.getConfig(), options.requesterSessionKey) }),
          onEvent: event => {
            const progress = options.progressHooks;
            if (event.type === 'message_end' && event.message.role === 'assistant') {
              const usage = event.message.usage;
              tokens += usage?.totalTokens ?? ((usage?.input ?? 0) + (usage?.output ?? 0));
            }
            if (event.type === 'tool_execution_start') progress?.onProgress({ type: 'tool_start', toolCallId: event.toolCallId, toolName: event.toolName, args: event.args as Record<string, unknown> });
            if (event.type === 'tool_execution_end') {
              progress?.onProgress({ type: 'tool_end', toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError });
              progress?.onProgress({ type: 'iteration', count: toolIterations, max: limit });
            }
            if (progress?.mode === 'full' && event.type === 'message_update') {
              const delta = event.assistantMessageEvent;
              if (delta?.type === 'text_delta' || delta?.type === 'thinking_delta') progress.onProgress({ type: delta.type, delta: delta.delta });
            }
          },
        });
        const verification = runtime.openSessionManager(options.workspace).getBranch().findLast(entry => entry.type === 'custom' && entry.customType === 'coding_verification');
        const proof = verification?.type === 'custom' ? verification.data as Awaited<ReturnType<RunVerification['summary']>> : undefined;
        const unverified = options.verifyChanges && proof?.changed && (!proof.evidence.some(item => item.kind === 'check' && item.status === 'passed') || proof.evidence.some(item => item.status !== 'passed'));
        return { summary: result.lastAssistantText || result.errorMessage || (exhausted ? 'Sub-agent budget exhausted.' : '(no final response)'),
          toolIterations, messages: await runtime.loadMessages(),
          status: controller.signal.aborted ? 'cancelled' as const : !result.ok ? 'failed' as const : exhausted || unverified ? 'partial' as const : 'success' as const,
          ...(verification?.type === 'custom' ? { verification: verification.data as Awaited<ReturnType<RunVerification['summary']>> } : {}),
        };
      } finally { evictEmbeddedSessionRunner(runtime.runtimeId, 'leaf_worker_complete'); }
    },
  };
}
