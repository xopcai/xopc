import { createHash, randomUUID } from 'node:crypto';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { McpConnectionCallbackSchema, type McpConnectionCallback } from './callback-config.js';
import { listMcpProductTools } from './product-tools.js';

export type RemoteMcpIdentity = {
  resource: string;
  issuer: string;
  subject: string;
  clientId: string;
};

export type RemoteMcpGrant = RemoteMcpIdentity & {
  connectionId: string;
  capabilityIds: string[];
  name?: string;
  toolset?: string;
  projectIds?: string[];
  maxConcurrentRuns?: number;
  callback?: McpConnectionCallback;
  grantedAt: number;
  expiresAt?: number;
  revokedAt?: number;
};

export interface GrantRemoteMcpOptions {
  capabilityIds?: readonly string[];
  write?: boolean;
  name?: string;
  toolset?: string;
  projectIds?: readonly string[];
  maxConcurrentRuns?: number;
  callback?: McpConnectionCallback;
  expiresAt?: number;
  replaceExisting?: boolean;
}

const grants = new DurableState<RemoteMcpGrant>('mcp-remote-grants');

function identityKey(identity: RemoteMcpIdentity): string {
  const { resource, issuer, subject, clientId } = identity;
  return createHash('sha256').update(JSON.stringify([resource, issuer, subject, clientId])).digest('hex');
}

function isRemoteGrantActive(grant: RemoteMcpGrant | undefined, now = Date.now()): grant is RemoteMcpGrant {
  if (!grant || grant.revokedAt !== undefined) return false;
  if (grant.expiresAt !== undefined && grant.expiresAt <= now) return false;
  return true;
}

export function grantRemoteMcpConnection(identity: RemoteMcpIdentity, options: GrantRemoteMcpOptions = {}): RemoteMcpGrant {
  const available = listMcpProductTools(Boolean(options.write));
  const ids = options.capabilityIds ?? available;
  if (!ids.length || ids.some(id => !available.includes(id))) {
    throw new Error('Use published capability IDs and enable write access explicitly for write tools');
  }
  if ([identity.subject, identity.clientId].some(value => !value.trim() || value.length > 1024)) {
    throw new Error('An OAuth subject and client ID are required');
  }
  const callback = options.callback ? McpConnectionCallbackSchema.parse(options.callback) : undefined;
  const projectIds = options.projectIds?.length ? [...new Set(options.projectIds)] : undefined;
  const grant: RemoteMcpGrant = {
    ...identity,
    connectionId: randomUUID(),
    capabilityIds: [...new Set(ids)],
    ...(options.name?.trim() ? { name: options.name.trim().slice(0, 120) } : {}),
    ...(options.toolset?.trim() ? { toolset: options.toolset.trim().slice(0, 64) } : {}),
    ...(projectIds ? { projectIds } : {}),
    ...(options.maxConcurrentRuns !== undefined ? { maxConcurrentRuns: options.maxConcurrentRuns } : {}),
    ...(callback ? { callback } : {}),
    grantedAt: Date.now(),
    ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
  };
  return grants.update(identityKey(identity), current => {
    if (isRemoteGrantActive(current) && !options.replaceExisting) {
      throw new Error(`Remote MCP connection already granted: ${current.connectionId}`);
    }
    return { value: grant, result: grant };
  });
}

export function findRemoteMcpGrant(identity: RemoteMcpIdentity): RemoteMcpGrant | undefined {
  const grant = grants.get(identityKey(identity));
  return isRemoteGrantActive(grant) ? grant : undefined;
}

export function findRemoteMcpGrantByConnectionId(connectionId: string): RemoteMcpGrant | undefined {
  return grants.values().find(grant => grant.connectionId === connectionId && isRemoteGrantActive(grant));
}

export function listRemoteMcpGrants(): RemoteMcpGrant[] {
  const now = Date.now();
  return grants.values().filter(grant => isRemoteGrantActive(grant, now));
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
