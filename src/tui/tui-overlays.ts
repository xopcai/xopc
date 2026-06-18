import type { Component, OverlayHandle, OverlayOptions, TUI } from '@earendil-works/pi-tui';

type OverlayHost = Pick<TUI, 'showOverlay' | 'hideOverlay' | 'hasOverlay' | 'setFocus'>;

/** Focus management for pi-tui overlays (openclaw pattern). */
export function createOverlayHandlers(host: OverlayHost, fallbackFocus: Component | (() => Component)) {
  const openOverlay = (
    component: Component,
    options?: OverlayOptions,
  ): OverlayHandle => {
    return host.showOverlay(component, options);
  };

  const closeOverlay = () => {
    if (host.hasOverlay()) {
      host.hideOverlay();
      return;
    }
    host.setFocus(typeof fallbackFocus === 'function' ? fallbackFocus() : fallbackFocus);
  };

  return { openOverlay, closeOverlay };
}
