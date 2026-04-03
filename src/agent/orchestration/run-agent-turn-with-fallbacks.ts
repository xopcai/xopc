/**
 * Primary chat model + `agents.defaults.model.fallbacks`: one user turn with rollback on failure.
 * Used by channel orchestrator, gateway webchat stream, and direct CLI-style turns.
 */

import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';
import type { Model, Api } from '@mariozechner/pi-ai';

import { resolveModel } from '../../providers/index.js';
import type { ModelManager } from '../models/index.js';
import {
  isAssistantTurnAborted,
  isAssistantTurnFailed,
  maybeRetryTurnAfterTransientLlmFailure,
} from './llm-turn-retry.js';
import { AGENT_TURN_TIMEOUT_MS, runAgentTurnWithTimeout } from './run-agent-turn-with-timeout.js';

export { AGENT_TURN_TIMEOUT_MS };

type FallbackLog = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  debug?: (obj: Record<string, unknown>, msg: string) => void;
};

export async function runAgentTurnWithModelFallbacks(params: {
  agent: Agent;
  sessionKey: string;
  modelManager: ModelManager;
  userMessage: AgentMessage;
  log: FallbackLog;
  /** After `prompt` adds the user message; before `waitForIdle`. */
  afterUserPrompt?: () => Promise<void>;
  timeoutMs?: number;
}): Promise<void> {
  const { agent, sessionKey, modelManager, userMessage, log } = params;
  const timeoutMs = params.timeoutMs ?? AGENT_TURN_TIMEOUT_MS;
  const afterUserPrompt = params.afterUserPrompt ?? (async () => {});

  const candidates = modelManager.getFallbackCandidatesForSession(sessionKey);
  if (candidates.length === 0) {
    throw new Error(
      'No model candidates available. Configure agents.defaults.model and provider API keys.',
    );
  }

  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const modelRef = `${candidate.provider}/${candidate.model}`;

    let resolved: Model<Api>;
    try {
      resolved = resolveModel(modelRef);
    } catch (err) {
      lastError = err;
      log.warn({ err, modelRef, attempt: i + 1 }, 'Skipping model candidate (resolve failed)');
      continue;
    }

    const beforeLen = agent.state.messages.length;

    try {
      modelManager.applyResolvedModel(agent, resolved, modelRef);

      log.info(
        { attempt: i + 1, total: candidates.length, provider: candidate.provider, model: candidate.model },
        'Running agent turn',
      );

      const runTurn = async () => {
        await agent.prompt(userMessage);
        await afterUserPrompt();
        await agent.waitForIdle();
        await maybeRetryTurnAfterTransientLlmFailure(agent, { sessionKey, log });
      };

      await runAgentTurnWithTimeout(agent, runTurn, timeoutMs);

      if (isAssistantTurnAborted(agent)) {
        return;
      }

      if (!isAssistantTurnFailed(agent)) {
        return;
      }

      lastError = new Error(`Assistant turn failed: ${modelRef}`);
      log.warn(
        { sessionKey, attempt: i + 1, total: candidates.length, modelRef },
        'Model turn failed after retries, trying fallback',
      );
    } catch (err) {
      lastError = err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      log.warn({ err, sessionKey, attempt: i + 1, modelRef }, 'Model call threw, trying fallback');
    }

    agent.replaceMessages(agent.state.messages.slice(0, beforeLen));
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(lastError != null ? String(lastError) : 'All model candidates failed');
}
