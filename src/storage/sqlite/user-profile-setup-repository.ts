import type { UserProfilePromptState } from '../../user-context/profile.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type ProfilePromptRow = {
  principal_id: string;
  state: 'active' | 'snoozed';
  suggestion_hash: string | null;
  snoozed_until: string | null;
  updated_at: string;
};

function fromRow(row: ProfilePromptRow): UserProfilePromptState {
  return {
    state: row.state,
    suggestionHash: row.suggestion_hash ?? undefined,
    snoozedUntil: row.snoozed_until ?? undefined,
    updatedAt: row.updated_at,
  };
}

export function getUserProfilePromptState(principalId = 'local-owner'): UserProfilePromptState {
  const row = getSqliteDatabase()
    .prepare('SELECT * FROM user_profile_prompt_state WHERE principal_id = ?')
    .get(principalId) as ProfilePromptRow | undefined;
  return row ? fromRow(row) : { state: 'active' };
}

export function setUserProfilePromptState(
  input: Pick<UserProfilePromptState, 'state' | 'suggestionHash' | 'snoozedUntil'>,
  principalId = 'local-owner',
): UserProfilePromptState {
  const updatedAt = new Date().toISOString();
  return runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO user_profile_prompt_state (
        principal_id, state, suggestion_hash, snoozed_until, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(principal_id) DO UPDATE SET
        state = excluded.state,
        suggestion_hash = excluded.suggestion_hash,
        snoozed_until = excluded.snoozed_until,
        updated_at = excluded.updated_at
    `).run(
      principalId,
      input.state,
      input.suggestionHash ?? null,
      input.snoozedUntil ?? null,
      updatedAt,
    );
    return getUserProfilePromptState(principalId);
  });
}
