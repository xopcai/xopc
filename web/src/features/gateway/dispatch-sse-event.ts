import { dispatchConfigReload } from '@/features/gateway/dispatch-config-reload';
import { useLocaleStore } from '@/stores/locale-store';
import { showActivity } from '@/stores/activity-center-store';

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
  const zh = useLocaleStore.getState().language === 'zh';
  const goalId = item.goalId?.trim();
  const common = {
    source: zh ? '目标运行' : 'Goal run',
    href: goalId ? `/goals/${encodeURIComponent(goalId)}` : undefined,
    dedupeKey: goalId ? `goal-queue:${goalId}` : undefined,
  };
  if (item.status === 'failed') {
    showActivity({
      tone: 'error',
      status: 'failed',
      title: zh ? '目标运行失败' : 'Goal run failed',
      message: item.error || item.goalId,
      ...common,
    });
    return;
  }
  if (item.status === 'retry_waiting') {
    showActivity({
      tone: 'warning',
      status: 'running',
      title: zh ? '目标将在稍后重试' : 'Goal retry scheduled',
      message: item.error || item.goalId,
      ...common,
    });
    return;
  }
  if (item.status === 'succeeded') {
    showActivity({
      tone: 'success',
      status: 'done',
      title: zh ? '目标运行完成' : 'Goal run finished',
      message: item.goalId,
      ...common,
    });
    return;
  }
  if (item.status === 'skipped') {
    showActivity({
      tone: 'info',
      status: 'done',
      title: zh ? '目标运行已跳过' : 'Goal run skipped',
      message: item.error || item.goalId,
      ...common,
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
