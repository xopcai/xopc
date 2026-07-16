/**
 * BackgroundReviewCoordinator — owns the per-session counters that decide when
 * to nudge the model into running a quiet user-understanding review
 * after a normal user turn finishes.
 *
 * The nudge state and review scheduling are kept out of the per-session agent
 * instance so:
 *   - `AgentInstance` no longer carries an inline counter object.
 *   - Future changes to the review cadence only touch this file.
 */

import type { Agent } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { summarizeUserUnderstandingQuality } from '../../storage/sqlite/index.js';
import { createLogger } from '../../utils/logger.js';
import { resolveAdaptiveUnderstandingCadence } from '../memory/understanding/quality.js';
import {
  isAssistantTurnAborted,
  isAssistantTurnFailed,
} from '../orchestration/llm-turn-retry.js';
import type { WorkspaceRuntime } from '../workspace-runtime/registry.js';
import {
  resolveBackgroundReviewSettings,
  type BackgroundReviewSettings,
} from './settings.js';
import { runBackgroundReviewTurn } from './run-background-review.js';

const log = createLogger('BackgroundReviewCoordinator');

interface NudgeState {
  turnsSinceReview: number;
  pendingReview: boolean;
  adaptiveIntervalTurns?: number;
  adaptiveIntervalExpiresAt?: number;
}

export interface BackgroundReviewCoordinatorOptions {
  /** Effective config snapshot used to look up review-cadence settings. */
  getConfig: () => Config | undefined;
}

export interface ScheduleReviewContext {
  sessionKey: string;
  agent: Agent;
  /** Last assistant text — review is skipped when empty. */
  lastAssistantText: string | null;
  workspaceRuntime: WorkspaceRuntime;
}

export class BackgroundReviewCoordinator {
  private readonly opts: BackgroundReviewCoordinatorOptions;
  private readonly states = new Map<string, NudgeState>();

  constructor(opts: BackgroundReviewCoordinatorOptions) {
    this.opts = opts;
  }

  /**
   * Called before the main `agent.prompt` for a user turn — bumps the memory
   * counter and arms a review when the cadence interval is hit.
   */
  beginUserTurn(sessionKey: string): void {
    const cfg = resolveBackgroundReviewSettings(this.opts.getConfig(), sessionKey);
    if (!cfg.enabled) return;

    const state = this.ensureState(sessionKey);
    const intervalTurns = this.resolveReviewInterval(cfg, state);
    state.turnsSinceReview += 1;
    if (state.turnsSinceReview >= intervalTurns) {
      state.pendingReview = true;
      state.turnsSinceReview = 0;
    }
  }

  /**
   * Fire-and-forget review after the main user turn. Decides whether to run a
   * understanding sweep based on the counter state + last assistant text,
   * and delegates the actual review to {@link runBackgroundReviewTurn}.
   */
  scheduleAfterUserTurn(ctx: ScheduleReviewContext): void {
    void this.runReviewIfNeeded(ctx).catch((err) => {
      log.warn({ err, sessionKey: ctx.sessionKey }, 'Background review failed');
    });
  }

  /** Tear down state for a session (called by `AgentManager.removeAgent`). */
  forgetSession(sessionKey: string): void {
    this.states.delete(sessionKey);
  }

  /** Clear every counter (`AgentManager.dispose` / hot reload). */
  clear(): void {
    this.states.clear();
  }

  private ensureState(sessionKey: string): NudgeState {
    const existing = this.states.get(sessionKey);
    if (existing) return existing;
    const state: NudgeState = {
      turnsSinceReview: 0,
      pendingReview: false,
    };
    this.states.set(sessionKey, state);
    return state;
  }

  private resolveReviewInterval(settings: BackgroundReviewSettings, state: NudgeState): number {
    if (!settings.adaptiveCadence || !settings.agentId) return settings.reviewIntervalTurns;
    const now = Date.now();
    if (
      state.adaptiveIntervalTurns != null
      && (state.adaptiveIntervalExpiresAt ?? 0) > now
    ) {
      return state.adaptiveIntervalTurns;
    }
    try {
      const metrics = summarizeUserUnderstandingQuality({ agentId: settings.agentId, windowDays: 30, nowMs: now });
      const decision = resolveAdaptiveUnderstandingCadence(settings.reviewIntervalTurns, metrics);
      state.adaptiveIntervalTurns = decision.effectiveIntervalTurns;
      state.adaptiveIntervalExpiresAt = now + 5 * 60_000;
      if (decision.slowed) {
        log.debug({
          agentId: settings.agentId,
          baseIntervalTurns: decision.baseIntervalTurns,
          effectiveIntervalTurns: decision.effectiveIntervalTurns,
          reasons: decision.reasons,
        }, 'User-understanding review cadence slowed by quality signals');
      }
      return decision.effectiveIntervalTurns;
    } catch {
      return settings.reviewIntervalTurns;
    }
  }

  private async runReviewIfNeeded(ctx: ScheduleReviewContext): Promise<void> {
    const state = this.states.get(ctx.sessionKey);
    if (!state) return;
    const settings = resolveBackgroundReviewSettings(this.opts.getConfig(), ctx.sessionKey);
    if (!settings.enabled) return;
    if (isAssistantTurnAborted(ctx.agent) || isAssistantTurnFailed(ctx.agent)) return;
    if (!ctx.lastAssistantText?.trim()) return;

    const shouldReview = state.pendingReview;
    state.pendingReview = false;
    if (!shouldReview) return;

    await runBackgroundReviewTurn({
      sessionKey: ctx.sessionKey,
      mainAgent: ctx.agent,
      settings,
      memoryManager: ctx.workspaceRuntime.memoryManager,
      getConfig: () => this.opts.getConfig(),
    });
  }
}
