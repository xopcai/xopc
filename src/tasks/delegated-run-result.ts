import { parseFileResourceArtifactUri, parseTurnOutcome } from '@xopcai/gateway-contract';

import { tryParseMediaUri } from '../media/uri.js';
import { DurableState } from '../storage/sqlite/durable-state.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { isAvailableDeliverable } from './task-deliverables.js';

export const delegatedRunText = new DurableState<string>('delegated-run-result');

type PublishedArtifact = {
  artifactId: string;
  title?: string;
  kind: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  fileId?: string;
  mediaId?: string;
  shareUrl?: string;
  available: boolean;
};

export function listDelegatedRunArtifacts(runId: string) {
  const rows = getSqliteDatabase().prepare(`SELECT outcome_json FROM task_run_outcomes
    WHERE task_run_id = ? ORDER BY rowid`).iterate(runId) as Iterable<{ outcome_json: string }>;
  const now = Date.now();
  const artifacts = new Map<string, PublishedArtifact>();
  for (const row of rows) {
    for (const item of parseTurnOutcome(JSON.parse(row.outcome_json))?.deliverables ?? []) {
      const publishedFileId = item.sourceFileId ?? parseFileResourceArtifactUri(item.uri ?? '');
      const fileId = publishedFileId?.startsWith('host-') ? undefined : publishedFileId ?? undefined;
      const media = item.location === 'artifact_store' && item.uri && tryParseMediaUri(item.uri);
      const mediaId = media && media.bucket === 'outbound' && media.id === item.artifactId ? media.id : undefined;
      const { artifactId, title, kind, mimeType, sizeBytes, sha256, shareUrl } = item;
      // Avoid returning internal media locations or host paths through MCP.
      const url = shareUrl && URL.parse(shareUrl);
      artifacts.set(artifactId, {
        artifactId, title, kind, mimeType, sizeBytes, sha256, fileId, mediaId,
        shareUrl: url && url.protocol === 'https:' && !url.username && !url.password ? shareUrl : undefined,
        available: isAvailableDeliverable(item, now),
      });
    }
  }
  return [...artifacts.values()].filter(artifact => artifact.available);
}
