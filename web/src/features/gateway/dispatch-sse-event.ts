import { dispatchConfigReload } from '@/features/gateway/dispatch-config-reload';

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
  const hyphenName = eventName.replace(/[._]/g, '-');
  window.dispatchEvent(new CustomEvent(hyphenName, { detail }));

  // Forward structured agent stream chunks to extension UIs.
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
