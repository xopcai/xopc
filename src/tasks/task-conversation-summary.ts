import type { TranscriptStoredRow } from '../session/session-context-for-llm.js';
import { extractFtsContent } from '../storage/sqlite/row-mappers.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { TaskCollaborationRepository } from './task-collaboration-repository.js';
import { getTaskNotificationPreference } from './task-notification-preference.js';
import { taskInstructionSequence } from './task-instruction-sequence.js';
import { TaskReadModelProjector } from './task-read-model-projector.js';
import { TaskResultDeliveryRepository } from './task-result-delivery-repository.js';
import { TaskRunRepository } from './task-run-repository.js';

/** Shared facts for status answers and proactive replies in the originating chat. */
export function taskConversationSummary(taskId: string, conversationId: string) {
  const model = new TaskReadModelProjector().get(taskId);
  if (!model) return undefined;
  const runs = new TaskRunRepository();
  const run = runs.getActiveRoot(taskId) ?? runs.getLatestRoot(taskId);
  const current = run?.contractVersion === model.task.latestContractVersion ? run : undefined;
  const receipt = current && runs.getReceipt(current.id);
  const waits = runs.listActiveWaits(taskId);
  const progress = new TaskCollaborationRepository().recent(taskId, undefined, 10)
    .findLast(entry => entry.kind === 'progress' && current && entry.taskRunId === current.id);
  const db = getSqliteDatabase();
  const previous = db.prepare(`SELECT delivery.delivery_id,
      substr(json_extract(entry.payload_json, '$.content'), 1, 600) AS text
    FROM task_result_deliveries delivery
    JOIN sessions session ON session.conversation_id = delivery.conversation_id
    JOIN transcript_entries entry ON entry.entry_id = delivery.reply_message_entry_id
      AND entry.transcript_id = session.active_transcript_id
    WHERE delivery.conversation_id = ? AND delivery.task_run_id IN
      (SELECT run_id FROM task_runs WHERE task_id = ?) AND delivery.reply_status = 'delivered'
    ORDER BY entry.seq DESC LIMIT 1`).get(conversationId, taskId) as
      { delivery_id: string; text: string } | undefined;
  const latestDelivery = current && db.prepare(`SELECT delivery.delivery_id, delivery.status, delivery.reply_status,
      json_extract(delivery.payload_json, '$.instructionSequence') AS instruction_sequence,
      EXISTS (SELECT 1 FROM transcript_entries entry JOIN sessions session ON session.active_transcript_id = entry.transcript_id
        WHERE entry.entry_id = delivery.reply_message_entry_id AND session.conversation_id = delivery.conversation_id) AS replyVisible
    FROM task_result_deliveries delivery WHERE delivery.task_run_id = ? AND delivery.conversation_id = ?`)
    .get(current.id, conversationId) as { delivery_id: string; status: string; reply_status: string | null; replyVisible: number; instruction_sequence: number | null } | undefined;
  const outdatedReply = latestDelivery?.instruction_sequence != null && latestDelivery.instruction_sequence !== taskInstructionSequence(taskId);
  const previousUpdates = db.prepare(`SELECT update_entry.entry_id, message.payload_json
    FROM task_collaboration_entries update_entry
    JOIN task_main_update_deliveries delivery ON delivery.entry_id = update_entry.entry_id
    JOIN sessions session ON session.conversation_id = delivery.conversation_id
    JOIN session_inputs input ON input.conversation_id = session.conversation_id AND input.status = 'completed'
      AND json_extract(input.origin_json, '$.type') = 'system'
      AND json_extract(input.origin_json, '$.source') = 'task_update'
      AND (input.client_message_id = 'task-main-update:' || update_entry.entry_id
        OR input.client_message_id GLOB 'task-main-update:' || update_entry.entry_id || ':retry:*')
    JOIN transcript_entries message ON message.transcript_id = session.active_transcript_id AND message.role = 'assistant'
      AND json_extract(message.payload_json, '$.turnId') = input.run_id
    WHERE update_entry.task_id = ? AND delivery.conversation_id = ?
      AND COALESCE(json_extract(message.payload_json, '$.metadata.hiddenFromClient'), 0) != 1
    ORDER BY message.seq DESC LIMIT 8`).all(taskId, conversationId) as { entry_id: string; payload_json: string }[];
  const previousUpdate = previousUpdates.map(row => ({ entryId: row.entry_id,
    text: extractFtsContent(JSON.parse(row.payload_json) as TranscriptStoredRow).slice(0, 500).trim() }))
    .find(update => update.text && update.text !== 'NO_REPLY');

  return {
    taskId,
    title: model.task.title,
    createdAt: model.task.createdAt,
    dueAt: model.task.dueAt,
    notificationPreference: getTaskNotificationPreference(taskId, conversationId),
    phase: model.task.phase,
    resolution: model.task.resolution,
    operationalState: model.operationalState,
    allocation: model.allocation,
    run: current && { status: current.status, queuedAt: current.queuedAt, startedAt: current.startedAt },
    waits: waits.slice(0, 4).map(wait => ({ kind: wait.kind, reason: wait.reason.slice(0, 500),
      questionId: wait.condition.collaborationEntryId })),
    attention: model.attention.slice(0, 4).map(item => ({ kind: item.kind, summary: item.summary.slice(0, 500) })),
    workerProgress: progress && { text: progress.body.slice(0, 600), at: progress.createdAt },
    receipt: receipt && { verdict: receipt.completionVerdict, verification: receipt.verification.status,
      summary: receipt.summary.slice(0, 700), remaining: receipt.remainingWork.slice(0, 5).map(item => item.slice(0, 300)),
      needsUser: receipt.needsUser, nextAction: receipt.nextAction?.slice(0, 500) },
    fileDelivery: new TaskResultDeliveryRepository().fileDeliveryState(taskId, conversationId),
    replyDelivery: latestDelivery && { resultId: latestDelivery.delivery_id,
      status: outdatedReply ? 'stale' : latestDelivery.status !== 'delivered' ? latestDelivery.status
        : latestDelivery.replyVisible ? 'delivered'
          : latestDelivery.reply_status === 'delivered' ? 'stale' : latestDelivery.reply_status },
    lastDeliveredUpdate: previousUpdate,
    lastDeliveredReply: previous && { resultId: previous.delivery_id, text: previous.text },
  };
}
