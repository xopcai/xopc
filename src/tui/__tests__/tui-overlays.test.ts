import { describe, expect, it, vi } from 'vitest';

import { createOverlayHandlers } from '../tui-overlays.js';

describe('createOverlayHandlers', () => {
  it('focuses overlays while open and restores the fallback focus when closed', () => {
    const overlay = { handleInput: vi.fn() };
    const editor = { handleInput: vi.fn() };
    let hasOverlay = false;
    const host = {
      showOverlay: vi.fn(() => {
        hasOverlay = true;
        return { close: vi.fn() };
      }),
      hideOverlay: vi.fn(() => {
        hasOverlay = false;
      }),
      hasOverlay: vi.fn(() => hasOverlay),
      setFocus: vi.fn(),
    };

    const { openOverlay, closeOverlay } = createOverlayHandlers(host, editor);

    openOverlay(overlay);
    expect(host.showOverlay).toHaveBeenCalledWith(overlay, undefined);
    expect(host.setFocus).toHaveBeenLastCalledWith(overlay);

    closeOverlay();
    expect(host.hideOverlay).toHaveBeenCalledOnce();
    expect(host.setFocus).toHaveBeenLastCalledWith(editor);
  });
});
