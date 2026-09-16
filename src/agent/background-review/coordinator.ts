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
import { createLogger } from '../../utils/logger.js';
import {
  isAssistantTurnAborted,
  isAssistantTurnFailed,
} from '../orchestration/llm-turn-retry.js';
import { resolveBackgroundReviewSettings } from './settings.js';
import { runBackgroundUserModelReview } from './run-background-review.js';

const log = createLogger('BackgroundReviewCoordinator');

interface NudgeState {
  turnsSinceReview: number;
  pendingReview: boolean;
}

export interface BackgroundReviewCoordinatorOptions {
  /** Effective config snapshot used to look up review-cadence settings. */
  getConfig: () => Config | undefined;
}

export interface ScheduleReviewContext {
  conversationId: string;
  agent: Agent;
  /** Last assistant text — review is skipped when empty. */
  lastAssistantText: string | null;
  workspaceId: string;
}

export class BackgroundReviewCoordinator {
  private readonly opts: BackgroundReviewCoordinatorOptions;
  private readonly states = new Map<string, NudgeState>();

  constructor(opts: BackgroundReviewCoordinatorOptions) {
    this.opts = opts;
  }

  /**
   * Called before the main `agent.prompt` for a user turn — bumps the review
   * counter and arms a review when the cadence interval is hit.
   */
  beginUserTurn(conversationId: string): void {
    const cfg = resolveBackgroundReviewSettings(this.opts.getConfig());
    if (!cfg.enabled) return;

    const state = this.ensureState(conversationId);
    const intervalTurns = cfg.reviewIntervalTurns;
    state.turnsSinceReview += 1;
    if (state.turnsSinceReview >= intervalTurns) {
      state.pendingReview = true;
      state.turnsSinceReview = 0;
    }
  }

  /**
   * Fire-and-forget review after the main user turn. Decides whether to run a
   * understanding sweep based on the counter state + last assistant text,
   * and delegates the actual review to {@link runBackgroundUserModelReview}.
   */
  scheduleAfterUserTurn(ctx: ScheduleReviewContext): void {
    void this.runReviewIfNeeded(ctx).catch((err) => {
      log.warn({ err, conversationId: ctx.conversationId }, 'Background review failed');
    });
  }

  /** Tear down state for a session (called by `AgentManager.removeAgent`). */
  forgetSession(conversationId: string): void {
    this.states.delete(conversationId);
  }

  /** Clear every counter (`AgentManager.dispose` / hot reload). */
  clear(): void {
    this.states.clear();
  }

  private ensureState(conversationId: string): NudgeState {
    const existing = this.states.get(conversationId);
    if (existing) return existing;
    const state: NudgeState = {
      turnsSinceReview: 0,
      pendingReview: false,
    };
    this.states.set(conversationId, state);
    return state;
  }

  private async runReviewIfNeeded(ctx: ScheduleReviewContext): Promise<void> {
    const state = this.states.get(ctx.conversationId);
    if (!state) return;
    const settings = resolveBackgroundReviewSettings(this.opts.getConfig());
    if (!settings.enabled) return;
    if (isAssistantTurnAborted(ctx.agent) || isAssistantTurnFailed(ctx.agent)) return;
    if (!ctx.lastAssistantText?.trim()) return;

    const shouldReview = state.pendingReview;
    state.pendingReview = false;
    if (!shouldReview) return;

    await runBackgroundUserModelReview({
      conversationId: ctx.conversationId,
      mainAgent: ctx.agent,
      settings,
      workspaceId: ctx.workspaceId,
      getConfig: () => this.opts.getConfig(),
    });
  }
}
