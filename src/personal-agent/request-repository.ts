import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import type { PersonalRequestResult } from './request-result.js';

export type PersonalRequestState = 'preflighting' | 'waiting_connection' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface PersonalRequest {
  requestId: string;
  conversationId: string;
  transcriptId: string;
  inputId: string;
  objective: string;
  connectorId: string;
  executorAgentId: string;
  accountId?: string;
  parameters: { timeRange?: { from: string; to: string; timezone: string; expression: string } };
  state: PersonalRequestState;
  connectionWaitId?: string;
  taskId?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  result?: PersonalRequestResult;
}

type Row = {
  request_id: string; conversation_id: string; transcript_id: string; input_id: string;
  objective: string; connector_id: string; executor_agent_id: string; account_id: string | null;
  parameters_json: string; state: PersonalRequestState; connection_wait_id: string | null;
  task_id: string | null; version: number; created_at: number; updated_at: number; result_json: string | null;
};
function fromRow(row: Row): PersonalRequest {
  return { requestId: row.request_id, conversationId: row.conversation_id, transcriptId: row.transcript_id,
    inputId: row.input_id, objective: row.objective, connectorId: row.connector_id,
    executorAgentId: row.executor_agent_id, accountId: row.account_id ?? undefined,
    parameters: JSON.parse(row.parameters_json), state: row.state,
    connectionWaitId: row.connection_wait_id ?? undefined, taskId: row.task_id ?? undefined,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}) };
}
export function getPersonalRequest(requestId: string): PersonalRequest | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const row = getSqliteDatabase().prepare('SELECT * FROM personal_requests WHERE request_id = ?').get(requestId) as Row | undefined;
  return row ? fromRow(row) : undefined;
}
export function personalRequestForWait(waitId: string): PersonalRequest | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const row = getSqliteDatabase().prepare('SELECT * FROM personal_requests WHERE connection_wait_id = ?').get(waitId) as Row | undefined;
  return row ? fromRow(row) : undefined;
}
export function personalRequestForTask(taskId: string): PersonalRequest | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const row = getSqliteDatabase().prepare('SELECT * FROM personal_requests WHERE task_id = ?').get(taskId) as Row | undefined;
  return row ? fromRow(row) : undefined;
}
export function personalRequestForExecution(conversationId: string): PersonalRequest | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const row = getSqliteDatabase().prepare(`SELECT request.* FROM personal_requests request
    JOIN task_sessions session ON session.task_id = request.task_id
    JOIN task_conversation_state state ON state.task_id = session.task_id
      AND state.active_conversation_id = session.conversation_id AND state.assignment_epoch = session.assignment_epoch
    WHERE session.conversation_id = ? AND session.role = 'execution' AND session.status = 'active'
    ORDER BY session.created_at DESC LIMIT 1`).get(conversationId) as Row | undefined;
  return row ? fromRow(row) : undefined;
}
export function listPersonalRequests(conversationId: string): PersonalRequest[] {
  return (getSqliteDatabase().prepare('SELECT * FROM personal_requests WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(conversationId) as Row[]).map(fromRow);
}
export function updatePersonalRequest(request: PersonalRequest, patch: Partial<Pick<PersonalRequest,
  'state' | 'connectionWaitId' | 'accountId' | 'taskId' | 'objective' | 'connectorId' | 'parameters'>>): PersonalRequest {
  const next = { ...request, ...patch, version: request.version + 1, updatedAt: Date.now() };
  const result = getSqliteDatabase().prepare(`UPDATE personal_requests SET state = ?, connection_wait_id = ?,
    account_id = ?, task_id = ?, objective = ?, connector_id = ?, parameters_json = ?, version = ?, updated_at = ?
    WHERE request_id = ? AND version = ?`).run(next.state, next.connectionWaitId ?? null, next.accountId ?? null,
    next.taskId ?? null, next.objective, next.connectorId, JSON.stringify(next.parameters), next.version,
    next.updatedAt, request.requestId, request.version);
  if (!result.changes) throw new Error('PERSONAL_REQUEST_CHANGED');
  return next;
}
