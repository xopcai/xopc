import { dispatchConfigReload } from '@/features/gateway/dispatch-config-reload';
import { showToast } from '@/lib/toast';

type GoalQueueEventDetail = {
  item?: {
    goalId?: string;
    status?: string;
    error?: string;
    attempts?: number;
    maxRetries?: number;
  };
};

function maybeNotifyGoalQueue(eventName: string, detail: unknown): void {
  if (eventName !== 'goal.queue.updated' || !detail || typeof detail !== 'object') return;
  const item = (detail as GoalQueueEventDetail).item;
  if (!item || typeof item.status !== 'string') return;
  if (item.status === 'failed') {
    showToast({
      type: 'error',
      title: 'Goal run failed',
      message: item.error || item.goalId,
      duration: 0,
    });
    return;
  }
  if (item.status === 'retry_waiting') {
    showToast({
      type: 'warning',
      title: 'Goal run retry scheduled',
      message: item.error || item.goalId,
    });
    return;
  }
  if (item.status === 'succeeded') {
    showToast({
      type: 'success',
      title: 'Goal run finished',
      message: item.goalId,
    });
    return;
  }
  if (item.status === 'skipped') {
    showToast({
      type: 'info',
      title: 'Goal run skipped',
      message: item.error || item.goalId,
    });
  }
}

/**
 * Mirror `ui` ChatPanel: dispatch `config.reload` as `config-reload` on `window` for listeners.
 */
export function dispatchGatewaySseEvent(eventName: string, rawData: string): void {
  let detail: unknown = rawData;
  try {
    detail = JSON.parse(rawData) as unknown;
  } catch {
    /* keep raw string */
  }
  if (eventName === 'config.reload') {
    dispatchConfigReload(detail);
    return;
  }
  maybeNotifyGoalQueue(eventName, detail);
  const hyphenName = eventName.replace(/[._]/g, '-');
  window.dispatchEvent(new CustomEvent(hyphenName, { detail }));

  const legacyHyphenName = eventName.replace(/\./g, '-');
  if (legacyHyphenName !== hyphenName) {
    window.dispatchEvent(new CustomEvent(legacyHyphenName, { detail }));
  }

  // Extension UI: forward structured agent stream chunks to `ExtensionProvider` (Phase 5).
  if (eventName === 'agent.stream' && detail && typeof detail === 'object' && detail !== null) {
    const d = detail as { sessionKey?: string; event?: unknown };
    if (typeof d.sessionKey === 'string' && d.sessionKey.length > 0) {
      window.dispatchEvent(
        new CustomEvent('agent-stream-event', {
          detail: {
            sessionKey: d.sessionKey,
            event: d.event !== undefined ? d.event : d,
          },
        }),
      );
    }
  }
}
