import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { protocol, type BrowserWindow } from 'electron';

const scheme = 'xopc-renderer';

export function registerPrivateRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme, privileges: { standard: true, secure: true } }]);
}

export function loadPrivateRendererDocument(
  window: BrowserWindow,
  document: 'screenshot-overlay' | 'screenshot-pin' | 'computer-preview',
): Promise<void> {
  const url = `${scheme}://${document}/`;
  const rendererProtocol = window.webContents.session.protocol;
  if (!rendererProtocol.isProtocolHandled(scheme)) {
    // Chromium's file:// loader cannot read packaged ASAR entries with the file privileges fuse off.
    const path = join(import.meta.dirname, '../preload', `${document}.html`);
    rendererProtocol.handle(scheme, async (request) => {
      if (request.method !== 'GET' || request.url !== url) return new Response(null, { status: 404 });
      return new Response(await readFile(path, 'utf8'), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    });
  }
  return window.loadURL(url);
}
