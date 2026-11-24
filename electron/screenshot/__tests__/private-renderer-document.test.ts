import { readFile } from 'node:fs/promises';

import { protocol, type BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { loadPrivateRendererDocument, registerPrivateRendererScheme } from '../../private-renderer-document.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('electron', () => ({ protocol: { registerSchemesAsPrivileged: vi.fn() } }));

describe('packaged private renderer documents', () => {
  it('registers a secure origin for the preview worker', () => {
    registerPrivateRendererScheme();
    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      { scheme: 'xopc-renderer', privileges: { standard: true, secure: true } },
    ]);
  });

  it('loads only the assigned document and reuses the partition handler', async () => {
    let handler: ((request: Request) => Promise<Response>) | undefined;
    const privateProtocol = {
      isProtocolHandled: vi.fn(() => Boolean(handler)),
      handle: vi.fn((_scheme: string, serve: NonNullable<typeof handler>) => { handler = serve; }),
    };
    const loadURL = vi.fn(async (_url: string) => undefined);
    const window = { webContents: { session: { protocol: privateProtocol } }, loadURL } as unknown as BrowserWindow;
    vi.mocked(readFile).mockResolvedValue('<!doctype html>');

    await loadPrivateRendererDocument(window, 'screenshot-overlay');
    await loadPrivateRendererDocument(window, 'screenshot-overlay');

    expect(privateProtocol.handle).toHaveBeenCalledTimes(1);
    const url = 'xopc-renderer://screenshot-overlay/';
    expect(loadURL.mock.calls).toEqual([[url], [url]]);
    const response = await handler!(new Request(url));
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('<!doctype html>');
    expect((await handler!(new Request('xopc-renderer://computer-preview/'))).status).toBe(404);
    expect((await handler!(new Request(url, { method: 'POST' }))).status).toBe(404);
    expect(readFile).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/[/\\]preload[/\\]screenshot-overlay\.html$/), 'utf8');
  });
});
