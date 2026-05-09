import type { AgentMessage } from '@earendil-works/pi-agent-core';

import type { SessionStore } from './store.js';

/**
 * Remove the last row if it is a gateway early-saved webchat user message (dangling prompt after abort).
 */
export async function stripTrailingWebchatEarlySaveUserIfPresent(
  sessionStore: SessionStore,
  sessionKey: string,
): Promise<boolean> {
  const msgs = await sessionStore.load(sessionKey);
  const last = msgs[msgs.length - 1] as
    | (AgentMessage & { webchatEarlySave?: boolean })
    | undefined;
  if (last?.role === 'user' && last.webchatEarlySave === true) {
    await sessionStore.save(sessionKey, msgs.slice(0, -1));
    return true;
  }
  return false;
}
