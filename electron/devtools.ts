import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { app, type BrowserWindow } from 'electron';

import { devToolsGlobalShortcutAccelerator, shouldAutoOpenDevTools } from './devtools-flags.js';

export { devToolsGlobalShortcutAccelerator, shouldAutoOpenDevTools };

const STARTUP_LOG = 'electron-startup.log';

/** Main-process DevTools toggle — works even when the renderer is blank or crashed (until webContents is destroyed). */
export function toggleMainWindowDevTools(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (wc.isDevToolsOpened()) {
    wc.closeDevTools();
    return;
  }
  wc.openDevTools({ mode: 'detach', activate: true });
}

export function openMainWindowDevTools(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (!win.webContents.isDevToolsOpened()) {
    win.webContents.openDevTools({ mode: 'detach', activate: true });
  }
}

export function appendElectronStartupLog(line: string): void {
  try {
    const dir = app.getPath('userData');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString();
    appendFileSync(join(dir, STARTUP_LOG), `[${stamp}] ${line}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

export function electronStartupLogPath(): string {
  return join(app.getPath('userData'), STARTUP_LOG);
}
