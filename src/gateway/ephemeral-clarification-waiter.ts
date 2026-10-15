import { normalizeClarificationQuestion, normalizeClarificationSubmission, readClarificationPresentation, type ClarificationSubmission } from '@xopcai/gateway-contract';
import type { ClarifyRequestPayload } from '../agent/tools/clarify-tool.js';

export type ClarificationStreamEvent = { type: string } & Record<string, unknown>;

type PendingClarification = {
  runId: string;
  request: ClarifyRequestPayload;
  expiresAt?: number;
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
    const request = normalizeClarificationQuestion(input.request);
    const requestId = crypto.randomUUID();
    const expiresAt = request.kind === 'approval' ? Date.now() + 10 * 60_000 : undefined;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(requestId, {
        runId: input.runId,
        request,
        expiresAt,
        resolve,
        reject,
        beforeResponse: input.beforeResponse,
      });
      input.publish({
        type: 'clarify_request',
        requestId,
        ...readClarificationPresentation(request),
        kind: request.kind ?? 'input',
        question: request.question,


        expiresAt,
        version: 1,
        createdAt: Date.now(),
      });
    });
  }

  answer(requestId: string, answer: ClarificationSubmission): boolean {
    const pending = this.pending.get(requestId);
    if (!pending || pending.beforeResponse?.() === false
      || (pending.expiresAt !== undefined && pending.expiresAt <= Date.now())) return false;
    let normalized: ReturnType<typeof normalizeClarificationSubmission>;
    try { normalized = normalizeClarificationSubmission(pending.request, answer); }
    catch { return false; }
    this.pending.delete(requestId);
    pending.resolve(normalized.answer);
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
