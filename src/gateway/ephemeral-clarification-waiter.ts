import type { ClarifyRequestPayload } from '../agent/tools/clarify-tool.js';

export type ClarificationStreamEvent = { type: string } & Record<string, unknown>;

type PendingClarification = {
  runId: string;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  beforeResponse?: () => boolean;
};

/** In-memory waiter exclusively for caller-owned ephemeral runs such as side chat. */
export class EphemeralClarificationWaiter {
  private readonly pending = new Map<string, PendingClarification>();

  start(input: {
    runId: string;
    publish: (event: ClarificationStreamEvent) => void;
    request: ClarifyRequestPayload;
    beforeResponse?: () => boolean;
  }): Promise<string> {
    const requestId = crypto.randomUUID();
    return new Promise<string>((resolve, reject) => {
      this.pending.set(requestId, {
        runId: input.runId,
        resolve,
        reject,
        beforeResponse: input.beforeResponse,
      });
      input.publish({
        type: 'clarify_request',
        requestId,
        kind: input.request.kind ?? 'input',
        question: input.request.question,
        choices: input.request.choices,
        suggestedAnswer: input.request.suggestedAnswer,
        version: 1,
        createdAt: Date.now(),
      });
    });
  }

  answer(requestId: string, answer: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.beforeResponse?.() === false) return false;
    this.pending.delete(requestId);
    pending.resolve(answer.trim());
    return true;
  }

  cancelForRun(runId: string): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.runId !== runId) continue;
      this.pending.delete(requestId);
      pending.reject(new Error('Ephemeral clarification cancelled'));
    }
  }

  dispose(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error('Gateway shutting down'));
    }
    this.pending.clear();
  }
}
