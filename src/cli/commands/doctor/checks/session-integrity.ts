import { existsSync } from 'node:fs';

import { loadConfig } from '../../../../config/loader.js';
import {
  getCurrentTranscriptId,
  getSqliteDatabase,
  isXopcDatabaseOpen,
  listSessionMetadata,
  openXopcDatabase,
} from '../../../../storage/sqlite/index.js';
import type { CheckResult, DoctorContext } from '../types.js';

export async function checkSessionIntegrity(ctx: DoctorContext): Promise<CheckResult> {
  if (!ctx.options.deep) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'skip',
      message: 'Deep mode off; session scan skipped.',
      hints: ['Run: xopc doctor --deep'],
    };
  }

  if (!existsSync(ctx.configPath)) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  try {
    loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'warn',
      message: 'Config invalid; session scan skipped.',
      hints: ['Fix xopc.json before running session integrity checks.'],
    };
  }

  if (!isXopcDatabaseOpen()) {
    openXopcDatabase();
  }

  if (!isXopcDatabaseOpen()) {
    openXopcDatabase();
  }

  const issues: string[] = [];
  const db = getSqliteDatabase();

  const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  const integrityFailures = integrity
    .map((row) => row.integrity_check)
    .filter((value) => value !== 'ok');
  for (const failure of integrityFailures) {
    issues.push(`database integrity: ${failure}`);
  }

  const { items } = listSessionMetadata({ limit: 100_000 });

  for (const session of items) {
    const transcriptId = getCurrentTranscriptId(session.key);
    if (!transcriptId) {
      issues.push(`missing transcript for ${session.key}`);
      continue;
    }
    if (transcriptId !== session.transcriptId) {
      issues.push(`transcript id mismatch for ${session.key}`);
    }
    const transcript = db
      .prepare(`SELECT transcript_id FROM transcripts WHERE transcript_id = ? AND status = 'active'`)
      .get(transcriptId) as { transcript_id?: string } | undefined;
    if (!transcript?.transcript_id) {
      issues.push(`active transcript row missing for ${session.key}`);
    }
  }

  const orphanTranscripts = db
    .prepare(
      `SELECT t.transcript_id FROM transcripts t
       LEFT JOIN sessions s ON s.current_transcript_id = t.transcript_id
       WHERE t.status = 'active' AND s.session_key IS NULL`,
    )
    .all() as Array<{ transcript_id: string }>;
  for (const row of orphanTranscripts) {
    issues.push(`orphan active transcript ${row.transcript_id}`);
  }

  if (issues.length === 0) {
    return {
      id: 'session-integrity',
      label: 'Sessions',
      status: 'pass',
      message: `SQLite session store OK (${items.length} session(s)).`,
      hints: [],
    };
  }

  return {
    id: 'session-integrity',
    label: 'Sessions',
    status: 'warn',
    message: `${issues.length} session integrity issue(s).`,
    hints: issues.slice(0, 8),
  };
}
