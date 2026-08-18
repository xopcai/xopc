import type { MediaRef } from '../media/types.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

export type OutcomeExecutionPriority = 'low' | 'normal' | 'high';
export type OutcomeExecutionSource = 'chat' | 'cli' | 'cron' | 'workflow' | 'channel' | 'api';
export type OutcomeUiLocale = 'en' | 'zh';

type OutcomeExecutionStateRow = {
  outcome_id: string;
  description: string | null;
  agent_id: string;
  priority: OutcomeExecutionPriority;
  active_session_key: string | null;
  next_action: string | null;
  blocked_reason: string | null;
  ui_locale: OutcomeUiLocale | null;
  source: OutcomeExecutionSource;
  project_id: string | null;
  context_text: string | null;
  context_attachments_json: string;
  approved_boundaries_json: string;
  created_at: number;
  updated_at: number;
};

export interface OutcomeExecutionState {
  outcomeId: string;
  description?: string;
  agentId: string;
  priority: OutcomeExecutionPriority;
  activeSessionKey?: string;
  nextAction?: string;
  blockedReason?: string;
  uiLocale?: OutcomeUiLocale;
  source: OutcomeExecutionSource;
  projectId?: string;
  contextMessage?: { text: string; attachments: MediaRef[] };
  approvedBoundaries: string[];
  createdAt: number;
  updatedAt: number;
}

function fromRow(row: OutcomeExecutionStateRow): OutcomeExecutionState {
  const attachments = JSON.parse(row.context_attachments_json) as MediaRef[];
  return {
    outcomeId: row.outcome_id,
    ...(row.description ? { description: row.description } : {}),
    agentId: row.agent_id,
    priority: row.priority,
    ...(row.active_session_key ? { activeSessionKey: row.active_session_key } : {}),
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
    ...(row.ui_locale ? { uiLocale: row.ui_locale } : {}),
    source: row.source,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...((row.context_text || attachments.length > 0)
      ? { contextMessage: { text: row.context_text ?? '', attachments } }
      : {}),
    approvedBoundaries: JSON.parse(row.approved_boundaries_json) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class OutcomeExecutionStateRepository {
  create(input: {
    outcomeId: string;
    description?: string;
    agentId?: string;
    priority?: OutcomeExecutionPriority;
    activeSessionKey?: string;
    uiLocale?: OutcomeUiLocale;
    source?: OutcomeExecutionSource;
    projectId?: string;
    contextText?: string;
    contextAttachments?: MediaRef[];
    approvedBoundaries?: string[];
    now?: number;
  }): OutcomeExecutionState {
    const now = input.now ?? Date.now();
    getSqliteDatabase().prepare(
      `INSERT INTO outcome_execution_state (
        outcome_id, description, agent_id, priority, active_session_key,
        ui_locale, source, project_id, context_text, context_attachments_json,
        approved_boundaries_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.outcomeId,
      input.description?.trim() || null,
      input.agentId ?? 'main',
      input.priority ?? 'normal',
      input.activeSessionKey ?? null,
      input.uiLocale ?? null,
      input.source ?? 'chat',
      input.projectId ?? null,
      input.contextText?.trim() || null,
      JSON.stringify(input.contextAttachments ?? []),
      JSON.stringify(input.approvedBoundaries ?? []),
      now,
      now,
    );
    return this.get(input.outcomeId)!;
  }

  get(outcomeId: string): OutcomeExecutionState | undefined {
    const row = getSqliteDatabase().prepare(
      'SELECT * FROM outcome_execution_state WHERE outcome_id = ?',
    ).get(outcomeId) as OutcomeExecutionStateRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  getBySession(sessionKey: string): OutcomeExecutionState | undefined {
    const row = getSqliteDatabase().prepare(
      `SELECT * FROM outcome_execution_state
       WHERE active_session_key = ? ORDER BY updated_at DESC LIMIT 1`,
    ).get(sessionKey) as OutcomeExecutionStateRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  listByProject(projectId: string, limit = 50): OutcomeExecutionState[] {
    const rows = getSqliteDatabase().prepare(
      `SELECT * FROM outcome_execution_state
       WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?`,
    ).all(projectId, Math.max(1, Math.min(200, Math.floor(limit)))) as OutcomeExecutionStateRow[];
    return rows.map(fromRow);
  }

  list(limit = 100): OutcomeExecutionState[] {
    const rows = getSqliteDatabase().prepare(
      'SELECT * FROM outcome_execution_state ORDER BY updated_at DESC LIMIT ?',
    ).all(Math.max(1, Math.min(500, Math.floor(limit)))) as OutcomeExecutionStateRow[];
    return rows.map(fromRow);
  }

  update(outcomeId: string, patch: {
    activeSessionKey?: string | null;
    nextAction?: string | null;
    blockedReason?: string | null;
    contextText?: string | null;
    contextAttachments?: MediaRef[];
    approvedBoundaries?: string[];
  }): OutcomeExecutionState | undefined {
    const current = this.get(outcomeId);
    if (!current) return undefined;
    const next = {
      activeSessionKey: patch.activeSessionKey === undefined ? current.activeSessionKey : patch.activeSessionKey ?? undefined,
      nextAction: patch.nextAction === undefined ? current.nextAction : patch.nextAction?.trim() || undefined,
      blockedReason: patch.blockedReason === undefined ? current.blockedReason : patch.blockedReason?.trim() || undefined,
      contextText: patch.contextText === undefined ? current.contextMessage?.text : patch.contextText?.trim() || undefined,
      contextAttachments: patch.contextAttachments ?? current.contextMessage?.attachments ?? [],
      approvedBoundaries: patch.approvedBoundaries ?? current.approvedBoundaries,
    };
    getSqliteDatabase().prepare(
      `UPDATE outcome_execution_state SET
        active_session_key = ?, next_action = ?, blocked_reason = ?,
        context_text = ?, context_attachments_json = ?, approved_boundaries_json = ?, updated_at = ?
       WHERE outcome_id = ?`,
    ).run(
      next.activeSessionKey ?? null,
      next.nextAction ?? null,
      next.blockedReason ?? null,
      next.contextText ?? null,
      JSON.stringify(next.contextAttachments),
      JSON.stringify(next.approvedBoundaries),
      Date.now(),
      outcomeId,
    );
    return this.get(outcomeId);
  }
}
