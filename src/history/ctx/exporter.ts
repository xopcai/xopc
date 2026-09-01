import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { resolveStateDir } from '../../config/paths-state.js';
import { writeTextAtomic } from '../../infra/write-file-atomic.js';
import {
  buildCtxHistoryJsonl,
  buildCtxPluginManifest,
  type XopcHistoryEntry,
  type XopcHistorySession,
} from './format.js';

interface TranscriptRow {
  session_id: string;
  status: string;
  created_at: number;
  archived_at: number | null;
  cwd: string;
  agent_id: string;
  session_type: string | null;
}

interface EntryRow {
  entry_id: string;
  session_id: string;
  seq: number;
  payload_json: string;
  created_at: number;
}

export interface CtxHistoryExportResult {
  outputDir: string;
  historyPath: string;
  manifestPath: string;
  sessionCount: number;
  eventCount: number;
  changed: boolean;
}

function readSnapshot(db: DatabaseSync): XopcHistorySession[] {
  db.exec('BEGIN');
  try {
    const transcripts = db.prepare(
      `SELECT
         t.session_id,
         t.status,
         t.created_at,
         t.archived_at,
         t.cwd,
         s.agent_id,
         s.session_type
       FROM transcripts t
       JOIN sessions s ON s.session_key = t.session_key
       WHERE t.status = 'active' OR t.archive_reason IN ('reset', 'stale')
       ORDER BY t.created_at ASC, t.session_id ASC`,
    ).all() as unknown as TranscriptRow[];
    const entries = db.prepare(
      `SELECT e.entry_id, e.session_id, e.seq, e.payload_json, e.created_at
       FROM transcript_entries e
       JOIN transcripts t ON t.session_id = e.session_id
       JOIN sessions s ON s.session_key = t.session_key
       WHERE t.status = 'active' OR t.archive_reason IN ('reset', 'stale')
       ORDER BY t.created_at ASC, t.session_id ASC, e.seq ASC, e.entry_id ASC`,
    ).all() as unknown as EntryRow[];
    db.exec('COMMIT');

    const entriesBySession = new Map<string, XopcHistoryEntry[]>();
    for (const entry of entries) {
      const bucket = entriesBySession.get(entry.session_id) ?? [];
      bucket.push({
        entryId: entry.entry_id,
        seq: entry.seq,
        createdAt: entry.created_at,
        payloadJson: entry.payload_json,
      });
      entriesBySession.set(entry.session_id, bucket);
    }
    return transcripts.map((transcript) => ({
      sessionId: transcript.session_id,
      status: transcript.status,
      createdAt: transcript.created_at,
      archivedAt: transcript.archived_at,
      cwd: transcript.cwd,
      agentId: transcript.agent_id,
      sessionType: transcript.session_type,
      entries: entriesBySession.get(transcript.session_id) ?? [],
    }));
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the snapshot error.
    }
    throw error;
  }
}

async function writeIfChanged(path: string, contents: string): Promise<boolean> {
  let existing: string | null = null;
  try {
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing === contents) return false;
  await writeTextAtomic(path, contents, { mode: 0o600, ensureDirMode: 0o700 });
  return true;
}

export function resolveDefaultCtxHistoryExportDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveStateDir(env), 'exports', 'ctx');
}

export async function exportCtxHistory(
  db: DatabaseSync,
  options: { outputDir?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CtxHistoryExportResult> {
  const outputDir = resolve(options.outputDir ?? resolveDefaultCtxHistoryExportDir(options.env));
  const historyPath = join(outputDir, 'history.jsonl');
  const manifestPath = join(outputDir, 'ctx-history-plugin.json');
  const sessions = readSnapshot(db);
  const history = buildCtxHistoryJsonl(sessions);
  const manifest = buildCtxPluginManifest();

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const historyChanged = await writeIfChanged(historyPath, history.contents);
  const manifestChanged = await writeIfChanged(manifestPath, manifest);
  return {
    outputDir,
    historyPath,
    manifestPath,
    sessionCount: sessions.length,
    eventCount: history.eventCount,
    changed: historyChanged || manifestChanged,
  };
}
