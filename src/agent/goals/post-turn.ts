import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { getAgentDefaultModelRef } from '../../config/schema.js';
import { resolveEffectiveAgentProfileForSession } from '../../config/agent-profile.js';
import { GoalService } from '../../goals/index.js';
import { createLogger } from '../../utils/logger.js';

import { evaluateAfterTurnHermesLike } from './evaluate-turn.js';
import { resolveGoalUiLocale } from './goal-locale.js';
import type { PersistentGoalApis } from './persistent-goal-apis.js';
import type { PersistentGoalState } from './state.js';

const log = createLogger('PersistentGoal');
const goalService = new GoalService();

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
  onGoalStatusUpdated?: (payload: {
    goalId: string;
    sessionKey: string;
    previousStatus: string;
    status: string;
    goal: import('../../goals/types.js').GoalWithDetails;
  }) => void;
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
    onGoalStatusUpdated,
  } = opts;

  if (skipPersistentGoalPostTurn) return;
  if (aborted || streamError) return;

  const meta = await apis.getSessionMetadata(sessionKey);
  if (!meta) return;

  const goal = goalService.getActiveForSession(sessionKey);
  if (!goal || goal.status !== 'active') return;

  const state: PersistentGoalState = {
    goal: goal.title,
    status: 'active',
    turnsUsed: goal.turnsUsed,
    maxTurns: goal.maxTurns,
    createdAt: goal.createdAt,
    lastTurnAt: goal.updatedAt,
    lastReason: goal.blockedReason,
    judgeModelRef: goal.judgeModelRef,
    decomposed: goal.checklist.length > 0 ? true : undefined,
    uiLocale: goal.uiLocale,
    checklist: goal.checklist.map((it) => ({
      text: it.text,
      status: it.status,
      addedBy: it.addedBy,
      addedAt: it.addedAt,
      completedAt: it.completedAt,
      evidence: it.evidenceSummary,
    })),
  };

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

  if (decision.newState) {
    const ns = decision.newState;
    const completedChecklistItemIds = decision.completedChecklistItemIndexes
      ?.map((index) => goal.checklist[index]?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    try {
      const updatedGoal = goalService.syncPostTurnState({
        goalId: goal.id,
        sessionKey,
        source: 'chat',
        status: ns.status === 'done'
          ? 'done'
          : decision.verdict === 'blocked'
            ? 'blocked'
            : decision.verdict === 'needs_input'
              ? 'needs_input'
              : ns.status === 'paused'
                ? 'paused'
                : 'active',
        turnsUsed: ns.turnsUsed,
        maxTurns: ns.maxTurns,
        reason: ns.pausedReason ?? decision.reason,
        nextAction: decision.continuationPrompt ?? undefined,
        assistantPreview: assistantPlainText,
        verdict: decision.verdict === 'done'
          ? 'done'
          : decision.verdict === 'decompose'
            ? 'decompose'
            : decision.verdict === 'blocked'
              ? 'blocked'
              : decision.verdict === 'needs_input'
                ? 'needs_input'
                : 'continue',
        confidence: decision.confidence,
        missingEvidence: decision.missingEvidence,
        userQuestion: decision.userQuestion,
        completedChecklistItemIds,
        checklist: ns.checklist?.map((it) => ({
          text: it.text,
          status: it.status,
          addedBy: it.addedBy,
          addedAt: it.addedAt,
          completedAt: it.completedAt,
          evidenceSummary: it.evidence,
        })),
      });
      if (updatedGoal && updatedGoal.status !== goal.status) {
        onGoalStatusUpdated?.({
          goalId: goal.id,
          sessionKey,
          previousStatus: goal.status,
          status: updatedGoal.status,
          goal: updatedGoal,
        });
      }
    } catch (err) {
      log.warn(
        { err, sessionKey, goalId: goal.id },
        `Persistent goal: SQLite goal update failed: ${err instanceof Error ? err.message : String(err)}`,
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
