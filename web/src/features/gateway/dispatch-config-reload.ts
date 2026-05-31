const CONFIG_RELOAD_DEBOUNCE_MS = 500;

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingDetail: unknown;

/**
 * Coalesce rapid `config.reload` SSE bursts (e.g. batch agent create) into one UI refresh.
 */
export function dispatchConfigReload(detail?: unknown): void {
  _pendingDetail = detail;
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
  }
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    const detailToEmit = _pendingDetail;
    _pendingDetail = undefined;
    window.dispatchEvent(new CustomEvent('config-reload', { detail: detailToEmit }));
  }, CONFIG_RELOAD_DEBOUNCE_MS);
}

/** Flush any pending debounced reload immediately (tests or explicit user refresh). */
export function flushConfigReload(): void {
  if (_debounceTimer === null) {
    return;
  }
  clearTimeout(_debounceTimer);
  _debounceTimer = null;
  const detailToEmit = _pendingDetail;
  _pendingDetail = undefined;
  window.dispatchEvent(new CustomEvent('config-reload', { detail: detailToEmit }));
}
