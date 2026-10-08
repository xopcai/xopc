import { TaskCollaborationRepository } from './task-collaboration-repository.js';
import type { TaskMainUpdateDecision } from './task-main-update-decision-service.js';
import { createLogger } from '../utils/logger.js';
import { TaskResultDeliveryRepository } from './task-result-delivery-repository.js';
import { TaskRunRepository } from './task-run-repository.js';
import { personalRequestForTask } from '../personal-agent/request-repository.js';

const log = createLogger('TaskMainUpdateDelivery');

export class TaskMainUpdateDelivery {
  readonly #entries = new TaskCollaborationRepository();

  async drain(input: {
    isAvailable: (conversationId: string) => boolean;
    decide: (input: { conversationId: string; entry: import('./task-collaboration-repository.js').TaskCollaborationEntry }) => Promise<TaskMainUpdateDecision>;
    submitAndConfirm: (message: { conversationId: string; clientMessageId: string; content: string }) => Promise<boolean>;
  }, limit = 20): Promise<number> {
    let delivered = 0;
    for (const { entry, conversationId, decision, decisionReason } of this.#entries.pendingMainUpdates(limit)) {
      if (['result', 'failure', 'progress'].includes(entry.kind) && personalRequestForTask(entry.taskId)) {
        this.#entries.markMainUpdateDelivered(entry.id);
        continue;
      }
      const results = new TaskResultDeliveryRepository();
      const isResult = entry.kind === 'result' && entry.taskRunId;
      if (isResult && results.hasForRun(entry.taskRunId!)) {
        this.#entries.markMainUpdateDelivered(entry.id);
        continue;
      }
      if (isResult && results.hasCapturedOutcome(entry.taskRunId!)
        && ['running', 'waiting', 'verifying'].includes(new TaskRunRepository().get(entry.taskRunId!)?.status ?? '')) {
        this.#entries.deferMainUpdate(entry.id);
        continue;
      }
      if (!input.isAvailable(conversationId)) {
        this.#entries.deferMainUpdate(entry.id);
        continue;
      }
      try {
        if (entry.kind === 'progress' && !this.#entries.hasSubmittedMainUpdate(entry.id)
          && this.#entries.hasNewerMainUpdate(entry.taskId, entry.sequence)) {
          if (!decision) this.#entries.decideMainUpdate(entry.id, 'silent', 'A newer update superseded this progress');
          this.#entries.markMainUpdateDelivered(entry.id);
          delivered += 1;
          continue;
        }
        const requiresOwnerAction = entry.kind === 'question' || entry.kind === 'failure';
        const verdict = requiresOwnerAction
          ? { notify: true, reason: 'The task owner must resolve this worker update' }
          : decision
            ? { notify: decision === 'notify', reason: decisionReason ?? 'Previously decided' }
            : await input.decide({ conversationId, entry });
        if (!decision) this.#entries.decideMainUpdate(entry.id, verdict.notify ? 'notify' : 'silent', verdict.reason);
        if (isResult && results.hasForRun(entry.taskRunId!)) {
          this.#entries.markMainUpdateDelivered(entry.id);
          continue;
        }
        if (!verdict.notify) {
          this.#entries.markMainUpdateDelivered(entry.id);
          delivered += 1;
          continue;
        }
        const content = [
          `A delegated Task has a new ${entry.kind} update. Task ID: ${entry.taskId}.`,
          `Collaboration entry ID: ${entry.id}.`,
          `Your private notification decision: ${JSON.stringify(verdict.reason)}.`,
          'Read the Task and collaboration board with personal_task(command="get", taskId) when available, otherwise xopc_use. If this is a worker question, first answer it from the Task brief or conversation with personal_task(command="answer", taskId, questionId, instruction) when available; ask the user only for a genuinely missing fact. For failures, inspect the actual blocker and try a suitable alternative within the user’s authorization before reporting an impasse. Then tell the user what matters in your own words. Keep the response proportionate to the update and recent conversation. Do not expose this internal trigger or repeat already reported details. If a result receipt is generic, use the board for the actual outcome. A finished TaskRun is not proof that the Task passed verification or was accepted; check its receipt and use precise status language. Do not ask the user to close a Task unless requested. Use tools without preliminary user-facing commentary, then give one concise reply.',
        ].join('\n');
        const completed = await input.submitAndConfirm({
          conversationId,
          clientMessageId: `task-main-update:${entry.id}`,
          content,
        });
        if (completed) {
          this.#entries.markMainUpdateDelivered(entry.id);
          delivered += 1;
        } else {
          this.#entries.deferMainUpdate(entry.id);
        }
      } catch (error) {
        log.warn({ err: error, conversationId, taskId: entry.taskId, entryId: entry.id },
          'Main Agent update delivery failed');
        this.#entries.deferMainUpdate(entry.id);
      }
    }
    return delivered;
  }
}
