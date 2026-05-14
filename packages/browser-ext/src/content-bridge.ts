/**
 * Content Script bridge — sends visual feedback messages to content scripts.
 *
 * All functions are fire-and-forget (best effort) since the content script
 * may not be loaded on chrome://, about:blank, or other non-web pages.
 */

async function sendContentMessage(
  tabId: number,
  message: Record<string, unknown>,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Content script not loaded on this page
  }
}

export async function showOverlayOnTab(tabId: number, status: string): Promise<void> {
  await sendContentMessage(tabId, { type: 'content/show-overlay', status });
}

export async function hideOverlayOnTab(tabId: number): Promise<void> {
  await sendContentMessage(tabId, { type: 'content/hide-overlay' });
}

export async function showClickRippleOnTab(tabId: number, x: number, y: number): Promise<void> {
  await sendContentMessage(tabId, { type: 'content/show-click-ripple', x, y });
}

export async function showHoverHighlightOnTab(tabId: number, selector: string): Promise<void> {
  await sendContentMessage(tabId, { type: 'content/show-hover-highlight', selector });
}

export async function showInputFlashOnTab(tabId: number, selector: string): Promise<void> {
  await sendContentMessage(tabId, { type: 'content/show-input-flash', selector });
}

export async function showScrollIndicatorOnTab(
  tabId: number,
  direction: 'up' | 'down',
): Promise<void> {
  await sendContentMessage(tabId, { type: 'content/show-scroll-indicator', direction });
}
