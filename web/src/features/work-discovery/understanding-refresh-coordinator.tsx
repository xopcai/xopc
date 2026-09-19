import { useEffect } from 'react';

import { useUnderstandingRefreshStore } from './understanding-refresh-store';

/** Mounted by the app shell so desktop collection survives modal and page navigation. */
export function UnderstandingRefreshCoordinator() {
  const running = useUnderstandingRefreshStore((state) => state.sources.some((run) => run.status === 'queued' || run.status === 'running'));
  useEffect(() => {
    const refresh = () => { void useUnderstandingRefreshStore.getState().poll(); };
    refresh();
    const timer = window.setInterval(refresh, running ? 1_500 : 30_000);
    window.addEventListener('understanding-refresh-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('understanding-refresh-updated', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [running]);
  return null;
}
