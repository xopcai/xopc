import { randomUUID } from 'node:crypto';

import { USER_MODEL_PRINCIPAL_ID, type UserModelScope } from '../../user-model/domain.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export interface CollaborationRule {
  id: string;
  category: 'communication' | 'execution' | 'boundary' | 'routine' | 'proactive';
  status: 'active' | 'disabled' | 'archived';
  priority: number;
  scope: UserModelScope;
  conditions: Record<string, unknown>;
  statement: string;
  revisionId: string;
  createdAt: number;
  updatedAt: number;
}

type RuleRow = {
  rule_id: string; category: CollaborationRule['category']; status: CollaborationRule['status'];
  priority: number; scope_type: UserModelScope['type']; scope_id: string | null;
  conditions_json: string; current_revision_id: string; created_at: number; updated_at: number; statement: string;
};

function fromRow(row: RuleRow): CollaborationRule {
  return {
    id: row.rule_id, category: row.category, status: row.status, priority: row.priority,
    scope: { type: row.scope_type, ...(row.scope_id ? { id: row.scope_id } : {}) },
    conditions: JSON.parse(row.conditions_json), statement: row.statement,
    revisionId: row.current_revision_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function getCollaborationRule(id: string): CollaborationRule | undefined {
  const row = getSqliteDatabase().prepare(`SELECT r.*, v.statement FROM collaboration_rules r
    JOIN collaboration_rule_revisions v ON v.revision_id = r.current_revision_id
    WHERE r.rule_id = ?`).get(id) as RuleRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function listCollaborationRules(principalId = USER_MODEL_PRINCIPAL_ID): CollaborationRule[] {
  return (getSqliteDatabase().prepare(`SELECT r.*, v.statement FROM collaboration_rules r
    JOIN collaboration_rule_revisions v ON v.revision_id = r.current_revision_id
    WHERE r.principal_id = ? ORDER BY r.priority, r.updated_at DESC`).all(principalId) as RuleRow[]).map(fromRow);
}

export function createCollaborationRule(
  input: Pick<CollaborationRule, 'category' | 'priority' | 'scope' | 'conditions' | 'statement'>,
): CollaborationRule {
  if (!input.statement.trim()) throw new Error('Collaboration rule statement is required.');
  if (input.scope.type === 'agent') throw new Error('Agent-scoped collaboration rules are not supported.');
  const id = randomUUID();
  const revisionId = randomUUID();
  const now = Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(`INSERT INTO collaboration_rules (
      rule_id, principal_id, category, status, priority, scope_type, scope_id,
      conditions_json, current_revision_id, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`).run(
      id, USER_MODEL_PRINCIPAL_ID, input.category, input.priority, input.scope.type,
      input.scope.id ?? null, JSON.stringify(input.conditions), revisionId, now, now,
    );
    db.prepare(`INSERT INTO collaboration_rule_revisions (
      revision_id, rule_id, statement, created_by, created_at
    ) VALUES (?, ?, ?, 'user', ?)`).run(revisionId, id, input.statement.trim(), now);
  });
  return getCollaborationRule(id)!;
}

export function setCollaborationRuleStatus(id: string, status: CollaborationRule['status']): CollaborationRule | undefined {
  const result = getSqliteDatabase().prepare(`UPDATE collaboration_rules SET status = ?, updated_at = ? WHERE rule_id = ?`)
    .run(status, Date.now(), id);
  return result.changes ? getCollaborationRule(id) : undefined;
}
