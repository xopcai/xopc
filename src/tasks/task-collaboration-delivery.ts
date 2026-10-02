import { TaskApplicationService } from './task-application-service.js';
import { TaskCollaborationRepository } from './task-collaboration-repository.js';
import { TaskConversationRepository } from './task-conversation-repository.js';
import { TaskRepository } from './task-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TaskCollaborationDelivery');

export class TaskCollaborationDelivery {
  readonly #entries = new TaskCollaborationRepository();
  readonly #conversations = new TaskConversationRepository();
  readonly #runs = new TaskRunRepository();
  readonly #tasks = new TaskRepository();
  readonly #application = new TaskApplicationService();

  async drain(submit: (input: {
    conversationId: string; clientMessageId: string; content: string;
    delivery: 'next' | 'steer';
  }) => Promise<boolean>, limit = 20): Promise<number> {
    let delivered = 0;
    for (const pending of this.#entries.pendingDeliveries(limit)) {
      const { entry, clientMessageId } = pending;
      const task = this.#tasks.get(entry.taskId);
      if (!task || task.phase === 'closed') {
        this.#entries.markStale(entry.id);
        continue;
      }
      const active = this.#conversations.getActiveSession(entry.taskId);
      if (!active) { this.#entries.defer(entry.id); continue; }
      if (entry.kind === 'answer' && entry.causationId) {
        const wait = this.#runs.listActiveWaits(entry.taskId)
          .find((item) => item.condition.collaborationEntryId === entry.causationId);
        if (wait) {
          const executing = wait.taskRunId && getSqliteDatabase().prepare(`SELECT 1 FROM session_inputs
            WHERE task_run_id = ? AND status IN ('queued', 'running', 'injecting') LIMIT 1`)
            .get(wait.taskRunId);
          if (executing) { this.#entries.defer(entry.id); continue; }
          const task = this.#tasks.require(entry.taskId);
          const result = this.#application.execute({ taskId: entry.taskId, expectedVersion: task.version,
            idempotencyKey: `collaboration-answer:${entry.id}`,
            command: { type: 'resolve_wait', waitId: wait.id,
              resolution: { kind: 'collaboration_answer', answer: entry.body } },
            actor: { kind: 'system', id: 'task-collaboration' },
          });
          if (!result.ok) { this.#entries.defer(entry.id); continue; }
          // The resumed TaskRun reads the board in its execution directive.
          this.#entries.markDelivered(entry.id, active.conversationId, active.assignmentEpoch);
          delivered += 1;
          continue;
        }
      }
      // Keep a waiting worker paused. Its next execution turn reads all board entries.
      if (this.#runs.listActiveWaits(entry.taskId).length > 0) {
        this.#entries.defer(entry.id);
        continue;
      }
      const content = `Task collaboration message ${entry.id} (${entry.kind}) from ${entry.authorKind}:\n${JSON.stringify(entry.body)}\nAcknowledge receipt through xopc_use task collaboration_post with kind ack and causationId ${entry.id} when appropriate.`;
      let accepted = false;
      try {
        accepted = await submit({ conversationId: active.conversationId, clientMessageId, content, delivery: 'steer' });
      } catch (error) {
        log.warn({ err: error, taskId: entry.taskId, entryId: entry.id }, 'Task instruction delivery failed');
      }
      if (!accepted) {
        this.#entries.defer(entry.id);
        continue;
      }
      this.#entries.markDelivered(entry.id, active.conversationId, active.assignmentEpoch);
      delivered += 1;
    }
    return delivered;
  }
}
