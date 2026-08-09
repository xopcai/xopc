import { createLogger } from '../utils/logger.js';

const log = createLogger('FocusReconciler');
const DEFAULT_INTERVAL_MS = 60_000;

interface ReconcileService {
  reconcile(): Promise<void>;
}

export function startFocusReconciler(
  service: ReconcileService,
  intervalMs = DEFAULT_INTERVAL_MS,
): () => Promise<void> {
  let stopped = false;
  let pending: Promise<void> | null = null;
  const reconcile = (): void => {
    if (stopped || pending) return;
    pending = service.reconcile()
      .catch((err) => log.warn({ err }, 'Focus state reconciliation failed'))
      .finally(() => { pending = null; });
  };
  reconcile();
  const timer = setInterval(reconcile, intervalMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
