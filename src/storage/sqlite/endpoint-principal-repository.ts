import type { EndpointKind } from '@xopcai/endpoint-tools-protocol';

import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export interface EndpointPrincipal {
  id: string;
  kind: EndpointKind;
  displayName: string;
  platform: string;
  publicKey: string;
  createdAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
}

type EndpointPrincipalRow = {
  id: string;
  kind: EndpointKind;
  display_name: string;
  platform: string;
  public_key: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
};

function fromRow(row: EndpointPrincipalRow): EndpointPrincipal {
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    platform: row.platform,
    publicKey: row.public_key,
    createdAt: row.created_at,
    ...(row.last_seen_at === null ? {} : { lastSeenAt: row.last_seen_at }),
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
  };
}

export function createEndpointPrincipal(
  principal: Omit<EndpointPrincipal, 'createdAt' | 'lastSeenAt' | 'revokedAt'>,
): EndpointPrincipal {
  const createdAt = Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO endpoint_principals (
        id, kind, display_name, platform, public_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      principal.id,
      principal.kind,
      principal.displayName,
      principal.platform,
      principal.publicKey,
      createdAt,
    );
  });
  return { ...principal, createdAt };
}

export function getEndpointPrincipal(id: string): EndpointPrincipal | undefined {
  const row = getSqliteDatabase()
    .prepare('SELECT * FROM endpoint_principals WHERE id = ?')
    .get(id) as EndpointPrincipalRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function touchEndpointPrincipal(id: string, seenAt = Date.now()): void {
  getSqliteDatabase()
    .prepare('UPDATE endpoint_principals SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(seenAt, id);
}

export function bindEndpointPrincipal(
  endpointId: string,
  principalId: string,
  boundAt = Date.now(),
): boolean {
  return runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT OR IGNORE INTO endpoint_instance_bindings (endpoint_id, principal_id, bound_at)
      VALUES (?, ?, ?)
    `).run(endpointId, principalId, boundAt);
    const binding = db.prepare(`
      SELECT principal_id FROM endpoint_instance_bindings WHERE endpoint_id = ?
    `).get(endpointId) as { principal_id: string } | undefined;
    return binding?.principal_id === principalId;
  });
}

export function revokeEndpointPrincipal(id: string, revokedAt = Date.now()): boolean {
  const result = getSqliteDatabase()
    .prepare('UPDATE endpoint_principals SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(revokedAt, id);
  return result.changes > 0;
}
