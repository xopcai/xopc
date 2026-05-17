import { existsSync } from 'node:fs';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { createAgentSession, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { Model, Api } from '@earendil-works/pi-ai';

import { createLogger } from '../../utils/logger.js';
import { guardSessionManager, type GuardedPiTranscriptManager } from './session-tool-result-guard-wrapper.js';
import { prepareSessionManagerForRun } from './session-manager-init.js';
import { prewarmSessionFile } from './session-manager-cache.js';
import { registerEmbeddedRun, unregisterEmbeddedRun } from './runs.js';
import { subscribeEmbeddedSessionEvents, lastAssistantPlainText } from './subscribe-session.js';
import type { RunXopcEmbeddedTurnParams, RunXopcEmbeddedTurnResult } from './types.js';
import { xopcToolsToDefinitions } from './xopc-tools-bridge.js';
import {
  isAssistantTurnAborted,
  isAssistantTurnFailed,
  maybeRetryTurnAfterTransientLlmFailure,
} from '../orchestration/llm-turn-retry.js';
import { runAgentTurnWithTimeout, resolveAgentTurnTimeoutMs } from '../orchestration/run-agent-turn-with-timeout.js';

const log = createLogger('EmbeddedRun');

/** xopc compacts via {@link SessionStore}; disable pi-coding-agent auto-compaction (unsafe without usage). */
function createEmbeddedSettingsManager(cwd: string): SettingsManager {
  const sm = SettingsManager.inMemory({ compaction: { enabled: false } });
  sm.setCompactionEnabled(false);
  void cwd;
  return sm;
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
      .filter((b): b is { type: 'text'; text: string } => !!b && typeof b === 'object' && (b as { type?: string }).type === 'text')
      .map((b) => b.text)
      .join('');
  }
  return '';
}

export async function runXopcEmbeddedTurn(params: RunXopcEmbeddedTurnParams): Promise<RunXopcEmbeddedTurnResult> {
  const {
    sessionKey,
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
  const { sessionId, absPath: sessionFile, sessionsDir } = await sessionStore.resolveTranscriptPath(sessionKey);
  const hadSessionFile = existsSync(sessionFile);

  await prewarmSessionFile(sessionFile);
  const settingsManager = createEmbeddedSettingsManager(workspaceDir);

  let piSm: GuardedPiTranscriptManager | undefined;
  let unsubscribe: (() => void) | undefined;

  try {
    piSm = guardSessionManager(SessionManager.open(sessionFile, sessionsDir, workspaceDir), {
      sessionKey,
      contextWindowTokens: resolvedModel.contextWindow ?? 128_000,
    });

    await prepareSessionManagerForRun({
      sessionManager: piSm,
      sessionFile,
      hadSessionFile,
      sessionId,
      cwd: workspaceDir,
    });

    const toolDefs = xopcToolsToDefinitions(tools);
    const toolNames = tools.map((t) => t.name);

    const { session } = await createAgentSession({
      cwd: workspaceDir,
      model: resolvedModel,
      thinkingLevel: thinkingLevel ?? 'medium',
      sessionManager: piSm,
      settingsManager,
      noTools: 'builtin',
      customTools: toolDefs,
      tools: toolNames,
    });

    session.agent.state.systemPrompt = systemPrompt;

    if (onEvent) {
      unsubscribe = subscribeEmbeddedSessionEvents(session, onEvent);
    }

    const handle = {
      sessionKey,
      sessionId,
      runId,
      session,
      abort: async () => {
        await session.abort();
      },
    };
    registerEmbeddedRun(handle);

    const abortListener = () => {
      void session.abort();
    };
    if (params.abortSignal) {
      if (params.abortSignal.aborted) {
        await session.abort();
        return { ok: false, errorMessage: 'aborted' };
      }
      params.abortSignal.addEventListener('abort', abortListener, { once: true });
    }

    try {
      await runAgentTurnWithTimeout(
        session.agent,
        async () => {
          const text = userMessageToPromptText(userMessage);
          await session.prompt(text, params.images?.length ? { images: params.images } : undefined);
          await session.agent.waitForIdle();
          await maybeRetryTurnAfterTransientLlmFailure(session.agent, { sessionKey, log });
        },
        timeoutMs,
      );

      if (isAssistantTurnAborted(session.agent)) {
        return { ok: true, lastAssistantText: lastAssistantPlainText(session) };
      }
      if (isAssistantTurnFailed(session.agent)) {
        return {
          ok: false,
          errorMessage: 'Assistant turn failed',
          lastAssistantText: lastAssistantPlainText(session),
        };
      }

      return { ok: true, lastAssistantText: lastAssistantPlainText(session) };
    } finally {
      params.abortSignal?.removeEventListener('abort', abortListener);
      unregisterEmbeddedRun(handle);
    }
  } catch (err) {
    const em = err instanceof Error ? err.message : String(err);
    log.error({ err, sessionKey, runId }, `Embedded run failed: ${em}`);
    onEvent?.({ type: 'error', content: em });
    return { ok: false, errorMessage: em };
  } finally {
    unsubscribe?.();
    try {
      piSm?.flushPendingToolResults?.();
    } catch {
      /* ignore */
    }
  }
}

export { abortEmbeddedRun, queueEmbeddedSteer } from './runs.js';
