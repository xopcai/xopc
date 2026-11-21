import { afterEach, expect, it, vi } from 'vitest';

import { installBrowserPreview } from './browser-preview';

const { sessions } = vi.hoisted(() => ({ sessions: new Map() }));
vi.mock('./session-manager', () => ({ automationSessions: sessions }));
vi.mock('./sidepanel/auth', () => ({ gatewayFetch: vi.fn() }));

afterEach(() => {
  sessions.clear();
  vi.unstubAllGlobals();
});

it('starts with one click on the verified task tab and adds a second viewer to the same capture', async () => {
  const onClicked = vi.fn();
  const onConnect = vi.fn();
  const onMessage = vi.fn();
  const open = vi.fn().mockResolvedValue(undefined);
  const executeScript = vi.fn().mockResolvedValue([{ documentId: 'document', result: 'https://example.org' }]);
  const getMediaStreamId = vi.fn((_options, callback: (id: string) => void) => callback('stream'));
  vi.stubGlobal('chrome', {
    action: { onClicked: { addListener: onClicked }, setTitle: vi.fn().mockResolvedValue(undefined),
      setBadgeText: vi.fn().mockResolvedValue(undefined) },
    i18n: { getUILanguage: () => 'en', getMessage: () => 'xopc' },
    sidePanel: { open, setPanelBehavior: vi.fn().mockResolvedValue(undefined) },
    runtime: { id: 'extension', onConnect: { addListener: onConnect } },
    scripting: { executeScript },
    tabCapture: { getMediaStreamId },
  });
  const send = vi.fn();
  sessions.set('session', { activeTabId: 1, tabIds: [1] });
  const preview = installBrowserPreview(send)!;
  const click = onClicked.mock.calls[0]![0];
  const current = { type: 'requested' as const, conversationId: 'conversation', requestId: 'first',
    browserSessionId: 'session', tabId: 1, origin: 'https://example.org', viewer: 'Web' };
  preview.receive(current);
  await Promise.resolve();
  expect(getMediaStreamId).not.toHaveBeenCalled();
  click({ id: 2 });
  expect(getMediaStreamId).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith({ tabId: 2 });

  click({ id: 1 });
  expect(getMediaStreamId).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
  const disconnect = vi.fn();
  onConnect.mock.calls[0]![0]({
    name: 'browser-preview:first', sender: { id: 'extension', tab: { id: 1 }, frameId: 0, documentId: 'document', url: current.origin },
    disconnect, onDisconnect: { addListener: vi.fn() }, onMessage: { addListener: onMessage },
  });
  onMessage.mock.calls[0]![0]({ type: 'ready' });
  expect(send).toHaveBeenCalledWith({ type: 'accept', requestId: 'first' });

  preview.receive({ ...current, requestId: 'second', viewer: 'Android' });
  await Promise.resolve();
  expect(send).toHaveBeenCalledWith({ type: 'accept', requestId: 'second' });
  expect(getMediaStreamId).toHaveBeenCalledOnce();
  click({ id: 1 });
  expect(disconnect).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith({ type: 'close', requestId: 'first' });
  expect(send).toHaveBeenCalledWith({ type: 'close', requestId: 'second' });
});
