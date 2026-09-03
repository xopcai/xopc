import crypto from 'node:crypto';

import type {
  ExecutionHostCapabilities,
  ExecutionHostRegistration,
} from '@xopcai/realtime-protocol';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export type ExecutionHostLifecycleStatus = 'active' | 'draining' | 'revoked';

export interface ExecutionHost {
  id: string;
  displayName: string;
  platform: string;
  arch: string;
  appVersion: string;
  publicKey: string;
  capabilities: ExecutionHostCapabilities;
  maxConcurrency: number;
  lifecycleStatus: ExecutionHostLifecycleStatus;
  credentialEpoch: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
}

export interface ExecutionHostEvent {
  id: string;
  hostId: string;
  type: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

type ExecutionHostRow = {
  host_id: string;
  display_name: string;
  platform: string;
  arch: string;
  app_version: string;
  public_key: string;
  capabilities_json: string;
  max_concurrency: number;
  lifecycle_status: ExecutionHostLifecycleStatus;
  credential_epoch: number;
  version: number;
  created_at: number;
  updated_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
};

type ExecutionHostEventRow = {
  event_id: string;
  host_id: string;
  type: string;
  metadata_json: string;
  created_at: number;
};

function hostFromRow(row: ExecutionHostRow): ExecutionHost {
  return {
    id: row.host_id,
    displayName: row.display_name,
    platform: row.platform,
    arch: row.arch,
    appVersion: row.app_version,
    publicKey: row.public_key,
    capabilities: JSON.parse(row.capabilities_json) as ExecutionHostCapabilities,
    maxConcurrency: row.max_concurrency,
    lifecycleStatus: row.lifecycle_status,
    credentialEpoch: row.credential_epoch,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_seen_at === null ? {} : { lastSeenAt: row.last_seen_at }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  };
}

function eventFromRow(row: ExecutionHostEventRow): ExecutionHostEvent {
  return {
    id: row.event_id,
    hostId: row.host_id,
    type: row.type,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

function appendEvent(
  hostId: string,
  type: string,
  metadata: Record<string, unknown>,
  createdAt: number,
): void {
  getSqliteDatabase().prepare(`
    INSERT INTO execution_host_events (event_id, host_id, type, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), hostId, type, JSON.stringify(metadata), createdAt);
}

export function createExecutionHost(
  registration: ExecutionHostRegistration,
  now = Date.now(),
): ExecutionHost {
  runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO execution_hosts (
        host_id, display_name, platform, arch, app_version, public_key,
        capabilities_json, max_concurrency, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      registration.hostId,
      registration.displayName,
      registration.platform,
      registration.arch,
      registration.appVersion,
      registration.publicKey,
      JSON.stringify(registration.capabilities),
      registration.maxConcurrency,
      now,
      now,
    );
    appendEvent(registration.hostId, 'enrolled', {}, now);
  });
  return getExecutionHost(registration.hostId)!;
}

export function getExecutionHost(hostId: string): ExecutionHost | undefined {
  const row = getSqliteDatabase().prepare(
    'SELECT * FROM execution_hosts WHERE host_id = ?',
  ).get(hostId) as ExecutionHostRow | undefined;
  return row ? hostFromRow(row) : undefined;
}

export function listExecutionHosts(): ExecutionHost[] {
  return (getSqliteDatabase().prepare(
    'SELECT * FROM execution_hosts ORDER BY created_at DESC',
  ).all() as unknown as ExecutionHostRow[]).map(hostFromRow);
}

export function touchExecutionHost(
  hostId: string,
  details: Pick<ExecutionHostRegistration, 'platform' | 'arch' | 'appVersion' | 'capabilities' | 'maxConcurrency'>,
  now = Date.now(),
): ExecutionHost | undefined {
  const result = getSqliteDatabase().prepare(`
    UPDATE execution_hosts SET platform = ?, arch = ?, app_version = ?,
      capabilities_json = ?, max_concurrency = ?, last_seen_at = ?, updated_at = ?,
      version = version + 1
    WHERE host_id = ? AND lifecycle_status != 'revoked'
  `).run(
    details.platform,
    details.arch,
    details.appVersion,
    JSON.stringify(details.capabilities),
    details.maxConcurrency,
    now,
    now,
    hostId,
  );
  return result.changes === 0 ? undefined : getExecutionHost(hostId);
}

export function revokeExecutionHost(hostId: string, now = Date.now()): ExecutionHost | undefined {
  return runSqliteWriteTransaction(() => {
    const result = getSqliteDatabase().prepare(`
      UPDATE execution_hosts SET lifecycle_status = 'revoked', revoked_at = ?,
        credential_epoch = credential_epoch + 1, version = version + 1, updated_at = ?
      WHERE host_id = ? AND lifecycle_status != 'revoked'
    `).run(now, now, hostId);
    if (result.changes === 0) return undefined;
    appendEvent(hostId, 'revoked', {}, now);
    return getExecutionHost(hostId);
  });
}

export function listExecutionHostEvents(hostId: string, limit = 100): ExecutionHostEvent[] {
  return (getSqliteDatabase().prepare(`
    SELECT * FROM execution_host_events WHERE host_id = ?
    ORDER BY created_at DESC, rowid DESC LIMIT ?
  `).all(hostId, Math.max(1, Math.min(500, Math.floor(limit)))) as unknown as ExecutionHostEventRow[])
    .map(eventFromRow);
}

export function recordExecutionHostEvent(
  hostId: string,
  type: string,
  metadata: Record<string, unknown> = {},
  now = Date.now(),
): void {
  appendEvent(hostId, type, metadata, now);
}
