import { MAX_PENDING_FOLLOW_UPS } from './pending-follow-up.types';

export type SendOrQueueInput = {
  text: string;
  runBusy: boolean;
  pendingCount: number;
  send: (text: string) => void | Promise<boolean | void>;
  addPendingFollowUp: (text: string) => void;
  onQueueFull?: () => void;
};

/** Send immediately when idle; otherwise enqueue a pending follow-up. */
export function sendOrQueueMessage(input: SendOrQueueInput): void {
  const trimmed = input.text.trim();
  if (!trimmed) return;

  if (input.runBusy) {
    if (input.pendingCount >= MAX_PENDING_FOLLOW_UPS) {
      input.onQueueFull?.();
      return;
    }
    input.addPendingFollowUp(trimmed);
    return;
  }

  void input.send(trimmed);
}
