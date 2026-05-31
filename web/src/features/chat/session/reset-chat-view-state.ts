import type { MutableRefObject } from 'react';

/** Sync stream guard refs on route change; per-session store slices hold committed messages. */
export function resetChatViewState(deps: {
  sendingRef: MutableRefObject<boolean>;
  streamingRef: MutableRefObject<boolean>;
}): void {
  deps.sendingRef.current = false;
  deps.streamingRef.current = false;
}
