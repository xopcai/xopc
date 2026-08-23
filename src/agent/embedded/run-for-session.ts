import crypto from 'node:crypto';
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { ModelManager } from '../models/index.js';
import type { SessionStore } from '../../session/store.js';
import { resolveAgentTurnTimeoutMs } from '../orchestration/run-agent-turn-with-timeout.js';
import { runXopcEmbeddedTurn } from './run-turn.js';
import type { EmbeddedStreamEvent, RunXopcEmbeddedTurnParams, RunXopcEmbeddedTurnResult } from './types.js';
import { applyStartupContextToUserMessage } from '../reply/apply-turn-user-enrichment.js';
import { createLogger } from '../../utils/logger.js';
import { resolveModel } from '../../providers/index.js';
import { evaluateContextBudget } from '../memory/context-budget.js';
import { resolveCompactionPolicy } from '../memory/compaction-policy.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';

const log = createLogger('EmbeddedTurnForSession');

export type RunEmbeddedForSessionParams = {
  sessionKey: string;
  runId?: string;
  userMessage: AgentMessage;
  llmImages?: import('@earendil-works/pi-ai').ImageContent[];
  sessionStore: SessionStore;
  agentManager: AgentInstanceGateway;
  modelManager: ModelManager;
  thinkingOverride?: string | null;
  abortSignal?: AbortSignal;
  /** Absolute parent deadline. The turn's own timeout is capped to the remaining budget. */
  deadlineAtMs?: number;
  onEvent?: (event: EmbeddedStreamEvent) => void;
  getConfig?: () => Config | undefined;
  beforeTurn?: () => void | Promise<void>;
  afterTurn?: (userPlain: string) => void | Promise<void>;
  startupAction?: 'new' | 'reset';
  forceStartupContext?: boolean;
  applyStartupContext?: boolean;
};

export async function runEmbeddedTurnForSession(
  params: RunEmbeddedForSessionParams,
): Promise<RunXopcEmbeddedTurnResult> {
  const { sessionKey, agentManager, modelManager, sessionStore, userMessage } = params;
  const runId = params.runId ?? crypto.randomUUID();

  await params.beforeTurn?.();

  const agent = (agentManager as any).getOrCreateAgent(sessionKey) as {
    state: {
      tools: RunXopcEmbeddedTurnParams['tools'];
      systemPrompt?: string;
      thinkingLevel?: ThinkingLevel;
    };
  };
  const mm = modelManager as any;
  const configuredModelRef = String(mm.getModelForSession(sessionKey));
  const candidates = typeof mm.getFallbackCandidatesForSession === 'function'
    ? mm.getFallbackCandidatesForSession(sessionKey)
    : [];
  const candidateModelRefs = candidates.length > 0
    ? candidates.map((candidate: { provider: string; model: string }) => `${candidate.provider}/${candidate.model}`)
    : [configuredModelRef];
  const resolvedCandidates: Array<{
    ref: string;
    model: RunXopcEmbeddedTurnParams['model'];
  }> = [];
  for (const [index, ref] of candidateModelRefs.entries()) {
    try {
      const resolved = index === 0 && typeof mm.getResolvedModelForSession === 'function'
        ? mm.getResolvedModelForSession(sessionKey)
        : resolveModel(ref);
      resolvedCandidates.push({
        ref,
        model: resolved as RunXopcEmbeddedTurnParams['model'],
      });
    } catch (err) {
      log.warn({ err, sessionKey, runId, modelRef: ref }, 'Skipping unavailable model candidate');
    }
  }
  const primary = resolvedCandidates[0];
  if (!primary) throw new Error(`No available model candidates for '${configuredModelRef}'`);

  const modelRef = primary.ref;
  const model = primary.model;
  if (typeof mm.applyResolvedModel === 'function') {
    mm.applyResolvedModel(agent, model, modelRef);
  } else {
    await mm.applyModelForSession(agent, sessionKey);
  }
  agentManager.setModelForSession(sessionKey, modelRef);
  const tools = agent.state.tools;
  const systemPrompt = agent.state.systemPrompt ?? '';
  const thinkingLevel = (params.thinkingOverride as ThinkingLevel | undefined) ?? agent.state.thinkingLevel;
  const workspaceDir = agentManager.getResolvedWorkspaceForSession(sessionKey);
  const config = params.getConfig?.();
  const cacheRetention = config
    ? resolveEffectiveAgentProfileForSession(config, sessionKey).manifest.runtime?.promptCacheRetention
    : undefined;
  const configuredTurnTimeoutMs = resolveAgentTurnTimeoutMs(config, sessionKey);
  const turnTimeoutMs = params.deadlineAtMs === undefined
    ? configuredTurnTimeoutMs
    : Math.max(1, Math.min(configuredTurnTimeoutMs, params.deadlineAtMs - Date.now()));

  let userMessageForTurn = userMessage;
  if (params.applyStartupContext !== false) {
    userMessageForTurn = await applyStartupContextToUserMessage({
      userMessage,
      sessionKey,
      workspaceDir,
      cfg: config,
      sessionStore,
      startupAction: params.startupAction,
      force: params.forceStartupContext,
    });
  }

  const result = await (async () => {
      await maybeAutoCompactBeforeTurn({
        sessionKey,
        sessionStore,
        agentManager,
        model,
        config,
        systemPrompt,
        userMessage: userMessageForTurn,
        tools,
        imageCount: params.llmImages?.length ?? 0,
        fallbackModels: resolvedCandidates.slice(1).map((candidate) => candidate.model),
        abortSignal: params.abortSignal,
        onEvent: params.onEvent,
      });

      log.info(
        {
          sessionKey,
          runId,
          configuredModelRef,
          primaryModelRef: modelRef,
          candidateModelRefs: resolvedCandidates.map((candidate) => candidate.ref),
        },
        'Agent model fallback candidates resolved',
      );

      let lastResult: RunXopcEmbeddedTurnResult | undefined;
      let lastError: unknown;
      let resumeLastUserMessage = false;
      const primaryModelRef = modelRef;

      for (let i = 0; i < resolvedCandidates.length; i++) {
        const candidate = resolvedCandidates[i]!;
        const candidateModelRef = candidate.ref;
        const isFallbackAttempt = i > 0;
        const candidateModel = candidate.model;
        const hasNextCandidate = i + 1 < resolvedCandidates.length;
        const rowsBeforeAttempt = hasNextCandidate
          ? await sessionStore.loadTranscriptRows(sessionKey)
          : undefined;

        if (typeof mm.applyResolvedModel === 'function') {
          mm.applyResolvedModel(agent, candidateModel, candidateModelRef);
        }
        agentManager.setModelForSession(sessionKey, candidateModelRef);

        if (isFallbackAttempt) {
          log.info(
            {
              sessionKey,
              runId,
              primaryModelRef,
              fallbackModelRef: candidateModelRef,
              attempt: i + 1,
              total: resolvedCandidates.length,
            },
            'Agent model fallback started',
          );
        }

        try {
          const turnResult = await runXopcEmbeddedTurn({
            sessionKey,
            runId,
            userMessage: userMessageForTurn,
            images: params.llmImages,
            model: candidateModel,
            modelRef: candidateModelRef,
            tools,
            systemPrompt,
            thinkingLevel,
            cacheRetention,
            workspaceDir,
            sessionStore,
            timeoutMs: turnTimeoutMs,
            abortSignal: params.abortSignal,
            onEvent: params.onEvent,
            resumeLastUserMessage,
          });

          if (turnResult.ok) {
            if (isFallbackAttempt) {
              log.info(
                {
                  sessionKey,
                  runId,
                  primaryModelRef,
                  fallbackModelRef: candidateModelRef,
                  attempt: i + 1,
                  total: resolvedCandidates.length,
                },
                'Agent model fallback succeeded',
              );
            }
            return turnResult;
          }

          lastResult = turnResult;
          log.warn(
            {
              sessionKey,
              runId,
              modelRef: candidateModelRef,
              attempt: i + 1,
              total: resolvedCandidates.length,
              hasNextCandidate,
              errorMessage: turnResult.errorMessage,
            },
            hasNextCandidate
              ? 'Agent model turn failed, trying fallback'
              : 'Agent model turn failed, no fallback remains',
          );
        } catch (err) {
          lastError = err;
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          log.warn(
            { err, sessionKey, runId, modelRef: candidateModelRef, attempt: i + 1, total: resolvedCandidates.length, hasNextCandidate },
            hasNextCandidate
              ? 'Agent model call threw, trying fallback'
              : 'Agent model call threw, no fallback remains',
          );
        }

        if (hasNextCandidate && rowsBeforeAttempt) {
          const preparation = await sessionStore.prepareModelFallback(sessionKey, rowsBeforeAttempt);
          if (preparation === 'unsafe') {
            log.warn(
              { sessionKey, runId, modelRef: candidateModelRef, attempt: i + 1 },
              'Agent model fallback skipped because the failed attempt changed the transcript',
            );
            break;
          }
          resumeLastUserMessage = preparation === 'resume';
        }
      }

      if (lastResult) return lastResult;
      if (lastError instanceof Error) throw lastError;
      if (lastError != null) throw new Error(String(lastError));
      return { ok: false, errorMessage: 'No model candidates available' };
  })();

  return result;
}

// ---------------------------------------------------------------------------
// Pre-turn automatic compaction
// ---------------------------------------------------------------------------

function serializedTranscriptBytes(messages: readonly AgentMessage[]): number {
  return Buffer.byteLength(JSON.stringify(messages), 'utf8');
}

async function maybeAutoCompactBeforeTurn(opts: {
  sessionKey: string;
  sessionStore: SessionStore;
  agentManager: AgentInstanceGateway;
  model: RunXopcEmbeddedTurnParams['model'];
  config: Config | undefined;
  systemPrompt: string;
  userMessage: AgentMessage;
  tools: RunXopcEmbeddedTurnParams['tools'];
  imageCount: number;
  fallbackModels: RunXopcEmbeddedTurnParams['model'][];
  abortSignal?: AbortSignal;
  onEvent?: (event: EmbeddedStreamEvent) => void;
}): Promise<void> {
  const {
    sessionKey,
    sessionStore,
    agentManager,
    model,
    config,
    systemPrompt,
    userMessage,
    tools,
    imageCount,
    fallbackModels,
    abortSignal,
    onEvent,
  } = opts;
  const policy = resolveCompactionPolicy(config);

  const contextWindow = (model as { contextWindow?: number }).contextWindow ?? 128_000;
  const messages = await sessionStore.load(sessionKey);
  const activeTranscriptBytes = serializedTranscriptBytes(messages);
  const byteLimitExceeded =
    policy.enabled && activeTranscriptBytes > policy.maxActiveTranscriptBytes;
  const budget = evaluateContextBudget({
    messages,
    contextWindow,
    systemPrompt,
    currentUserMessage: userMessage,
    tools,
    imageCount,
    triggerThreshold: policy.triggerThreshold,
    reserveTokens: policy.reserveTokens,
    minToolResultKeepChars: policy.minToolResultKeepChars,
    canCompact: messages.length >= policy.minMessagesBeforeCompact,
  });

  if (
    !byteLimitExceeded &&
    (budget.route === 'fits' || budget.route === 'truncate_tool_results_only')
  ) {
    return;
  }

  if (!policy.enabled) {
    if (budget.estimatedTokens <= budget.hardLimitTokens) return;
    const fitsAfterToolPruning = budget.estimatedTokens - budget.reducibleToolResultTokens
      <= budget.hardLimitTokens;
    if (fitsAfterToolPruning) return;
    throw new Error(
      `Context budget exceeded (${budget.estimatedTokens}/${budget.hardLimitTokens} tokens) and compaction is disabled`,
    );
  }

  log.info(
    {
      sessionKey,
      route: budget.route,
      estimatedTokens: budget.estimatedTokens,
      usagePercent: budget.usagePercent,
      contextWindow,
      activeTranscriptBytes,
      maxActiveTranscriptBytes: policy.maxActiveTranscriptBytes,
      byteLimitExceeded,
    },
    'Pre-turn auto-compaction triggered',
  );

  onEvent?.({
    type: 'compaction',
    status: 'started',
    tokensBefore: budget.estimatedTokens,
  });

  try {
    let summaryModel = model;
    let summaryFallbackModels = fallbackModels;
    if (policy.model) {
      summaryModel = resolveModel(policy.model) as RunXopcEmbeddedTurnParams['model'];
      const summaryRef = `${summaryModel.provider}/${summaryModel.id}`;
      summaryFallbackModels = [model, ...fallbackModels].filter(
        (candidate) => `${candidate.provider}/${candidate.id}` !== summaryRef,
      );
    }
    const result = await sessionStore.compact(
      sessionKey,
      messages,
      summaryModel,
      undefined,
      byteLimitExceeded || budget.estimatedTokens > budget.hardLimitTokens,
      { fallbackModels: summaryFallbackModels, signal: abortSignal },
    );

    if (result.compacted) {
      // Evict the cached agent so the next turn reloads from the compacted transcript
      agentManager.removeAgent(sessionKey);

      log.info(
        { sessionKey, tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter },
        'Pre-turn auto-compaction completed',
      );

      onEvent?.({
        type: 'compaction',
        status: 'completed',
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        summary: result.summary.length > 200 ? `${result.summary.slice(0, 200)}…` : result.summary,
      });
    } else {
      if (byteLimitExceeded || budget.estimatedTokens > budget.hardLimitTokens) {
        throw new Error(
          byteLimitExceeded
            ? `Active transcript size exceeded (${activeTranscriptBytes}/${policy.maxActiveTranscriptBytes} bytes) but no safe compaction range was available`
            : `Context budget exceeded (${budget.estimatedTokens}/${budget.hardLimitTokens} tokens) but no safe compaction range was available`,
        );
      }
      onEvent?.({ type: 'compaction', status: 'skipped' });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.warn(
      { err, sessionKey, estimatedTokens: budget.estimatedTokens, activeTranscriptBytes },
      `Pre-turn auto-compaction failed: ${errorMessage}`,
    );
    onEvent?.({ type: 'compaction', status: 'skipped' });
    if (byteLimitExceeded || budget.estimatedTokens > budget.hardLimitTokens) {
      throw err;
    }
  }
}
