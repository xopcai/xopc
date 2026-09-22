import type { Message } from './messages.types';

/** Reconcile one client-only user row without changing other optimistic sends. */
export function setOptimisticUserMessageDelivery(
  messages: Message[],
  clientSubmissionId: string,
  status: 'accepted' | 'failed',
): Message[] {
  return messages.map((message) => {
    if (message.clientSubmissionId !== clientSubmissionId) return message;
    if (status === 'failed') return { ...message, deliveryStatus: 'failed' };
    const accepted = { ...message };
    delete accepted.clientSubmissionId;
    delete accepted.deliveryStatus;
    delete accepted.pendingAppContext;
    return accepted;
  });
}
