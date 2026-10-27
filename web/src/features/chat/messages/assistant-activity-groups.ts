import type { AssistantWorkLogItem } from './assistant-turn-view-model';
import type { ToolUseContent } from './messages.types';

export type AssistantActivityGroup =
  | { type: 'item'; item: AssistantWorkLogItem }
  | { type: 'tools'; tools: ToolUseContent[] };

/** Only adjacent tools share a summary; narration and reasoning preserve phase boundaries. */
export function groupAssistantActivity(items: AssistantWorkLogItem[]): AssistantActivityGroup[] {
  const groups: AssistantActivityGroup[] = [];
  for (const item of items) {
    const previous = groups.at(-1);
    if (item.type !== 'tool_use') groups.push({ type: 'item', item });
    else if (previous?.type === 'tools') previous.tools.push(item);
    else groups.push({ type: 'tools', tools: [item] });
  }
  return groups;
}

/** Keep public summaries specific and bounded; every call remains available in details. */
export function summarizeToolActivity(tools: ToolUseContent[], title: (tool: ToolUseContent) => string, labels: {
  repeated: string; more: string; failed: string; separator: string;
}): string {
  const counts = new Map<string, number>();
  let failed = 0;
  for (const tool of tools) {
    if (tool.status === 'error' || tool.activity?.status === 'failed') { failed++; continue; }
    const action = title(tool);
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  const actions = [...counts];
  const parts = actions.slice(0, 2).map(([action, count]) => count === 1 ? action
    : labels.repeated.replace('{{action}}', action).replace('{{count}}', String(count)));
  const remaining = actions.slice(2).reduce((sum, [, count]) => sum + count, 0);
  if (remaining > 0) parts.push(labels.more.replace('{{count}}', String(remaining)));
  if (failed > 0) parts.push(labels.failed.replace('{{count}}', String(failed)));
  return parts.join(labels.separator);
}
