import { TASK_RESULT_DELIVERY_TYPE, TaskResultDeliverySchema } from '@xopcai/gateway-contract';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { appendTranscriptEntry, loadLlmMessagesForSession } from '../storage/sqlite/transcript-repository.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-instance-repository.js';
import { emitSessionTranscriptUpdate } from '../session/transcript-events.js';
import { TaskRunRepository } from '../tasks/task-run-repository.js';
import { TaskConversationRepository } from '../tasks/task-conversation-repository.js';
import { createLogger } from '../utils/logger.js';
import { getPersonalRequest, updatePersonalRequest } from './request-repository.js';
import { PersonalRequestResultSchema, renderPersonalRequestResult } from './request-result.js';

const log = createLogger('PersonalRequestDelivery');

/** Closed authorization waits retain their feedback marker for restart-safe delivery. */
export function drainPersonalRequestContinuations(notify?: (conversationId: string, requestId: string) => void): void {
  const db = getSqliteDatabase();
  const rows = db.prepare(`SELECT wait.id, request.request_id FROM session_connection_waits wait
    JOIN personal_requests request ON request.connection_wait_id = wait.id
    WHERE wait.status = 'closed' AND json_extract(wait.data_json, '$.resolution') = 'continued'
      AND json_extract(wait.data_json, '$.personalResumeFeedback.notifiedAt') IS NULL
    ORDER BY request.created_at LIMIT 50`).all() as { id: string; request_id: string }[];
  for (const row of rows) {
    try {
      const request = getPersonalRequest(row.request_id)!;
      const entryId = runSqliteWriteTransaction(() => {
        if (readCurrentTranscriptId(db, request.conversationId) !== request.transcriptId || request.state === 'cancelled') {
          db.prepare("UPDATE session_connection_waits SET data_json = json_set(data_json, '$.personalResumeFeedback.notifiedAt', ?) WHERE id = ?")
            .run(Date.now(), row.id);
          return undefined;
        }
        const stored = db.prepare("SELECT json_extract(data_json, '$.personalResumeFeedback.entryId') AS entry_id FROM session_connection_waits WHERE id = ?")
          .get(row.id) as { entry_id: string | null };
        if (stored.entry_id) return stored.entry_id;
        const content = /[\u3400-\u9fff]/u.test(request.objective)
          ? '连接成功，正在继续处理你的请求。结果会直接发到这里。'
          : 'Connected. Continuing your request; the result will appear here.';
        const entry = appendTranscriptEntry(request.conversationId, { role: 'custom', customType: 'personal_request_status',
          content, details: { requestId: request.requestId, waitId: row.id, taskId: request.taskId }, display: true, timestamp: Date.now() });
        db.prepare("UPDATE session_connection_waits SET data_json = json_set(data_json, '$.personalResumeFeedback.entryId', ?) WHERE id = ?")
          .run(entry.entry_id, row.id);
        return entry.entry_id;
      });
      if (!entryId) continue;
      emitSessionTranscriptUpdate({ conversationId: request.conversationId });
      notify?.(request.conversationId, request.requestId);
      db.prepare("UPDATE session_connection_waits SET data_json = json_set(data_json, '$.personalResumeFeedback.notifiedAt', ?) WHERE id = ?")
        .run(Date.now(), row.id);
    } catch (err) {
      const errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const changed = db.prepare(`UPDATE session_connection_waits
        SET data_json = json_set(data_json, '$.personalResumeFeedback.error', ?)
        WHERE id = ? AND COALESCE(json_extract(data_json, '$.personalResumeFeedback.error'), '') != ?`)
        .run(errorMessage, row.id, errorMessage);
      if (changed.changes) log.warn({ err, requestId: row.request_id, waitId: row.id }, 'Connection continuation feedback will retry');
    }
  }
}

/** The request itself is the durable outbox; append and delivery marker commit together. */
export function drainPersonalRequestResults(notify?: (conversationId: string, requestId: string) => void): void {
  const db = getSqliteDatabase();
  const rows = db.prepare(`SELECT request_id, delivery_attempts FROM personal_requests request WHERE task_id IS NOT NULL
    AND state != 'cancelled' AND notified_at IS NULL AND delivery_attempts < 8 AND delivery_next_attempt_at <= ? AND EXISTS
    (SELECT 1 FROM task_runs run WHERE run.task_id = request.task_id AND run.parent_run_id IS NULL
      AND run.status IN ('succeeded','failed','cancelled')
      AND NOT EXISTS (SELECT 1 FROM task_runs newer WHERE newer.task_id = run.task_id
        AND newer.parent_run_id IS NULL AND newer.queued_at > run.queued_at))
    ORDER BY created_at LIMIT 50`).all(Date.now()) as { request_id: string; delivery_attempts: number }[];
  for (const row of rows) {
    try {
      const request = getPersonalRequest(row.request_id)!;
      const run = new TaskRunRepository().getLatestRoot(request.taskId!);
      if (!run || !['succeeded', 'failed', 'cancelled'].includes(run.status)) continue;
      const state = new TaskConversationRepository().getState(request.taskId!);
      const receipt = new TaskRunRepository().getReceipt(run.id);
      runSqliteWriteTransaction(() => {
        const stored = db.prepare('SELECT result_json, result_run_id, delivery_entry_id FROM personal_requests WHERE request_id = ?')
          .get(request.requestId) as { result_json: string | null; result_run_id: string | null; delivery_entry_id: string | null };
        if (stored.delivery_entry_id) return;
        if (readCurrentTranscriptId(db, request.conversationId) !== request.transcriptId) {
          updatePersonalRequest(request, { state: run.status === 'succeeded' ? 'completed' : 'failed' });
          db.prepare('UPDATE personal_requests SET notified_at = ? WHERE request_id = ?').run(Date.now(), request.requestId);
          return;
        }
        if (state?.activeConversationId !== run.conversationId) throw new Error('Task execution changed');
        const parsed = stored.result_json && stored.result_run_id === run.id
          ? PersonalRequestResultSchema.safeParse(JSON.parse(stored.result_json)) : undefined;
        const messages = run.conversationId ? loadLlmMessagesForSession(run.conversationId) : [];
        const assistant = messages.filter(message => message.role === 'assistant').at(-1);
        const fallback = assistant?.role === 'assistant'
          ? assistant.content.filter(part => part.type === 'text').map(part => part.text).join('\n').trim() : '';
        const content = parsed?.success ? renderPersonalRequestResult(parsed.data)
          : fallback && fallback !== 'NO_REPLY' ? fallback.slice(0, 16000) : receipt?.summary ?? 'Request finished without a readable result.';
        const failed = run.status !== 'succeeded';
        const display = failed ? `查询未完成。\n\n${content}` : content;
        const now = Date.now();
        const delivery = TaskResultDeliverySchema.parse({ version: 1, deliveryId: `personal-request:${request.requestId}`,
          taskId: request.taskId, taskRunId: run.id, taskTitle: request.objective.slice(0, 300),
          conversationId: request.conversationId, originTranscriptId: request.transcriptId,
          requestInputId: request.inputId, assignmentEpoch: state?.assignmentEpoch ?? 0,
          outcome: { version: 1, outcomeId: `personal-request:${request.requestId}`, runId: run.id,
            turnId: `personal-request:${request.requestId}`, status: failed ? 'failed' : parsed?.success && parsed.data.coverage?.partial ? 'partial' : 'succeeded',
            summary: content.slice(0, 2000), deliverables: [], evidence: [], createdAt: new Date(now).toISOString() }, createdAt: now });
        const entry = appendTranscriptEntry(request.conversationId, { role: 'custom', customType: TASK_RESULT_DELIVERY_TYPE,
          content: display, details: delivery, display: true, timestamp: now });
        updatePersonalRequest(request, { state: run.status === 'cancelled' ? 'cancelled' : failed ? 'failed' : 'completed' });
        db.prepare('UPDATE personal_requests SET delivery_entry_id = ? WHERE request_id = ?').run(entry.entry_id, request.requestId);
        // The direct result replaces a second main-model summary for this run.
        db.prepare(`UPDATE task_main_update_deliveries SET status = 'delivered', decision = 'silent',
          decision_reason = 'Personal request result delivered', updated_at = ? WHERE entry_id IN
          (SELECT entry_id FROM task_collaboration_entries WHERE task_run_id = ? AND kind IN ('result','failure','progress'))`)
          .run(now, run.id);
      });
      const delivered = db.prepare('SELECT delivery_entry_id, notified_at FROM personal_requests WHERE request_id = ?')
        .get(request.requestId) as { delivery_entry_id: string | null; notified_at: number | null };
      if (delivered.delivery_entry_id && !delivered.notified_at) {
        emitSessionTranscriptUpdate({ conversationId: request.conversationId });
        notify?.(request.conversationId, request.requestId);
        db.prepare('UPDATE personal_requests SET notified_at = ? WHERE request_id = ?').run(Date.now(), request.requestId);
      }
    } catch (err) {
      db.prepare(`UPDATE personal_requests SET delivery_attempts = delivery_attempts + 1,
        delivery_next_attempt_at = ?, delivery_error = ? WHERE request_id = ?`)
        .run(Date.now() + Math.min(60_000, 1000 * 2 ** row.delivery_attempts),
          (err instanceof Error ? err.message : String(err)).slice(0, 500), row.request_id);
      if (row.delivery_attempts === 0 || row.delivery_attempts === 7) {
        log.warn({ err, requestId: row.request_id, attempts: row.delivery_attempts + 1 },
          row.delivery_attempts === 7 ? 'Personal request delivery exhausted retries' : 'Personal request delivery will retry');
      }
    }
  }
}
