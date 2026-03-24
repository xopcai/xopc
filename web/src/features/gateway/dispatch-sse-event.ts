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
}
