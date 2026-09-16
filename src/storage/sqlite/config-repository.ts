import type { DatabaseSync } from 'node:sqlite';

import { notifyUserContextChange } from '../../user-context/changes.js';
import type { SessionAgentConfig } from '../../session/config-types.js';
import { sessionConfigRowToConfig, type SessionConfigRow } from './row-mappers.js';
import { ensureSessionInTransaction } from './session-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

function readConfigRow(db: DatabaseSync, conversationId: string): SessionConfigRow | undefined {
  return db
    .prepare(
      `SELECT conversation_id, thinking_level, reasoning_level, verbose_level, elevated_mode,
              model_override, provider_override, working_directory_override, response_language,
              user_context_mode, fixed_model, updated_at
       FROM session_config WHERE conversation_id = ?`,
    )
    .get(conversationId) as SessionConfigRow | undefined;
}

export function getSessionConfig(conversationId: string): SessionAgentConfig | null {
  const db = getSqliteDatabase();
  const row = readConfigRow(db, conversationId);
  if (!row) {
    return null;
  }
  return sessionConfigRowToConfig(row);
}

/** Persisted file locations must be discoverable before a session runs again. */
export function listSessionWorkspaceOverrides(): Array<{ conversationId: string; workingDirectoryOverride: string }> {
  return getSqliteDatabase().prepare(`
    SELECT conversation_id AS conversationId, working_directory_override AS workingDirectoryOverride
    FROM session_config WHERE length(trim(working_directory_override)) > 0
  `).all() as Array<{ conversationId: string; workingDirectoryOverride: string }>;
}

export function setSessionConfig(conversationId: string, config: SessionAgentConfig, cwd: string): SessionAgentConfig {
  notifyUserContextChange({ kind: 'session', id: conversationId });
  return runSqliteWriteTransaction((db) => {
    ensureSessionInTransaction(db, conversationId, cwd);
    const updatedAt = Math.max(Date.now(), (readConfigRow(db, conversationId)?.updated_at ?? 0) + 1);
    const next = { ...config, updatedAt };
    db.prepare(
      `INSERT INTO session_config (
        conversation_id, thinking_level, reasoning_level, verbose_level, elevated_mode,
        model_override, provider_override, working_directory_override, response_language, user_context_mode, fixed_model, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        thinking_level = excluded.thinking_level,
        reasoning_level = excluded.reasoning_level,
        verbose_level = excluded.verbose_level,
        elevated_mode = excluded.elevated_mode,
        model_override = excluded.model_override,
        provider_override = excluded.provider_override,
        working_directory_override = excluded.working_directory_override,
        response_language = excluded.response_language,
        user_context_mode = excluded.user_context_mode,
        fixed_model = excluded.fixed_model,
        updated_at = excluded.updated_at`,
    ).run(
      conversationId,
      next.thinkingLevel ?? null,
      next.reasoningLevel ?? null,
      next.verboseLevel ?? null,
      next.elevatedMode ?? null,
      next.modelOverride ?? null,
      next.providerOverride ?? null,
      next.workingDirectoryOverride ?? null,
      next.responseLanguage ?? null,
      next.userContextMode ?? null,
      next.fixedModel ? 1 : 0,
      updatedAt,
    );
    return next;
  });
}

export function updateSessionConfig(
  conversationId: string,
  partial: Partial<SessionAgentConfig>,
  cwd: string,
): SessionAgentConfig {
  const existing = getSessionConfig(conversationId);
  return setSessionConfig(conversationId, { ...existing, ...partial }, cwd);
}

export function deleteSessionConfig(conversationId: string): void {
  notifyUserContextChange({ kind: 'session', id: conversationId });
  runSqliteWriteTransaction((db) => {
    db.prepare(`DELETE FROM session_config WHERE conversation_id = ?`).run(conversationId);
  });
}

export function hasSessionConfig(conversationId: string): boolean {
  const db = getSqliteDatabase();
  const row = db
    .prepare(`SELECT 1 AS ok FROM session_config WHERE conversation_id = ?`)
    .get(conversationId) as { ok?: number } | undefined;
  return row?.ok === 1;
}
