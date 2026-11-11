import type { AgentStreamRunStatus } from '@xopcai/gateway-contract';

export type SubmittedRunNotice = { inputId: string; runId: string; status?: AgentStreamRunStatus };

/** Listen before POST so an announcement can precede the durable receipt. */
export function watchSubmittedRun(conversationId: string, clientMessageId: string, signal: AbortSignal) {
  const wakePoll = new AbortController();
  let acceptedInputId: string | undefined;
  let notice: SubmittedRunNotice | undefined;
  let wake: (() => void) | undefined;

  const onRun = (event: Event) => {
    const detail = (event as CustomEvent<Partial<SubmittedRunNotice> & {
      conversationId?: string; clientMessageId?: string;
    }>).detail;
    if (detail?.conversationId !== conversationId || detail.clientMessageId !== clientMessageId
      || typeof detail.inputId !== 'string' || !detail.inputId || typeof detail.runId !== 'string' || !detail.runId) return;
    if (acceptedInputId && detail.inputId !== acceptedInputId) return;
    const status = event.type === 'run-completed' ? detail.status : undefined;
    if (event.type === 'run-completed' && status !== 'success' && status !== 'error'
      && status !== 'cancelled' && status !== 'suspended') return;
    if (notice?.runId === detail.runId && notice.status && !status) return;
    notice = { inputId: detail.inputId, runId: detail.runId, status };
    if (acceptedInputId === detail.inputId) {
      wakePoll.abort();
      wake?.();
    }
  };

  window.addEventListener?.('run-started', onRun);
  window.addEventListener?.('run-completed', onRun);
  return {
    accept(inputId: string) {
      acceptedInputId = inputId;
      if (notice?.inputId === inputId) wakePoll.abort();
    },
    current(inputId: string) {
      return notice?.inputId === inputId ? notice : undefined;
    },
    fallbackSignal: AbortSignal.any([signal, wakePoll.signal]),
    wait(inputId: string, ms: number) {
      signal.throwIfAborted();
      if (notice?.inputId === inputId) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          wake = undefined;
          resolve();
        };
        const abort = () => {
          finish();
          reject(signal.reason);
        };
        const timer = setTimeout(finish, ms);
        wake = () => { if (notice?.inputId === inputId) finish(); };
        signal.addEventListener('abort', abort, { once: true });
      });
    },
    dispose() {
      window.removeEventListener?.('run-started', onRun);
      window.removeEventListener?.('run-completed', onRun);
    },
  };
}
