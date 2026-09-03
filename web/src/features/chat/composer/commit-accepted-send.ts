import type { ComposerSendHandler } from './composer.types';
import { showComposerNotification } from './composer-notifications';

/** Clear input only after submission accepts it, including asynchronous session creation. */
export function commitAcceptedSend(result: ReturnType<ComposerSendHandler>, commit: () => void): void {
  const accept = (accepted: void | boolean) => { if (accepted !== false) commit(); };
  if (result instanceof Promise) {
    void result.then(accept).catch((error) => {
      showComposerNotification('error', error instanceof Error ? error.message : String(error));
    });
  } else {
    accept(result);
  }
}
