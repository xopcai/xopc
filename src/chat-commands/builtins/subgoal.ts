/**
 * `/subgoal` — view or edit checklist criteria for the active first-class goal.
 */

import { GoalService } from '../../goals/index.js';
import type { CommandContext, CommandDefinition } from '../types.js';
import { commandRegistry } from '../registry.js';

const goals = new GoalService();

function activeGoal(ctx: CommandContext) {
  return goals.getActiveForSession(ctx.sessionKey);
}

function renderChecklist(goal: NonNullable<ReturnType<typeof activeGoal>>): string {
  if (!goal.checklist.length) return 'Checklist is empty. Add criteria with /subgoal add <text>.';
  const done = goal.checklist.filter((it) => it.status === 'completed' || it.status === 'impossible').length;
  const lines = goal.checklist.map((it, index) => {
    const marker = it.status === 'completed' ? '[x]' : it.status === 'impossible' ? '[!]' : '[ ]';
    const evidence = it.evidenceSummary ? ` (${it.evidenceSummary})` : '';
    return `${index + 1}. ${marker} ${it.text}${evidence}`;
  });
  return `Checklist (${done}/${goal.checklist.length} terminal):\n${lines.join('\n')}`;
}

const subgoalCommand: CommandDefinition = {
  id: 'system.subgoal',
  name: 'subgoal',
  description: 'View or edit checklist criteria for the active goal (add, mark, remove, reset)',
  category: 'system',
  scope: ['global', 'private', 'group'],
  acceptsArgs: true,
  examples: [
    '/subgoal',
    '/subgoal add Run tests in CI',
    '/subgoal mark 2 completed',
    '/subgoal remove 3',
    '/subgoal reset',
  ],
  handler: async (ctx: CommandContext, args: string) => {
    const goal = activeGoal(ctx);
    if (!goal) return { content: 'No active goal. Set one with /goal <text> first.', success: true };

    const t = args.trim();
    const lower = t.toLowerCase();

    if (!t || lower === 'list' || lower === 'status') {
      return { content: renderChecklist(goal), success: true };
    }

    if (lower === 'reset' || lower === 'clear') {
      goals.updateChecklist(goal.id, { type: 'reset' });
      return { content: '✓ Checklist cleared.', success: true };
    }

    const addM = t.match(/^add\s+([\s\S]+)$/i);
    if (addM) {
      const text = addM[1]!.trim();
      goals.updateChecklist(goal.id, { type: 'add', text });
      return { content: `⊙ Added checklist item: ${text}`, success: true };
    }

    const removeM = t.match(/^remove\s+(\d+)\s*$/i);
    if (removeM) {
      const index = Number(removeM[1]);
      const item = goal.checklist[index - 1];
      if (!item) return { content: `No checklist item #${index}.`, success: false };
      goals.updateChecklist(goal.id, { type: 'remove', itemId: item.id });
      return { content: `✓ Removed item #${index}.`, success: true };
    }

    const markM = t.match(/^mark\s+(\d+)\s+(pending|completed|impossible)\s*$/i);
    if (markM) {
      const index = Number(markM[1]);
      const status = markM[2]!.toLowerCase() as 'pending' | 'completed' | 'impossible';
      const item = goal.checklist[index - 1];
      if (!item) return { content: `No checklist item #${index}.`, success: false };
      goals.updateChecklist(goal.id, { type: 'mark', itemId: item.id, status });
      return { content: `⊙ Item #${index} -> ${status}.`, success: true };
    }

    return {
      content:
        'Usage:\n' +
        '• /subgoal — show checklist\n' +
        '• /subgoal add <text>\n' +
        '• /subgoal mark <n> pending|completed|impossible\n' +
        '• /subgoal remove <n>\n' +
        '• /subgoal reset',
      success: true,
    };
  },
};

export function registerSubgoalCommand(): void {
  commandRegistry.register(subgoalCommand);
}
