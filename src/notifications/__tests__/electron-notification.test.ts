import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ shown: vi.fn(), inputs: [] as Array<{ toastXml?: string }>, focused: true,
  activation: null as ((details: { type: string; arguments: string }) => void) | null,
  last: null as { emit: (event: string) => void } | null }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    static handleActivation(callback: typeof native.activation) { native.activation = callback; }
    constructor(input: { toastXml?: string }) { super(); native.last = this; native.inputs.push(input); }
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
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeAll(async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  await initElectronShellPreferences();
  registerSystemSettingsIpc({ handle: (name: string, handler: (event: IpcMainInvokeEvent, input: unknown) => unknown) => handlers.set(name, handler) } as unknown as IpcMain,
    { isMainWindowFocused: () => native.focused, navigateMainWindow: navigate });
});
afterAll(() => Object.defineProperty(process, 'platform', platform));
beforeEach(() => { native.focused = true; native.inputs.length = 0; vi.clearAllMocks(); });

function activateToast(xml: string) {
  const encoded = xml.match(/launch="([^"]+)"/)![1]!;
  const argumentsText = encoded.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  native.activation!({ type: 'click', arguments: argumentsText });
}

describe('native decision notification', () => {
  it('allows attention while looking elsewhere in a focused app, and opens its conversation on click', async () => {
    const handler = handlers.get('system-settings:show-product-notification')!;
    expect(await handler(event, input)).toEqual({ ok: true, outcome: 'suppressed-focused' });
    expect(await handler(event, { ...input, allowWhenFocused: true })).toEqual({ ok: true, outcome: 'shown' });
    expect(native.shown).toHaveBeenCalledOnce();
    native.last?.emit('click');
    expect(navigate).not.toHaveBeenCalled();
    activateToast(native.inputs[0]!.toastXml!);
    expect(navigate).toHaveBeenCalledWith('/chat/conversation-1');
  });

  it('still validates parameters and rejects untrusted callers', async () => {
    const handler = handlers.get('system-settings:show-product-notification')!;
    expect(await handler(event, { ...input, allowWhenFocused: 'yes' })).toEqual({ ok: false, error: 'INVALID_ARGUMENTS' });
    const untrusted = { senderFrame: { url: 'https://example.org/' }, sender: { getURL: () => 'https://example.org/' } } as IpcMainInvokeEvent;
    await expect(handler(untrusted, { ...input, allowWhenFocused: true })).rejects.toThrow('untrusted renderer');
  });

  it.each(['Succeeded', 'Failed'])('restores the original %s execution after a newer notification and a renderer restart', async status => {
    native.focused = false;
    const handler = handlers.get('system-settings:show-product-notification')!;
    const target = { kind: 'automation_run', automationId: 'task one', runId: `original/${status}` };
    expect(await handler(event, { ...input, id: 'old-event', title: status, target })).toEqual({ ok: true, outcome: 'shown' });
    const oldToast = native.inputs[0]!.toastXml!;
    await handler(event, { ...input, id: 'new-event', target: { ...target, runId: 'newer' } });
    native.last = null;
    navigate.mockClear();
    activateToast(oldToast);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(`/automations?automation=task%20one&run=original%2F${status}`);
  });

  it('registers activation routing on a fresh process without needing the original Notification object', () => {
    const reopened = vi.fn();
    registerSystemSettingsIpc({ handle: vi.fn() } as unknown as IpcMain, { navigateMainWindow: reopened });
    native.activation!({ type: 'click', arguments: JSON.stringify({ xopcNotification: 1, target: { kind: 'automation_run', automationId: 'task', runId: 'old-run' } }) });
    expect(reopened).toHaveBeenCalledExactlyOnceWith('/automations?automation=task&run=old-run');
    native.activation!({ type: 'click', arguments: '{"target":{"kind":"unknown"}}' });
    native.activation!({ type: 'action', arguments: '{}' });
    expect(reopened).toHaveBeenCalledOnce();
  });

  it('retains instance click routing on platforms without Windows activation', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const fallbackHandlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>();
    const fallbackNavigate = vi.fn();
    try {
      registerSystemSettingsIpc({ handle: (name: string, handler: (event: IpcMainInvokeEvent, input: unknown) => unknown) => fallbackHandlers.set(name, handler) } as unknown as IpcMain, { navigateMainWindow: fallbackNavigate });
      const handler = fallbackHandlers.get('system-settings:show-product-notification')!;
      expect(await handler(event, { ...input, target: { kind: 'automation_run', automationId: 'task', runId: 'original' } })).toEqual({ ok: true, outcome: 'shown' });
      expect(native.inputs[0]?.toastXml).toBeUndefined();
      native.last?.emit('click');
      expect(fallbackNavigate).toHaveBeenCalledExactlyOnceWith('/automations?automation=task&run=original');
    } finally { Object.defineProperty(process, 'platform', { value: 'win32' }); }
  });
});
