import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ shown: vi.fn(), last: null as { emit: (event: string) => void } | null }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(_input: unknown) { super(); native.last = this; }
    show() { native.shown(); this.emit('show'); }
  }
  return { Notification, app: { getPath: () => '/test', getLocale: () => 'en' },
    desktopCapturer: {}, powerSaveBlocker: {}, shell: {}, systemPreferences: {} };
});
vi.mock('node:fs/promises', () => ({ constants: {}, access: vi.fn(), writeFile: vi.fn(),
  readFile: vi.fn().mockResolvedValue(JSON.stringify({ notifyEnabled: true, notificationAuthStatus: 'granted' })) }));
vi.mock('../../../electron/tray.js', () => ({ hasSystemTray: () => false }));

import { initElectronShellPreferences, registerSystemSettingsIpc } from '../../../electron/ipc/system-settings-ipc.js';

const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>();
const navigate = vi.fn();
const event = { senderFrame: { url: 'http://127.0.0.1:18790/' }, sender: { getURL: () => 'http://127.0.0.1:18790/' } } as IpcMainInvokeEvent;
const input = { id: 'event-1', title: 'Decision needed', body: 'Open the conversation', target: { kind: 'chat', conversationId: 'conversation-1' } };
beforeAll(async () => {
  await initElectronShellPreferences();
  registerSystemSettingsIpc({ handle: (name: string, handler: (event: IpcMainInvokeEvent, input: unknown) => unknown) => handlers.set(name, handler) } as unknown as IpcMain,
    { isMainWindowFocused: () => true, navigateMainWindow: navigate });
});

describe('native decision notification', () => {
  it('allows attention while looking elsewhere in a focused app, and opens its conversation on click', async () => {
    const handler = handlers.get('system-settings:show-product-notification')!;
    expect(await handler(event, input)).toEqual({ ok: true, outcome: 'suppressed-focused' });
    expect(await handler(event, { ...input, allowWhenFocused: true })).toEqual({ ok: true, outcome: 'shown' });
    expect(native.shown).toHaveBeenCalledOnce();
    native.last?.emit('click');
    expect(navigate).toHaveBeenCalledWith('/chat/conversation-1');
  });

  it('still validates parameters and rejects untrusted callers', async () => {
    const handler = handlers.get('system-settings:show-product-notification')!;
    expect(await handler(event, { ...input, allowWhenFocused: 'yes' })).toEqual({ ok: false, error: 'INVALID_ARGUMENTS' });
    const untrusted = { senderFrame: { url: 'https://example.org/' }, sender: { getURL: () => 'https://example.org/' } } as IpcMainInvokeEvent;
    await expect(handler(untrusted, { ...input, allowWhenFocused: true })).rejects.toThrow('untrusted renderer');
  });
});
