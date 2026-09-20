import type { DatabaseSync } from 'node:sqlite';

import type { SceneCutoverBindings } from './bindings.js';
import { convertSceneDatabase } from './database.js';
import { commitSceneCutover } from './journal.js';
import { readSceneSnapshotChecklists } from './snapshot.js';

/** Offline only. Production hosts may use this after the legacy workers have been removed. */
export function runSceneCutover(input: {
  db: DatabaseSync; configPath: string; backupRoot: string; owners: SceneCutoverBindings;
  mailAccounts: Array<{ followUpId: string; accountId: string }>;
  heartbeatWorkspaceId?: string; checklists: Array<{ workspaceId: string; sourcePath: string }>;
}): Promise<{ snapshotPath: string; resumed: boolean }> {
  return commitSceneCutover({ ...input, bindings: input.owners,
    convert: (db, config, owners, snapshotPath) => {
      convertSceneDatabase(db, { config, owners, mailAccounts: input.mailAccounts,
        heartbeatWorkspaceId: input.heartbeatWorkspaceId, checklists: readSceneSnapshotChecklists(snapshotPath) });
    },
  });
}
