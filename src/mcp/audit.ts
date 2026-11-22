import { randomUUID } from 'node:crypto';

import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { DurableState } from '../storage/sqlite/durable-state.js';

export interface McpAuditEntry {
  id: string;
  at: number;
  transport: 'stdio' | 'remote';
  principalId: string;
  connectionId: string;
  capabilityId: string;
  status: string;
  durationMs: number;
  operationId?: string;
}

export interface McpConnectionStats {
  connectionId: string;
  totalCalls: number;
  errorCount: number;
  lastUsedAt: number;
  toolCounts: Record<string, number>;
  errorCodes: Record<string, number>;
}

const MAX_AUDIT_ENTRIES = 500;
const auditLog = new DurableState<McpAuditEntry[]>('mcp-audit-log');
const connectionStats = new DurableState<McpConnectionStats>('mcp-audit-stats');

export function recordMcpAudit(entry: Omit<McpAuditEntry, 'id' | 'at'>): void {
  if (!isXopcDatabaseOpen()) return;
  const now = Date.now();
  const record: McpAuditEntry = {
    id: randomUUID(),
    at: now,
    ...entry,
  };
  try {
    auditLog.update('recent', current => {
      const next = [record, ...(current ?? [])].slice(0, MAX_AUDIT_ENTRIES);
      return { value: next, result: undefined };
    });
    connectionStats.update(entry.connectionId, current => {
      const base: McpConnectionStats = current ?? {
        connectionId: entry.connectionId,
        totalCalls: 0,
        errorCount: 0,
        lastUsedAt: now,
        toolCounts: {},
        errorCodes: {},
      };
      const nextToolCounts = { ...base.toolCounts };
      nextToolCounts[entry.capabilityId] = (nextToolCounts[entry.capabilityId] ?? 0) + 1;
      const nextErrorCodes = { ...base.errorCodes };
      const isError = entry.status !== 'succeeded';
      if (isError) {
        nextErrorCodes[entry.status] = (nextErrorCodes[entry.status] ?? 0) + 1;
      }
      const updated: McpConnectionStats = {
        connectionId: entry.connectionId,
        totalCalls: base.totalCalls + 1,
        errorCount: base.errorCount + (isError ? 1 : 0),
        lastUsedAt: now,
        toolCounts: nextToolCounts,
        errorCodes: nextErrorCodes,
      };
      return { value: updated, result: undefined };
    });
  } catch {
    // Audit persistence must never fail a completed tool call.
  }
}

export function listMcpAuditEntries(options: { connectionId?: string; limit?: number } = {}): McpAuditEntry[] {
  if (!isXopcDatabaseOpen()) return [];
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const entries = auditLog.get('recent') ?? [];
  const filtered = options.connectionId
    ? entries.filter(item => item.connectionId === options.connectionId)
    : entries;
  return filtered.slice(0, limit);
}

export function getMcpConnectionStats(connectionId: string): McpConnectionStats | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  return connectionStats.get(connectionId);
}

export function listAllMcpConnectionStats(): Record<string, McpConnectionStats> {
  if (!isXopcDatabaseOpen()) return {};
  const result: Record<string, McpConnectionStats> = {};
  for (const [id, stats] of connectionStats.entries()) {
    result[id] = stats;
  }
  return result;
}
