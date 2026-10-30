import { canonicalSessionCommand, type SessionInputControlCommand, type SessionInputControlView } from '@xopcai/gateway-contract';

import { readCurrentTranscriptId } from './session-instance-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export class SessionInputControlConflict extends Error {}

export function readSessionInputControl(conversationId: string): SessionInputControlView {
  const db = getSqliteDatabase();
  const row = db.prepare(`SELECT paused, version, stop_run_id, review_required FROM session_input_control WHERE conversation_id = ?`)
    .get(conversationId) as { paused: number; version: number; stop_run_id: string | null; review_required: number } | undefined;
  const runtime = db.prepare('SELECT active_run_id FROM session_input_runtime WHERE conversation_id = ?')
    .get(conversationId) as { active_run_id: string | null } | undefined;
  return { paused: Boolean(row?.paused), version: row?.version ?? 0, reviewRequired: Boolean(row?.review_required),
    phase: row?.stop_run_id ? 'stopping' : runtime?.active_run_id ? 'running' : 'idle' };
}

export function hasSessionInputControlOperation(conversationId: string, operationId: string): boolean {
  return Boolean(getSqliteDatabase().prepare('SELECT 1 FROM session_input_control_operations WHERE conversation_id = ? AND operation_id = ?')
    .get(conversationId, operationId));
}

/** The pause fence commits before any asynchronous cancellation or context preparation. */
export function acceptSessionInputControl(conversationId: string, command: SessionInputControlCommand): { runId?: string; replay: boolean } {
  return runSqliteWriteTransaction(db => {
    const request = canonicalSessionCommand(command);
    const previous = db.prepare('SELECT request_json, run_id FROM session_input_control_operations WHERE conversation_id = ? AND operation_id = ?')
      .get(conversationId, command.operationId) as { request_json: string; run_id: string | null } | undefined;
    if (previous) {
      if (previous.request_json !== request) throw new SessionInputControlConflict('Operation identity was reused');
      const current = db.prepare('SELECT stop_run_id FROM session_input_control WHERE conversation_id = ?')
        .get(conversationId) as { stop_run_id: string | null } | undefined;
      return { replay: true, runId: current?.stop_run_id === previous.run_id ? previous.run_id ?? undefined : undefined };
    }
    if (readCurrentTranscriptId(db, conversationId) !== command.expectedTranscriptId) throw new SessionInputControlConflict('Conversation transcript changed');
    const state = readSessionInputControl(conversationId);
    if (state.version !== command.expectedVersion) throw new SessionInputControlConflict('Queue control changed');
    if ((command.action === 'resume' || command.action === 'send' || command.action === 'steer') && state.phase === 'stopping') throw new SessionInputControlConflict('Wait for stopping to finish');
    if ((command.action === 'send' || command.action === 'steer') && !command.inputId) throw new SessionInputControlConflict('Select an input');
    if (command.action === 'send' && state.phase !== 'idle') throw new SessionInputControlConflict('Wait for the active input to finish');
    if (command.action === 'send' && db.prepare('SELECT 1 FROM session_input_control WHERE conversation_id = ? AND permitted_input_id IS NOT NULL').get(conversationId)) {
      throw new SessionInputControlConflict('Another input is awaiting execution');
    }
    if (command.action === 'steer' && state.phase !== 'running') throw new SessionInputControlConflict('No active reply to steer');
    if (command.inputId) {
      const row = db.prepare('SELECT status, version, expected_transcript_id FROM session_inputs WHERE conversation_id = ? AND id = ?')
        .get(conversationId, command.inputId) as { status: string; version: number; expected_transcript_id: string | null } | undefined;
      if (row?.expected_transcript_id && row.expected_transcript_id !== command.expectedTranscriptId) throw new SessionInputControlConflict('Input belongs to an earlier transcript');
      if (!row || (row.status !== 'queued' && !(command.action === 'send' && row.status === 'interrupted')) || row.version !== command.inputVersion) throw new SessionInputControlConflict('This input changed or has started');
    }
    const runtime = db.prepare('SELECT active_run_id FROM session_input_runtime WHERE conversation_id = ?')
      .get(conversationId) as { active_run_id: string | null } | undefined;
    const runId = command.action === 'stop' || command.action === 'steer' ? runtime?.active_run_id ?? undefined : undefined;
    db.prepare(`INSERT INTO session_input_runtime(conversation_id, revision, updated_at_ms) VALUES (?, 0, ?) ON CONFLICT DO NOTHING`).run(conversationId, Date.now());
    db.prepare(`INSERT INTO session_input_control(conversation_id) VALUES (?) ON CONFLICT DO NOTHING`).run(conversationId);
    db.prepare(`UPDATE session_input_control SET paused = ?, version = version + 1,
      stop_run_id = CASE WHEN ? = 'stop' THEN ? ELSE stop_run_id END,
      permitted_input_id = ?, review_required = CASE WHEN ? = 'resume' THEN 0 ELSE review_required END WHERE conversation_id = ?`)
      .run(command.action === 'steer' ? Number(state.paused) : command.action === 'resume' ? 0 : 1, command.action,
        command.action === 'stop' ? runId ?? null : null, command.action === 'send' ? command.inputId! : null, command.action, conversationId);
    if (command.action === 'send') {
      db.prepare("UPDATE session_inputs SET status = 'queued', effective_delivery = 'next', target_run_id = NULL, version = version + 1, updated_at_ms = ? WHERE id = ?")
        .run(Date.now(), command.inputId!);
    }
    if (command.action === 'steer') {
      db.prepare("UPDATE session_inputs SET status = 'injecting', effective_delivery = 'steer', target_run_id = ?, version = version + 1, updated_at_ms = ? WHERE id = ?")
        .run(runId!, Date.now(), command.inputId!);
    }
    db.prepare(`INSERT INTO session_input_control_operations(conversation_id, operation_id, request_json, run_id) VALUES (?, ?, ?, ?)`)
      .run(conversationId, command.operationId, request, runId ?? null);
    db.prepare(`UPDATE session_input_runtime SET revision = revision + 1 WHERE conversation_id = ?`).run(conversationId);
    return { runId, replay: false };
  });
}

/** Called inside the input acceptance transaction, never as a later HTTP side effect. */
export function authorizeSessionInput(conversationId: string, inputId: string, version?: number, single = false): void {
  const db = getSqliteDatabase();
  const state = readSessionInputControl(conversationId);
  if (version !== undefined && state.version !== version) throw new SessionInputControlConflict('Queue control changed; retry after refreshing');
  if (!single) return;
  if (version === undefined || state.phase !== 'idle') throw new SessionInputControlConflict('Wait for the active input to finish');
  const granted = db.prepare('SELECT permitted_input_id FROM session_input_control WHERE conversation_id = ?')
    .get(conversationId) as { permitted_input_id: string | null } | undefined;
  if (granted?.permitted_input_id) throw new SessionInputControlConflict('Another input is awaiting execution');
  db.prepare(`INSERT INTO session_input_control(conversation_id, paused, permitted_input_id, version) VALUES (?, 1, ?, 1)
    ON CONFLICT(conversation_id) DO UPDATE SET paused = 1, permitted_input_id = excluded.permitted_input_id, version = version + 1`).run(conversationId, inputId);
}
