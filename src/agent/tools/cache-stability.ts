import type { AgentTool } from '@earendil-works/pi-agent-core';

const TOOL_ORDER = new Map([
  ['xopc_tool_search', 10],
  ['xopc_tool_describe', 20],
  ['xopc_tool_execute', 30],
]);

/** Provider-visible tool order is part of the cached prompt prefix. */
export function sortToolsForPromptCache<T extends Pick<AgentTool, 'name' | 'description'>>(
  tools: readonly T[],
): T[] {
  return [...tools].sort((left, right) => {
    const leftOrder = TOOL_ORDER.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = TOOL_ORDER.get(right.name) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return left.description.localeCompare(right.description);
  });
}
