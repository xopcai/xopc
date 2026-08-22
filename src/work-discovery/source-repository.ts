import {
  getUnderstandingSourceGrant,
  listUnderstandingSourceGrants,
  revokeUnderstandingSourceGrant,
  upsertUnderstandingSourceGrant,
} from '../user-context/sources/repository.js';

import type { WorkDiscoveryDirectorySource, WorkDiscoveryPreview } from './types.js';

const ADAPTER_ID = 'local-work-folders';

function fingerprint(value: Record<string, unknown>): WorkDiscoveryPreview['fingerprint'] | undefined {
  const candidate = value.fingerprint;
  if (!candidate || typeof candidate !== 'object') return undefined;
  return candidate as WorkDiscoveryPreview['fingerprint'];
}

function directorySource(grant: ReturnType<typeof getUnderstandingSourceGrant>): WorkDiscoveryDirectorySource | null {
  if (!grant || grant.adapterId !== ADAPTER_ID || typeof grant.config.rootPath !== 'string') return null;
  return {
    id: grant.id,
    kind: 'directory',
    rootPath: grant.config.rootPath,
    displayName: grant.displayName,
    status: grant.status,
    scope: { readOnly: true },
    ...(fingerprint(grant.checkpoint) ? { fingerprint: fingerprint(grant.checkpoint) } : {}),
    ...(grant.lastCollectedAt != null ? { lastScannedAt: grant.lastCollectedAt } : {}),
    createdAt: grant.createdAt,
    updatedAt: grant.updatedAt,
  };
}

export function listWorkDiscoveryDirectorySources(options: { includeRevoked?: boolean } = {}): WorkDiscoveryDirectorySource[] {
  return listUnderstandingSourceGrants(options).flatMap((grant) => {
    const source = directorySource(grant);
    return source ? [source] : [];
  });
}

export function getWorkDiscoveryDirectorySource(id: string): WorkDiscoveryDirectorySource | null {
  return directorySource(getUnderstandingSourceGrant(id));
}

export function upsertWorkDiscoveryDirectorySource(input: {
  rootPath: string;
  displayName: string;
  fingerprint?: WorkDiscoveryPreview['fingerprint'];
  scanned?: boolean;
  nowMs?: number;
}): WorkDiscoveryDirectorySource {
  const existing = listUnderstandingSourceGrants({ includeRevoked: true })
    .find((grant) => grant.adapterId === ADAPTER_ID && grant.config.rootPath === input.rootPath);
  const grant = upsertUnderstandingSourceGrant({
    sourceKey: `local-work-folder:${input.rootPath}`,
    adapterId: ADAPTER_ID,
    category: 'files',
    platform: 'all',
    displayName: input.displayName,
    accessMode: 'continuous',
    retentionPolicy: 'derived_only',
    processingPolicy: 'remote_allowed',
    config: { rootPath: input.rootPath, readOnly: true },
    checkpoint: input.fingerprint
      ? { ...existing?.checkpoint, fingerprint: input.fingerprint }
      : existing?.checkpoint,
    ...(input.scanned ? { lastCollectedAt: input.nowMs ?? Date.now() } : {}),
    ...(input.nowMs != null ? { nowMs: input.nowMs } : {}),
  });
  return directorySource(grant)!;
}

export function revokeWorkDiscoveryDirectorySource(id: string, nowMs = Date.now()): WorkDiscoveryDirectorySource | null {
  const source = getWorkDiscoveryDirectorySource(id);
  if (!source) return null;
  return directorySource(revokeUnderstandingSourceGrant(id, nowMs));
}
