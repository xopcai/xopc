/**
 * Electron custom chrome: mark draggable regions (macOS `titleBarStyle: hiddenInset`, etc.).
 * Ignored in normal browsers.
 */
export const APP_CHROME_DRAG_CLASS = '[-webkit-app-region:drag]';

/** Use on buttons, links, and inputs inside a drag region so they stay clickable. */
export const APP_CHROME_NO_DRAG_CLASS = '[-webkit-app-region:no-drag]';

/** Sidebar rail top row — fixed `h-14`, Electron window drag region. */
export const APP_TOP_HEADER_BAR_CLASS = `h-14 shrink-0 items-center ${APP_CHROME_DRAG_CLASS}`;
