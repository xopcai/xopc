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
import {
  isAssistantTurnAborted,
  isAssistantTurnFailed,
} from '../orchestration/llm-turn-retry.js';
import { resolveBackgroundReviewSettings } from './settings.js';
import { createBackgroundUserModelReviewTask } from './run-background-review.js';

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

  /** Reserve a due review and return the work without starting it. */
  createReviewTaskAfterUserTurn(ctx: ScheduleReviewContext): (() => Promise<void>) | undefined {
    const state = this.states.get(ctx.conversationId);
    if (!state) return undefined;
    const settings = resolveBackgroundReviewSettings(this.opts.getConfig());
    if (!settings.enabled) return undefined;
    if (isAssistantTurnAborted(ctx.agent) || isAssistantTurnFailed(ctx.agent)) return undefined;
    if (!ctx.lastAssistantText?.trim()) return undefined;
    if (!state.pendingReview) return undefined;

    state.pendingReview = false;
    return createBackgroundUserModelReviewTask({
      conversationId: ctx.conversationId,
      mainAgent: ctx.agent,
      settings,
      workspaceId: ctx.workspaceId,
      getConfig: () => this.opts.getConfig(),
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
}
