// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchJson: vi.fn(), apiFetch: vi.fn() }));
vi.mock('@/lib/fetch', () => api);
vi.mock('@/stores/gateway-store', () => ({ useGatewayStore: (select: (state: { conversationId: string }) => unknown) =>
  select({ conversationId: 'browser-test' }) }));
import { personalUnreadLabel, usePersonalUnread } from '../use-personal-unread';
import { isPersonalNotificationViewed } from '@/features/notifications/notification-policy';

const snapshot = { conversationId: 'personal-chat', transcriptId: 'transcript', lastSeq: 7, unreadCount: 3 };
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
async function render(viewed?: string) {
  function Probe() { return <span>{usePersonalUnread(viewed)}</span>; }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Probe /></SWRConfig>));
}

describe('Personal unread messages', () => {
  it('keeps messages unread while navigating elsewhere', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    api.fetchJson.mockResolvedValue({ ok: true, payload: snapshot });
    await render();
    expect(container?.textContent).toBe('3');
    expect(api.apiFetch).not.toHaveBeenCalled();
    expect(personalUnreadLabel(99)).toBe('99');
    expect(personalUnreadLabel(100)).toBe('99+');
  });

  it('waits for a visible focused conversation to acknowledge the observed snapshot', async () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    api.fetchJson.mockResolvedValue({ ok: true, payload: snapshot });
    api.apiFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, payload: { ...snapshot, unreadCount: 0 } }) });
    await render('personal-chat');
    expect(container?.textContent).toBe('3');
    expect(api.apiFetch).not.toHaveBeenCalled();
    focus.mockReturnValue(true);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(api.apiFetch).toHaveBeenCalledWith('/api/personal-agent/read', {
      method: 'POST', body: JSON.stringify({ transcriptId: 'transcript', lastSeq: 7 }),
    });
    expect(container?.textContent).toBe('0');
  });

  it('suppresses Personal notifications only while that conversation is visible', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const notification = { id: 'reply', title: 'Joyce', body: 'Done', route: '/personal',
      target: { kind: 'chat' as const, conversationId: 'personal-chat', personal: true }, status: 'success' as const, source: 'chat' as const };
    window.location.hash = '#/personal';
    expect(isPersonalNotificationViewed(notification)).toBe(true);
    window.location.hash = '#/tasks';
    expect(isPersonalNotificationViewed(notification)).toBe(false);
    window.location.hash = '#/personal';
    vi.mocked(document.hasFocus).mockReturnValue(false);
    expect(isPersonalNotificationViewed(notification)).toBe(false);
  });
});
