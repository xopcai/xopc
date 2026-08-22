import {
  createUnderstandingSourceRun,
  listUnderstandingSourceGrants,
  listUnderstandingSourceRuns,
  updateUnderstandingSourceRun,
} from '../user-context/sources/repository.js';

import type { WorkDiscoveryPreview, WorkDiscoverySourceRefresh } from './types.js';
import { workDiscoveryFingerprintsEqual } from './incremental.js';
import { getWorkDiscoveryRun } from './repository.js';

function refreshFromRun(run: ReturnType<typeof createUnderstandingSourceRun>): WorkDiscoverySourceRefresh {
  const previousFingerprint = run.metadata.previousFingerprint as WorkDiscoveryPreview['fingerprint'] | undefined;
  return {
    id: run.id,
    sourceId: run.grantId,
    changed: run.metadata.changed === true,
    ...(previousFingerprint ? { previousFingerprint } : {}),
    currentFingerprint: run.metadata.currentFingerprint as WorkDiscoveryPreview['fingerprint'],
    status: run.status === 'running' ? 'queued' : run.status as WorkDiscoverySourceRefresh['status'],
    ...(typeof run.metadata.discoveryRunId === 'string' ? { discoveryRunId: run.metadata.discoveryRunId } : {}),
    checkedAt: run.startedAt,
  };
}

export function recordWorkDiscoverySourceRefresh(input: {
  sourceId: string;
  changed: boolean;
  previousFingerprint?: WorkDiscoveryPreview['fingerprint'];
  currentFingerprint: WorkDiscoveryPreview['fingerprint'];
  status?: WorkDiscoverySourceRefresh['status'];
  discoveryRunId?: string;
  checkedAt?: number;
}): WorkDiscoverySourceRefresh {
  const status = input.status === 'queued'
    ? 'running'
    : input.status === 'failed'
      ? 'failed'
      : 'completed';
  return refreshFromRun(createUnderstandingSourceRun({
    grantId: input.sourceId,
    kind: 'fingerprint',
    status,
    metadata: {
      changed: input.changed,
      ...(input.previousFingerprint ? { previousFingerprint: input.previousFingerprint } : {}),
      currentFingerprint: input.currentFingerprint,
      ...(input.discoveryRunId ? { discoveryRunId: input.discoveryRunId } : {}),
    },
    ...(input.checkedAt != null ? { nowMs: input.checkedAt } : {}),
  }));
}

export function listWorkDiscoverySourceRefreshes(sourceId: string, limit = 20): WorkDiscoverySourceRefresh[] {
  return listUnderstandingSourceRuns(sourceId, limit)
    .filter((run) => run.kind === 'fingerprint')
    .map(refreshFromRun);
}

export function findActiveWorkDiscoverySourceRefresh(
  sourceId: string,
  fingerprint: WorkDiscoveryPreview['fingerprint'],
): WorkDiscoverySourceRefresh | null {
  return listWorkDiscoverySourceRefreshes(sourceId, 100).find((refresh) => {
    if (refresh.status !== 'queued' || !refresh.discoveryRunId) return false;
    const run = getWorkDiscoveryRun(refresh.discoveryRunId);
    return Boolean(run && ['queued', 'probing', 'analyzing'].includes(run.status)
      && workDiscoveryFingerprintsEqual(refresh.currentFingerprint, fingerprint));
  }) ?? null;
}

export function updateWorkDiscoverySourceRefreshForRun(
  runId: string,
  status: 'completed' | 'failed',
): void {
  for (const source of listUnderstandingSourceGrants()) {
    const refresh = listUnderstandingSourceRuns(source.id, 100)
      .find((item) => item.kind === 'fingerprint' && item.metadata.discoveryRunId === runId);
    if (refresh) updateUnderstandingSourceRun(refresh.id, { status, completed: true });
  }
}
