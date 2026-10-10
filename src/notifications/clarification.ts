import type { ProductNotification } from '@xopcai/gateway-contract';

import { getClarification } from '../storage/sqlite/clarification-wait-repository.js';
import { readCurrentTranscriptId } from '../storage/sqlite/session-instance-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type { NotificationPlan } from './planner.js';

export function isClarificationNotificationActionable(notification: Pick<ProductNotification, 'type' | 'payload' | 'target'>): boolean {
  if (notification.type !== 'chat.needs_input') return true;
  const wait = typeof notification.payload.waitId === 'string' ? getClarification(notification.payload.waitId) : undefined;
  return Boolean(wait && wait.status === 'open'
    && notification.target.kind === 'chat' && notification.target.conversationId === wait.conversationId
    && readCurrentTranscriptId(getSqliteDatabase(), wait.conversationId) === wait.transcriptId
    && (wait.expiresAt === undefined || wait.expiresAt > Date.now()));
}

/** Wait creation and intent insertion commit together; publication and settlement do too. */
export function flushClarificationNotifications(persist: (plan: NotificationPlan) => ProductNotification | null): ProductNotification[] {
  return runSqliteWriteTransaction(db => {
    const rows = db.prepare(`SELECT wait_id FROM clarification_notification_outbox
      WHERE status = 'pending' ORDER BY created_at, wait_id LIMIT 100`).all();
    const published: ProductNotification[] = [];
    for (const row of rows) {
      const wait = getClarification(String(row.wait_id));
      if (wait && !wait.taskRunId) {
        const session = db.prepare("SELECT json_extract(custom_data_json, '$.personalAgent') AS personal FROM sessions WHERE conversation_id = ?")
          .get(wait.conversationId) as { personal: number | null } | undefined;
        const personal = session?.personal === 1;
        const notification: NotificationPlan['notification'] = {
          type: 'chat.needs_input', target: { kind: 'chat', conversationId: wait.conversationId, ...(personal ? { personal: true } : {}) },
          priority: 'high',
          title: wait.kind === 'approval'
            ? { en: 'Your authorization is needed', zh: '需要你的授权' }
            : { en: 'Your decision is needed', zh: '需要你判断后继续' },
          body: { en: 'A question is waiting for your answer. Open the conversation to continue.', zh: '有一个问题等待你回答，点击继续。' },
          payload: { waitId: wait.id, transcriptId: wait.transcriptId, originRunId: wait.originRunId,
            objectiveRevision: wait.objectiveRevision, kind: wait.kind, expiresAt: wait.expiresAt },
        };
        if (isClarificationNotificationActionable(notification)) {
          const event = persist({ dedupeKey: `clarification.needs_input:${wait.id}`, createdAt: wait.createdAt, notification });
          if (event) published.push(event);
        }
      }
      db.prepare("UPDATE clarification_notification_outbox SET status = 'settled' WHERE wait_id = ?").run(row.wait_id);
    }
    return published;
  });
}
