import type { McpServerRow } from '@/features/connectors/mcp/mcp-config-api';

/** Arguments and URL query strings can contain credentials; summaries never include them. */
export function mcpServerEndpointSummary(row: McpServerRow): string {
  if (row.transport === 'stdio') return row.command.trim();
  try {
    const url = new URL(row.url);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch { return row.url.trim().split(/[?#]/, 1)[0].replace(/\/\/[^/]*@/, '//'); }
}
