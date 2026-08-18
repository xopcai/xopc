import { randomUUID } from 'node:crypto';

import type {
  Outcome,
  OutcomeContract,
  OutcomeImportance,
  OutcomeInternalStatus,
  OutcomeUserStatus,
} from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export type OutcomeSubjectKind =
  | 'project'
  | 'work_item'
  | 'session'
  | 'workflow'
  | 'automation'
  | 'artifact'
  | 'source';

export type OutcomeLinkInput = {
  kind: OutcomeSubjectKind;
  id: string;
  relation?: string;
};

type OutcomeRow = {
  outcome_id: string;
  objective: string;
  user_status: OutcomeUserStatus;
  internal_status: OutcomeInternalStatus;
  importance: OutcomeImportance;
  due_at: number | null;
  latest_contract_version: number;
  latest_receipt_run_id: string | null;
  created_at: number;
  updated_at: number;
};

type OutcomeContractRow = {
  outcome_id: string;
  version: number;
  objective: string;
  deliverables_json: string;
  acceptance_criteria_json: string;
  constraints_json: string;
  approval_required_json: string;
  assumptions_json: string;
  risks_json: string;
  context_snapshot_id: string | null;
  created_by: 'user' | 'system';
  created_at: number;
};

type OutcomeLinkRow = {
  subject_kind: OutcomeSubjectKind;
  subject_id: string;
  relation: string;
};

function contractFromRow(row: OutcomeContractRow): OutcomeContract {
  return {
    outcomeId: row.outcome_id,
    version: row.version,
    objective: row.objective,
    deliverables: JSON.parse(row.deliverables_json) as string[],
    acceptanceCriteria: JSON.parse(row.acceptance_criteria_json) as string[],
    constraints: JSON.parse(row.constraints_json) as string[],
    approvalRequired: JSON.parse(row.approval_required_json) as string[],
    assumptions: JSON.parse(row.assumptions_json) as string[],
    risks: JSON.parse(row.risks_json) as string[],
    ...(row.context_snapshot_id ? { contextSnapshotId: row.context_snapshot_id } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function outcomeFromRow(row: OutcomeRow, contract?: OutcomeContract): Outcome {
  return {
    id: row.outcome_id,
    objective: row.objective,
    userStatus: row.user_status,
    internalStatus: row.internal_status,
    importance: row.importance,
    ...(row.due_at === null ? {} : { dueAt: row.due_at }),
    latestContractVersion: row.latest_contract_version,
    ...(row.latest_receipt_run_id ? { latestReceiptRunId: row.latest_receipt_run_id } : {}),
    ...(contract ? { contract } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class OutcomeRepository {
  create(input: {
    id?: string;
    objective: string;
    deliverables?: string[];
    acceptanceCriteria?: string[];
    constraints?: string[];
    approvalRequired?: string[];
    assumptions?: string[];
    risks?: string[];
    contextSnapshotId?: string;
    createdBy?: 'user' | 'system';
    importance?: OutcomeImportance;
    dueAt?: number;
    links?: OutcomeLinkInput[];
    now?: number;
  }): Outcome {
    const objective = input.objective.trim();
    if (!objective) throw new Error('Outcome objective is required');
    const id = input.id ?? randomUUID();
    const now = input.now ?? Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO outcomes (
          outcome_id, objective, user_status, internal_status, importance,
          due_at, latest_contract_version, created_at, updated_at
        ) VALUES (?, ?, 'running', 'captured', ?, ?, 1, ?, ?)`,
      ).run(id, objective, input.importance ?? 'normal', input.dueAt ?? null, now, now);
      db.prepare(
        `INSERT INTO outcome_contracts (
          outcome_id, version, objective, deliverables_json, acceptance_criteria_json,
          constraints_json, approval_required_json, context_snapshot_id, created_by, created_at
          , assumptions_json, risks_json
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        objective,
        JSON.stringify(input.deliverables ?? []),
        JSON.stringify(input.acceptanceCriteria ?? []),
        JSON.stringify(input.constraints ?? []),
        JSON.stringify(input.approvalRequired ?? []),
        input.contextSnapshotId ?? null,
        input.createdBy ?? 'system',
        now,
        JSON.stringify(input.assumptions ?? []),
        JSON.stringify(input.risks ?? []),
      );
      for (const link of input.links ?? []) {
        this.addLink(id, link, now);
      }
    });
    return this.get(id)!;
  }

  get(id: string): Outcome | undefined {
    const row = getSqliteDatabase()
      .prepare('SELECT * FROM outcomes WHERE outcome_id = ?')
      .get(id) as OutcomeRow | undefined;
    if (!row) return undefined;
    return outcomeFromRow(row, this.getContract(id, row.latest_contract_version));
  }

  getBySubject(kind: OutcomeSubjectKind, subjectId: string): Outcome | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT outcomes.* FROM outcomes
       JOIN outcome_links ON outcome_links.outcome_id = outcomes.outcome_id
       WHERE outcome_links.subject_kind = ? AND outcome_links.subject_id = ?
       ORDER BY outcomes.updated_at DESC LIMIT 1`,
    ).get(kind, subjectId) as OutcomeRow | undefined;
    return row ? outcomeFromRow(row, this.getContract(row.outcome_id, row.latest_contract_version)) : undefined;
  }

  listLinks(outcomeId: string): OutcomeLinkInput[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT subject_kind, subject_id, relation FROM outcome_links
       WHERE outcome_id = ? ORDER BY created_at ASC`,
    ).all(outcomeId) as OutcomeLinkRow[];
    return rows.map((row) => ({
      kind: row.subject_kind,
      id: row.subject_id,
      relation: row.relation,
    }));
  }

  list(input: { status?: OutcomeUserStatus; limit?: number } = {}): Outcome[] {
    const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 50)));
    const rows = (input.status
      ? getSqliteDatabase().prepare(
        'SELECT * FROM outcomes WHERE user_status = ? ORDER BY updated_at DESC LIMIT ?',
      ).all(input.status, limit)
      : getSqliteDatabase().prepare(
        'SELECT * FROM outcomes ORDER BY updated_at DESC LIMIT ?',
      ).all(limit)) as OutcomeRow[];
    return rows.map((row) => outcomeFromRow(
      row,
      this.getContract(row.outcome_id, row.latest_contract_version),
    ));
  }

  getContract(outcomeId: string, version?: number): OutcomeContract | undefined {
    const row = (version === undefined
      ? getSqliteDatabase().prepare(
        'SELECT * FROM outcome_contracts WHERE outcome_id = ? ORDER BY version DESC LIMIT 1',
      ).get(outcomeId)
      : getSqliteDatabase().prepare(
        'SELECT * FROM outcome_contracts WHERE outcome_id = ? AND version = ?',
      ).get(outcomeId, version)) as OutcomeContractRow | undefined;
    return row ? contractFromRow(row) : undefined;
  }

  reviseContract(input: {
    outcomeId: string;
    objective: string;
    deliverables: string[];
    acceptanceCriteria: string[];
    constraints: string[];
    approvalRequired: string[];
    assumptions: string[];
    risks: string[];
    contextSnapshotId?: string;
    createdBy: 'user' | 'system';
    now?: number;
  }): Outcome {
    const current = this.get(input.outcomeId);
    if (!current) throw new Error('Outcome not found');
    const objective = input.objective.trim();
    if (!objective) throw new Error('Outcome objective is required');
    const version = current.latestContractVersion + 1;
    const now = input.now ?? Date.now();
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO outcome_contracts (
          outcome_id, version, objective, deliverables_json, acceptance_criteria_json,
          constraints_json, approval_required_json, context_snapshot_id, created_by, created_at
          , assumptions_json, risks_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.outcomeId,
        version,
        objective,
        JSON.stringify(input.deliverables),
        JSON.stringify(input.acceptanceCriteria),
        JSON.stringify(input.constraints),
        JSON.stringify(input.approvalRequired),
        input.contextSnapshotId ?? null,
        input.createdBy,
        now,
        JSON.stringify(input.assumptions),
        JSON.stringify(input.risks),
      );
      db.prepare(
        `UPDATE outcomes SET objective = ?, latest_contract_version = ?, updated_at = ?
         WHERE outcome_id = ?`,
      ).run(objective, version, now, input.outcomeId);
    });
    return this.get(input.outcomeId)!;
  }

  updateState(input: {
    id: string;
    userStatus: OutcomeUserStatus;
    internalStatus: OutcomeInternalStatus;
    latestReceiptRunId?: string;
    now?: number;
  }): Outcome | undefined {
    const now = input.now ?? Date.now();
    getSqliteDatabase().prepare(
      `UPDATE outcomes SET user_status = ?, internal_status = ?,
       latest_receipt_run_id = COALESCE(?, latest_receipt_run_id), updated_at = ?
       WHERE outcome_id = ?`,
    ).run(input.userStatus, input.internalStatus, input.latestReceiptRunId ?? null, now, input.id);
    return this.get(input.id);
  }

  addLink(outcomeId: string, link: OutcomeLinkInput, now = Date.now()): void {
    getSqliteDatabase().prepare(
      `INSERT INTO outcome_links (outcome_id, subject_kind, subject_id, relation, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(outcome_id, subject_kind, subject_id)
       DO UPDATE SET relation = excluded.relation`,
    ).run(outcomeId, link.kind, link.id, link.relation ?? 'supports', now);
  }
}
