/**
 * `/subgoal` — view or edit the standing goal checklist (Hermes parity).
 */

import type { CommandContext, CommandDefinition } from '../types.js';
import { commandRegistry } from '../registry.js';

import { applyChecklistUserMutation } from '../../agent/goals/checklist-user.js';
import { checklistCounts } from '../../agent/goals/checklist-types.js';
import { readPersistentGoal, renderChecklistNumbered } from '../../agent/goals/state.js';

async function patchMetadata(
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

const subgoalCommand: CommandDefinition = {
  id: 'system.subgoal',
  name: 'subgoal',
  description: 'View or edit checklist criteria for the active /goal (add, mark, remove, reset)',
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
    const apis = ctx.persistentGoalApis;
    if (!apis) {
      return { content: 'Goals unavailable on this surface.', success: false };
    }

    const t = args.trim();
    const lower = t.toLowerCase();
    const meta = await apis.getSessionMetadata(ctx.sessionKey);
    const custom = meta?.customData as Record<string, unknown> | undefined;
    const s = readPersistentGoal(custom);

    if (!t || lower === 'list' || lower === 'status') {
      if (!s || s.status === 'cleared') {
        return { content: 'No active goal. Set one with /goal <text> first.', success: true };
      }
      const items = s.checklist ?? [];
      if (!items.length) {
        return {
          content:
            s.decomposed === true
              ? 'Checklist is empty (decomposition produced no items). The judge will use freeform mode.'
              : 'Checklist not built yet — it appears after the first assistant turn once decomposition runs.',
          success: true,
        };
      }
      const { total, completed, impossible } = checklistCounts(items);
      const header = `Checklist (${completed + impossible}/${total} terminal):\n`;
      return { content: header + renderChecklistNumbered(items), success: true };
    }

    if (lower === 'reset' || lower === 'clear') {
      const applied = applyChecklistUserMutation(custom, { type: 'reset' });
      if (applied.kind === 'error') return { content: applied.error, success: false };
      if (applied.kind === 'noop') return { content: applied.message, success: true };
      const cd = applied.customData;
      const r = await patchMetadata(ctx, () => cd);
      if (!r.ok) return { content: 'error' in r ? r.error : 'Failed', success: false };
      return {
        content:
          '✓ Checklist cleared. Decomposition will run again on the next goal evaluation turn (or set /goal anew).',
        success: true,
      };
    }

    const addM = t.match(/^add\s+([\s\S]+)$/i);
    if (addM) {
      const text = addM[1]!.trim();
      const applied = applyChecklistUserMutation(custom, { type: 'add', text });
      if (applied.kind === 'error') return { content: applied.error, success: false };
      if (applied.kind === 'noop') return { content: applied.message, success: true };
      const cd = applied.customData;
      const r = await patchMetadata(ctx, () => cd);
      if (!r.ok) return { content: 'error' in r ? r.error : 'Failed', success: false };
      return { content: `⊙ Added checklist item: ${text}`, success: true };
    }

    const removeM = t.match(/^remove\s+(\d+)\s*$/i);
    if (removeM) {
      const idx = Number(removeM[1]);
      const applied = applyChecklistUserMutation(custom, { type: 'remove', index1Based: idx });
      if (applied.kind === 'error') return { content: applied.error, success: false };
      if (applied.kind === 'noop') return { content: applied.message, success: true };
      const cd = applied.customData;
      const r = await patchMetadata(ctx, () => cd);
      if (!r.ok) return { content: 'error' in r ? r.error : 'Failed', success: false };
      return { content: `✓ Removed item #${idx}.`, success: true };
    }

    const markM = t.match(/^mark\s+(\d+)\s+(pending|completed|impossible)\s*$/i);
    if (markM) {
      const idx = Number(markM[1]);
      const status = markM[2]!.toLowerCase() as 'pending' | 'completed' | 'impossible';
      const applied = applyChecklistUserMutation(custom, { type: 'mark', index1Based: idx, status });
      if (applied.kind === 'error') return { content: applied.error, success: false };
      if (applied.kind === 'noop') return { content: applied.message, success: true };
      const cd = applied.customData;
      const r = await patchMetadata(ctx, () => cd);
      if (!r.ok) return { content: 'error' in r ? r.error : 'Failed', success: false };
      return { content: `⊙ Item #${idx} → ${status}.`, success: true };
    }

    return {
      content:
        'Usage:\n' +
        '• /subgoal — show checklist\n' +
        '• /subgoal add <text>\n' +
        '• /subgoal mark <n> pending|completed|impossible\n' +
        '• /subgoal remove <n>\n' +
        '• /subgoal reset — wipe checklist (re-decompose on next turn)',
      success: true,
    };
  },
};

export function registerSubgoalCommand(): void {
  commandRegistry.register(subgoalCommand);
}
