import { lstat } from 'node:fs/promises';

import { TASK_RESULT_DELIVERY_TYPE, TaskResultDeliverySchema, type TurnOutcomeDeliverable } from '@xopcai/gateway-contract';

import { MEDIA_ARTIFACT_MAX_BYTES, resolveMediaBufferPath } from '../media/store.js';
import { tryParseMediaUri } from '../media/uri.js';
import { appendTranscriptEntry } from '../storage/sqlite/transcript-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { emitSessionTranscriptUpdate } from '../session/transcript-events.js';
import { createLogger } from '../utils/logger.js';
import { getPersonalAgentByConversation } from '../personal-agent/repository.js';
import { enqueuePersonalReply } from '../personal-agent/reply-composer.js';
import { personalRequestForTask } from '../personal-agent/request-repository.js';
import { TaskRepository } from './task-repository.js';
import { TaskConversationRepository } from './task-conversation-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { TaskResultDeliveryRepository } from './task-result-delivery-repository.js';

const log = createLogger('TaskResultDelivery');

async function materializedArtifact(item: TurnOutcomeDeliverable): Promise<TurnOutcomeDeliverable> {
  // Only immutable published media can cross an Agent workspace boundary.
  const { workspaceRelativePath: _path, thumbnailUrl: _thumbnail, ...artifact } = item;
  if (item.availability !== 'available') return { ...artifact, uri: undefined, shareUrl: undefined, capabilities: [] };
  const media = item.uri ? tryParseMediaUri(item.uri) : null;
  if (media?.bucket === 'outbound' && item.location === 'artifact_store') {
    const file = await lstat(resolveMediaBufferPath(media.id, media.bucket)).catch(() => null);
    if (file?.isFile() && file.size <= MEDIA_ARTIFACT_MAX_BYTES) {
      return { ...artifact, sizeBytes: file.size, shareUrl: undefined,
        capabilities: item.capabilities.filter(capability => capability === 'preview' || capability === 'download') };
    }
    return { ...artifact, availability: 'missing', uri: undefined, shareUrl: undefined, capabilities: [] };
  }
  if (item.kind === 'site' && item.location === 'external_host') {
    try {
      const url = new URL(item.shareUrl ?? item.uri ?? '');
      if (url.protocol === 'https:' && !url.username && !url.password) {
        return { ...artifact, uri: url.href, shareUrl: url.href, capabilities: ['open'] };
      }
    } catch { /* An invalid remote reference is not a published result. */ }
  }
  return { ...artifact, availability: 'failed', uri: undefined, shareUrl: undefined, capabilities: [] };
}

export class TaskResultDeliveryService {
  readonly #repository = new TaskResultDeliveryRepository();

  async drain(notify: (conversationId: string, deliveryId: string) => void, limit = 20): Promise<number> {
    let delivered = 0;
    for (const row of this.#repository.pending(limit)) {
      try {
        const delivery = TaskResultDeliverySchema.parse(JSON.parse(row.payload_json));
        if (row.status === 'pending') {
          const deliverables = await Promise.all(delivery.outcome.deliverables.map(materializedArtifact));
          const persisted = runSqliteWriteTransaction(db => {
            const current = db.prepare('SELECT status FROM task_result_deliveries WHERE delivery_id = ?')
              .get(row.delivery_id) as { status: string } | undefined;
            if (current?.status !== 'pending') return current?.status === 'delivered';
            const run = new TaskRunRepository().get(delivery.taskRunId);
            const state = new TaskConversationRepository().getState(delivery.taskId);
            const session = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?')
              .get(delivery.conversationId);
            const task = db.prepare('SELECT resolution FROM tasks WHERE task_id = ?').get(delivery.taskId) as { resolution: string | null };
            if (!session || !run || !['succeeded', 'failed'].includes(run.status)
              || (task.resolution && task.resolution !== 'done')
              || new TaskRunRepository().getLatestRoot(delivery.taskId)?.id !== run.id
              || state?.assignmentEpoch !== delivery.assignmentEpoch
              || state.activeConversationId !== run.conversationId) {
              db.prepare("UPDATE task_result_deliveries SET status = 'stale' WHERE delivery_id = ?").run(row.delivery_id);
              return false;
            }
            const available = deliverables.filter(item => item.availability === 'available').length;
            const outcome = { ...delivery.outcome, deliverables,
              status: deliverables.length > 0 && available === 0 ? 'failed' as const : available < deliverables.length
                ? 'partial' as const : delivery.outcome.status };
            const locale = db.prepare('SELECT locale FROM tasks WHERE task_id = ?').get(delivery.taskId) as { locale: string | null };
            const zh = locale.locale?.startsWith('zh') === true;
            const statusText = zh
              ? `${delivery.taskTitle}：${available === deliverables.length ? '成果已生成' : available > 0 ? '部分成果已生成' : '成果暂不可用'}。`
              : `${delivery.taskTitle}: ${available === deliverables.length ? 'Results ready' : available > 0 ? 'Partial results ready' : 'Results unavailable'}.`;
            const personal = getPersonalAgentByConversation(delivery.conversationId);
            if (personal && !personalRequestForTask(delivery.taskId)) enqueuePersonalReply({ delivery: { ...delivery, outcome },
              report: delivery.text?.trim() || delivery.outcome.summary?.trim() || statusText,
              objective: new TaskRepository().get(delivery.taskId)?.contract?.objective ?? delivery.taskTitle });
            const content = personal ? statusText : delivery.text ? `${statusText}\n\n${delivery.text}` : statusText;
            const details = { ...delivery, outcome };
            if (personal) delete details.text;
            const entry = !personal || deliverables.length ? appendTranscriptEntry(delivery.conversationId, {
              role: 'custom', customType: TASK_RESULT_DELIVERY_TYPE, content, display: true,
              details, timestamp: Date.now(),
            }) : undefined;
            db.prepare(`UPDATE task_result_deliveries SET status = 'delivered', payload_json = ?,
              message_entry_id = ?, delivered_at = ? WHERE delivery_id = ?`)
              .run(JSON.stringify(details), entry?.entry_id ?? null, Date.now(), row.delivery_id);
            return true;
          });
          if (!persisted) continue;
        }
        // Persist first. An interrupted publish is retried without another transcript append.
        emitSessionTranscriptUpdate({ conversationId: delivery.conversationId });
        notify(delivery.conversationId, delivery.deliveryId);
        getSqliteDatabase().prepare('UPDATE task_result_deliveries SET notified_at = ? WHERE delivery_id = ?')
          .run(Date.now(), row.delivery_id);
        delivered += 1;
        log.info({ conversationId: delivery.conversationId, taskId: delivery.taskId,
          deliveryId: delivery.deliveryId, durationMs: Date.now() - delivery.createdAt }, 'Task result delivered to main Chat');
      } catch (error) {
        this.#repository.retry(row.delivery_id, error instanceof Error ? error.message : String(error));
        if (row.attempts === 0 || row.attempts === 7) {
          log.warn({ err: error, deliveryId: row.delivery_id }, 'Task result delivery failed');
        }
      }
    }
    return delivered;
  }
}
