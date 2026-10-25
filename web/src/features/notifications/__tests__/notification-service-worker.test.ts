import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../../../public/notification-sw.js', import.meta.url), 'utf8');
type Client = { url: string; focused?: boolean; navigate: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> };
function setup(windows: Client[] = []) {
  const handlers = new Map<string, (event: unknown) => void>();
  const clients = { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => ({})), claim: vi.fn(async () => {}) };
  const skipWaiting = vi.fn(async () => {});
  runInNewContext(source, { URL, self: { registration: { scope: 'https://xopc.test/' }, clients, skipWaiting, addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler) } });
  return { clients, handlers, skipWaiting, async click(route: unknown) {
    let pending = Promise.resolve();
    const close = vi.fn();
    handlers.get('notificationclick')!({ notification: { data: { route }, close }, waitUntil: (value: Promise<void>) => { pending = value; } });
    await pending;
    expect(close).toHaveBeenCalledOnce();
  } };
}
function client(url = 'https://xopc.test/#/chat/new', focused = false): Client {
  const value: Client = { url, focused, navigate: vi.fn(), focus: vi.fn(async () => value) };
  value.navigate.mockResolvedValue(value);
  return value;
}

describe('native browser notification activation', () => {
  it.each(['success-first', 'failure-first'])('focuses a background app at its original execution: %s', async runId => {
    const window = client(); const worker = setup([window]);
    const route = `/automations?automation=task-1&run=${runId}`;
    await worker.click(route);
    expect(window.navigate).toHaveBeenCalledWith(`https://xopc.test/#${route}`);
    expect(window.focus).toHaveBeenCalledOnce();
    expect(worker.clients.openWindow).not.toHaveBeenCalled();
  });
  it.each(['success-first', 'failure-first'])('reopens a closed app at the notification execution: %s', async runId => {
    const worker = setup();
    await worker.click(`/automations?automation=task-1&run=${runId}`);
    expect(worker.clients.openWindow).toHaveBeenCalledWith(`https://xopc.test/#/automations?automation=task-1&run=${runId}`);
  });
  it('keeps an old notification target after a newer execution is viewed, without a renderer listener', async () => {
    const window = client('https://xopc.test/#/automations?automation=task-1&run=newer');
    await setup([window]).click('/automations?automation=task-1&run=older');
    expect(window.navigate).toHaveBeenCalledWith('https://xopc.test/#/automations?automation=task-1&run=older');
  });
  it('avoids unrelated tabs and recovers if the app closes during activation', async () => {
    const unrelated = client('https://xopc.test/api/health', true);
    const closing = client(); closing.navigate.mockRejectedValue(new Error('Window closed'));
    const worker = setup([unrelated, closing]);
    await worker.click('/automations?automation=task&run=original');
    expect(unrelated.navigate).not.toHaveBeenCalled();
    expect(worker.clients.openWindow).toHaveBeenCalledWith('https://xopc.test/#/automations?automation=task&run=original');
  });
  it('prefers the focused app and falls back when navigation returns no client', async () => {
    const background = client(); const focused = client('https://xopc.test/#/chat/new', true);
    focused.navigate.mockResolvedValue(null);
    const worker = setup([background, focused]);
    await worker.click('/automations?automation=task&run=original');
    expect(focused.navigate).toHaveBeenCalledOnce();
    expect(background.focus).toHaveBeenCalledOnce();
  });
  it.each([undefined, 'https://other.test/', '//other.test/', '/\\other.test/', '/bad\nroute'])('ignores malformed targets: %s', async route => {
    const worker = setup(); await worker.click(route);
    expect(worker.clients.matchAll).not.toHaveBeenCalled();
    expect(worker.clients.openWindow).not.toHaveBeenCalled();
  });
  it('activates updated click handling without waiting for the app to be closed', async () => {
    const worker = setup(); const pending: Promise<void>[] = [];
    const event = { waitUntil: (promise: Promise<void>) => pending.push(promise) };
    worker.handlers.get('install')!(event); worker.handlers.get('activate')!(event);
    await Promise.all(pending);
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
    expect(worker.clients.claim).toHaveBeenCalledOnce();
  });
});
