import { randomUUID } from 'node:crypto';

import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type { Config } from '../config/schema.js';
import type { EndpointToolRuntime } from '../endpoint-tools/index.js';
import type { MessageBus } from '../infra/bus/index.js';
import { cloudCreditBudgetStopMessage, isCloudCreditBudgetExhausted } from '../providers/xopc-cloud-credit-budget.js';
import { createLogger } from '../utils/logger.js';
import { runXopcEmbeddedTurn } from './embedded/run-turn.js';
import { evictEmbeddedSessionRunner } from './embedded/session-runner.js';
import { InMemoryTranscriptRuntime, type EmbeddedTranscriptRuntime } from './embedded/transcript-runtime.js';
import { createAgentTurnPolicy } from './orchestration/agent-turn-policy.js';
import { createDelegationBudgetPolicy, resolveDelegationBudget, type DelegationBudgetTier, type DelegationStopReason } from './orchestration/delegation-budget.js';
import type { RunVerification } from './coding/run-verification.js';
import { buildSubagentSystemPrompt } from './prompt/subagent-context.js';
import { resolveResponseLanguageForSession } from './prompt/response-language.js';
import { withDataToolPermissions } from './tools/dataBatch.js';
import { withSearchCache } from './tools/search/cache.js';
import { createResearchCheckpointTool } from './tools/research-checkpoint-tool.js';
import type { ResearchCheckpointSink } from './orchestration/research-checkpoint.js';
import { resolveAgentAbortReason, type AgentAbortReason } from './orchestration/run-termination.js';
import { executeWithTimeout } from './lifecycle/timeout-wrapper.js';
import type { ToolExecutorConfig } from './tools/executor.js';

const log = createLogger('DelegateChild');

export interface BuildChildToolsOptions {
  workspace: string;
  bus: MessageBus;
  model: Model<Api>;
  agentId?: string;
  getConfig: () => Config | undefined;
  toolExecutorConfig?: Partial<ToolExecutorConfig>;
  endpointTools?: EndpointToolRuntime;
  conversationId: string;
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
  isWorkspaceTrusted?: (workspaceDir: string) => boolean | null | undefined;
  /** Host-owned completion signal, e.g. a validated structured result. */
  isComplete?: () => boolean;
  authorizeToolCall?: import('./orchestration/agent-turn-policy.js').AgentTurnPolicyOptions['authorizeToolCall'];
  workspace: string;
  goal: string;
  context?: string;
  requesterConversationId?: string;
  allowedToolNames: string[];
  maxIterations: number;
  budgetTier?: DelegationBudgetTier;
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
  conversationId?: string;
  timeoutMs?: number;
  verifyChanges?: boolean;
  researchCheckpoint?: ResearchCheckpointSink;
}

export interface DelegateChildRunResult {
  summary: string;
  toolIterations: number;
  messages: AgentMessage[];
  status: 'success' | 'failed' | 'cancelled' | 'partial';
  stopReason: DelegationStopReason;
  budget: ReturnType<ReturnType<typeof createDelegationBudgetPolicy>['snapshot']>;
  handoff: { requested: boolean; completed: boolean; summary: string };
  verification?: Awaited<ReturnType<RunVerification['summary']>>;
}

export interface DelegateChildHandle {
  run(): Promise<DelegateChildRunResult>;
  abort(reason?: AgentAbortReason): void;
}

/** Leaf workers use the same execution, transcript and verification harness as foreground turns. */
export function createDelegateChildHandle(options: DelegateChildHandleOptions): DelegateChildHandle {
  const controller = new AbortController();
  const conversationId = options.conversationId ?? randomUUID();
  const runtime = options.transcriptRuntime ?? new InMemoryTranscriptRuntime({ runtimeId: conversationId, cwd: options.workspace });
  let started = false;
  return {
    abort: (reason = 'parent_cancelled') => { controller.abort(Object.assign(new Error(reason), { code: reason })); },
    async run() {
      if (started) throw new Error('A child handle can only run once');
      started = true;
      controller.signal.throwIfAborted();
      const allow = new Set(options.allowedToolNames);
      let tools = options.buildChildTools({ workspace: options.workspace, bus: options.bus,
        model: options.model, agentId: options.agentId, getConfig: options.getConfig,
        toolExecutorConfig: options.toolExecutorConfig,
        conversationId,
      }).filter(tool => allow.has(tool.name)).map(tool => tool.name === 'data_batch' ? {
        ...tool, execute: (id, args, signal, onUpdate) => withDataToolPermissions(allow, () => tool.execute(id, args, signal, onUpdate)),
      } : tool);
      const budget = createDelegationBudgetPolicy(resolveDelegationBudget(options.budgetTier, options.maxIterations, options.timeoutMs), {
        isComplete: options.isComplete, authorizeToolCall: async (context, signal) =>
          options.researchCheckpoint && context.toolCall.name === 'research_checkpoint' ? undefined : options.authorizeToolCall?.(context, signal),
      });
      if (options.researchCheckpoint) {
        const checkpointTool = createResearchCheckpointTool(options.researchCheckpoint);
        tools = [...tools.filter(tool => tool.name !== checkpointTool.name), checkpointTool];
        allow.add(checkpointTool.name);
        // Long reads cannot consume the time reserved for the handoff.
        tools = tools.map(tool => tool.name === checkpointTool.name ? tool : {
          ...tool,
          execute: async (id, args, signal, onUpdate) => {
            const remainingMs = budget.researchRemainingMs();
            if (!remainingMs) throw new Error('Research phase deadline exceeded; save findings and hand off');
            const toolController = new AbortController();
            const forwardAbort = () => toolController.abort(signal?.reason);
            if (signal?.aborted) forwardAbort();
            else signal?.addEventListener('abort', forwardAbort, { once: true });
            try {
              return await executeWithTimeout(() => tool.execute(id, args, toolController.signal, onUpdate), {
                toolName: tool.name, timeoutMs: remainingMs, signal,
                onTimeout: error => { toolController.abort(error); budget.requestHandoff('deadline_exceeded'); },
              });
            } finally { signal?.removeEventListener('abort', forwardAbort); }
          },
        });
      }
      const limit = budget.snapshot().limits.maxToolCalls;
      let handoffCompleted = false;
      const expanded = createAgentTurnPolicy({
        authorizeToolCall: async (context, signal) => {
          const { toolCall } = context;
          const creditStop = cloudCreditBudgetStopMessage();
          if (creditStop) {
            budget.stop('credit_budget', creditStop);
            return { block: true, terminate: true, reason: creditStop };
          }
          if (!allow.has(toolCall.name)) return { block: true, reason: 'Tool is outside the delegated capability set.' };
          return budget.policy.beforeToolCall(context, signal);
        },
      });
      const policy = { ...budget.policy, beforeToolCall: expanded.beforeToolCall,
        beforeModelRequest: (signal?: AbortSignal) => {
          const creditStop = cloudCreditBudgetStopMessage();
          if (creditStop) budget.stop('credit_budget', creditStop);
          if (controller.signal.aborted) budget.stop(resolveAgentAbortReason(controller.signal.reason), 'Sub-agent cancelled');
          return budget.policy.beforeModelRequest?.(signal);
        },
        shouldStopAfterTurn: (context: Parameters<typeof budget.policy.shouldStopAfterTurn>[0]) => {
          const creditStop = cloudCreditBudgetStopMessage();
          if (creditStop) budget.stop('credit_budget', creditStop);
          return budget.policy.shouldStopAfterTurn(context);
        },
      };
      try {
        const params: Parameters<typeof runXopcEmbeddedTurn>[0] = {
          conversationId, runId: randomUUID(), workspaceDir: options.workspace,
          isWorkspaceTrusted: options.isWorkspaceTrusted,
          userMessage: { role: 'user', content: options.goal, timestamp: Date.now() },
          model: options.model, modelRef: `${options.model.provider}/${options.model.id}`,
          tools, transcriptRuntime: runtime, turnPolicy: policy, abortSignal: controller.signal,
          timeoutMs: options.researchCheckpoint ? Math.max(1, budget.researchRemainingMs()) : budget.snapshot().limits.timeoutMs, thinkingLevel: 'medium',
          verifyChanges: options.verifyChanges,
          timeoutExtensionMs: options.researchCheckpoint ? () => budget.snapshot().handoffRequestStarted ? budget.remainingMs() : 0 : undefined,
          systemPrompt: buildSubagentSystemPrompt({ goal: options.goal, context: options.context,
            workspace: options.workspace, toolNames: tools.map(tool => tool.name),
            responseLanguage: resolveResponseLanguageForSession(options.getConfig(), options.requesterConversationId) })
            + (options.researchCheckpoint ? '\n\nUse research_checkpoint after each verified source, before further searching. Address every requested field, including not_disclosed; keep nextSteps current. A final answer alone does not save findings.' : '')
            + `\n\nDelegation budget: ${JSON.stringify(budget.snapshot().limits)}. Tokens are cumulative across requests. Search before reading targeted chunks; continue truncated reads from their returned next position. If asked for a budget handoff, stop tools and summarize evidence, incomplete work and precise next steps.`,
          onEvent: event => {
            const progress = options.progressHooks;
            if (event.type === 'message_end' && event.message.role === 'assistant') {
              const usage = event.message.usage;
              budget.addTokens(usage?.totalTokens ?? ((usage?.input ?? 0) + (usage?.output ?? 0)));
              if (budget.snapshot().handoffRequested && event.message.stopReason === 'stop'
                && event.message.content.some(item => item.type === 'text' && item.text.trim())
                && !event.message.content.some(item => item.type === 'toolCall')) handoffCompleted = true;
            }
            if (event.type === 'tool_execution_start') progress?.onProgress({ type: 'tool_start', toolCallId: event.toolCallId, toolName: event.toolName, args: event.args as Record<string, unknown> });
            if (event.type === 'tool_execution_end') {
              if (options.researchCheckpoint && event.toolName !== 'research_checkpoint') {
                const excerpt = event.result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
                options.researchCheckpoint.recordEvidence({ toolCallId: event.toolCallId, runId: event.runId ?? params.runId, toolName: event.toolName,
                  isError: event.isError, excerpt, recordedAt: Date.now() });
              }
              progress?.onProgress({ type: 'tool_end', toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError });
              progress?.onProgress({ type: 'iteration', count: budget.snapshot().usage.toolCalls, max: limit });
            }
            if (progress?.mode === 'full' && event.type === 'message_update') {
              const delta = event.assistantMessageEvent;
              if (delta?.type === 'text_delta' || delta?.type === 'thinking_delta') progress.onProgress({ type: delta.type, delta: delta.delta });
            }
          },
        };
        const runResearchTurn = (turn: Parameters<typeof runXopcEmbeddedTurn>[0]) => options.researchCheckpoint?.recordSearch
          ? withSearchCache({
            get: key => options.researchCheckpoint!.read().searches?.find(entry => entry.key === key),
            set: entry => options.researchCheckpoint!.recordSearch!(entry),
          }, () => runXopcEmbeddedTurn(turn)) : runXopcEmbeddedTurn(turn);
        let result = await runResearchTurn(params);
        const phaseTimedOut = result.terminationReason === 'deadline_exceeded' || /timed out|deadline expired/i.test(result.errorMessage ?? '');
        // A settled research deadline leaves one fresh, tool-free summary attempt.
        if (options.researchCheckpoint && phaseTimedOut && !/did not settle/i.test(result.errorMessage ?? '')
          && !controller.signal.aborted && budget.remainingMs() > 0 && !budget.snapshot().handoffRequestStarted) {
          budget.requestHandoff('deadline_exceeded');
          result = await runResearchTurn({ ...params, runId: randomUUID(),
            tools: [], timeoutMs: Math.max(1, budget.remainingMs()), timeoutExtensionMs: undefined,
            userMessage: { role: 'user', timestamp: Date.now(), content:
              'Research time expired. Do not perform more research. Summarize saved findings, source evidence and precise unfinished steps. Do not claim completion.\n'
              + JSON.stringify(options.researchCheckpoint.read()) },
          });
        }
        const verification = runtime.openSessionManager(options.workspace).getBranch().findLast(entry => entry.type === 'custom' && entry.customType === 'coding_verification');
        const proof = verification?.type === 'custom' ? verification.data as Awaited<ReturnType<RunVerification['summary']>> : undefined;
        const unverified = options.verifyChanges && proof?.changed && (!proof.evidence.some(item => item.kind === 'check' && item.status === 'passed') || proof.evidence.some(item => item.status !== 'passed'));
        const snapshot = budget.snapshot();
        const stopReason: DelegationStopReason = controller.signal.aborted ? resolveAgentAbortReason(controller.signal.reason)
          : isCloudCreditBudgetExhausted(result.errorMessage ?? '') ? 'credit_budget'
          : /timed out|did not settle|deadline expired/i.test(result.errorMessage ?? '') ? 'deadline_exceeded'
          : (snapshot.stopReason === 'timeout' ? 'deadline_exceeded' : snapshot.stopReason) ?? (!result.ok ? result.terminationReason ?? 'runtime_error' : unverified ? 'verification' : 'completed');
        const budgetHandoff = result.stopReason === 'policy_limit'
          && ['tool_calls', 'total_tokens', 'model_turns', 'tool_failures', 'timeout', 'deadline_exceeded'].includes(stopReason)
          && (!snapshot.handoffRequested || handoffCompleted);
        const messages = await runtime.loadMessages();
        const evidence = stopReason !== 'completed' && !handoffCompleted
          ? messages.filter(message => message.role === 'toolResult').slice(-3).map(message => {
            if (message.role !== 'toolResult') return '';
            const text = message.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
            return `${message.toolName}: ${text.slice(0, 1500)}`;
          }).join('\n\n') : '';
        const summary = [result.lastAssistantText, result.errorMessage, snapshot.stopMessage,
          evidence ? `Recent tool evidence (bounded excerpts; not a completion claim):\n${evidence}` : '',
          stopReason !== 'completed' ? `Delegation stopped: ${stopReason}. Treat this as a partial handoff; validate completion before continuing.` : '',
        ].filter(Boolean).join('\n\n') || '(no final response)';
        log.info({ conversationId, stopReason, budgetTier: snapshot.tier, usage: snapshot.usage,
          limits: snapshot.limits, handoffRequested: snapshot.handoffRequested, handoffCompleted }, `Delegation stopped: ${stopReason}`);
        return { summary, stopReason, budget: { ...snapshot, stopReason }, handoff: { requested: snapshot.handoffRequested, completed: handoffCompleted, summary },
          toolIterations: snapshot.usage.toolCalls, messages,
          status: ['user_cancelled', 'parent_cancelled'].includes(stopReason) ? 'cancelled' as const
            : options.researchCheckpoint && stopReason === 'deadline_exceeded' && !/did not settle/i.test(result.errorMessage ?? '') ? 'partial' as const
            : !result.ok && !budgetHandoff ? 'failed' as const : stopReason !== 'completed' ? 'partial' as const : 'success' as const,
          ...(verification?.type === 'custom' ? { verification: verification.data as Awaited<ReturnType<RunVerification['summary']>> } : {}),
        };
      } finally { evictEmbeddedSessionRunner(runtime.runtimeId, 'leaf_worker_complete'); }
    },
  };
}
