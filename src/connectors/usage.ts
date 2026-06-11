import type { Config } from '../config/schema.js';
import { isManagedConnectorServer } from './materialize.js';
import type { ConnectorAuditRecord, ConnectorHealthResult, ConnectorUsageRecord } from './types.js';

const MAX_AUDIT_RECORDS = 50;

function getManagedConnectorMarker(config: Config, instanceId: string): Record<string, unknown> | undefined {
  const server = config.mcp?.servers?.[instanceId];
  if (!isManagedConnectorServer(server)) {
    return undefined;
  }
  return server.xopcConnector as Record<string, unknown>;
}

export function getConnectorUsageFromMarker(marker: unknown): ConnectorUsageRecord {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return {};
  }
  const usage = (marker as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return {};
  }
  const record = usage as Record<string, unknown>;
  return {
    lastHealthCheckAt: typeof record.lastHealthCheckAt === 'string' ? record.lastHealthCheckAt : undefined,
    lastHealthStatus: typeof record.lastHealthStatus === 'string' ? record.lastHealthStatus as ConnectorUsageRecord['lastHealthStatus'] : undefined,
    lastToolCount: typeof record.lastToolCount === 'number' ? record.lastToolCount : undefined,
  };
}

export function getConnectorAuditFromMarker(marker: unknown): ConnectorAuditRecord[] {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return [];
  }
  const audit = (marker as Record<string, unknown>).audit;
  if (!Array.isArray(audit)) {
    return [];
  }
  return audit.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.at !== 'string' || typeof record.action !== 'string') {
      return [];
    }
    return [{
      at: record.at,
      action: record.action as ConnectorAuditRecord['action'],
      status: typeof record.status === 'string' ? record.status as ConnectorAuditRecord['status'] : undefined,
      ok: typeof record.ok === 'boolean' ? record.ok : undefined,
      toolCount: typeof record.toolCount === 'number' ? record.toolCount : undefined,
    }];
  });
}

export function appendConnectorAuditRecord(
  config: Config,
  instanceId: string,
  record: Omit<ConnectorAuditRecord, 'at'>,
): void {
  const marker = getManagedConnectorMarker(config, instanceId);
  if (!marker) {
    return;
  }
  const existing = Array.isArray(marker.audit) ? marker.audit : [];
  marker.audit = [
    ...existing.slice(-MAX_AUDIT_RECORDS + 1),
    { ...record, at: new Date().toISOString() },
  ];
}

export function recordConnectorHealthUsage(
  config: Config,
  instanceId: string,
  result: ConnectorHealthResult,
): void {
  const marker = getManagedConnectorMarker(config, instanceId);
  if (!marker) {
    return;
  }
  marker.usage = {
    lastHealthCheckAt: new Date().toISOString(),
    lastHealthStatus: result.status,
    lastToolCount: result.toolCount,
  } satisfies ConnectorUsageRecord;
  appendConnectorAuditRecord(config, instanceId, {
    action: 'health_check',
    status: result.status,
    ok: result.ok,
    toolCount: result.toolCount,
  });
}
