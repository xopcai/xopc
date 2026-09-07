import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { USER_MODEL_PRINCIPAL_ID, validateScope, type AssertionAuthority, type UserModelScope } from './domain.js';

export type UserGoalStatus = 'proposed' | 'active' | 'paused' | 'achieved' | 'abandoned';

export interface UserGoal {
  id: string;
  principalId: string;
  status: UserGoalStatus;
  scope: UserModelScope;
  title: string;
  desiredOutcome: string;
  declaredImportance?: number;
  confidence: number;
  authority: AssertionAuthority;
  targetAt?: number;
  validFrom?: number;
  validTo?: number;
  reviewAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface UserPriorityWindow {
  id: string;
  principalId: string;
  targetType: 'goal' | 'project' | 'task' | 'assertion' | 'topic';
  targetId: string;
  rank: 'primary' | 'secondary' | 'background';
  declaredImportance?: number;
  urgency: number;
  scope: UserModelScope;
  validFrom: number;
  validTo: number;
  reviewAt: number;
  status: 'active' | 'paused' | 'completed' | 'expired';
  createdAt: number;
  updatedAt: number;
}

function optionalNumber(value: number | null): number | undefined {
  return value === null ? undefined : value;
}

export function listUserGoals(principalId = USER_MODEL_PRINCIPAL_ID): UserGoal[] {
  const rows = getSqliteDatabase().prepare(`SELECT g.*, r.title, r.desired_outcome
    FROM user_goals g JOIN user_goal_revisions r ON r.revision_id = g.current_revision_id
    WHERE g.principal_id = ? ORDER BY g.updated_at DESC`).all(principalId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.goal_id as string,
    principalId: row.principal_id as string,
    status: row.status as UserGoalStatus,
    scope: { type: row.scope_type as UserModelScope['type'], ...(
      row.scope_id ? { id: row.scope_id as string } : {}) },
    title: row.title as string,
    desiredOutcome: row.desired_outcome as string,
    ...(optionalNumber(row.declared_importance as number | null) === undefined ? {}
      : { declaredImportance: row.declared_importance as number }),
    confidence: row.confidence as number,
    authority: row.authority as AssertionAuthority,
    ...(optionalNumber(row.target_at as number | null) === undefined ? {} : { targetAt: row.target_at as number }),
    ...(optionalNumber(row.valid_from as number | null) === undefined ? {} : { validFrom: row.valid_from as number }),
    ...(optionalNumber(row.valid_to as number | null) === undefined ? {} : { validTo: row.valid_to as number }),
    ...(optionalNumber(row.review_at as number | null) === undefined ? {} : { reviewAt: row.review_at as number }),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }));
}

export function createUserGoal(input: {
  title: string;
  desiredOutcome: string;
  scope: UserModelScope;
  declaredImportance?: number;
  targetAt?: number;
  now?: number;
}): UserGoal {
  validateScope(input.scope);
  if (!input.title.trim() || !input.desiredOutcome.trim()) throw new Error('Goal title and desired outcome are required.');
  if (input.declaredImportance !== undefined
    && (input.declaredImportance < 0 || input.declaredImportance > 1)) {
    throw new Error('Goal declared importance must be between 0 and 1.');
  }
  const now = input.now ?? Date.now();
  const goalId = randomUUID();
  const revisionId = randomUUID();
  runSqliteWriteTransaction((db) => {
    db.prepare(`INSERT INTO user_goals (
      goal_id, principal_id, status, scope_type, scope_id, declared_importance,
      confidence, authority, target_at, current_revision_id, created_at, updated_at
    ) VALUES (?, ?, 'active', ?, ?, ?, 1, 'user_explicit', ?, ?, ?, ?)`).run(
      goalId, USER_MODEL_PRINCIPAL_ID, input.scope.type, input.scope.id ?? null,
      input.declaredImportance ?? null, input.targetAt ?? null, revisionId, now, now,
    );
    db.prepare(`INSERT INTO user_goal_revisions (
      revision_id, goal_id, title, desired_outcome, created_by, change_reason, created_at
    ) VALUES (?, ?, ?, ?, 'user', 'Goal created by user.', ?)`).run(
      revisionId, goalId, input.title.trim(), input.desiredOutcome.trim(), now,
    );
  });
  return listUserGoals().find((goal) => goal.id === goalId)!;
}

export function setUserGoalStatus(id: string, status: UserGoalStatus, now = Date.now()): UserGoal | undefined {
  const result = getSqliteDatabase().prepare(`UPDATE user_goals SET status = ?, updated_at = ? WHERE goal_id = ?`)
    .run(status, now, id);
  return result.changes ? listUserGoals().find((goal) => goal.id === id) : undefined;
}

export function listPriorityWindows(principalId = USER_MODEL_PRINCIPAL_ID): UserPriorityWindow[] {
  const rows = getSqliteDatabase().prepare(`SELECT * FROM user_priority_windows
    WHERE principal_id = ? ORDER BY valid_from DESC`).all(principalId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.priority_id as string,
    principalId: row.principal_id as string,
    targetType: row.target_type as UserPriorityWindow['targetType'],
    targetId: row.target_id as string,
    rank: row.rank as UserPriorityWindow['rank'],
    ...((row.declared_importance as number | null) === null ? {} : { declaredImportance: row.declared_importance as number }),
    urgency: row.urgency as number,
    scope: { type: row.scope_type as UserModelScope['type'], ...(row.scope_id ? { id: row.scope_id as string } : {}) },
    validFrom: row.valid_from as number,
    validTo: row.valid_to as number,
    reviewAt: row.review_at as number,
    status: row.status as UserPriorityWindow['status'],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }));
}

export function createPriorityWindow(input: {
  targetType: UserPriorityWindow['targetType'];
  targetId: string;
  rank: UserPriorityWindow['rank'];
  urgency: number;
  scope: UserModelScope;
  validFrom: number;
  validTo: number;
  reviewAt?: number;
  declaredImportance?: number;
  now?: number;
}): UserPriorityWindow {
  validateScope(input.scope);
  if (!input.targetId.trim()) throw new Error('Priority target id is required.');
  if (input.validTo < input.validFrom) throw new Error('Priority validTo must be after validFrom.');
  for (const value of [input.urgency, input.declaredImportance]) {
    if (value !== undefined && (value < 0 || value > 1)) throw new Error('Priority scores must be between 0 and 1.');
  }
  const now = input.now ?? Date.now();
  const id = randomUUID();
  getSqliteDatabase().prepare(`INSERT INTO user_priority_windows (
    priority_id, principal_id, target_type, target_id, rank, declared_importance,
    urgency, scope_type, scope_id, valid_from, valid_to, review_at, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).run(
    id, USER_MODEL_PRINCIPAL_ID, input.targetType, input.targetId.trim(), input.rank,
    input.declaredImportance ?? null, input.urgency, input.scope.type, input.scope.id ?? null,
    input.validFrom, input.validTo, input.reviewAt ?? input.validTo, now, now,
  );
  return listPriorityWindows().find((item) => item.id === id)!;
}
