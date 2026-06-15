import type { DatabaseSync } from 'node:sqlite';

import type { SessionAgentConfig } from '../../session/config-types.js';
import { sessionConfigRowToConfig, type SessionConfigRow } from './row-mappers.js';
import { ensureSessionInTransaction } from './session-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

function readConfigRow(db: DatabaseSync, sessionKey: string): SessionConfigRow | undefined {
  return db
    .prepare(
      `SELECT session_key, thinking_level, reasoning_level, verbose_level, elevated_mode,
              model_override, provider_override, working_directory_override, updated_at
       FROM session_config WHERE session_key = ?`,
    )
    .get(sessionKey) as SessionConfigRow | undefined;
}

export function getSessionConfig(sessionKey: string): SessionAgentConfig | null {
  const db = getSqliteDatabase();
  const row = readConfigRow(db, sessionKey);
  if (!row) {
    return null;
  }
  return sessionConfigRowToConfig(row);
}

export function setSessionConfig(sessionKey: string, config: SessionAgentConfig, cwd: string): SessionAgentConfig {
  return runSqliteWriteTransaction((db) => {
    ensureSessionInTransaction(db, sessionKey, cwd);
    const updatedAt = Date.now();
    const next = { ...config, updatedAt };
    db.prepare(
      `INSERT INTO session_config (
        session_key, thinking_level, reasoning_level, verbose_level, elevated_mode,
        model_override, provider_override, working_directory_override, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        thinking_level = excluded.thinking_level,
        reasoning_level = excluded.reasoning_level,
        verbose_level = excluded.verbose_level,
        elevated_mode = excluded.elevated_mode,
        model_override = excluded.model_override,
        provider_override = excluded.provider_override,
        working_directory_override = excluded.working_directory_override,
        updated_at = excluded.updated_at`,
    ).run(
      sessionKey,
      next.thinkingLevel ?? null,
      next.reasoningLevel ?? null,
      next.verboseLevel ?? null,
      next.elevatedMode ?? null,
      next.modelOverride ?? null,
      next.providerOverride ?? null,
      next.workingDirectoryOverride ?? null,
      updatedAt,
    );
    return next;
  });
}

export function updateSessionConfig(
  sessionKey: string,
  partial: Partial<SessionAgentConfig>,
  cwd: string,
): SessionAgentConfig {
  const existing = getSessionConfig(sessionKey);
  return setSessionConfig(sessionKey, { ...existing, ...partial }, cwd);
}

export function deleteSessionConfig(sessionKey: string): void {
  runSqliteWriteTransaction((db) => {
    db.prepare(`DELETE FROM session_config WHERE session_key = ?`).run(sessionKey);
  });
}

export function hasSessionConfig(sessionKey: string): boolean {
  const db = getSqliteDatabase();
  const row = db
    .prepare(`SELECT 1 AS ok FROM session_config WHERE session_key = ?`)
    .get(sessionKey) as { ok?: number } | undefined;
  return row?.ok === 1;
}
