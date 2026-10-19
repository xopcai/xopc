import type { ComposerSendHandler } from './composer.types';
import { showComposerNotification } from './composer-notifications';

/** Clear input only after submission accepts it, including asynchronous session creation. */
export function commitAcceptedSend(result: ReturnType<ComposerSendHandler>, commit: (conversationId?: string) => void): void {
  const accept = (accepted: Awaited<ReturnType<ComposerSendHandler>>) => {
    if (accepted === false) return;
    if (accepted && typeof accepted === 'object') commit(accepted.conversationId);
    else commit();
  };
  if (result instanceof Promise) {
    void result.then(accept).catch((error) => {
      showComposerNotification('error', error instanceof Error ? error.message : String(error));
    });
  } else {
    accept(result);
  }
}
