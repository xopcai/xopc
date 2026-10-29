import { getMcpSetupResumeInput } from '../mcp/continuation-input.js';
import { isPhoneAssistanceSuspended, phoneAssistance, phoneResumeForRun } from '../../phone/assistance.js';
import { isNestedCodemodePolicy } from './codemode-extension.js';
import { ProviderUsageScopeError } from '../../providers/model-usage.js';
import { traceRun, traceTools, traceOperation, setTraceIdentity, recordTraceLatency } from '../../observability/runtime.js';
import { getConnectionResumeInput, isConnectionSuspended } from '../../storage/sqlite/connection-wait-repository.js';
import { isComputerControlActive, isComputerLeaseTool, stopComputerControl } from '../../computer/control-guard.js';
import { bindComputerAgentTurn, computerImagesForRequest, computerRequestFrameCleanup,
  endComputerAgentTurn, setComputerProgramAuthorization } from '../../computer/agent-context.js';
import {
  getClarificationResumeInput,
  getClarification,
  isClarificationSuspended,
} from '../../storage/sqlite/clarification-wait-repository.js';
import type {
  Agent,
  AgentMessage,
  AgentRequestUpdate,
  AgentTurnDecision,
} from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  isRecoverableLength,
  type AssistantMessage,
  type Model,
  type Api,
} from '@earendil-works/pi-ai';

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
  isAgentTurnTimeoutError,
  runAgentTurnWithTimeout,
  resolveAgentTurnTimeoutMs,
} from '../orchestration/run-agent-turn-with-timeout.js';
import { resolveAgentAbortReason } from '../orchestration/run-termination.js';
import { detectToolLoops, type RecentToolCall } from '../orchestration/loop-guard.js';
import { tryApplySessionTranscriptHygiene } from '../transcript/transcript-hygiene.js';
import { restoreCurrentTurnImages } from './current-turn-images.js';
import { acquireEmbeddedSessionRunner, evictEmbeddedSessionRunner } from './session-runner.js';
import { externalPolicyContext, getXopcToolMetadata } from './tool-metadata.js';
import { allowsExecutionTool, filterExecutionTools, resolveExecutionToolPolicy } from './execution-tool-policy.js';
import { configurationCapabilityCorrection } from './configuration-capability-correction.js';
import { createSqliteTranscriptRuntime } from './transcript-runtime.js';
import { wrapStreamFnForXopcExtensions } from './xopc-stream-bridge.js';
import { projectContextForModel } from '../memory/context-budget.js';
import { assessContext, recoverContext as recoverContextUntraced } from '../memory/context-recovery.js';
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
import { projectWorkEvidence } from '../coding/projectEvidence.js';
import { withDelegationScope } from '../orchestration/delegation-scope.js';
import { runWithEmbeddedExecutionSession } from './execution-context.js';
import type { CompactionDiscardedAttempt } from '../memory/compaction.js';
import { continuesAfterTool, trackAiUsageStream } from '../../usage/recorder.js';
import { isXopcDatabaseOpen } from '../../storage/sqlite/index.js';
import { getSessionMetadata } from '../../storage/sqlite/session-repository.js';
import { projectForgottenHistoryMessages, projectSuppressedMemoryBlocks, originalReadAuthorizationNotice } from '../../memory-learning/forgotten-history.js';
import { getActiveTranscriptUserText } from '../inbound/attachment-pipeline.js';
import { resolveEffectiveAgentConfigForSession } from '../../config/agent-profile.js';
import { getModelThinking } from '../../providers/model-thinking.js';
import { NO_REPLY } from '../messaging/no-reply.js';
import { ACCEPTANCE_REPAIR_READ_TOOLS, canResumeAfterModelFailure, completedRecoveryToolResult } from '../orchestration/turn-recovery.js';
import { withCloudCreditBudget, reportCloudCreditError, isCloudCreditBudgetExhausted, cloudCreditBudgetStopMessage } from '../../providers/xopc-cloud-credit-budget.js';

const log = createLogger('EmbeddedRun');
const LOG_PREVIEW_MAX_CHARS = 300;
const RECOVERY_READ_TOOLS = new Set(['read_file', 'find', 'grep', 'list_dir', 'tool_manual', 'tool_search',
  'review_workspace', 'language_diagnostics', 'session_status']);

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

function lastAssistantMessage(messages: readonly AgentMessage[]): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant') return message as AssistantMessage;
  }
  return undefined;
}

function discardedAttempt(message: AssistantMessage): CompactionDiscardedAttempt {
  return {
    assistantTimestamp: message.timestamp,
    provider: message.provider,
    model: message.model,
    toolCallIds: message.content.flatMap(block => block.type === 'toolCall' ? [block.id] : []),
  };
}

function isRecoverableLengthForModel(message: AssistantMessage, model: Model<Api>): boolean {
  return message.provider === model.provider
    && message.model === model.id
    && isRecoverableLength(message, model.maxTokens ?? 0);
}

function withRecoveredMessages(
  current: readonly AgentMessage[],
  recovered: readonly AgentMessage[],
): AgentMessage[] {
  return [
    ...current.filter(message => message.role === 'system'),
    ...recovered.filter(message => message.role !== 'system'),
  ];
}

function createContextErrorStream(model: Model<Api>, errorMessage: string) {
  const stream = createAssistantMessageEventStream();
  const error: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
  };
  stream.push({ type: 'error', reason: 'error', error });
  stream.end(error);
  return stream;
}

async function recoverRunContext(params: {
  agent: Agent;
  model: Model<Api>;
  conversationId: string;
  transcriptRuntime: NonNullable<RunXopcEmbeddedTurnParams['transcriptRuntime']>;
  abortSignal?: AbortSignal;
  onEvent?: RunXopcEmbeddedTurnParams['onEvent'];
  policy: ResolvedCompactionPolicy;
  systemPrompt: string;
  providerRejected?: boolean;
  discardedAttempt?: CompactionDiscardedAttempt;
}): Promise<Awaited<ReturnType<typeof recoverContext>>> {
  let started = false;
  const summaryModel = params.policy.model
    ? (await import('../../providers/index.js')).resolveModel(params.policy.model) as Model<Api>
    : params.model;
  try {
    const recovered = await recoverContext({
      conversationId: params.conversationId,
      transcript: params.transcriptRuntime,
      policy: params.policy,
      budget: {
        contextWindow: params.model.contextWindow ?? 128_000,
        systemPrompt: params.systemPrompt,
        tools: params.agent.state.tools,
        reserveTokens: params.policy.reserveTokens,
        triggerThreshold: params.policy.triggerThreshold,
        minToolResultKeepChars: params.policy.minToolResultKeepChars,
      },
      summaryModel,
      fallbackModels: summaryModel === params.model ? [] : [params.model],
      signal: params.abortSignal,
      providerRejected: params.providerRejected,
      forceOnTrigger: true,
      preserveLastUser: params.providerRejected,
      discardedAttempt: params.discardedAttempt,
      onCompactionStart: () => {
        if (started) return;
        started = true;
        params.onEvent?.({ type: 'compaction', status: 'started' });
      },
    });
    if (recovered.status === 'compacted') {
      params.onEvent?.({ type: 'compaction', status: 'completed',
        tokensBefore: recovered.result?.tokensBefore, tokensAfter: recovered.result?.tokensAfter,
        summary: recovered.result?.summary.slice(0, 200) });
    } else if (started) {
      params.onEvent?.({ type: 'compaction', status: 'skipped' });
    }
    return recovered;
  } catch (error) {
    if (started) params.onEvent?.({ type: 'compaction', status: 'skipped' });
    throw error;
  }
}

async function maybeRecoverInterruptedContext(params: {
  agent: Agent;
  model: Model<Api>;
  conversationId: string;
  transcriptRuntime: NonNullable<RunXopcEmbeddedTurnParams['transcriptRuntime']>;
  abortSignal?: AbortSignal;
  onEvent?: RunXopcEmbeddedTurnParams['onEvent'];
  policy: ResolvedCompactionPolicy;
  systemPrompt: string;
  recoveryState: { interruptedAttempts: number };
  onContextRecovered?: () => void;
}): Promise<boolean> {
  const assistant = lastAssistantMessage(params.agent.state.messages);
  const errorMessage = getAssistantTurnErrorMessage(params.agent);
  const overflow = !!errorMessage && isContextOverflowError(errorMessage);
  const recoverableLength = !!assistant && isRecoverableLengthForModel(assistant, params.model);
  if (!overflow && !recoverableLength) return false;
  const discardedCalls = new Set(recoverableLength && assistant ? discardedAttempt(assistant).toolCallIds : []);
  const recoveryHistory = params.agent.state.messages.filter(message => !recoverableLength || (message !== assistant
    && !(message.role === 'toolResult' && discardedCalls.has(message.toolCallId))));
  if (!canResumeAfterModelFailure(recoveryHistory)) {
    log.warn({ conversationId: params.conversationId }, 'Context recovery stopped because a tool outcome is unconfirmed');
    return false;
  }
  if (recoverableLength && (!params.policy.enabled || params.recoveryState.interruptedAttempts >= 1)) {
    log.warn({ conversationId: params.conversationId, attempts: params.recoveryState.interruptedAttempts },
      'Truncated response recovery is unavailable or already exhausted');
    return false;
  }
  if (recoverableLength) params.recoveryState.interruptedAttempts += 1;

  const messages = stripTrailingErrorAssistantMessages(params.agent.state.messages);
  log.warn(
    { conversationId: params.conversationId, errorMessage, messageCount: messages.length,
      reason: recoverableLength ? 'length' : 'context_overflow' },
    recoverableLength
      ? 'Assistant response was truncated; compacting and retrying the same turn once'
      : 'Provider rejected the context window; compacting and retrying the same turn',
  );
  const recovered = await recoverRunContext({
    ...params,
    providerRejected: true,
    discardedAttempt: recoverableLength && assistant ? discardedAttempt(assistant) : undefined,
  });
  params.agent.state.messages = stripTrailingErrorAssistantMessages(recovered.messages);
  params.onContextRecovered?.();
  params.abortSignal?.throwIfAborted();
  await params.agent.continue();
  await params.agent.waitForIdle();
  return true;
}

export async function runXopcEmbeddedTurn(params: RunXopcEmbeddedTurnParams): Promise<RunXopcEmbeddedTurnResult> {
  const limitCreditMicro = isXopcDatabaseOpen() && getSessionMetadata(params.conversationId)
    ? resolveEffectiveAgentConfigForSession(params.conversationId).config.runtime.cloudCreditLimitPerRunMicro
    : undefined;
  return withCloudCreditBudget({ conversationId: params.conversationId, runId: params.runId, limitCreditMicro }, async () => {
    try {
      const result = await traceRun('agent.run', { conversationId: params.conversationId, runId: params.runId }, () => runXopcEmbeddedTurnInner(params), params.userMessage);
      if (result.errorMessage?.includes('provider_usage_scope_denied')) return { ...result, ok: false, retryable: false };
      const stopped = cloudCreditBudgetStopMessage();
      if (stopped) return { ...result, ok: false, retryable: false, errorMessage: stopped };
      if (result.errorMessage && isCloudCreditBudgetExhausted(result.errorMessage)) {
        reportCloudCreditError(result.errorMessage);
        return { ...result, retryable: false };
      }
      return result;
    } catch (error) {
      if (error instanceof ProviderUsageScopeError) return { ok: false, retryable: false, errorMessage: error.message };
      const message = error instanceof Error ? error.message : String(error);
      if (isCloudCreditBudgetExhausted(message)) {
        reportCloudCreditError(message);
        return { ok: false, retryable: false, errorMessage: message };
      }
      throw error;
    }
  });
}

async function runXopcEmbeddedTurnInner(params: RunXopcEmbeddedTurnParams): Promise<RunXopcEmbeddedTurnResult> {
  const preparationStartedAt = performance.now();
  let firstModelRequestAt: number | undefined;
  let currentModelRequestAt: number | undefined;
  let modelRequestNumber = 0;
  let firstModelTextSeen = false;
  let latencyModelRef: string | undefined;
  let latencyReasoning: string | undefined;
  const {
    conversationId,
    runId,
    userMessage,
    model,
    tools: rawTools,
    systemPrompt,
    thinkingLevel,
    workspaceDir,
    sessionStore,
    onEvent,
  } = params;

  const toolPolicyConversationId = params.toolPolicyConversationId ?? conversationId;
  const executionToolPolicy = resolveExecutionToolPolicy(toolPolicyConversationId);
  const tools = traceTools(filterExecutionTools(executionToolPolicy, rawTools));
  const timeoutMs = params.timeoutMs || resolveAgentTurnTimeoutMs();
  const resolvedModel = requireEmbeddedModel(model, params.modelRef);
  const configuredThinking = isXopcDatabaseOpen() && getSessionMetadata(conversationId)
    ? resolveEffectiveAgentConfigForSession(conversationId).config.runtime.thinkingLevel
    : undefined;
  if (configuredThinking && !getModelThinking(resolvedModel).options.includes(configuredThinking)) {
    throw new Error(`Agent requires a model that supports thinking ${configuredThinking}`);
  }
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

  setTraceIdentity({ transcriptId: transcriptRuntime.transcriptId });
  let runner: Awaited<ReturnType<typeof acquireEmbeddedSessionRunner>> | undefined;
  let unsubscribe: (() => void) | undefined;
  let quarantineRunner = false;
  let runLease: ReturnType<typeof acquireEmbeddedRunLease> | undefined;
  let restorePrepareNextTurn: (() => void) | undefined;
  let restorePrepareRequest: (() => void) | undefined;
  let restoreTransformContext: (() => void) | undefined;
  let restoreToolHooks: (() => void) | undefined;

  try {
    runLease = acquireEmbeddedRunLease({
      conversationId,
      transcriptId: transcriptRuntime.transcriptId,
      runId,
    });
    const instructions = await RepositoryInstructions.open(workspaceDir, { isWorkspaceTrusted: params.isWorkspaceTrusted });
    const rootInstructions = await instructions.load('.', true);
    runner = await acquireEmbeddedSessionRunner({
      runtimeId: transcriptRuntime.runtimeId,
      transcriptId: transcriptRuntime.transcriptId,
      workspaceDir,
      model: resolvedModel,
      modelRef: params.modelRef,
      tools,
      executionToolPolicy,
      codemode: params.codemode,
      mcp: params.mcp,
      systemPrompt: [systemPrompt, rootInstructions].filter(Boolean).join('\n\n'),
      thinkingLevel: configuredThinking ?? thinkingLevel ?? 'medium',
      transcriptRuntime,
    });

    const { session, reused } = runner;
    const configurationTurnStart = session.agent.state.messages.length;
    await runLease.attach(session, async () => session.abort());
    const runAbortSignal = params.abortSignal
      ? AbortSignal.any([runLease.signal, params.abortSignal])
      : runLease.signal;
    if (runAbortSignal.aborted) {
      await session.abort();
      return { ok: false, terminationReason: resolveAgentAbortReason(runAbortSignal.reason), errorMessage: 'aborted' };
    }
    session.agent.state.messages = stripTrailingErrorAssistantMessages(await transcriptRuntime.loadMessages());
    runner.piSm.setActiveTurnId?.(runId);
    const recoveryState = { interruptedAttempts: 0 };
    const requestRetryBudget = { continues: 0 };
    let useAuthoritativeProjection = false;
    const basePrepareNextTurn = session.agent.prepareNextTurnWithContext;
    const inTurnPrepareNextTurn: typeof session.agent.prepareNextTurnWithContext = async (turn, signal) => {
      const prepared = await basePrepareNextTurn?.(turn, signal);
      const currentContext = prepared?.context ?? turn.context;
      const recoverableLength = isRecoverableLengthForModel(turn.message, resolvedModel);
      if (recoverableLength && (!compactionPolicy.enabled || recoveryState.interruptedAttempts >= 1)) {
        return prepared;
      }
      if (recoverableLength) recoveryState.interruptedAttempts += 1;
      try {
        const recovered = await recoverRunContext({
          agent: session.agent,
          model: resolvedModel,
          conversationId,
          transcriptRuntime,
          policy: compactionPolicy,
          systemPrompt: [systemPrompt, rootInstructions].filter(Boolean).join('\n\n'),
          abortSignal: signal ?? runAbortSignal,
          onEvent,
          providerRejected: recoverableLength,
          discardedAttempt: recoverableLength ? discardedAttempt(turn.message) : undefined,
        });
        useAuthoritativeProjection ||= recovered.status === 'compacted';
        return {
          ...prepared,
          context: {
            ...currentContext,
            messages: withRecoveredMessages(currentContext.messages, recovered.messages),
          },
        };
      } catch (error) {
        if (signal?.aborted || runAbortSignal.aborted) throw error;
        log.error({ err: error, conversationId, runId, phase: 'prepare_next_turn' },
          'In-turn context recovery failed; the next request will use the guarded provider path');
        return prepared;
      }
    };
    session.agent.prepareNextTurnWithContext = inTurnPrepareNextTurn;
    restorePrepareNextTurn = () => {
      if (session.agent.prepareNextTurnWithContext === inTurnPrepareNextTurn) {
        session.agent.prepareNextTurnWithContext = basePrepareNextTurn;
      }
    };
    const basePrepareRequest = session.agent.prepareRequest;
    const authoritativePrepareRequest: typeof session.agent.prepareRequest = async (request, signal) => {
      const prepared = await basePrepareRequest?.(request, signal) as AgentRequestUpdate | undefined;
      const currentContext = prepared?.context ?? request.context;
      const imagesForModel = resolvedModel.input?.includes('image') === false ? [] : params.images ?? [];
      const restoreImages = (messages: AgentMessage[]) => restoreCurrentTurnImages(messages, imagesForModel, runId);
      if (!useAuthoritativeProjection) return {
        ...prepared,
        context: { ...currentContext, messages: restoreImages(currentContext.messages as AgentMessage[]) },
      };
      try {
        const messages = await transcriptRuntime.loadMessages();
        return {
          ...prepared,
          context: {
            ...currentContext,
            messages: restoreImages(withRecoveredMessages(currentContext.messages, messages)),
          },
        };
      } catch (error) {
        if (signal?.aborted || runAbortSignal.aborted) throw error;
        log.error({ err: error, conversationId, runId, phase: 'prepare_request' },
          'Failed to refresh the authoritative compacted projection');
        return {
          ...prepared,
          context: { ...currentContext, messages: restoreImages(currentContext.messages as AgentMessage[]) },
        };
      }
    };
    session.agent.prepareRequest = authoritativePrepareRequest;
    restorePrepareRequest = () => {
      if (session.agent.prepareRequest === authoritativePrepareRequest) {
        session.agent.prepareRequest = basePrepareRequest;
      }
    };

    const streamFnWithXopcExtensions = wrapStreamFnForXopcExtensions(
      session.agent.streamFunction,
      params.promptCachePolicy,
    );
    let evidenceProjection: ReturnType<typeof projectWorkEvidence> | undefined;
    const baseTransformContext = session.agent.transformContext;
    const transformWorkEvidence: NonNullable<typeof session.agent.transformContext> = async (messages, signal) => {
      const transformed = await baseTransformContext?.(messages, signal) ?? messages;
      evidenceProjection = params.verifyChanges ? projectWorkEvidence(transformed) : undefined;
      return evidenceProjection?.messages ?? transformed;
    };
    session.agent.transformContext = transformWorkEvidence;
    restoreTransformContext = () => {
      if (session.agent.transformContext === transformWorkEvidence) session.agent.transformContext = baseTransformContext;
    };
    const loggingStreamFn: typeof session.agent.streamFunction = (streamModel, context, options) => {
      bindComputerAgentTurn(conversationId, runId, streamModel);
      const releaseComputerFrames = computerRequestFrameCleanup(conversationId, runId);
      instructions.acknowledge();
      const memoryMetadata = isXopcDatabaseOpen() ? getSessionMetadata(conversationId) : undefined;
      const historyContext = {
        conversationId, agentId: memoryMetadata?.agentId ?? '', workspaceId: workspaceDir,
        projectId: memoryMetadata?.projectId,
      };
      const sourceMessages = projectForgottenHistoryMessages([...context.messages], historyContext,
        getActiveTranscriptUserText(conversationId) ?? (typeof userMessage === 'string' ? userMessage : ''))
        .map(message => message.role !== 'system' ? message : { ...message,
          ...(typeof message.content === 'string' ? { content: projectSuppressedMemoryBlocks(message.content, historyContext) } : {}),
          ...(message.sections ? { sections: Object.fromEntries(Object.entries(message.sections).map(([key, value]) =>
            [key, projectSuppressedMemoryBlocks(value, historyContext)])) } : {}),
        });
      // Project using host tool-call ids before provider hygiene rewrites them.
      const computerMessages = sourceMessages.map(message => {
        if (message.role !== 'toolResult' || message.toolName !== 'computer_use') return message;
        const images = computerImagesForRequest(conversationId, runId, message.toolCallId);
        return images.length ? { ...message, content: [...message.content, ...images] } : message;
      });
      const hygienicMessages = tryApplySessionTranscriptHygiene(computerMessages, streamModel) as typeof sourceMessages;
      const recentToolCalls = extractRecentToolCalls(session.agent.state.messages);
      const loopGuard = detectToolLoops(recentToolCalls);

      let effectiveContext: typeof context = { ...context, messages: hygienicMessages };
      const readAuthorization = originalReadAuthorizationNotice(historyContext,
        getActiveTranscriptUserText(conversationId) ?? (typeof userMessage === 'string' ? userMessage : ''));
      if (readAuthorization) effectiveContext = { ...effectiveContext, messages: [...effectiveContext.messages,
        { role: 'system' as const, content: '', sections: { 'xopc.original-read-authorization': readAuthorization }, timestamp: 0 }] };
      if (loopGuard.injection) {
        effectiveContext = { ...effectiveContext, messages: [...effectiveContext.messages,
          { role: 'user' as const, content: loopGuard.injection, timestamp: Date.now() }] };
      }
      const executionGuidance = verification.modelGuidance();
      if (executionGuidance) effectiveContext = { ...effectiveContext, messages: [...effectiveContext.messages,
        { role: 'system' as const, content: '', sections: { 'xopc.execution-focus': executionGuidance }, timestamp: 0 }] };

      let effectiveSystemPrompt = getCurrentSystemPrompt(effectiveContext.messages);
      let effectiveTools = getCurrentTools(effectiveContext.messages);

      const projection = projectContextForModel({
        messages: effectiveContext.messages as AgentMessage[],
        contextWindow: streamModel.contextWindow ?? 128_000,
        systemPrompt: effectiveSystemPrompt,
        tools: effectiveTools,
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
        effectiveSystemPrompt = getCurrentSystemPrompt(effectiveContext.messages);
        effectiveTools = getCurrentTools(effectiveContext.messages);
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
        systemPrompt: effectiveSystemPrompt, tools: effectiveTools,
        reserveTokens: compactionPolicy.reserveTokens,
        minToolResultKeepChars: compactionPolicy.minToolResultKeepChars,
      }, compactionPolicy.maxActiveTranscriptBytes);
      if (!assessed.fits) {
        const errorMessage = `Context budget exceeded before provider request (${assessed.evaluation.estimatedTokens}/${assessed.evaluation.hardLimitTokens} tokens)`;
        log.error({ conversationId, runId, phase: 'provider_preflight',
          estimatedTokens: assessed.evaluation.estimatedTokens,
          hardLimitTokens: assessed.evaluation.hardLimitTokens }, errorMessage);
        return createContextErrorStream(streamModel, errorMessage);
      }
      effectiveContext = { ...effectiveContext, messages: assessed.messages as typeof effectiveContext.messages };
      effectiveSystemPrompt = getCurrentSystemPrompt(effectiveContext.messages);
      effectiveTools = getCurrentTools(effectiveContext.messages);

      const modelRequestStop = params.turnPolicy?.beforeModelRequest?.(options?.signal ?? runAbortSignal);
      if (modelRequestStop) return createContextErrorStream(streamModel, modelRequestStop);

      const promptCacheSnapshot = buildPromptCacheSnapshot({
        model: streamModel,
        systemPrompt: effectiveSystemPrompt,
        tools: effectiveTools,
        reasoning: options?.reasoning,
      });
      const promptCacheChanges = observePromptCacheSnapshot(conversationId, promptCacheSnapshot);

      const recordedContext = { ...effectiveContext, messages: effectiveContext.messages.map(message =>
        message.role === 'toolResult' && message.toolName === 'computer_use'
          ? { ...message, content: message.content.filter(block => block.type !== 'image') } : message) };
      log.debug(
        {
          conversationId,
          runId,
          reusedRunner: reused,
          modelRef: `${streamModel.provider}/${streamModel.id}`,
          systemPromptLength: effectiveSystemPrompt.length,
          messageCount: effectiveContext.messages.filter(message => message.role !== 'system').length,
          transcriptRepaired: hygienicMessages !== sourceMessages,
          sharedEvidenceChars: evidenceProjection?.savedChars ?? 0,
          sharedReviews: evidenceProjection?.sharedReviews ?? 0,
          sharedReads: evidenceProjection?.sharedReads ?? 0,
          toolCount: effectiveTools.length,
          toolSchemaChars: JSON.stringify(effectiveTools).length,
          estimatedContextTokens: assessed.evaluation.estimatedTokens,
          lastUserMessagePreview: getLastUserMessagePreview(effectiveContext.messages),
          loopWarningInjected: !!loopGuard.injection,
          promptCache: promptCacheSnapshot,
          promptCacheChanges,
          ...(process.env.XOPC_LOG_LLM_PAYLOAD === 'true'
            ? {
                effectiveContext: {
                  systemPrompt: effectiveSystemPrompt,
                  messages: recordedContext.messages.filter(message => message.role !== 'system'),
                  tools: effectiveTools,
                },
              }
            : {}),
        },
        'Sending messages to AI',
      );
      currentModelRequestAt = performance.now();
      modelRequestNumber += 1;
      latencyModelRef = `${streamModel.provider}/${streamModel.id}`;
      latencyReasoning = options?.reasoning;
      if (firstModelRequestAt === undefined) {
        firstModelRequestAt = currentModelRequestAt;
        recordTraceLatency({ embeddedPreparationMs: firstModelRequestAt - preparationStartedAt });
        log.info({ conversationId, runId, modelRef: latencyModelRef, thinking: latencyReasoning ?? 'off',
          phase: 'first_model_request', preparationMs: firstModelRequestAt - preparationStartedAt,
          messageCount: effectiveContext.messages.length, systemPromptLength: effectiveSystemPrompt.length,
          toolCount: effectiveTools.length, toolSchemaChars: JSON.stringify(effectiveTools).length,
          estimatedContextTokens: assessed.evaluation.estimatedTokens }, 'Embedded first model request ready');
      }
      const stream = trackAiUsageStream(streamModel, {
        operation: continuesAfterTool(effectiveContext.messages) ? 'agent.continue_after_tool' : 'agent.answer',
        conversationId,
        runId,
        traceId: runId,
      }, () => streamFnWithXopcExtensions(streamModel, effectiveContext, { ...options }), { context: recordedContext, reasoning: options?.reasoning });
      void Promise.resolve(stream).then(value => value.result()).finally(releaseComputerFrames).catch(() => {});
      return stream;
    };
    session.agent.streamFunction = loggingStreamFn;
    const verification = await RunVerification.open(workspaceDir, { required: params.verifyChanges === true, toolNames: tools.map(tool => tool.name) });
    const checkpoints = runner.piSm.getBranch?.() ?? [];
    const recoveryTurn = params.resumeLastUserMessage === true || Boolean(params.recoveryMessage);
    const lastStart = checkpoints.findLastIndex(entry => entry.type === 'custom' && entry.customType === 'coding_run_started');
    const lastSummary = checkpoints.findLastIndex(entry => entry.type === 'custom' && entry.customType === 'coding_verification');
    const checkpoint = checkpoints[recoveryTurn && lastSummary >= lastStart ? lastSummary : lastStart];
    if (checkpoint?.type === 'custom' && (recoveryTurn || lastStart > lastSummary)) {
      verification.restore(checkpoint.data, recoveryTurn && lastSummary >= lastStart);
    }
    runner.piSm.appendCustomEntry('coding_run_started', { runId, workspace: workspaceDir, required: params.verifyChanges ?? false, ...await verification.summary() });
    let policyStopped = false;
    let policyCompleted = false;
    let recoveringModel = params.resumeLastUserMessage === true || Boolean(params.recoveryMessage);
    let recoveryMessages = [...session.agent.state.messages];
    let policyStopReason: string | undefined;
    let lengthRecoveryExhausted = false;
    let phoneStopped = false;
    let phoneNotice: string | undefined;
    let connectionStopped = false;
    let clarificationStopped = false;
    let sentVisibleMessage = false;
    params.turnPolicy?.reset();
    const nativeBeforeTool = session.agent.beforeToolCall;
    const nativeAfterTool = session.agent.afterToolCall;
    const computerProgramOperation = Symbol('computerProgramOperation');
    const hostBeforeTool: NonNullable<typeof nativeBeforeTool> = async (context, signal) => {
      if (!allowsExecutionTool(executionToolPolicy, context.toolCall.name)) {
        return { block: true, reason: 'Tool is outside this execution scope.' };
      }
      const currentToolPolicy = resolveExecutionToolPolicy(toolPolicyConversationId);
      if (currentToolPolicy.surface !== executionToolPolicy.surface
        || currentToolPolicy.taskExecution !== executionToolPolicy.taskExecution) {
        policyStopped = true;
        policyStopReason = 'Execution identity changed during the run';
        quarantineRunner = true;
        return { block: true, terminate: true, reason: 'Execution identity changed. Start a new turn with the current tool policy.' };
      }
      const resume = getClarificationResumeInput(conversationId, runId);
      const wait = resume?.payload?.waitId ? getClarification(resume.payload.waitId) : undefined;
      if (wait?.approvalKey?.startsWith('computer:') && wait.decision !== 'approve') {
        await stopComputerControl(conversationId);
      }
      if (isComputerControlActive(conversationId) && !isComputerLeaseTool(context.toolCall.name)) {
        return { block: true, reason: 'A desktop-control lease is active. Only computer_use, clarification and static tool manuals are admitted until release is confirmed. Close the lease before an authorized tool handoff. Never use shell, browser or raw MCP to bypass a desktop refusal.' };
      }
      if (phoneStopped) return { block: true, reason: 'Waiting for the user to finish operating the phone.', terminate: true };
      if (connectionStopped) return { block: true, reason: 'Waiting for the user to connect an app.', terminate: true };
      if (clarificationStopped) return { block: true, reason: 'Waiting for the user to answer.', terminate: true };
      const decision = await params.turnPolicy?.beforeToolCall(externalPolicyContext(context, tools), signal);
      if (decision?.block) {
        policyStopped ||= decision.terminate === true;
        if (decision.terminate) policyStopReason = decision.reason;
        return decision;
      }
      const tool = tools.find(candidate => candidate.name === context.toolCall.name);
      const metadata = tool && getXopcToolMetadata(tool);
      const readOnly = RECOVERY_READ_TOOLS.has(context.toolCall.name)
        || metadata?.external?.readOnly === true || metadata?.annotations?.readOnlyHint === true
        || (context.toolCall.name === 'task_collaboration' && (context.args as { command?: string }).command === 'get')
        || (context.toolCall.name === 'managed_job' && ['wait', 'status', 'list'].includes(String((context.args as { action?: string }).action)));
      const repairPublication = ['acceptance_repair', 'model_failure'].includes(params.recoveryReason ?? '')
        && ['publish_artifacts', 'publish_task_result'].includes(context.toolCall.name);
      if (recoveringModel && !readOnly && !repairPublication) {
        const recorded = completedRecoveryToolResult(recoveryMessages, context.toolCall.name, context.args);
        if (recorded) return { block: true, reason: recorded };
      }
      if (context.toolCall.name !== 'read_file') {
        const scoped = await instructions.forTool(context.toolCall.name, context.args);
        if (scoped) return { block: true, reason: `${scoped}\n\nApply these instructions, then retry the operation.` };
      }
      await verification.beforeTool(context.toolCall.id, context.toolCall.name);
      if (context.toolCall.name === 'computer_use' && !(context as unknown as Record<symbol, unknown>)[computerProgramOperation]) {
        let operationNumber = 0;
        const nestedContext = (operation: string, args: unknown) => ({ ...context,
          [computerProgramOperation]: true,
          toolCall: { ...context.toolCall, id: `${context.toolCall.id}/ui/${++operationNumber}` },
          args: { op: 'exec', operation, input: args },
        });
        let activeOperation: ReturnType<typeof nestedContext> | undefined;
        setComputerProgramAuthorization(conversationId, async (operation, args) => {
          activeOperation = nestedContext(operation, args);
          const result = await hostBeforeTool(activeOperation, signal);
          if (result?.block) throw new Error('COMPUTER_PROGRAM_POLICY_REFUSED');
        }, async (_operation, result) => {
          if (!activeOperation) throw new Error('COMPUTER_PROGRAM_POLICY_REFUSED');
          const operation = activeOperation;
          activeOperation = undefined;
          const checked = await hostAfterTool({ ...operation, result: {
            content: [{ type: 'text', text: JSON.stringify(result) }], details: {},
          }, isError: false }, signal);
          if (checked?.isError) throw new Error('COMPUTER_PROGRAM_POLICY_REFUSED');
          const content = checked?.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
          return content ? JSON.parse(content) : result;
        });
      }
      return decision;
    };
    const hostAfterTool: NonNullable<typeof nativeAfterTool> = async (context) => {
      phoneStopped ||= isPhoneAssistanceSuspended(conversationId, runId);
      if (phoneStopped && context.toolCall.name === 'phone_use') {
        const details = context.result.details as { message?: string } | undefined;
        if (typeof details?.message === 'string') phoneNotice = details.message.slice(0, 500);
      }
      connectionStopped ||= isConnectionSuspended(conversationId, runId);
      clarificationStopped ||= isClarificationSuspended(conversationId, runId);
      const scoped = context.toolCall.name === 'read_file' ? await instructions.forTool(context.toolCall.name, context.args)
        : context.toolCall.name === 'data_batch' ? await instructions.forDataResult(context.result.content) : '';
      const checked = await verification.afterTool(context);
      if (scoped && context.toolCall.name === 'data_batch') {
        checked.result = { content: [{ type: 'text', text: `${scoped}\n\nNew directory instructions were discovered. Apply them before retrying the affected data queries; this result is not evidence of a complete search.` }], details: { status: 'retry_required' } };
      } else if (scoped) checked.result.content.unshift({ type: 'text', text: scoped });
      await params.turnPolicy?.afterToolCall({ ...externalPolicyContext(context, tools), ...checked });
      return { ...checked.result, isError: checked.isError };
    };
    // Keep pi's MCP readiness and result hooks alongside the per-turn host policy.
    const beforeTool: NonNullable<typeof nativeBeforeTool> = async (context, signal) => {
      const decision = await hostBeforeTool(context, signal);
      if (decision?.block || isNestedCodemodePolicy(context)) return decision;
      return await nativeBeforeTool?.(context, signal) ?? decision;
    };
    const afterTool: NonNullable<typeof nativeAfterTool> = async (context, signal) => {
      const checked = await hostAfterTool(context, signal);
      if (isNestedCodemodePolicy(context)) return checked;
      const native = await nativeAfterTool?.({ ...context,
        result: { ...context.result, ...checked }, isError: checked?.isError ?? context.isError,
      }, signal);
      return native ? { ...checked, ...native } : checked;
    };
    session.agent.beforeToolCall = beforeTool;
    session.agent.afterToolCall = afterTool;
    restoreToolHooks = () => {
      if (session.agent.beforeToolCall === beforeTool) session.agent.beforeToolCall = nativeBeforeTool;
      if (session.agent.afterToolCall === afterTool) session.agent.afterToolCall = nativeAfterTool;
    };
    const baseFinishTurn = session.agent.finishTurn;
    session.agent.finishTurn = async (context, signal): Promise<AgentTurnDecision | undefined> => {
      const baseDecision = await baseFinishTurn?.(context, signal);
      if (baseDecision && baseDecision.action === 'end') return { action: 'end' };
      if (context.message && isRecoverableLengthForModel(context.message, resolvedModel)
        && recoveryState.interruptedAttempts >= 1) {
        log.warn({ conversationId, runId }, 'Stopping after the bounded truncated-response recovery attempt');
        lengthRecoveryExhausted = true;
        return { action: 'end' };
      }
      policyStopped ||= params.turnPolicy?.shouldStopAfterTurn(context) ?? false;
      policyCompleted ||= policyStopped && params.turnPolicy?.stopReason?.() === 'completed';
      if (policyStopped) policyStopReason ??= 'Agent execution policy stopped before completion';
      if (policyStopped || connectionStopped || clarificationStopped || phoneStopped) return { action: 'end' };
      const continuation = params.turnPolicy?.takeContinuationMessage?.();
      if (continuation) {
        session.agent.steer({ role: 'user', content: continuation, timestamp: Date.now() });
        return { action: 'continue' };
      }
      if (baseDecision && baseDecision.action === 'continue') return { action: 'continue' };
      return undefined;
    };

    unsubscribe = subscribeEmbeddedSessionEvents(session, (event) => {
      if (!firstModelTextSeen && firstModelRequestAt !== undefined && currentModelRequestAt !== undefined && event.type === 'message_update'
        && event.assistantMessageEvent?.type === 'text_delta' && event.assistantMessageEvent.delta.trim()) {
        firstModelTextSeen = true;
        const textSeenAt = performance.now();
        recordTraceLatency({ modelFirstTextMs: textSeenAt - currentModelRequestAt,
          firstRequestToTextMs: textSeenAt - firstModelRequestAt, modelRequestNumber });
        log.info({ conversationId, runId, modelRef: latencyModelRef, thinking: latencyReasoning ?? 'off',
          phase: 'first_model_text', modelFirstTextMs: textSeenAt - currentModelRequestAt,
          firstRequestToTextMs: textSeenAt - firstModelRequestAt, modelRequestNumber },
        'Embedded first response text ready');
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        recordPromptCacheTouch(conversationId, resolvedModel, event.message.usage);
      }
      if (event.type === 'tool_execution_end') {
        markTurnToolResult(conversationId, runId, event.toolName);
        if (event.toolName === 'send_message' && !event.isError) sentVisibleMessage = true;
      }
      onEvent?.({ ...event, runId });
    }, params.onAgentEvent);

    const abortListener = () => {
      void session.abort();
    };
    runAbortSignal.addEventListener('abort', abortListener, { once: true });

    try {
      // Startup awaits may finish after cancellation, before the listener was registered.
      if (runAbortSignal.aborted) {
        return { ok: false, terminationReason: resolveAgentAbortReason(runAbortSignal.reason), errorMessage: 'aborted' };
      }
      await runAgentTurnWithTimeout(
        session.agent,
        () => withDelegationScope({ tools,
          getToolContext: () => {
            const message = session.agent.state.messages.findLast(item => item.role === 'assistant');
            return message?.role === 'assistant' ? { assistantMessage: message, context: { messages: session.agent.state.messages, tools: session.agent.state.tools } } : undefined;
          },
          authorizeToolCall: params.turnPolicy ? (context, signal) => runWithEmbeddedExecutionSession(conversationId,
            () => params.turnPolicy!.beforeToolCall(context, signal), runId) : undefined,
        }, async () => {
          // The timeout wrapper defers this callback to a microtask.
          if (runAbortSignal.aborted) return;
          const connectionResume = getConnectionResumeInput(conversationId, runId) ?? getMcpSetupResumeInput(conversationId, runId);
          const clarificationResume = getClarificationResumeInput(conversationId, runId);
          const phoneResume = phoneResumeForRun(conversationId, runId);
          if (phoneResume) {
            await session.sendCustomMessage({ customType: 'phone_resume', content: userMessageToPromptText(userMessage), display: false }, { triggerTurn: true });
          } else if (connectionResume) {
            await session.sendCustomMessage({ customType: 'connection_resume', content: connectionResume.content, display: false }, { triggerTurn: true });
          } else if (clarificationResume) {
            await session.sendCustomMessage({ customType: 'clarification_resume', content: clarificationResume.content, display: false }, { triggerTurn: true });
          } else if (params.recoveryMessage && !params.resumeLastUserMessage) {
            if (!canResumeAfterModelFailure(session.agent.state.messages, ['acceptance_repair', 'model_failure'].includes(params.recoveryReason ?? '')
              ? { allowFailedReadTools: ACCEPTANCE_REPAIR_READ_TOOLS } : undefined)) throw new Error('Cannot resume because a tool outcome is unconfirmed');
            await session.sendCustomMessage({ customType: 'task_continuation', content: params.recoveryMessage, display: false }, { triggerTurn: true });
          } else if (params.resumeLastUserMessage) {
            await session.agent.continue();
          } else {
            const text = userMessageToPromptText(userMessage);
            const images = params.images ?? [];
            await session.prompt(text, images.length > 0 ? { images } : undefined);
          }
          await session.agent.waitForIdle();
          clarificationStopped ||= isClarificationSuspended(conversationId, runId);
          if (connectionStopped || clarificationStopped || phoneStopped) return;
          const recoverSettledTurn = async () => {
            if (policyStopped || connectionStopped || clarificationStopped || phoneStopped) return;
            await maybeRetryTurnAfterTransientLlmFailure(session.agent, {
              conversationId,
              log,
              signal: runAbortSignal,
              budget: requestRetryBudget,
              shouldRetry: () => !policyStopped && !connectionStopped && !clarificationStopped && !phoneStopped,
              onRetry: () => { recoveringModel = true; recoveryMessages = [...session.agent.state.messages]; },
            });
            if (policyStopped || connectionStopped || clarificationStopped || phoneStopped) return;
            const recovered = await maybeRecoverInterruptedContext({
              agent: session.agent,
              model: resolvedModel,
              conversationId,
              transcriptRuntime,
              policy: compactionPolicy,
              systemPrompt: [systemPrompt, rootInstructions].filter(Boolean).join('\n\n'),
              abortSignal: runAbortSignal,
              onEvent,
              recoveryState,
              onContextRecovered: () => { useAuthoritativeProjection = true; recoveringModel = true; },
            });
            if (recovered) await maybeRetryTurnAfterTransientLlmFailure(session.agent, {
              conversationId, log, signal: runAbortSignal,
              budget: requestRetryBudget,
              shouldRetry: () => !policyStopped && !connectionStopped && !clarificationStopped && !phoneStopped,
              onRetry: () => { recoveringModel = true; recoveryMessages = [...session.agent.state.messages]; },
            });
          };
          await recoverSettledTurn();
          const capabilityCorrection = configurationCapabilityCorrection(
            session.getAllTools().filter(tool => tool.exposure !== 'hidden').map(tool => tool.name),
            userMessageToPromptText(userMessage), lastAssistantPlainText(session),
            session.agent.state.messages.slice(configurationTurnStart));
          if (capabilityCorrection && !policyStopped && !connectionStopped && !clarificationStopped && !phoneStopped
            && !runAbortSignal.aborted && !isAssistantTurnFailed(session.agent) && !isAssistantTurnAborted(session.agent)) {
            await session.sendCustomMessage({ customType: 'configuration_capability_current', content: capabilityCorrection, display: false }, { triggerTurn: true });
            await session.agent.waitForIdle();
            await recoverSettledTurn();
          }
          if (params.requireVisibleReply && !sentVisibleMessage && !policyStopped
            && !runAbortSignal.aborted && !isAssistantTurnFailed(session.agent)
            && !isAssistantTurnAborted(session.agent)
            && lastAssistantPlainText(session).trim() === NO_REPLY) {
            await session.sendCustomMessage({
              customType: 'visible_reply_required',
              content: 'The direct user message still needs a visible response in this conversation. Answer it now. If it is unclear, ask one short clarifying question. Do not output NO_REPLY.',
              display: false,
            }, { triggerTurn: true });
            await session.agent.waitForIdle();
            await recoverSettledTurn();
          }
          // One bounded continuation closes accidental early completion without
          // forcing impossible checks or bypassing user cancellation and budgets.
          const pending = await verification.pendingContext();
          if ((params.verifyChanges ?? false) && pending && !policyStopped && !runAbortSignal.aborted
            && !isAssistantTurnFailed(session.agent) && !isAssistantTurnAborted(session.agent)) {
            await session.sendCustomMessage({
              customType: 'coding_verification', content: pending, display: false,
            }, { triggerTurn: true });
            await session.agent.waitForIdle();
            await recoverSettledTurn();
          }
        }),
        timeoutMs,
        { timeoutExtensionMs: params.timeoutExtensionMs },
      );

      if (phoneStopped) {
        const wait = phoneAssistance(conversationId);
        const text = `需要你在手机上完成一步操作。${phoneNotice ? ` ${phoneNotice}\n` : '\n'}请点击“接管手机”，完成后点击“恢复 AI 操作”，我会从当前页面继续原任务。`;
        const notice: AssistantMessage = { role: 'assistant', content: [{ type: 'text', text }],
          api: resolvedModel.api, provider: resolvedModel.provider, model: resolvedModel.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop', timestamp: Date.now() };
        runner.piSm.appendMessage(notice);
        session.agent.state.messages = [...session.agent.state.messages, notice];
        onEvent?.({ type: 'message_start', runId, message: notice });
        onEvent?.({ type: 'message_end', runId, message: notice });
        runner.piSm.appendCustomEntry('phone_assistance_required', { runId, waitId: wait?.id });
      }
      if (connectionStopped) runner.piSm.appendCustomEntry('connection_required', { runId, conversationId });
      if (clarificationStopped) runner.piSm.appendCustomEntry('clarification_required', { runId, conversationId });
      runner.piSm.appendCustomEntry('coding_verification', { runId, workspace: workspaceDir, required: params.verifyChanges ?? false, ...await verification.summary() });

      if (runAbortSignal.aborted) {
        return { ok: false, retryable: false, terminationReason: resolveAgentAbortReason(runAbortSignal.reason), errorMessage: 'aborted' };
      }
      if (isAssistantTurnAborted(session.agent)) {
        return { ok: false, retryable: false, terminationReason: 'provider_error', errorMessage: 'aborted', lastAssistantText: lastAssistantPlainText(session) };
      }
      if ((policyStopped && !policyCompleted) || lengthRecoveryExhausted || lastAssistantMessage(session.agent.state.messages)?.stopReason === 'length') {
        return { ok: false, retryable: false, errorMessage: policyStopReason ?? 'Assistant response was truncated before completion',
          stopReason: policyStopped ? 'policy_limit' : 'response_truncated',
          lastAssistantText: lastAssistantPlainText(session) };
      }
      if (isAssistantTurnFailed(session.agent)) {
        return {
          ok: false,
          retryable: canResumeAfterModelFailure(session.agent.state.messages,
            { allowFailedReadTools: ACCEPTANCE_REPAIR_READ_TOOLS }),
          terminationReason: 'provider_error',
          errorMessage: getAssistantTurnErrorMessage(session.agent) ?? 'Assistant turn failed',
          lastAssistantText: lastAssistantPlainText(session),
        };
      }

      if (params.requireVisibleReply && !sentVisibleMessage
        && lastAssistantPlainText(session).trim() === NO_REPLY) {
        return { ok: false, retryable: false, errorMessage: 'Assistant did not produce a visible reply' };
      }

      runner.piSm.appendCustomEntry('xopc.model-selection', {
        runId,
        model: `${session.agent.state.model?.provider ?? resolvedModel.provider}/${session.agent.state.model?.id ?? resolvedModel.id}`,
        thinkingLevel: session.agent.state.thinkingLevel,
      });
      return {
        ok: true,
        ...(phoneStopped ? { stopReason: 'phone_assistance_required' as const } : connectionStopped
          ? { stopReason: 'connection_required' as const }
          : clarificationStopped
            ? { stopReason: 'clarification_required' as const }
            : {}),
        lastAssistantText: lastAssistantPlainText(session),
      };
    } finally {
      session.agent.finishTurn = baseFinishTurn;
      restorePrepareNextTurn();
      restorePrepareNextTurn = undefined;
      restorePrepareRequest();
      restorePrepareRequest = undefined;
      restoreTransformContext();
      restoreTransformContext = undefined;
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
    return { ok: false, terminationReason: isAgentTurnTimeoutError(err) ? 'deadline_exceeded'
      : params.abortSignal?.aborted ? resolveAgentAbortReason(params.abortSignal.reason) : 'runtime_error', errorMessage: em };
  } finally {
    await endComputerAgentTurn(conversationId, runId);
    restorePrepareNextTurn?.();
    restorePrepareRequest?.();
    restoreTransformContext?.();
    restoreToolHooks?.();
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

async function recoverContext(...args: Parameters<typeof recoverContextUntraced>) {
  return traceOperation('context.compaction', () => recoverContextUntraced(...args));
}
