import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { getAgentDefaultModelRef } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';

import { evaluateAfterTurnHermesLike } from './evaluate-turn.js';
import type { PersistentGoalApis } from './persistent-goal-apis.js';
import {
  PERSISTENT_GOAL_CUSTOM_KEY,
  mergeCustomDataPatch,
  readPersistentGoal,
  serializePersistentGoal,
} from './state.js';

const log = createLogger('PersistentGoal');

function buildHistoryExcerpt(messages: AgentMessage[], maxChars: number): string {
  if (maxChars <= 0) return '';
  try {
    const raw = JSON.stringify(messages);
    if (raw.length <= maxChars) return raw;
    return raw.slice(-maxChars);
  } catch {
    return '';
  }
}

function resolveJudgeModelRef(config: Config | undefined, storedJudge?: string): string | undefined {
  const fromCfg = config?.goals?.judgeModelRef?.trim();
  if (fromCfg) return fromCfg;
  if (storedJudge?.trim()) return storedJudge.trim();
  if (config) return getAgentDefaultModelRef(config);
  return undefined;
}

async function appendAssistantLine(apis: PersistentGoalApis, sessionKey: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const loaded = await apis.loadMessages(sessionKey);
  const assistantMsg = {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: trimmed }],
    timestamp: Date.now(),
  } as AgentMessage;
  await apis.saveMessages(sessionKey, [...loaded, assistantMsg]);
}

export async function handlePersistentGoalPostTurn(opts: {
  apis: PersistentGoalApis;
  sessionKey: string;
  assistantPlainText: string;
  aborted: boolean;
  streamError?: string;
  skipPersistentGoalPostTurn: boolean;
  config: Config | undefined;
  signal?: AbortSignal;
  /** Hermes-style: verdict line also sent as a normal outbound message (non-webchat). */
  publishVerdictToChannel?: (text: string) => Promise<void>;
}): Promise<void> {
  const {
    apis,
    sessionKey,
    assistantPlainText,
    aborted,
    streamError,
    skipPersistentGoalPostTurn,
    config,
    signal,
    publishVerdictToChannel,
  } = opts;

  if (skipPersistentGoalPostTurn) return;
  if (aborted || streamError) return;

  const meta = await apis.getSessionMetadata(sessionKey);
  if (!meta) return;

  const state = readPersistentGoal(meta.customData as Record<string, unknown> | undefined);
  if (!state || state.status !== 'active') return;

  const judgeRef = resolveJudgeModelRef(config, state.judgeModelRef);
  if (!judgeRef) {
    log.warn({ sessionKey }, 'Persistent goal: no judge model ref; skipping post-turn');
    return;
  }

  const goalsCfg = config?.goals;
  const historyCap = goalsCfg?.checklistHistoryChars ?? 24_000;
  let historyExcerpt = '';
  try {
    const msgs = await apis.loadMessages(sessionKey);
    historyExcerpt = buildHistoryExcerpt(msgs, historyCap);
  } catch (err) {
    log.debug(
      { err, sessionKey },
      `Persistent goal: could not load messages for judge context: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const decision = await evaluateAfterTurnHermesLike(state, assistantPlainText, judgeRef, signal, {
    goalsSlice: goalsCfg,
    historyExcerpt,
  });

  const baseCustom = { ...(meta.customData as Record<string, unknown> | undefined) };

  if (decision.newState) {
    const merged = mergeCustomDataPatch(baseCustom, {
      [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(decision.newState),
    });
    await apis.updateSessionMetadata(sessionKey, { customData: merged });
  }

  if (decision.message) {
    if (publishVerdictToChannel) {
      try {
        await publishVerdictToChannel(decision.message);
      } catch (err) {
        log.warn(
          { err, sessionKey },
          `Persistent goal: channel verdict send failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      try {
        await appendAssistantLine(apis, sessionKey, decision.message);
      } catch (err) {
        log.warn(
          { err, sessionKey },
          `Persistent goal: failed to append status message: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (decision.shouldContinue && decision.continuationPrompt) {
    apis.scheduleContinuation(sessionKey, decision.continuationPrompt);
  }
}
