import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { getAgentDefaultModelRef } from '../../config/schema.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { createLogger } from '../../utils/logger.js';

import { evaluateAfterTurnHermesLike } from './evaluate-turn.js';
import { appendGoalRun } from './goal-run-store.js';
import { resolveGoalUiLocale } from './goal-locale.js';
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

function resolveJudgeModelRef(
  config: Config | undefined,
  sessionKey: string,
  storedJudge?: string,
  runtimeSessionModelRef?: string,
): string | undefined {
  const fromCfg = config?.goals?.judgeModelRef?.trim();
  if (fromCfg) return fromCfg;
  if (storedJudge?.trim()) return storedJudge.trim();
  if (config) {
    const profile = resolveEffectiveAgentProfileForSession(config, sessionKey);
    if (profile.primaryModelRef?.trim()) return profile.primaryModelRef.trim();
  }
  if (runtimeSessionModelRef?.trim()) return runtimeSessionModelRef.trim();
  if (config) return getAgentDefaultModelRef(config);
  return undefined;
}

async function appendAssistantLine(apis: PersistentGoalApis, sessionKey: string, text: string): Promise<void> {
  await apis.appendAssistantReceipt(sessionKey, text);
}

export async function handlePersistentGoalPostTurn(opts: {
  apis: PersistentGoalApis;
  sessionKey: string;
  assistantPlainText: string;
  aborted: boolean;
  streamError?: string;
  skipPersistentGoalPostTurn: boolean;
  config: Config | undefined;
  /** Active session model (overrides, per-agent defaults) when goals/global defaults are unset. */
  runtimeSessionModelRef?: string;
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
    runtimeSessionModelRef,
    signal,
    publishVerdictToChannel,
  } = opts;

  if (skipPersistentGoalPostTurn) return;
  if (aborted || streamError) return;

  const meta = await apis.getSessionMetadata(sessionKey);
  if (!meta) return;

  const state = readPersistentGoal(meta.customData as Record<string, unknown> | undefined);
  if (!state || state.status !== 'active') return;

  const judgeRef = resolveJudgeModelRef(config, sessionKey, state.judgeModelRef, runtimeSessionModelRef);
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
    uiLocale: resolveGoalUiLocale(state),
  });

  const baseCustom = { ...(meta.customData as Record<string, unknown> | undefined) };

  if (decision.newState) {
    const merged = mergeCustomDataPatch(baseCustom, {
      [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(decision.newState),
    });
    await apis.updateSessionMetadata(sessionKey, { customData: merged });
  }

  if (config) {
    try {
      await appendGoalRun({
        config,
        sessionKey,
        decision,
        assistantPlainText,
      });
    } catch (err) {
      log.warn(
        { err, sessionKey },
        `Persistent goal: goal run append failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
