import type { ProductNotification } from '@xopcai/gateway-contract';

import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { getPersonalAgentByConversation } from './repository.js';

function personalTask(taskId: string): boolean {
  return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM task_origin_links o
    JOIN sessions s ON s.conversation_id = o.conversation_id
    WHERE o.task_id = ? AND json_extract(s.custom_data_json, '$.personalAgent') = 1`).get(taskId));
}

export function allowsPersonalTaskNotification(notification: Pick<ProductNotification, 'target' | 'type'>): boolean {
  if (notification.target.kind === 'task') {
    // Questions/approvals still require attention; results are reported by Personal AI.
    return notification.type === 'task.needs_input' || !personalTask(notification.target.taskId);
  }
  if (notification.target.kind === 'chat') {
    const worker = getSqliteDatabase().prepare(`SELECT o.task_id FROM task_sessions w
      JOIN task_origin_links o ON o.task_id = w.task_id
      JOIN sessions s ON s.conversation_id = o.conversation_id
      WHERE w.conversation_id = ? AND json_extract(s.custom_data_json, '$.personalAgent') = 1 LIMIT 1`)
      .get(notification.target.conversationId);
    return !worker;
  }
  return true;
}

export function personalReplyNotification(conversationId: string, deliveryId: string): Record<string, unknown> | null {
  if (!deliveryId.startsWith('reply:')) return null;
  const personal = getPersonalAgentByConversation(conversationId);
  if (!personal) return null;
  const row = getSqliteDatabase().prepare(`SELECT reply_text, reply_status, payload_json FROM task_result_deliveries
    WHERE delivery_id = ? AND conversation_id = ?`).get(deliveryId.slice(6), conversationId) as
    { reply_text: string | null; reply_status: string; payload_json: string } | undefined;
  if (!row || row.reply_status !== 'delivered') return null;
  const delivery = JSON.parse(row.payload_json) as { outcome: { status: string } };
  return { conversationId, deliveryId, text: row.reply_text, displayName: personal.displayName,
    failed: delivery.outcome.status === 'failed' || delivery.outcome.status === 'partial' };
}

export function personalRunDelegated(conversationId: string, runId: string): boolean {
  return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM task_origin_links o
    JOIN session_inputs i ON i.id = o.request_input_id
    WHERE o.conversation_id = ? AND i.run_id = ? LIMIT 1`).get(conversationId, runId));
}
