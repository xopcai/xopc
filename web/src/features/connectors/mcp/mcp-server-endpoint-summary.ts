import type { McpServerRow } from '@/features/connectors/mcp/mcp-config-api';

export function mcpServerEndpointSummary(row: McpServerRow): string {
  if (row.transport === 'stdio') {
    const command = row.command.trim();
    if (!command) return '';
    const args = row.argsText.trim();
    return args ? `${command} ${args}` : command;
  }
  return row.url.trim();
}
