import type { McpToolInfo } from '@/features/settings/mcp/mcp-config-api';

function displayToolName(fullName: string | undefined, stripPrefix?: string): string {
  if (!fullName) return '';
  if (stripPrefix && fullName.startsWith(stripPrefix)) {
    return fullName.slice(stripPrefix.length);
  }
  return fullName;
}

export function toolMatchesQuery(tool: McpToolInfo, query: string, stripPrefix?: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const shortName = tool.shortName || displayToolName(tool.name, stripPrefix);
  const haystack = [tool.name, shortName, tool.description].filter(Boolean).join('\n').toLowerCase();
  return haystack.includes(q);
}
