import { getConnectionResumeInput, isConnectionSuspended } from '../../storage/sqlite/connection-wait-repository.js';
import { isComputerControlActive, stopComputerControl } from '../../computer/control-guard.js';
import {
  getClarificationResumeInput,
  getClarification,
  isClarificationSuspended,
} from '../../storage/sqlite/clarification-wait-repository.js';
import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { Model, Api } from '@earendil-works/pi-ai';

import { createLogger } from '../../utils/logger.js';
import { acquireEmbeddedRunLease, EmbeddedRunConflictError } from './runs.js';
import { subscribeEmbeddedSessionEvents, lastAssistantPlainText } from './subscribe-session.js';
import type { RunXopcEmbeddedTurnParams, RunXopcEmbeddedTurnResult } from './types.js';
import {
  getAssistantTurnErrorMessage,
  isAssistantTurnAborted,
  isAssistantTurnFailed,
  maybeRetryTurnAfterTransientLlmFailure,
  stripTrailingErrorAssistantMessages,
} from '../orchestration/llm-turn-retry.js';
import {
  isAgentTurnUnsettledError,
  runAgentTurnWithTimeout,
  resolveAgentTurnTimeoutMs,
} from '../orchestration/run-agent-turn-with-timeout.js';
import { detectToolLoops, type RecentToolCall } from '../orchestration/loop-guard.js';
import { tryApplySessionTranscriptHygiene } from '../transcript/transcript-hygiene.js';
import { acquireEmbeddedSessionRunner, evictEmbeddedSessionRunner } from './session-runner.js';
import { createSqliteTranscriptRuntime } from './transcript-runtime.js';
import { wrapStreamFnForXopcExtensions } from './xopc-stream-bridge.js';
import { projectContextForModel } from '../memory/context-budget.js';
import { assessContext, recoverContext, ContextRecoveryError } from '../memory/context-recovery.js';
import { resolveCompactionPolicy, type ResolvedCompactionPolicy } from '../memory/compaction-policy.js';
import { isContextOverflowError } from '../orchestration/context-overflow.js';
import {
  buildPromptCacheSnapshot,
  observePromptCacheSnapshot,
} from '../../providers/prompt-cache-observability.js';
import {
  isPromptCacheExpired,
  recordPromptCacheTouch,
} from '../../providers/prompt-cache-lifecycle.js';
import { resolvePromptCachePolicy } from '../../providers/prompt-cache-plan.js';
import { markTurnToolResult } from '../memory/turn-provenance.js';
import { RepositoryInstructions } from '../coding/repository-instructions.js';
import { RunVerification } from '../coding/run-verification.js';

const log = createLogger('EmbeddedRun');
const LOG_PREVIEW_MAX_CHARS = 300;

function truncateForLog(value: string, maxChars = LOG_PREVIEW_MAX_CHARS): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((block): block is { type: string; text: string } => {
      return !!block && typeof block === 'object' && (block as { type?: string }).type === 'text';
    })
    .map((block) => block.text)
    .join('');
}

function extractRecentToolCalls(messages: readonly { role?: string; content?: unknown }[]): RecentToolCall[] {
  const lastUser = messages.findLastIndex(message => message.role === 'user');
  messages = messages.slice(Math.max(0, lastUser));
  const resultByToolCallId = new Map<string, string>();
  const revisionByToolCallId = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'toolResult') continue;
    const toolCallId = (message as { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId !== 'string' || !toolCallId) continue;
    resultByToolCallId.set(toolCallId, extractTextFromContent(message.content));
    const revision = (message as { details?: { workspaceRevision?: unknown } }).details?.workspaceRevision;
    if (typeof revision === 'string') revisionByToolCallId.set(toolCallId, revision);
  }

  const calls: RecentToolCall[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'toolCall') {
        const toolCall = block as { id?: string; name: string; arguments: unknown };
        calls.push({
          name: toolCall.name,
          params: toolCall.arguments,
          ...(toolCall.id && revisionByToolCallId.has(toolCall.id) ? { revision: revisionByToolCallId.get(toolCall.id) } : {}),
          ...(toolCall.id && resultByToolCallId.has(toolCall.id)
            ? { resultPreview: resultByToolCallId.get(toolCall.id) }
            : {}),
        });
      }
    }
  }
  return calls.slice(-12);
}

function getLastUserMessagePreview(messages: readonly { role?: string; content?: unknown }[]): string | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (message?.role !== 'user') {
      continue;
    }
    const text = extractTextFromContent(message.content).trim();
    return text ? truncateForLog(text) : undefined;
  }
  return undefined;
}

function requireEmbeddedModel(model: Model<Api> | undefined, modelRef: string): Model<Api> {
  if (!model?.id || !model?.provider) {
    throw new Error(`Invalid model for embedded run: ${modelRef}`);
  }
  return model;
}

function userMessageToPromptText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: 'text'; text: string } => {
        return !!block && typeof block === 'object' && (block as { type?: string }).type === 'text';
      })
      .map((block) => block.text)
      .join('');
  }
  return '';
}

async function maybeRecoverContextOverflow(params: {
  agent: Agent;
  model: Model<Api>;
  conversationId: string;
  transcriptRuntime: NonNullable<RunXopcEmbeddedTurnParams['transcriptRuntime']>;
  abortSignal?: AbortSignal;
  onEvent?: RunXopcEmbeddedTurnParams['onEvent'];
  policy: ResolvedCompactionPolicy;
}): Promise<boolean> {
  const errorMessage = getAssistantTurnErrorMessage(params.agent);
  if (!errorMessage || !isContextOverflowError(errorMessage)) return false;

  const messages = stripTrailingErrorAssistantMessages(params.agent.state.messages);
  log.warn(
    { conversationId: params.conversationId, errorMessage, messageCount: messages.length },
    'Provider rejected the context window; compacting and retrying the same turn',
  );
  params.onEvent?.({ type: 'compaction', status: 'started' });

  const summaryModel = params.policy.model
    ? (await import('../../providers/index.js')).resolveModel(params.policy.model) as Model<Api>
    : params.model;
  const recovered = await recoverContext({
    conversationId: params.conversationId,
    transcript: params.transcriptRuntime,
    policy: params.policy,
    budget: {
      contextWindow: params.model.contextWindow ?? 128_000,
      systemPrompt: params.agent.state.systemPrompt,
      tools: params.agent.state.tools,
      reserveTokens: params.policy.reserveTokens,
      triggerThreshold: params.policy.triggerThreshold,
      minToolResultKeepChars: params.policy.minToolResultKeepChars,
    },
    summaryModel,
    fallbackModels: summaryModel === params.model ? [] : [params.model],
    signal: params.abortSignal,
    providerRejected: true,
    preserveLastUser: true,
  }).catch((error: unknown) => {
    params.onEvent?.({ type: 'compaction', status: 'skipped' });
    throw error;
  });
  params.agent.state.messages = stripTrailingErrorAssistantMessages(recovered.messages);
  params.abortSignal?.throwIfAborted();
  params.onEvent?.({ type: 'compaction', status: 'completed',
    tokensBefore: recovered.result?.tokensBefore, tokensAfter: recovered.result?.tokensAfter,
    summary: recovered.result?.summary.slice(0, 200) });
  await params.agent.continue();
  await params.agent.waitForIdle();
  return true;
}

export async function runXopcEmbeddedTurn(params: RunXopcEmbeddedTurnParams): Promise<RunXopcEmbeddedTurnResult> {
  const {
    conversationId,
    runId,
    userMessage,
    model,
    tools,
    systemPrompt,
    thinkingLevel,
    workspaceDir,
    sessionStore,
    onEvent,
  } = params;

  const timeoutMs = params.timeoutMs || resolveAgentTurnTimeoutMs();
  const resolvedModel = requireEmbeddedModel(model, params.modelRef);
  const promptCachePolicy = resolvePromptCachePolicy(params.promptCachePolicy);
  const compactionPolicy = params.compactionPolicy ?? resolveCompactionPolicy();
  const transcriptRuntime = params.transcriptRuntime ?? (
    sessionStore
      ? await createSqliteTranscriptRuntime({ conversationId, sessionStore })
      : undefined
  );
  if (!transcriptRuntime) {
    throw new Error('Embedded run requires a transcript runtime');
  }

  let runner: Awaited<ReturnType<typeof acquireEmbeddedSessionRunner>> | undefined;
  let unsubscribe: (() => void) | undefined;
  let quarantineRunner = false;
  let runLease: ReturnType<typeof acquireEmbeddedRunLease> | undefined;

  try {
    runLease = acquireEmbeddedRunLease({
      conversationId,
      transcriptId: transcriptRuntime.transcriptId,
      runId,
    });
    const instructions = await RepositoryInstructions.open(workspaceDir);
    const rootInstructions = await instructions.load('.', true);
    runner = await acquireEmbeddedSessionRunner({
      runtimeId: transcriptRuntime.runtimeId,
      transcriptId: transcriptRuntime.transcriptId,
      workspaceDir,
      model: resolvedModel,
      modelRef: params.modelRef,
      tools,
      systemPrompt: [systemPrompt, rootInstructions].filter(Boolean).join('\n\n'),
      thinkingLevel: thinkingLevel ?? 'medium',
      transcriptRuntime,
    });

    const { session, reused } = runner;
    await runLease.attach(session, async () => session.abort());
    const runAbortSignal = params.abortSignal
      ? AbortSignal.any([runLease.signal, params.abortSignal])
      : runLease.signal;
    if (runAbortSignal.aborted) {
      await session.abort();
      return { ok: false, errorMessage: 'aborted' };
    }
    session.agent.state.messages = stripTrailingErrorAssistantMessages(await transcriptRuntime.loadMessages());
    runner.piSm.setActiveTurnId?.(runId);

    const streamFnWithXopcExtensions = wrapStreamFnForXopcExtensions(
      session.agent.streamFunction,
      params.promptCachePolicy,
    );
    const loggingStreamFn: typeof session.agent.streamFunction = (streamModel, context, options) => {
      instructions.acknowledge();
      const sourceMessages = [...context.messages];
      const hygienicMessages = tryApplySessionTranscriptHygiene(sourceMessages, streamModel) as typeof sourceMessages;
      const recentToolCalls = extractRecentToolCalls(hygienicMessages);
      const loopGuard = detectToolLoops(recentToolCalls);

      let effectiveContext: typeof context = { ...context, messages: hygienicMessages };
      if (loopGuard.injection) {
        effectiveContext = { ...effectiveContext, messages: [...hygienicMessages,
          { role: 'user' as const, content: loopGuard.injection, timestamp: Date.now() }] };
      }

      const projection = projectContextForModel({
        messages: effectiveContext.messages as AgentMessage[],
        contextWindow: streamModel.contextWindow ?? 128_000,
        systemPrompt: effectiveContext.systemPrompt,
        tools: effectiveContext.tools,
        reserveTokens: compactionPolicy.reserveTokens,
        minToolResultKeepChars: compactionPolicy.minToolResultKeepChars,
        canCompact: false,
        reason: isPromptCacheExpired(conversationId, streamModel, promptCachePolicy)
          ? 'cache_expired'
          : 'normal',
      });
      if (projection.prunedToolResults > 0 || projection.prunedImages > 0) {
        effectiveContext = {
          ...effectiveContext,
          messages: projection.messages as typeof effectiveContext.messages,
        };
        log.warn(
          {
            conversationId,
            runId,
            prunedToolResults: projection.prunedToolResults,
            prunedImages: projection.prunedImages,
            estimatedTokens: projection.evaluation.estimatedTokens,
            hardLimitTokens: projection.evaluation.hardLimitTokens,
          },
          'Projected a smaller provider context',
        );
      }

      const assessed = assessContext({
        messages: effectiveContext.messages as AgentMessage[],
        contextWindow: streamModel.contextWindow ?? 128_000,
        systemPrompt: effectiveContext.systemPrompt, tools: effectiveContext.tools,
        reserveTokens: compactionPolicy.reserveTokens,
        minToolResultKeepChars: compactionPolicy.minToolResultKeepChars,
      }, compactionPolicy.maxActiveTranscriptBytes);
      if (!assessed.fits) {
        throw new ContextRecoveryError('unrecoverable',
          `Context budget exceeded before provider request (${assessed.evaluation.estimatedTokens}/${assessed.evaluation.hardLimitTokens} tokens)`);
      }
      effectiveContext = { ...effectiveContext, messages: assessed.messages as typeof effectiveContext.messages };

      const promptCacheSnapshot = buildPromptCacheSnapshot({
        model: streamModel,
        systemPrompt: effectiveContext.systemPrompt,
        tools: effectiveContext.tools,
        reasoning: options?.reasoning,
      });
      const promptCacheChanges = observePromptCacheSnapshot(conversationId, promptCacheSnapshot);

      log.debug(
        {
          conversationId,
          runId,
          reusedRunner: reused,
          modelRef: `${streamModel.provider}/${streamModel.id}`,
          systemPromptLength: effectiveContext.systemPrompt?.length ?? 0,
          messageCount: effectiveContext.messages.length,
          transcriptRepaired: hygienicMessages !== sourceMessages,
          toolCount: effectiveContext.tools?.length ?? 0,
          lastUserMessagePreview: getLastUserMessagePreview(effectiveContext.messages),
          loopWarningInjected: !!loopGuard.injection,
          promptCache: promptCacheSnapshot,
          promptCacheChanges,
          ...(process.env.XOPC_LOG_LLM_PAYLOAD === 'true'
            ? {
                effectiveContext: {
                  systemPrompt: effectiveContext.systemPrompt,
                  messages: effectiveContext.messages,
                  tools: effectiveContext.tools,
                },
              }
            : {}),
        },
        'Sending messages to AI',
      );
      return streamFnWithXopcExtensions(streamModel, effectiveContext, {
        ...options,
      });
    };
    session.agent.streamFunction = loggingStreamFn;
    const verification = await RunVerification.open(workspaceDir);
    const checkpoints = runner.piSm.getBranch?.() ?? [];
    const lastStart = checkpoints.findLastIndex(entry => entry.type === 'custom' && entry.customType === 'coding_run_started');
    const lastSummary = checkpoints.findLastIndex(entry => entry.type === 'custom' && entry.customType === 'coding_verification');
    const checkpoint = checkpoints[params.resumeLastUserMessage && lastSummary >= lastStart ? lastSummary : lastStart];
    if (checkpoint?.type === 'custom' && (params.resumeLastUserMessage || lastStart > lastSummary)) {
      verification.restore(checkpoint.data, params.resumeLastUserMessage === true && lastSummary >= lastStart);
    }
    runner.piSm.appendCustomEntry('coding_run_started', { runId, workspace: workspaceDir, required: params.verifyChanges ?? false, ...await verification.summary() });
    let policyStopped = false;
    let connectionStopped = false;
    let clarificationStopped = false;
    params.turnPolicy?.reset();
    session.agent.beforeToolCall = async (context, signal) => {
      const resume = getClarificationResumeInput(conversationId, runId);
      const wait = resume?.payload?.waitId ? getClarification(resume.payload.waitId) : undefined;
      if (wait?.approvalKey?.startsWith('computer:') && wait.answer !== '已在桌面端处理，继续') {
        await stopComputerControl(conversationId);
      }
      if (isComputerControlActive(conversationId) && !['computer_use', 'clarify'].includes(context.toolCall.name)) {
        return { block: true, reason: 'A desktop-control lease is active. Only computer_use and clarification are admitted until it is released. Never use shell, browser or raw MCP to bypass a desktop refusal.' };
      }
      if (connectionStopped) return { block: true, reason: 'Waiting for the user to connect an app.', terminate: true };
      if (clarificationStopped) return { block: true, reason: 'Waiting for the user to answer.', terminate: true };
      const decision = await params.turnPolicy?.beforeToolCall(context, signal);
      if (decision?.block) {
        policyStopped ||= decision.terminate === true;
        return decision;
      }
      if (context.toolCall.name !== 'read_file') {
        const scoped = await instructions.forTool(context.toolCall.name, context.args);
        if (scoped) return { block: true, reason: `${scoped}\n\nApply these instructions, then retry the operation.` };
      }
      await verification.beforeTool(context.toolCall.id, context.toolCall.name);
      return decision;
    };
    session.agent.afterToolCall = async (context) => {
      connectionStopped ||= isConnectionSuspended(conversationId, runId);
      clarificationStopped ||= isClarificationSuspended(conversationId, runId);
      const scoped = context.toolCall.name === 'read_file' ? await instructions.forTool(context.toolCall.name, context.args) : '';
      const checked = await verification.afterTool(context);
      if (scoped) checked.result.content.unshift({ type: 'text', text: scoped });
      await params.turnPolicy?.afterToolCall({ ...context, ...checked });
      return checked;
    };
    session.agent.shouldStopAfterTurn = (context) => {
      policyStopped ||= params.turnPolicy?.shouldStopAfterTurn(context) ?? false;
      return policyStopped || connectionStopped || clarificationStopped;
    };

    unsubscribe = subscribeEmbeddedSessionEvents(session, (event) => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        recordPromptCacheTouch(conversationId, resolvedModel, event.message.usage);
      }
      if (event.type === 'tool_execution_end') {
        markTurnToolResult(conversationId, runId, event.toolName);
      }
      onEvent?.({ ...event, runId });
    }, params.onAgentEvent);

    const abortListener = () => {
      void session.abort();
    };
    runAbortSignal.addEventListener('abort', abortListener, { once: true });

    try {
      await runAgentTurnWithTimeout(
        session.agent,
        async () => {
          const connectionResume = getConnectionResumeInput(conversationId, runId);
          const clarificationResume = getClarificationResumeInput(conversationId, runId);
          if (connectionResume) {
            await session.sendCustomMessage({ customType: 'connection_resume', content: connectionResume.content, display: false }, { triggerTurn: true });
          } else if (clarificationResume) {
            await session.sendCustomMessage({ customType: 'clarification_resume', content: clarificationResume.content, display: false }, { triggerTurn: true });
          } else if (params.resumeLastUserMessage) {
            await session.agent.continue();
          } else {
            const text = userMessageToPromptText(userMessage);
            const images = params.images ?? [];
            await session.prompt(text, images.length > 0 ? { images } : undefined);
          }
          await session.agent.waitForIdle();
          clarificationStopped ||= isClarificationSuspended(conversationId, runId);
          if (connectionStopped || clarificationStopped) return;
          await maybeRetryTurnAfterTransientLlmFailure(session.agent, {
            conversationId,
            log,
            signal: runAbortSignal,
          });
          await maybeRecoverContextOverflow({
            agent: session.agent,
            model: resolvedModel,
            conversationId,
            transcriptRuntime,
            policy: compactionPolicy,
            abortSignal: runAbortSignal,
            onEvent,
          });
          // One bounded continuation closes accidental early completion without
          // forcing impossible checks or bypassing user cancellation and budgets.
          const pending = await verification.pendingContext();
          if ((params.verifyChanges ?? false) && pending && !policyStopped && !runAbortSignal.aborted
            && !isAssistantTurnFailed(session.agent) && !isAssistantTurnAborted(session.agent)) {
            await session.sendCustomMessage({
              customType: 'coding_verification', content: pending, display: false,
            }, { triggerTurn: true });
            await session.agent.waitForIdle();
          }
        },
        timeoutMs,
      );

      if (connectionStopped) runner.piSm.appendCustomEntry('connection_required', { runId, conversationId });
      if (clarificationStopped) runner.piSm.appendCustomEntry('clarification_required', { runId, conversationId });
      runner.piSm.appendCustomEntry('coding_verification', { runId, workspace: workspaceDir, required: params.verifyChanges ?? false, ...await verification.summary() });

      if (runAbortSignal.aborted) {
        return { ok: false, errorMessage: 'aborted' };
      }
      if (isAssistantTurnAborted(session.agent)) {
        return { ok: true, lastAssistantText: lastAssistantPlainText(session) };
      }
      if (isAssistantTurnFailed(session.agent)) {
        return {
          ok: false,
          errorMessage: getAssistantTurnErrorMessage(session.agent) ?? 'Assistant turn failed',
          lastAssistantText: lastAssistantPlainText(session),
        };
      }

      runner.piSm.appendCustomEntry('xopc.model-selection', {
        runId,
        model: `${session.agent.state.model?.provider ?? resolvedModel.provider}/${session.agent.state.model?.id ?? resolvedModel.id}`,
        thinkingLevel: session.agent.state.thinkingLevel,
      });
      return {
        ok: true,
        ...(connectionStopped
          ? { stopReason: 'connection_required' as const }
          : clarificationStopped
            ? { stopReason: 'clarification_required' as const }
            : {}),
        lastAssistantText: lastAssistantPlainText(session),
      };
    } finally {
      runAbortSignal.removeEventListener('abort', abortListener);
    }
  } catch (err) {
    if (err instanceof EmbeddedRunConflictError) {
      const em = err.message;
      log.warn({ conversationId, runId, activeRunId: err.activeRunId }, `Embedded run rejected: ${em}`);
      onEvent?.({ type: 'error', content: em, runId });
      return { ok: false, retryable: false, errorMessage: em };
    }
    quarantineRunner = isAgentTurnUnsettledError(err);
    const em = err instanceof Error ? err.message : String(err);
    log.error({ err, conversationId, runId }, `Embedded run failed: ${em}`);
    onEvent?.({ type: 'error', content: em, runId });
    return { ok: false, errorMessage: em };
  } finally {
    runLease?.release();
    unsubscribe?.();
    try {
      runner?.piSm.flushPendingToolResults?.();
    } catch {
      /* ignore */
    }
    runner?.piSm.setActiveTurnId?.(null);
    if (quarantineRunner) {
      evictEmbeddedSessionRunner(transcriptRuntime.runtimeId, 'unsettled_after_timeout');
    }
    runner?.release();
  }
}

export { abortEmbeddedRun, queueEmbeddedSteer } from './runs.js';
