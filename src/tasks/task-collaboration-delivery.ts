import { personalRequestForTask } from '../personal-agent/request-repository.js';
import { TaskApplicationService } from './task-application-service.js';
import { TaskCollaborationRepository } from './task-collaboration-repository.js';
import { isLightweightDefaultContract } from './task-contract-definition.js';
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
      const activeWaits = this.#runs.listActiveWaits(entry.taskId);
      const questionWait = activeWaits.find((item) =>
        entry.causationId
          ? item.condition.collaborationEntryId === entry.causationId
          : entry.kind === 'instruction' && typeof item.condition.collaborationEntryId === 'string',
      );
      const answersExistingWait = Boolean(questionWait && (entry.kind === 'answer' || entry.kind === 'instruction'));
      if (!task || (task.phase === 'closed' && (task.resolution !== 'done' || !answersExistingWait))) {
        this.#entries.markStale(entry.id);
        continue;
      }
      const active = this.#conversations.getActiveSession(entry.taskId);
      if (!active) { this.#entries.defer(entry.id); continue; }
      if (questionWait && (entry.kind === 'answer' || entry.kind === 'instruction')) {
        const executing = questionWait.taskRunId && getSqliteDatabase().prepare(`SELECT 1 FROM session_inputs
          WHERE task_run_id = ? AND status IN ('queued', 'running', 'injecting') LIMIT 1`)
          .get(questionWait.taskRunId);
        if (executing) { this.#entries.defer(entry.id); continue; }
        const currentTask = this.#tasks.require(entry.taskId);
        const result = this.#application.execute({ taskId: entry.taskId, expectedVersion: currentTask.version,
          idempotencyKey: `collaboration-answer:${entry.id}`,
          command: { type: 'resolve_wait', waitId: questionWait.id,
            resolution: { kind: 'collaboration_answer', answer: entry.body } },
          actor: { kind: 'system', id: 'task-collaboration' },
        });
        if (!result.ok) { this.#entries.defer(entry.id); continue; }
        // The resumed TaskRun reads the board in its execution directive.
        this.#entries.markDelivered(entry.id, active.conversationId, active.assignmentEpoch);
        delivered += 1;
        continue;
      }
      // Keep a waiting worker paused on non-collaboration waits (e.g. approval/connection). Its next turn reads all board entries.
      if (activeWaits.length > 0) {
        this.#entries.defer(entry.id);
        continue;
      }
      const connected = Boolean(personalRequestForTask(entry.taskId));
      const lightweight = !connected && isLightweightDefaultContract(task.contract);
      const postTool = connected ? 'task_collaboration command post' : 'xopc_use task collaboration_post';
      const content = lightweight
        ? `Task follow-up direction (${entry.id}) from ${entry.authorKind}:\n${JSON.stringify(entry.body)}\nIncorporate this updated direction directly into your ongoing execution and final deliverable.`
        : `Task collaboration message ${entry.id} (${entry.kind}) from ${entry.authorKind}:\n${JSON.stringify(entry.body)}\nBefore continuing, acknowledge receipt and explain how the output will incorporate this direction through ${postTool} with kind ack and causationId ${entry.id}. Confirmation records receipt and intent, not verified completion.`;
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
