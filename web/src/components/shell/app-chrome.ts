/**
 * Electron custom chrome: mark draggable regions (macOS `titleBarStyle: hiddenInset`, etc.).
 * Ignored in normal browsers.
 */
export const APP_CHROME_DRAG_CLASS = '[-webkit-app-region:drag]';

/** Use on buttons, links, and inputs inside a drag region so they stay clickable. */
export const APP_CHROME_NO_DRAG_CLASS = '[-webkit-app-region:no-drag]';

/**
 * Shared top strip height for the sidebar rail header and the main column header
 * (AppShell aside + ChatPage title row).
 */
export const APP_TOP_HEADER_BAR_CLASS = `h-14 shrink-0 items-center ${APP_CHROME_DRAG_CLASS}`;
