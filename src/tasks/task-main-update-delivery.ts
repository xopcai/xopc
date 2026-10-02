import { TaskCollaborationRepository } from './task-collaboration-repository.js';
import type { TaskMainUpdateDecision } from './task-main-update-decision-service.js';
import { createLogger } from '../utils/logger.js';

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
        const verdict = decision
          ? { notify: decision === 'notify', reason: decisionReason ?? 'Previously decided' }
          : await input.decide({ conversationId, entry });
        if (!decision) this.#entries.decideMainUpdate(entry.id, verdict.notify ? 'notify' : 'silent', verdict.reason);
        if (!verdict.notify) {
          this.#entries.markMainUpdateDelivered(entry.id);
          delivered += 1;
          continue;
        }
        const content = [
          `A delegated Task has a new ${entry.kind} update. Task ID: ${entry.taskId}.`,
          `Collaboration entry ID: ${entry.id}.`,
          `Your private notification decision: ${JSON.stringify(verdict.reason)}.`,
          'Read the Task and collaboration board with xopc_use, then tell the user what matters in your own words. Keep the response proportionate to the update and recent conversation. Do not expose this internal trigger or repeat already reported details. If a result receipt is generic, use the board for the actual outcome. A finished TaskRun is not proof that the Task passed verification or was accepted; check its receipt and use precise status language. Do not ask the user to close a Task unless requested. Use tools without preliminary user-facing commentary, then give one concise reply.',
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
