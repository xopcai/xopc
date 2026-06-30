/**
 * BackgroundReviewCoordinator — owns the per-session counters that decide when
 * to nudge the model into running a quiet "review memory / review skills" follow-up
 * after a normal user turn finishes.
 *
 * Previously the nudge state, the `agent.subscribe` plumbing for the skill counter,
 * and the call to `runBackgroundReviewTurn` lived as private methods + a per-instance
 * field on `AgentManager`. Extracted so:
 *   - `AgentInstance` no longer carries an inline counter object.
 *   - The agent-event subscription used to count `tool_execution_end` events is
 *     owned by the coordinator; teardown is automatic on `forgetSession`.
 *   - Future changes to the nudge cadence (per-agent intervals, per-tool counters,
 *     etc.) only touch this file.
 */

import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';

import type { Config } from '../../config/schema.js';
import { createLogger } from '../../utils/logger.js';
import {
  isAssistantTurnAborted,
  isAssistantTurnFailed,
} from '../orchestration/llm-turn-retry.js';
import type { WorkspaceRuntime } from '../workspace-runtime/registry.js';
import { resolveBackgroundReviewSettings } from './settings.js';
import { runBackgroundReviewTurn } from './run-background-review.js';

const log = createLogger('BackgroundReviewCoordinator');

interface NudgeState {
  turnsSinceMemory: number;
  itersSinceSkill: number;
  pendingMemoryReview: boolean;
  unsubscribe?: () => void;
}

export interface BackgroundReviewCoordinatorOptions {
  /** Effective config snapshot used to look up review-cadence settings. */
  getConfig: () => Config | undefined;
  /** Trigger after the review turn writes skill files (lets agents reload prompts). */
  onSkillsFilesystemMutate: () => void;
}

export interface ScheduleReviewContext {
  sessionKey: string;
  agent: Agent;
  registeredToolNames: readonly string[];
  skillAllowlist?: readonly string[];
  workspacePath: string;
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
   * counter and arms `pendingMemoryReview` when the cadence interval is hit.
   */
  beginUserTurn(sessionKey: string, registeredToolNames: readonly string[]): void {
    const cfg = resolveBackgroundReviewSettings(this.opts.getConfig());
    if (!cfg.enabled || cfg.memoryNudgeInterval <= 0) return;
    if (!registeredToolNames.includes('curated_memory')) return;

    const state = this.ensureState(sessionKey);
    state.turnsSinceMemory += 1;
    if (state.turnsSinceMemory >= cfg.memoryNudgeInterval) {
      state.pendingMemoryReview = true;
      state.turnsSinceMemory = 0;
    }
  }

  /**
   * Subscribe to the agent's events to update the skill counter as the
   * conversation progresses. Idempotent per session — the previous subscription
   * is torn down before installing the new one.
   */
  attachToAgent(
    sessionKey: string,
    agent: Agent,
    registeredToolNames: readonly string[],
  ): void {
    const state = this.ensureState(sessionKey);
    state.unsubscribe?.();
    const unsub = agent.subscribe((ev: AgentEvent) => {
      const cfg = resolveBackgroundReviewSettings(this.opts.getConfig());
      if (!cfg.enabled || cfg.skillNudgeInterval <= 0) return;
      if (!registeredToolNames.includes('skill_manage')) return;
      if (ev.type === 'turn_start') {
        state.itersSinceSkill += 1;
      }
      if (ev.type === 'tool_execution_end') {
        const te = ev as Extract<AgentEvent, { type: 'tool_execution_end' }>;
        if (!te.isError && typeof te.toolName === 'string' && te.toolName.trim() === 'skill_manage') {
          state.itersSinceSkill = 0;
        }
      }
    });
    state.unsubscribe = unsub;
  }

  /**
   * Fire-and-forget review after the main user turn. Decides whether to run a
   * memory and/or skills sweep based on the counter state + last assistant text,
   * and delegates the actual review to {@link runBackgroundReviewTurn}.
   */
  scheduleAfterUserTurn(ctx: ScheduleReviewContext): void {
    void this.runReviewIfNeeded(ctx).catch((err) => {
      log.warn({ err, sessionKey: ctx.sessionKey }, 'Background review failed');
    });
  }

  /** Tear down state for a session (called by `AgentManager.removeAgent`). */
  forgetSession(sessionKey: string): void {
    const state = this.states.get(sessionKey);
    if (!state) return;
    state.unsubscribe?.();
    this.states.delete(sessionKey);
  }

  /** Tear down every subscription (`AgentManager.dispose` / hot reload). */
  clear(): void {
    for (const state of this.states.values()) {
      state.unsubscribe?.();
    }
    this.states.clear();
  }

  private ensureState(sessionKey: string): NudgeState {
    const existing = this.states.get(sessionKey);
    if (existing) return existing;
    const state: NudgeState = {
      turnsSinceMemory: 0,
      itersSinceSkill: 0,
      pendingMemoryReview: false,
    };
    this.states.set(sessionKey, state);
    return state;
  }

  private async runReviewIfNeeded(ctx: ScheduleReviewContext): Promise<void> {
    const state = this.states.get(ctx.sessionKey);
    if (!state) return;
    const settings = resolveBackgroundReviewSettings(this.opts.getConfig());
    if (!settings.enabled) return;
    if (isAssistantTurnAborted(ctx.agent) || isAssistantTurnFailed(ctx.agent)) return;
    if (!ctx.lastAssistantText?.trim()) return;

    const reviewMemory = state.pendingMemoryReview;
    state.pendingMemoryReview = false;

    let reviewSkills = false;
    if (
      settings.skillNudgeInterval > 0 &&
      ctx.registeredToolNames.includes('skill_manage') &&
      state.itersSinceSkill >= settings.skillNudgeInterval
    ) {
      reviewSkills = true;
      state.itersSinceSkill = 0;
    }

    if (!reviewMemory && !reviewSkills) return;

    await runBackgroundReviewTurn({
      sessionKey: ctx.sessionKey,
      mainAgent: ctx.agent,
      settings,
      reviewMemory,
      reviewSkills,
      registeredToolNames: [...ctx.registeredToolNames],
      skillAllowlist: ctx.skillAllowlist ? [...ctx.skillAllowlist] : undefined,
      workspacePath: ctx.workspacePath,
      skillManager: ctx.workspaceRuntime.skillManager,
      memoryManager: ctx.workspaceRuntime.memoryManager,
      getConfig: () => this.opts.getConfig(),
      onSkillsFilesystemMutate: this.opts.onSkillsFilesystemMutate,
    });
  }
}
