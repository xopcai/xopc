import {
  emptyMcpServerRow,
  type McpServerRow,
} from '@/features/connectors/mcp/mcp-config-api';

export function buildNewCustomServerRow(
  _existingCustomServers: McpServerRow[],
  _managedServerIds: ReadonlySet<string>,
): McpServerRow {
  return emptyMcpServerRow();
}
