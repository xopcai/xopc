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
  const hyphenName = eventName.replace(/\./g, '-');
  window.dispatchEvent(new CustomEvent(hyphenName, { detail }));

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
