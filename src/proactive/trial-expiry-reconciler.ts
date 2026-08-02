import { createLogger } from '../utils/logger.js';

const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;
const log = createLogger('FocusTrialExpiry');

interface TrialExpiryService {
  reconcileExpiredTrials(): Promise<number>;
}

export function startTrialExpiryReconciler(
  service: TrialExpiryService,
  intervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
): () => Promise<void> {
  let stopped = false;
  let pending: Promise<void> | null = null;

  const reconcile = (): void => {
    if (stopped || pending) return;
    pending = service.reconcileExpiredTrials()
      .then((pausedCount) => {
        if (pausedCount > 0) {
          log.info({ pausedCount }, 'Expired focus watch trials paused');
        }
      })
      .catch((err) => {
        log.warn({ err }, 'Focus watch trial expiry reconciliation failed');
      })
      .finally(() => {
        pending = null;
      });
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
