import type { AgentRunRelay, RelayEvent } from './agent-run-relay.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('gateway:clarify');

/** User inactivity window before pending clarification is rejected (web/Telegram, etc.). */
export const CLARIFY_USER_RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;

export interface ClarifyBridgeRequest {
  question: string;
  choices?: string[];
  default?: string;
}

export interface StartClarifyRequestOptions {
  sessionKey: string;
  /** Present for in-flight webchat runs (SSE + relay). */
  runId?: string;
  relay: AgentRunRelay;
  publishSse?: (event: RelayEvent) => void;
  request: ClarifyBridgeRequest;
  /** e.g. Telegram inline keyboard + prompt message */
  deliver?: (ctx: {
    sessionKey: string;
    requestId: string;
    request: ClarifyBridgeRequest;
  }) => Promise<void>;
}

interface PendingClarification {
  runId: string;
  sessionKey: string;
  choices?: string[];
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Pending user answers for the `clarify` tool (web UI, Telegram, etc.).
 */
export class ClarifyBridge {
  private pending = new Map<string, PendingClarification>();
  /** sessionKey → requestId when waiting for a free-text reply (no multiple-choice). */
  private pendingFreeTextBySession = new Map<string, string>();

  startRequest(opts: StartClarifyRequestOptions): Promise<string> {
    const { sessionKey, runId, relay, publishSse, request, deliver } = opts;
    const requestId = crypto.randomUUID();
    const hasChoices = Array.isArray(request.choices) && request.choices.length >= 2;
    const needsFreeText = !hasChoices;

    return new Promise<string>((resolve, reject) => {
      const failStart = (err: unknown) => {
        const e = this.deletePending(requestId);
        if (e) {
          e.reject(err instanceof Error ? err : new Error(String(err)));
        }
      };

      const timeout = setTimeout(() => {
        const entry = this.deletePending(requestId);
        if (entry) {
          entry.reject(new Error('Clarification timeout: user did not respond within 5 minutes'));
        }
      }, CLARIFY_USER_RESPONSE_TIMEOUT_MS);

      this.pending.set(requestId, {
        runId: runId ?? '',
        sessionKey,
        choices: hasChoices ? request.choices : undefined,
        resolve,
        reject,
        timeout,
      });

      if (needsFreeText) {
        this.pendingFreeTextBySession.set(sessionKey, requestId);
      }

      const payload: RelayEvent = {
        type: 'clarify_request',
        requestId,
        question: request.question,
        choices: request.choices,
        default: request.default,
      };

      if (runId) {
        relay.publish(runId, payload);
      }
      try {
        publishSse?.(payload);
      } catch (err) {
        log.warn({ err, requestId }, 'clarify SSE publish failed');
      }

      if (deliver) {
        void deliver({ sessionKey, requestId, request }).catch(failStart);
      }
    });
  }

  private deletePending(requestId: string): PendingClarification | undefined {
    const entry = this.pending.get(requestId);
    if (!entry) return undefined;
    clearTimeout(entry.timeout);
    this.pending.delete(requestId);
    this.clearFreeTextSlot(entry.sessionKey, requestId);
    return entry;
  }

  private clearFreeTextSlot(sessionKey: string, requestId: string): void {
    if (this.pendingFreeTextBySession.get(sessionKey) === requestId) {
      this.pendingFreeTextBySession.delete(sessionKey);
    }
  }

  /**
   * Consume the user's next text message as the clarify answer (Telegram DM/group).
   */
  tryConsumeFreeTextReply(sessionKey: string, text: string): boolean {
    const requestId = this.pendingFreeTextBySession.get(sessionKey);
    if (!requestId) return false;
    return this.handleResponse(requestId, text);
  }

  handleChoiceCallback(requestId: string, choiceIndex: number): boolean {
    const entry = this.pending.get(requestId);
    if (!entry?.choices || choiceIndex < 0 || choiceIndex >= entry.choices.length) {
      return false;
    }
    return this.handleResponse(requestId, entry.choices[choiceIndex]!);
  }

  handleResponse(requestId: string, answer: string): boolean {
    const entry = this.deletePending(requestId);
    if (!entry) return false;
    entry.resolve(answer.trim());
    return true;
  }

  cancelForRun(runId: string): void {
    for (const [id, entry] of [...this.pending]) {
      if (entry.runId === runId) {
        const e = this.deletePending(id);
        e?.reject(new Error('Clarification cancelled: agent run aborted'));
      }
    }
  }

  dispose(): void {
    for (const [id, entry] of [...this.pending]) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('Gateway shutting down'));
      this.pending.delete(id);
    }
    this.pending.clear();
    this.pendingFreeTextBySession.clear();
  }
}
