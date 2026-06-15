import { SessionManager, type FileEntry } from '@earendil-works/pi-coding-agent';

import {
  ensureSessionRecord,
  loadTranscriptRowsForSession,
  requireXopcDatabase,
} from '../../storage/sqlite/index.js';
import { storedRowsToFileEntries } from '../../session/stored-rows-to-file-entries.js';
import { repairAssistantUsageInSessionManager } from './session-manager-init.js';

type SessionManagerHydrationTarget = {
  fileEntries: FileEntry[];
  sessionId: string;
  flushed: boolean;
  byId: Map<string, unknown>;
  labelsById: Map<string, unknown>;
  leafId: string | null;
  _buildIndex: () => void;
};

/**
 * Open an in-memory pi SessionManager hydrated from the SQLite transcript.
 * File persistence is disabled; writes flow through the tool-result guard into SQLite.
 */
export function openSqliteHydratingSessionManager(params: {
  sessionKey: string;
  sessionId: string;
  cwd: string;
}): SessionManager {
  requireXopcDatabase();

  ensureSessionRecord(params.sessionKey, params.cwd);
  const rows = loadTranscriptRowsForSession(params.sessionKey);
  const sm = SessionManager.inMemory(params.cwd);
  const entries = storedRowsToFileEntries({
    sessionId: params.sessionId,
    cwd: params.cwd,
    rows,
  });

  const internal = sm as unknown as SessionManagerHydrationTarget;
  internal.fileEntries = entries;
  internal.sessionId = params.sessionId;
  internal.flushed = true;
  internal._buildIndex();
  repairAssistantUsageInSessionManager(sm);
  return sm;
}
