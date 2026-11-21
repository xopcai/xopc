import { afterEach, expect, it, vi } from 'vitest';

import { installBrowserPreview } from './browser-preview';

const { sessions } = vi.hoisted(() => ({ sessions: new Map() }));
vi.mock('./session-manager', () => ({ automationSessions: sessions }));
vi.mock('./sidepanel/auth', () => ({ gatewayFetch: vi.fn() }));

afterEach(() => {
  sessions.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setupChrome(overrides: {
  executeScript?: ReturnType<typeof vi.fn>;
  getMediaStreamId?: ReturnType<typeof vi.fn>;
} = {}) {
  const onClicked = vi.fn();
  const onConnect = vi.fn();
  const onRemoved = vi.fn();
  const onUpdated = vi.fn();
  const open = vi.fn().mockResolvedValue(undefined);
  const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
  const executeScript = overrides.executeScript ?? vi.fn().mockResolvedValue([{ documentId: 'document', result: 'https://example.org' }]);
  const getMediaStreamId = overrides.getMediaStreamId ?? vi.fn((_options, callback: (id: string) => void) => callback('stream'));
  vi.stubGlobal('chrome', {
    action: { onClicked: { addListener: onClicked }, setTitle: vi.fn().mockResolvedValue(undefined),
      setBadgeText: vi.fn().mockResolvedValue(undefined) },
    i18n: { getUILanguage: () => 'en', getMessage: () => 'xopc' },
    sidePanel: { open, setPanelBehavior },
    runtime: { id: 'extension', onConnect: { addListener: onConnect } },
    scripting: { executeScript },
    tabCapture: { getMediaStreamId },
    tabs: { onRemoved: { addListener: onRemoved }, onUpdated: { addListener: onUpdated } },
  });
  return { onClicked, onConnect, onRemoved, onUpdated, open, setPanelBehavior, executeScript, getMediaStreamId };
}

it('starts with one click on the verified task tab, lists viewers, opens side panel while sharing, and supports per-viewer stop', async () => {
  const { onClicked, onConnect, open, getMediaStreamId } = setupChrome();
  const onMessage = vi.fn();
  const send = vi.fn();
  sessions.set('session', { activeTabId: 1, tabIds: [1] });
  const preview = installBrowserPreview(send)!;
  const click = onClicked.mock.calls[0]![0];
  const current = { type: 'requested' as const, conversationId: 'conversation', requestId: 'first',
    browserSessionId: 'session', tabId: 1, origin: 'https://example.org', viewer: 'Web' };
  preview.receive(current);
  await Promise.resolve();
  expect(getMediaStreamId).not.toHaveBeenCalled();
  expect(preview.status()).toEqual({
    origin: 'https://example.org',
    sharing: false,
    viewers: [{ requestId: 'first', viewer: 'Web', active: false }],
  });
  click({ id: 2 });
  expect(getMediaStreamId).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith({ tabId: 2 });

  click({ id: 1 });
  expect(getMediaStreamId).toHaveBeenCalledOnce();
  expect(send).not.toHaveBeenCalled();
  const disconnect = vi.fn();
  const postMessage = vi.fn();
  onConnect.mock.calls[0]![0]({
    name: 'browser-preview:first', sender: { id: 'extension', tab: { id: 1 }, frameId: 0, documentId: 'document', url: current.origin },
    disconnect, postMessage, onDisconnect: { addListener: vi.fn() }, onMessage: { addListener: onMessage },
  });
  onMessage.mock.calls[0]![0]({ type: 'ready' });
  expect(send).toHaveBeenCalledWith({ type: 'accept', requestId: 'first' });

  preview.receive({ ...current, requestId: 'second', viewer: 'Android' });
  await Promise.resolve();
  expect(send).toHaveBeenCalledWith({ type: 'accept', requestId: 'second' });
  expect(getMediaStreamId).toHaveBeenCalledOnce();
  expect(preview.status()).toEqual({
    origin: 'https://example.org',
    sharing: true,
    viewers: [
      { requestId: 'first', viewer: 'Web', active: true },
      { requestId: 'second', viewer: 'Android', active: true },
    ],
  });

  // Clicking the toolbar icon while sharing opens the side panel instead of abruptly killing the stream.
  click({ id: 1 });
  expect(open).toHaveBeenCalledWith({ tabId: 1 });
  expect(disconnect).not.toHaveBeenCalled();

  // Stopping a single viewer keeps the remaining viewer active.
  preview.stop('second');
  expect(send).toHaveBeenCalledWith({ type: 'close', requestId: 'second' });
  expect(disconnect).not.toHaveBeenCalled();
  expect(preview.status()?.viewers).toEqual([{ requestId: 'first', viewer: 'Web', active: true }]);

  // Stopping all viewers tears down the capture.
  preview.stop();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith({ type: 'close', requestId: 'first' });
});

it('clears captureId when a sensitive document rejects startup immediately or times out', async () => {
  vi.useFakeTimers();
  const executeScript = vi.fn()
    .mockResolvedValueOnce([{ documentId: 'document', result: 'https://example.org' }])
    .mockResolvedValueOnce([{ result: false }]);
  const { onClicked, getMediaStreamId } = setupChrome({ executeScript });
  const send = vi.fn();
  sessions.set('session', { activeTabId: 1, tabIds: [1] });
  const preview = installBrowserPreview(send)!;
  const click = onClicked.mock.calls[0]![0];
  const current = { type: 'requested' as const, conversationId: 'conversation', requestId: 'first',
    browserSessionId: 'session', tabId: 1, origin: 'https://example.org', viewer: 'Web' };
  preview.receive(current);
  await Promise.resolve();

  click({ id: 1 });
  await Promise.resolve();
  await Promise.resolve();
  expect(send).toHaveBeenCalledWith({ type: 'close', requestId: 'first' });
  expect(preview.status()).toBeUndefined();

  // Subsequent request can start normally (no captureId deadlock) and times out cleanly if never ready.
  executeScript
    .mockResolvedValueOnce([{ documentId: 'document', result: 'https://example.org' }])
    .mockResolvedValueOnce([{ result: true }]);
  preview.receive({ ...current, requestId: 'second' });
  await Promise.resolve();
  click({ id: 1 });
  expect(getMediaStreamId).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(send).toHaveBeenCalledWith({ type: 'close', requestId: 'second' });
  expect(preview.status()).toBeUndefined();
});

it('cleans up pending preview requests when the task tab closes or navigates cross-origin', async () => {
  const { onRemoved, onUpdated } = setupChrome();
  const send = vi.fn();
  sessions.set('session', { activeTabId: 1, tabIds: [1] });
  const preview = installBrowserPreview(send)!;
  const current = { type: 'requested' as const, conversationId: 'conversation', requestId: 'first',
    browserSessionId: 'session', tabId: 1, origin: 'https://example.org', viewer: 'Web' };
  preview.receive(current);
  await Promise.resolve();

  onUpdated.mock.calls[0]![0](1, { url: 'https://other.test/page' });
  expect(send).toHaveBeenCalledWith({ type: 'close', requestId: 'first' });
  expect(preview.status()).toBeUndefined();

  preview.receive({ ...current, requestId: 'second' });
  await Promise.resolve();
  onRemoved.mock.calls[0]![0](1);
  expect(send).toHaveBeenCalledWith({ type: 'close', requestId: 'second' });
  expect(preview.status()).toBeUndefined();
});

it('recovers cleanly in stopBeforeAction when the port throws synchronously or close times out', async () => {
  vi.useFakeTimers();
  const { onClicked, onConnect } = setupChrome();
  const send = vi.fn();
  sessions.set('session', { activeTabId: 1, tabIds: [1] });
  const preview = installBrowserPreview(send)!;
  const click = onClicked.mock.calls[0]![0];
  const current = { type: 'requested' as const, conversationId: 'conversation', requestId: 'first',
    browserSessionId: 'session', tabId: 1, origin: 'https://example.org', viewer: 'Web' };
  preview.receive(current);
  await Promise.resolve();
  click({ id: 1 });

  const disconnect = vi.fn();
  const postMessage = vi.fn(() => { throw new Error('Port already disconnected'); });
  onConnect.mock.calls[0]![0]({
    name: 'browser-preview:first', sender: { id: 'extension', tab: { id: 1 }, frameId: 0, documentId: 'document', url: current.origin },
    disconnect, postMessage,
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    onMessage: { addListener: vi.fn() },
  });

  await expect(preview.stopBeforeAction({ action: 'fill', sessionId: 'session', revision: 1, ref: 'e1', value: 'x' })).resolves.toBeUndefined();
  expect(send).toHaveBeenCalledWith({ type: 'close', requestId: 'first' });

  // Hung page should not block `close` past the 1s stop deadline.
  preview.receive({ ...current, requestId: 'second' });
  await Promise.resolve();
  click({ id: 1 });
  onConnect.mock.calls[0]![0]({
    name: 'browser-preview:second', sender: { id: 'extension', tab: { id: 1 }, frameId: 0, documentId: 'document', url: current.origin },
    disconnect, postMessage: vi.fn(),
    onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
    onMessage: { addListener: vi.fn() },
  });
  const closing = preview.stopBeforeAction({ action: 'close', sessionId: 'session' });
  await vi.advanceTimersByTimeAsync(1000);
  await expect(closing).resolves.toBeUndefined();
  expect(send).toHaveBeenCalledWith({ type: 'close', requestId: 'second' });
});
