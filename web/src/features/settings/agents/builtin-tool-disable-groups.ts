/**
 * UI grouping for gateway built-in tool ids (`GATEWAY_BUILTIN_TOOL_IDS`).
 * Any id returned by the gateway but not listed here appears under `misc`.
 */
export const BUILTIN_TOOL_UI_GROUPS = [
  {
    key: 'workspace',
    toolIds: ['read_file', 'write_file', 'edit_file', 'list_dir', 'grep', 'find'] as const,
  },
  { key: 'execution', toolIds: ['shell'] as const },
  { key: 'web', toolIds: ['web_search', 'web_fetch'] as const },
  { key: 'messaging', toolIds: ['send_message', 'send_media'] as const },
  {
    key: 'memory',
    toolIds: ['memory_search', 'memory_get', 'curated_memory', 'session_search'] as const,
  },
  { key: 'media', toolIds: ['image', 'image_generate'] as const },
  { key: 'extensions', toolIds: ['extensions'] as const },
  { key: 'mcp', toolIds: ['bundle-mcp'] as const },
] as const;

export type BuiltinToolUiGroupKey = (typeof BUILTIN_TOOL_UI_GROUPS)[number]['key'] | 'misc' | 'unknown';

const ASSIGNED = new Set<string>(
  BUILTIN_TOOL_UI_GROUPS.flatMap((g) => [...g.toolIds].map((id) => String(id))),
);

export function miscBuiltinToolIds(builtinToolIds: string[]): string[] {
  return builtinToolIds
    .filter((id) => id && !ASSIGNED.has(id))
    .sort((x, y) => x.localeCompare(y));
}
