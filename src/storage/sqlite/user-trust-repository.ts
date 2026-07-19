import {
  DEFAULT_USER_TRUST_LEVEL,
  isUserTrustLevel,
  type UserTrustLevel,
  type UserTrustPolicy,
} from '../../user-context/trust-policy.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type UserTrustPolicyRow = {
  principal_id: string;
  default_action_level: string;
  updated_at: string;
};

function fromRow(row: UserTrustPolicyRow): UserTrustPolicy {
  return {
    principalId: row.principal_id,
    defaultActionLevel: isUserTrustLevel(row.default_action_level)
      ? row.default_action_level
      : DEFAULT_USER_TRUST_LEVEL,
    updatedAt: row.updated_at,
  };
}

export function getUserTrustPolicy(principalId = 'local-owner'): UserTrustPolicy {
  const row = getSqliteDatabase()
    .prepare('SELECT * FROM user_trust_policies WHERE principal_id = ?')
    .get(principalId) as UserTrustPolicyRow | undefined;
  return row ? fromRow(row) : {
    principalId,
    defaultActionLevel: DEFAULT_USER_TRUST_LEVEL,
  };
}

export function setUserTrustPolicy(
  defaultActionLevel: UserTrustLevel,
  principalId = 'local-owner',
): UserTrustPolicy {
  const updatedAt = new Date().toISOString();
  return runSqliteWriteTransaction((db) => {
    db.prepare(`
      INSERT INTO user_trust_policies (principal_id, default_action_level, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(principal_id) DO UPDATE SET
        default_action_level = excluded.default_action_level,
        updated_at = excluded.updated_at
    `).run(principalId, defaultActionLevel, updatedAt);
    return getUserTrustPolicy(principalId);
  });
}
