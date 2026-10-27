import type { AssistantWorkLogItem } from './assistant-turn-view-model';
import type { TextContent, ToolUseContent } from './messages.types';

/** Keep public narration and known operation summaries; generic activity uses one indicator. */
export function publicAssistantProgress(items: AssistantWorkLogItem[], toolTitle?: (tool: ToolUseContent) => string | null): TextContent[] {
  const seen = new Set<string>();
  const progress: TextContent[] = [];
  for (const item of items) {
    const title = item.type === 'tool_use' ? toolTitle?.(item) : null;
    const block: TextContent | null = item.type === 'text' && item.presentation === 'narration' ? item
      : title ? { type: 'text', text: title, presentation: 'narration', segmentId: `tool-progress:${item.type === 'tool_use' ? item.id : ''}` } : null;
    if (!block) continue;
    const text = block.text.replace(/\s+/g, ' ').trim();
    if (!text || /^(?:正在处理|正在执行操作|其他操作|处理中|working|processing|other operations?|running)[.。…\s]*$/i.test(text)
      || seen.has(text)) continue;
    seen.add(text);
    progress.push(block);
  }
  return progress;
}

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
