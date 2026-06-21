/**
 * `/goal` — first-class goal control from any command surface.
 */

import { getDefaultAgentId } from '../../routing/resolve-route.js';
import { GoalService, type GoalWithDetails } from '../../goals/index.js';
import type { CommandContext, CommandDefinition } from '../types.js';
import { commandRegistry } from '../registry.js';

const goals = new GoalService();

function statusLine(goal: GoalWithDetails): string {
  const turns = `${goal.turnsUsed}/${goal.maxTurns} turns`;
  const progress = goal.checklist.length
    ? ` · ${goal.checklist.filter((it) => it.status === 'completed' || it.status === 'impossible').length}/${goal.checklist.length} criteria`
    : '';
  if (goal.status === 'active') return `⊙ Goal (active, ${turns}${progress}): ${goal.title}`;
  if (goal.status === 'paused') return `⏸ Goal (paused, ${turns}${progress}): ${goal.title}`;
  if (goal.status === 'blocked' || goal.status === 'needs_input') {
    const reason = goal.blockedReason ? ` — ${goal.blockedReason}` : '';
    return `⏸ Goal (${goal.status}, ${turns}${progress}${reason}): ${goal.title}`;
  }
  if (goal.status === 'done') return `✓ Goal done (${turns}${progress}): ${goal.title}`;
  return `Goal (${goal.status}, ${turns}${progress}): ${goal.title}`;
}

function activeGoal(ctx: CommandContext): GoalWithDetails | null {
  return goals.getActiveForSession(ctx.sessionKey);
}

const goalCommand: CommandDefinition = {
  id: 'system.goal',
  name: 'goal',
  description: 'Create and manage a durable goal: checklist + judge loop; /subgoal edits criteria',
  category: 'system',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: ['/goal Ship the fix', '/goal status', '/goal pause', '/goal resume', '/goal clear'],
  handler: async (ctx: CommandContext, args: string) => {
    const t = args.trim();
    const lower = t.toLowerCase();

    if (!t || lower === 'status') {
      const goal = activeGoal(ctx);
      return {
        content: goal ? statusLine(goal) : 'No active goal. Set one with /goal <text>.',
        success: true,
      };
    }

    if (lower === 'pause') {
      const goal = activeGoal(ctx);
      if (!goal) return { content: 'No active goal.', success: true };
      const next = goals.pause(goal.id);
      return { content: `⏸ Goal paused: ${next?.title ?? goal.title}`, success: true };
    }

    if (lower === 'resume') {
      const goal = activeGoal(ctx);
      if (!goal) return { content: 'No goal to resume.', success: true };
      const next = goals.resume(goal.id);
      ctx.persistentGoalApis?.scheduleContinuation(ctx.sessionKey, next?.nextAction || next?.title || goal.title);
      return { content: `▶ Goal resumed: ${next?.title ?? goal.title}`, success: true };
    }

    if (lower === 'clear' || lower === 'stop' || lower === 'archive') {
      const goal = activeGoal(ctx);
      if (!goal) return { content: 'No active goal.', success: true };
      goals.archive(goal.id);
      try {
        await ctx.abortCurrentTurn?.();
      } catch {
        return { content: '✓ Goal archived. Current turn could not be stopped automatically.', success: true };
      }
      return { content: '✓ Goal archived.', success: true };
    }

    const depth = ctx.persistentGoalApis?.inboundConcurrentDepth(ctx.sessionKey) ?? 0;
    if (depth > 1) {
      return {
        content:
          'Agent is running — use /goal status / pause / clear mid-run, or wait for the current turn to finish before setting a new goal.',
        success: false,
      };
    }

    const goal = goals.create({
      title: t,
      sessionKey: ctx.sessionKey,
      agentId: getDefaultAgentId(ctx.config),
      config: ctx.config,
      source: ctx.source === 'cli' ? 'cli' : ctx.source === 'api' ? 'api' : 'channel',
    });

    ctx.persistentGoalApis?.scheduleContinuation(ctx.sessionKey, goal.title);

    return {
      content:
        `⊙ Goal set (${goal.maxTurns}-turn budget): ${goal.title}\n` +
        "I'll keep working until the goal is done, you pause/archive it, or the budget is exhausted.\n" +
        'Controls: /goal status · /goal pause · /goal resume · /goal clear · /subgoal',
      success: true,
    };
  },
};

export function registerGoalCommand(): void {
  commandRegistry.register(goalCommand);
}
