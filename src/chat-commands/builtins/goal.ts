/**
 * Persistent `/goal` (Hermes-style Ralph loop) on any channel with session metadata.
 */

import type { CommandContext, CommandDefinition } from '../types.js';
import { commandRegistry } from '../registry.js';

import {
  defaultMaxTurns,
  mergeCustomDataPatch,
  readPersistentGoal,
  serializePersistentGoal,
  PERSISTENT_GOAL_CUSTOM_KEY,
  type PersistentGoalState,
} from '../../agent/goals/state.js';
import { applyPersistentGoalUserAction } from '../../agent/goals/patch-from-user-action.js';

function statusLine(state: NonNullable<ReturnType<typeof readPersistentGoal>>): string {
  const turns = `${state.turnsUsed}/${state.maxTurns} turns`;
  if (state.status === 'active') {
    return `⊙ Goal (active, ${turns}): ${state.goal}`;
  }
  if (state.status === 'paused') {
    const extra = state.pausedReason ? ` — ${state.pausedReason}` : '';
    return `⏸ Goal (paused, ${turns}${extra}): ${state.goal}`;
  }
  if (state.status === 'done') {
    return `✓ Goal done (${turns}): ${state.goal}`;
  }
  return `Goal (${state.status}, ${turns}): ${state.goal}`;
}

async function patchGoalMetadata(
  ctx: CommandContext,
  patchCustom: (base: Record<string, unknown>) => Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apis = ctx.persistentGoalApis;
  if (!apis) return { ok: false, error: 'Goals unavailable on this surface.' };
  const meta = await apis.getSessionMetadata(ctx.sessionKey);
  if (!meta) return { ok: false, error: 'Session not found' };
  const base = { ...(meta.customData as Record<string, unknown> | undefined) };
  const customData = patchCustom(base);
  await apis.updateSessionMetadata(ctx.sessionKey, { customData });
  return { ok: true };
}

const goalCommand: CommandDefinition = {
  id: 'system.goal',
  name: 'goal',
  description:
    'Set or manage a standing goal (Hermes-style): status, pause, resume, clear; auto-continues until done or budget hit',
  category: 'system',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/goal Ship the fix', '/goal status', '/goal pause', '/goal resume', '/goal clear'],
  handler: async (ctx: CommandContext, args: string) => {
    const apis = ctx.persistentGoalApis;
    if (!apis) {
      return {
        content: 'Goals unavailable on this surface.',
        success: false,
      };
    }

    const t = args.trim();
    const lower = t.toLowerCase();

    if (!t || lower === 'status') {
      const meta = await apis.getSessionMetadata(ctx.sessionKey);
      const s = readPersistentGoal(meta?.customData as Record<string, unknown> | undefined);
      if (!s || s.status === 'cleared') {
        return {
          content: 'No active goal. Set one with /goal <text>.',
          success: true,
        };
      }
      return { content: statusLine(s), success: true };
    }

    if (lower === 'pause') {
      const meta = await apis.getSessionMetadata(ctx.sessionKey);
      const applied = applyPersistentGoalUserAction(
        meta?.customData as Record<string, unknown> | undefined,
        'pause',
      );
      if (applied.kind === 'error') {
        return { content: applied.error, success: false };
      }
      if (applied.kind === 'noop') {
        return { content: applied.message, success: true };
      }
      const r = await patchGoalMetadata(ctx, () => applied.customData);
      if (!r.ok) return { content: 'error' in r ? r.error : 'Failed', success: false };
      const s = readPersistentGoal(applied.customData);
      return { content: `⏸ Goal paused: ${s?.goal ?? ''}`, success: true };
    }

    if (lower === 'resume') {
      const meta = await apis.getSessionMetadata(ctx.sessionKey);
      const applied = applyPersistentGoalUserAction(
        meta?.customData as Record<string, unknown> | undefined,
        'resume',
      );
      if (applied.kind === 'error') {
        return { content: applied.error, success: false };
      }
      if (applied.kind === 'noop') {
        return { content: applied.message, success: true };
      }
      const r = await patchGoalMetadata(ctx, () => applied.customData);
      if (!r.ok) return { content: 'error' in r ? r.error : 'Failed', success: false };
      const s = readPersistentGoal(applied.customData);
      return {
        content:
          `▶ Goal resumed: ${s?.goal ?? ''}\n` +
          'Send any message to continue, or wait — the next assistant turn will pick up from here.',
        success: true,
      };
    }

    if (lower === 'clear' || lower === 'stop' || lower === 'done') {
      const meta = await apis.getSessionMetadata(ctx.sessionKey);
      const had = !!readPersistentGoal(meta?.customData as Record<string, unknown> | undefined);
      const applied = applyPersistentGoalUserAction(
        meta?.customData as Record<string, unknown> | undefined,
        'clear',
      );
      if (applied.kind === 'error') {
        return { content: applied.error, success: false };
      }
      if (applied.kind === 'noop') {
        return { content: applied.message, success: true };
      }
      const r = await patchGoalMetadata(ctx, () => applied.customData);
      if (!r.ok) return { content: 'error' in r ? r.error : 'Failed', success: false };
      return { content: had ? '✓ Goal cleared.' : 'No active goal.', success: true };
    }

    // New goal text — Hermes rejects when another inbound turn is in flight for this session.
    const depth = apis.inboundConcurrentDepth(ctx.sessionKey);
    if (depth > 1) {
      return {
        content:
          'Agent is running — use /goal status / pause / clear mid-run, or wait for the current turn to finish before setting a new goal.',
        success: false,
      };
    }

    const maxTurns = defaultMaxTurns(ctx.config.goals);
    const judgeModelRef =
      typeof ctx.config.goals?.judgeModelRef === 'string' ? ctx.config.goals.judgeModelRef.trim() : undefined;

    const next: PersistentGoalState = {
      goal: t,
      status: 'active',
      turnsUsed: 0,
      maxTurns,
      createdAt: Date.now(),
      lastTurnAt: 0,
      ...(judgeModelRef ? { judgeModelRef } : {}),
    };

    const r = await patchGoalMetadata(ctx, (base) =>
      mergeCustomDataPatch(base, { [PERSISTENT_GOAL_CUSTOM_KEY]: serializePersistentGoal(next) }),
    );
    if (!r.ok) return { content: 'error' in r ? r.error : 'Failed', success: false };

    apis.scheduleContinuation(ctx.sessionKey, next.goal);

    return {
      content:
        `⊙ Goal set (${next.maxTurns}-turn budget): ${next.goal}\n` +
        "I'll keep working until the goal is done, you pause/clear it, or the budget is exhausted.\n" +
        'Controls: /goal status · /goal pause · /goal resume · /goal clear',
      success: true,
    };
  },
};

export function registerGoalCommand(): void {
  commandRegistry.register(goalCommand);
}
