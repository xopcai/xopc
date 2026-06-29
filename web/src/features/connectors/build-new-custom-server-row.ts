import {
  emptyMcpServerRow,
  type McpServerRow,
} from '@/features/connectors/mcp/mcp-config-api';

export function buildNewCustomServerRow(
  existingCustomServers: McpServerRow[],
  managedServerIds: ReadonlySet<string>,
): McpServerRow {
  let nextIndex = existingCustomServers.length + 1;
  let candidateId = `server-${nextIndex}`;
  const taken = new Set([
    ...existingCustomServers.map((server) => server.id.trim()),
    ...managedServerIds,
  ]);
  while (taken.has(candidateId)) {
    nextIndex += 1;
    candidateId = `server-${nextIndex}`;
  }
  return emptyMcpServerRow(candidateId);
}
