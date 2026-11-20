import { createHash, randomUUID } from 'node:crypto';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { listMcpProductTools } from './product-tools.js';

export type RemoteMcpIdentity = {
  resource: string;
  issuer: string;
  subject: string;
  clientId: string;
};

type RemoteMcpGrant = RemoteMcpIdentity & {
  connectionId: string;
  capabilityIds: string[];
  grantedAt: number;
  revokedAt?: number;
};

const grants = new DurableState<RemoteMcpGrant>('mcp-remote-grants');

function identityKey(identity: RemoteMcpIdentity): string {
  const { resource, issuer, subject, clientId } = identity;
  return createHash('sha256').update(JSON.stringify([resource, issuer, subject, clientId])).digest('hex');
}

export function grantRemoteMcpConnection(identity: RemoteMcpIdentity, options: {
  capabilityIds?: readonly string[];
  write?: boolean;
} = {}): RemoteMcpGrant {
  const available = listMcpProductTools(Boolean(options.write));
  const ids = options.capabilityIds ?? available;
  if (!ids.length || ids.some(id => !available.includes(id))) {
    throw new Error('Use published capability IDs and enable write access explicitly for write tools');
  }
  if ([identity.subject, identity.clientId].some(value => !value.trim() || value.length > 1024)) {
    throw new Error('An OAuth subject and client ID are required');
  }
  const grant = { ...identity, connectionId: randomUUID(), capabilityIds: [...new Set(ids)], grantedAt: Date.now() };
  return grants.update(identityKey(identity), current => {
    if (current && current.revokedAt === undefined) throw new Error(`Remote MCP connection already granted: ${current.connectionId}`);
    return { value: grant, result: grant };
  });
}

export function findRemoteMcpGrant(identity: RemoteMcpIdentity): RemoteMcpGrant | undefined {
  const grant = grants.get(identityKey(identity));
  return grant?.revokedAt === undefined ? grant : undefined;
}

export function listRemoteMcpGrants(): RemoteMcpGrant[] {
  return grants.values().filter(grant => grant.revokedAt === undefined);
}

export function revokeRemoteMcpConnection(connectionId: string): boolean {
  requireXopcDatabase();
  return runSqliteWriteTransaction(() => {
    const entry = grants.entries().find(([, grant]) => grant.connectionId === connectionId && grant.revokedAt === undefined);
    if (!entry) return false;
    const [key, grant] = entry;
    grants.set(key, { ...grant, revokedAt: Date.now() });
    return true;
  });
}
