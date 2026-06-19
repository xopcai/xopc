import type { Component, OverlayHandle, OverlayOptions, TUI } from '@earendil-works/pi-tui';

type OverlayHost = Pick<TUI, 'showOverlay' | 'hideOverlay' | 'hasOverlay' | 'setFocus'>;

/** Focus management for pi-tui overlays (openclaw pattern). */
export function createOverlayHandlers(host: OverlayHost, fallbackFocus: Component | (() => Component)) {
  const openOverlay = (
    component: Component,
    options?: OverlayOptions,
  ): OverlayHandle => {
    const handle = host.showOverlay(component, options);
    host.setFocus(component);
    return handle;
  };

  const closeOverlay = () => {
    if (host.hasOverlay()) {
      host.hideOverlay();
    }
    host.setFocus(typeof fallbackFocus === 'function' ? fallbackFocus() : fallbackFocus);
  };

  return { openOverlay, closeOverlay };
}
