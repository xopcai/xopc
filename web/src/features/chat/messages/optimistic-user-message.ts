import type { Message } from './messages.types';

/** Reconcile one client-only user row without changing other optimistic sends. */
export function setOptimisticUserMessageDelivery(
  messages: Message[],
  clientSubmissionId: string,
  status: 'accepted' | 'failed',
): Message[] {
  return messages.map((message) => {
    if (message.clientSubmissionId !== clientSubmissionId) return message;
    // A canonical user event may arrive before the HTTP acknowledgement.
    if (!message.deliveryStatus) return message;
    if (status === 'failed') return { ...message, deliveryStatus: 'failed' };
    // Keep its identity until the transcript confirms the accepted input.
    const accepted = { ...message, deliveryStatus: 'accepted' as const };
    delete accepted.pendingAppContext;
    return accepted;
  });
}
