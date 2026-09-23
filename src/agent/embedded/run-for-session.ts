import crypto from 'node:crypto';
import { voicePresentationPrompt } from '../prompt/voice-presentation.js';
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';
import { parseTurnOutcome } from '@xopcai/gateway-contract';

import type { Config } from '../../config/schema.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';
import type { ModelManager } from '../models/index.js';
import type { SessionStore } from '../../session/store.js';
import type { TranscriptStoredRow } from '../../session/session-context-for-llm.js';
import { resolveAgentTurnTimeoutMs } from '../orchestration/run-agent-turn-with-timeout.js';
import { runXopcEmbeddedTurn } from './run-turn.js';
import { runWithEmbeddedExecutionSession } from './execution-context.js';
import type { EmbeddedStreamEvent, RunXopcEmbeddedTurnParams, RunXopcEmbeddedTurnResult } from './types.js';
import { applyStartupContextToUserMessage } from '../reply/apply-turn-user-enrichment.js';
import { createLogger } from '../../utils/logger.js';
import { resolveModel } from '../../providers/index.js';
import { recoverContext } from '../memory/context-recovery.js';
import { resolveCompactionPolicy } from '../memory/compaction-policy.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { resolvePromptCachePolicy } from '../../providers/prompt-cache-plan.js';
import { AgentRunSupervisor } from '../orchestration/agent-run-supervisor.js';
import { projectTurnOutcome } from '../../session/turn-outcome-projector.js';
import { appendDynamicPromptSection } from '../prompt/cache-boundary.js';

const log = createLogger('EmbeddedTurnForSession');

export type RunEmbeddedForSessionParams = {
  conversationId: string;
  runId?: string;
  userMessage: AgentMessage;
  dynamicSystemContext?: string;
  llmImages?: import('@earendil-works/pi-ai').ImageContent[];
  sessionStore: SessionStore;
  agentManager: AgentInstanceGateway;
  modelManager: ModelManager;
  thinkingOverride?: string | null;
  presentation?: 'voice';
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
  const { conversationId, agentManager, modelManager, sessionStore, userMessage } = params;
  const runId = params.runId ?? crypto.randomUUID();
  const config = params.getConfig?.();
  const supervisor = new AgentRunSupervisor({
    timeoutMs: resolveAgentTurnTimeoutMs(config, conversationId),
    deadlineAtMs: params.deadlineAtMs,
    parentSignal: params.abortSignal,
  });
  const finish = async (result: RunXopcEmbeddedTurnResult): Promise<RunXopcEmbeddedTurnResult> => {
    if (result.stopReason === 'connection_required' || result.stopReason === 'clarification_required') return result;
    try {
      const rows = await sessionStore.loadTranscriptRows(conversationId);
      const hasTurn = rows.some((source) => {
        const row = source as TranscriptStoredRow & Record<string, unknown>;
        return row.turnId === runId;
      });
      const alreadyPersisted = rows.some((source) => {
        const row = source as TranscriptStoredRow & Record<string, unknown>;
        return row.type === 'custom'
          && row.customType === 'turn_outcome'
          && parseTurnOutcome(row.data)?.turnId === runId;
      });
      if (!hasTurn || alreadyPersisted) return result;

      const runStatus = result.ok
        ? 'success'
        : result.errorMessage === 'aborted'
          ? 'cancelled'
          : 'error';
      const outcome = projectTurnOutcome({
        rows,
        turnId: runId,
        runStatus,
        summary: result.errorMessage,
      });
      await sessionStore.appendTranscriptCustomEntry(conversationId, {
        customType: 'turn_outcome',
        data: outcome,
      });
      params.onEvent?.({ type: 'turn_outcome', runId, outcome });
    } catch (err) {
      log.warn({ err, conversationId, runId }, 'Turn outcome persistence failed');
    }
    return result;
  };

  try {
    await params.beforeTurn?.();
    if (supervisor.signal.aborted) return { ok: false, errorMessage: 'aborted' };

    await agentManager.ensureMemoryReadyForSession?.(conversationId);
    if (supervisor.signal.aborted) return { ok: false, errorMessage: 'aborted' };

    const agent = (agentManager as any).getOrCreateAgent(conversationId) as {
      state: {
        tools: RunXopcEmbeddedTurnParams['tools'];
        systemPrompt?: string;
        thinkingLevel?: ThinkingLevel;
      };
    };
    const mm = modelManager as any;
    const configuredModelRef = String(mm.getModelForSession(conversationId));
    const candidates = typeof mm.getFallbackCandidatesForSession === 'function'
      ? mm.getFallbackCandidatesForSession(conversationId)
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
          ? mm.getResolvedModelForSession(conversationId)
          : resolveModel(ref);
        resolvedCandidates.push({
          ref,
          model: resolved as RunXopcEmbeddedTurnParams['model'],
        });
      } catch (err) {
        log.warn({ err, conversationId, runId, modelRef: ref }, 'Skipping unavailable model candidate');
      }
    }
    const primary = resolvedCandidates[0];
    if (!primary) throw new Error(`No available model candidates for '${configuredModelRef}'`);

    const modelRef = primary.ref;
    const model = primary.model;
    if (typeof mm.applyResolvedModel === 'function') {
      mm.applyResolvedModel(agent, model, modelRef);
    } else {
      await mm.applyModelForSession(agent, conversationId);
    }
    agentManager.setModelForSession(conversationId, modelRef);
    const tools = agent.state.tools;
    const turnPolicy = agentManager.createAgentTurnPolicy(conversationId);
    const baseSystemPrompt = [agent.state.systemPrompt ?? '', params.presentation === 'voice' ? voicePresentationPrompt : '']
      .filter(Boolean).join('\n\n');
    const systemPrompt = appendDynamicPromptSection(baseSystemPrompt, params.dynamicSystemContext ?? '');
    const thinkingLevel = (params.thinkingOverride as ThinkingLevel | undefined) ?? agent.state.thinkingLevel;
    const workspaceDir = agentManager.getResolvedWorkspaceForSession(conversationId);
    const promptCachePolicy = resolvePromptCachePolicy(
      config
        ? resolveEffectiveAgentProfileForSession(conversationId).config.runtime.promptCache
        : undefined,
    );
    let userMessageForTurn = userMessage;
    if (params.applyStartupContext !== false) {
      userMessageForTurn = await applyStartupContextToUserMessage({
        userMessage,
        conversationId,
        workspaceDir,
        cfg: config,
        sessionStore,
        startupAction: params.startupAction,
        force: params.forceStartupContext,
      });
      if (supervisor.signal.aborted) return { ok: false, errorMessage: 'aborted' };
    }

    try {
      await maybeAutoCompactBeforeTurn({
        conversationId,
        sessionStore,
        agentManager,
        model,
        config,
        systemPrompt,
        userMessage: userMessageForTurn,
        tools,
        imageCount: params.llmImages?.length ?? 0,
        fallbackModels: resolvedCandidates.slice(1).map((candidate) => candidate.model),
        abortSignal: supervisor.signal,
        onEvent: params.onEvent,
      });
    } catch (err) {
      if (supervisor.signal.aborted) return { ok: false, errorMessage: 'aborted' };
      throw err;
    }
    if (supervisor.signal.aborted) return { ok: false, errorMessage: 'aborted' };

    log.info(
      {
        conversationId,
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
      const attemptPlan = supervisor.planModelAttempt(isFallbackAttempt);
      if (attemptPlan.ok === false) {
        lastResult = { ok: false, errorMessage: attemptPlan.reason };
        break;
      }
      const rowsBeforeAttempt = hasNextCandidate
        ? await sessionStore.loadTranscriptRows(conversationId)
        : undefined;

      if (typeof mm.applyResolvedModel === 'function') {
        mm.applyResolvedModel(agent, candidateModel, candidateModelRef);
      }
      agentManager.setModelForSession(conversationId, candidateModelRef);

      if (isFallbackAttempt) {
        log.info(
          {
            conversationId,
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
        const turnResult = await runWithEmbeddedExecutionSession(
          conversationId,
          () => runXopcEmbeddedTurn({
            conversationId,
            verifyChanges: config ? resolveEffectiveAgentProfileForSession(conversationId).agentId === 'coder' : false,
            runId,
            userMessage: userMessageForTurn,
            images: params.llmImages,
            model: candidateModel,
            modelRef: candidateModelRef,
            tools,
            systemPrompt,
            thinkingLevel,
            promptCachePolicy,
            compactionPolicy: resolveCompactionPolicy(config),
            workspaceDir,
            sessionStore,
            timeoutMs: attemptPlan.timeoutMs,
            turnPolicy,
            abortSignal: supervisor.signal,
            onEvent: params.onEvent,
            onAgentEvent: (event) => agentManager.emitRuntimeEvent(conversationId, event),
            resumeLastUserMessage,
          }),
          runId,
        );

        if (turnResult.ok) {
          if (isFallbackAttempt) {
            log.info(
              {
                conversationId,
                runId,
                primaryModelRef,
                fallbackModelRef: candidateModelRef,
                attempt: i + 1,
                total: resolvedCandidates.length,
              },
              'Agent model fallback succeeded',
            );
          }
          return finish(turnResult);
        }

        lastResult = turnResult;
        if (supervisor.signal.aborted || turnResult.retryable === false) break;
        log.warn(
          {
            conversationId,
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
          await finish({ ok: false, errorMessage: 'aborted' });
          throw err;
        }
        log.warn(
          { err, conversationId, runId, modelRef: candidateModelRef, attempt: i + 1, total: resolvedCandidates.length, hasNextCandidate },
          hasNextCandidate
            ? 'Agent model call threw, trying fallback'
            : 'Agent model call threw, no fallback remains',
        );
      }

      if (hasNextCandidate && rowsBeforeAttempt) {
        const preparation = await sessionStore.prepareModelFallback(conversationId, rowsBeforeAttempt);
        if (preparation === 'unsafe') {
          log.warn(
            { conversationId, runId, modelRef: candidateModelRef, attempt: i + 1 },
            'Agent model fallback skipped because the failed attempt changed the transcript',
          );
          break;
        }
        resumeLastUserMessage = preparation === 'resume';
      }
    }

    if (lastResult) return finish(lastResult);
    if (lastError != null) {
      const result = await finish({
        ok: false,
        errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
      });
      if (lastError instanceof Error) throw lastError;
      throw new Error(result.errorMessage);
    }
    return finish({ ok: false, errorMessage: 'No model candidates available' });
  } finally {
    supervisor.dispose();
  }
}

// ---------------------------------------------------------------------------
// Pre-turn automatic compaction
// ---------------------------------------------------------------------------

async function maybeAutoCompactBeforeTurn(opts: {
  conversationId: string;
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
    conversationId,
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

  let started = false;
  try {
    const recovered = await recoverContext({
      conversationId,
      policy,
      budget: {
        contextWindow: model.contextWindow ?? 128_000, systemPrompt,
        currentUserMessage: userMessage, tools, imageCount,
        triggerThreshold: policy.triggerThreshold, reserveTokens: policy.reserveTokens,
        minToolResultKeepChars: policy.minToolResultKeepChars,
      },
      summaryModel: () => policy.model ? resolveModel(policy.model) as typeof model : model,
      fallbackModels: policy.model ? [model, ...fallbackModels] : fallbackModels,
      signal: abortSignal,
      transcript: {
        loadMessages: () => sessionStore.load(conversationId),
        compact: (...args) => {
          if (!started) {
            started = true;
            onEvent?.({ type: 'compaction', status: 'started' });
          }
          return sessionStore.compact(conversationId, ...args);
        },
      },
      onCompacted: () => agentManager.removeAgent(conversationId),
    });
    if (recovered.status === 'compacted' && recovered.result) {
      const result = recovered.result;
      onEvent?.({ type: 'compaction', status: 'completed', tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter, summary: result.summary.slice(0, 200) });
    } else if (started) onEvent?.({ type: 'compaction', status: 'skipped' });
  } catch (err) {
    log.warn({ err, conversationId }, 'Pre-turn context recovery failed');
    if (started) onEvent?.({ type: 'compaction', status: 'skipped' });
    throw err;
  }
}
