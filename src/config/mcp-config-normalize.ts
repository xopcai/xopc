import { isRecord } from '../utils/is-record.js';

export type ConfigMcpServers = Record<string, Record<string, unknown>>;
export function canonicalizeConfiguredMcpServer(server: Record<string, unknown>): Record<string, unknown> {
  return { ...server };
}

export function normalizeConfiguredMcpServers(value: unknown): ConfigMcpServers {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, server]) => isRecord(server))
      .map(([name, server]) => [name, { ...(server as Record<string, unknown>) }]),
  );
}
