import { startKnowledgeSyncRun, finishKnowledgeSyncRun } from '../../storage/sqlite/knowledge-repository.js';

export function syncedSource(sourceInstanceId: string, collectionScope: string, at = Date.now()) {
  const run = startKnowledgeSyncRun({ sourceInstanceId, collectionScope, nowMs: at });
  finishKnowledgeSyncRun({ runId: run.id, status: 'succeeded', nowMs: at });
}
