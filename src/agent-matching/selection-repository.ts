import { createHash, randomUUID } from 'node:crypto';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { getSessionMetadata } from '../storage/sqlite/index.js';
import { getSessionInputState } from '../storage/sqlite/session-input-repository.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-instance-repository.js';
import type { SpecialistAssessment } from './service.js';
import type { SpecialistTaskRequirements } from './schema.js';

export type SelectionStatus = 'pending_connection' | 'rejected' | 'task_linked' | 'start_blocked' | 'start_failed';
export interface SelectionRecord {
  id: string;
  conversationId: string;
  taskId?: string;
  taskRunId?: string;
  personalRequestId?: string;
  decisionGroupId: string;
  previousSelectionId?: string;
  idempotencyKey: string;
  requestHash: string;
  selectedAgentId: string;
  requirements: SpecialistTaskRequirements;
  assessment: SpecialistAssessment;
  candidates?: Array<Pick<SpecialistAssessment, 'id' | 'revision' | 'eligibility' | 'checks' | 'matched' | 'missing'>>;
  selectionSource: 'snapshot' | 'match' | 'explicit' | 'legacy';
  selectionReason: string;
  reasonSource: 'model' | 'system';
  status: SelectionStatus;
  reasonCode?: string;
  createdAt: number;
}

type Row = {
  id: string; conversation_id: string; task_id: string | null; task_run_id: string | null;
  personal_request_id: string | null; decision_group_id: string; previous_selection_id: string | null;
  idempotency_key: string; request_hash: string; selected_agent_id: string;
  requirements_json: string; assessment_json: string; selection_source: SelectionRecord['selectionSource'];
  reason_source: SelectionRecord['reasonSource']; candidates_json: string | null; selection_reason: string; status: SelectionStatus; reason_code: string | null; created_at: number;
};
function decode(row: Row): SelectionRecord {
  return { id: row.id, conversationId: row.conversation_id, taskId: row.task_id ?? undefined,
    taskRunId: row.task_run_id ?? undefined, personalRequestId: row.personal_request_id ?? undefined,
    decisionGroupId: row.decision_group_id, previousSelectionId: row.previous_selection_id ?? undefined,
    idempotencyKey: row.idempotency_key, requestHash: row.request_hash, selectedAgentId: row.selected_agent_id,
    requirements: JSON.parse(row.requirements_json), assessment: JSON.parse(row.assessment_json),
    candidates: row.candidates_json ? JSON.parse(row.candidates_json) : undefined,
    selectionSource: row.selection_source, selectionReason: row.selection_reason, reasonSource: row.reason_source,
    status: row.status, reasonCode: row.reason_code ?? undefined, createdAt: row.created_at };
}

export function selectionRequestHash(value: unknown): string {
  // Stable object-key ordering keeps semantically identical retries equivalent.
  const normalize = (input: unknown): unknown => Array.isArray(input) ? input.map(normalize)
    : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)])) : input;
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

export class AgentSelectionRepository {
  find(conversationId: string, key: string): SelectionRecord | undefined {
    const row = getSqliteDatabase().prepare('SELECT * FROM agent_selection_records WHERE conversation_id = ? AND idempotency_key = ?')
      .get(conversationId, key) as Row | undefined;
    return row && decode(row);
  }

  list(conversationId: string, filter: { taskId?: string; requestId?: string; offset?: number } = {}): SelectionRecord[] {
    const clauses = ['conversation_id = ?'];
    const args: Array<string | number> = [conversationId];
    if (filter.taskId) { clauses.push('task_id = ?'); args.push(filter.taskId); }
    if (filter.requestId) { clauses.push('personal_request_id = ?'); args.push(filter.requestId); }
    return (getSqliteDatabase().prepare(`SELECT * FROM agent_selection_records WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ?`).all(...args, Math.max(0, filter.offset ?? 0)) as Row[]).map(decode);
  }

  create(input: {
    conversationId: string; key: string; requestHash: string; requirements: SpecialistTaskRequirements;
    assessment: SpecialistAssessment; source: SelectionRecord['selectionSource']; reason?: string; reasonSource?: SelectionRecord['reasonSource'];
    candidates?: SelectionRecord['candidates']; previousSelectionId?: string; requestId?: string; status: SelectionStatus;
  }): SelectionRecord {
    const existing = this.find(input.conversationId, input.key);
    if (existing) {
      if (existing.requestHash !== input.requestHash) throw new Error('Idempotency key was reused with different input');
      return existing;
    }
    const db = getSqliteDatabase();
    if (!getSessionMetadata(input.conversationId)) throw new Error('Selection conversation not found');
    const previous = input.previousSelectionId ? db.prepare('SELECT * FROM agent_selection_records WHERE id = ? AND conversation_id = ?')
      .get(input.previousSelectionId, input.conversationId) as Row | undefined : undefined;
    if (input.previousSelectionId && !previous) throw new Error('Previous selection does not belong to this conversation');
    const id = randomUUID();
    const now = Date.now();
    db.prepare(`INSERT INTO agent_selection_records(id, conversation_id, transcript_id, input_id,
      personal_request_id, decision_group_id, previous_selection_id, idempotency_key, request_hash,
      selected_agent_id, selected_agent_revision, matcher_version, catalog_revision, requirements_json,
      selected_profile_json, assessment_json, candidates_json, selection_source, reason_source, selection_reason, status, reason_code, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.conversationId,
      readCurrentTranscriptId(db, input.conversationId) ?? null, getSessionInputState(input.conversationId).activeInputId ?? null,
      input.requestId ?? null, previous?.decision_group_id ?? id, previous?.id ?? null, input.key, input.requestHash,
      input.assessment.id, input.assessment.revision ?? null, input.assessment.matcherVersion, input.assessment.catalogRevision,
      JSON.stringify(input.requirements), input.assessment.specialistProfile ? JSON.stringify(input.assessment.specialistProfile) : null,
      JSON.stringify(input.assessment), input.candidates ? JSON.stringify(input.candidates.slice(0, 10)) : null, input.source, input.reasonSource ?? (input.reason ? 'model' : 'system'), (input.reason ?? 'Legacy delegation; selected Agent revalidated').slice(0, 500),
      input.status, input.status === 'rejected' ? input.assessment.checks.find(check => check.state === 'blocked' || check.state === 'unknown')?.reasonCode ?? 'unavailable' : null, now, now);
    return this.find(input.conversationId, input.key)!;
  }

  link(id: string, result: { taskId?: string; runId?: string; status: SelectionStatus; reasonCode?: string }): void {
    getSqliteDatabase().prepare(`UPDATE agent_selection_records SET task_id = COALESCE(?, task_id),
      task_run_id = COALESCE(?, task_run_id), status = ?, reason_code = ?, updated_at = ? WHERE id = ?`)
      .run(result.taskId ?? null, result.runId ?? null, result.status, result.reasonCode ?? null, Date.now(), id);
  }
}
