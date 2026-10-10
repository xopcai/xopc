// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isNotificationActionable } from '../notification-api';
import { decideNotification, isClarificationNotificationViewed } from '../notification-policy';
import { presentProductNotification } from '../product-notification';
import { getBrowserNotificationPreferences } from '../browser-notification-preferences';

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/fetch', () => api);
const event = {
  schemaVersion: 1 as const, id: 'notification-1', type: 'chat.needs_input' as const,
  target: { kind: 'chat' as const, conversationId: 'conversation-1' }, priority: 'high' as const,
  title: { en: 'Your decision is needed', zh: '需要你判断后继续' },
  body: { en: 'Open the conversation', zh: '点击继续' }, createdAt: Date.now(),
  payload: { waitId: 'wait-1', transcriptId: 'transcript-1' },
};

afterEach(() => { vi.restoreAllMocks(); api.apiFetch.mockReset(); document.body.replaceChildren(); localStorage.clear(); });

describe('clarification notification policy', () => {
  it('presents a decision as attention and keeps its preference independent of success/failure', () => {
    const notification = presentProductNotification(event, 'zh');
    expect(notification).toMatchObject({ status: 'attention', waitId: 'wait-1', route: '/chat/conversation-1' });
    const input = { notification, preferences: { enabled: true, completed: false, failed: false },
      permissionGranted: true, appFocused: false, alreadyDelivered: false };
    expect(decideNotification(input)).toEqual({ notify: true });
    expect(decideNotification({ ...input, preferences: { ...input.preferences, needsInput: false } }))
      .toEqual({ notify: false, reason: 'status-disabled' });
    expect(getBrowserNotificationPreferences().needsInput).toBe(true);
  });

  it('suppresses only a visible card belonging to the notification, including Personal conversations', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const card = document.createElement('section');
    card.dataset.clarificationId = 'wait-1';
    document.body.append(card);
    vi.spyOn(card, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const bounds = vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ top: 10, bottom: 100, left: 10, right: 100 } as DOMRect);
    const notification = presentProductNotification(event, 'en');
    window.location.hash = '#/settings/gateway';
    expect(isClarificationNotificationViewed(notification)).toBe(false);
    window.location.hash = '#/chat/conversation-1';
    expect(isClarificationNotificationViewed(notification)).toBe(true);
    bounds.mockReturnValue({ top: -500, bottom: -10, left: 10, right: 100 } as DOMRect);
    expect(isClarificationNotificationViewed(notification)).toBe(false);
    bounds.mockReturnValue({ top: 10, bottom: 100, left: 10, right: 100 } as DOMRect);
    window.location.hash = '#/personal';
    const personal = presentProductNotification({ ...event, target: { ...event.target, personal: true } }, 'en');
    expect(isClarificationNotificationViewed(personal)).toBe(true);
    card.dataset.clarificationId = 'another-conversation-wait';
    expect(isClarificationNotificationViewed(personal)).toBe(false);
  });

  it('rechecks the persisted snapshot before displaying and rejects answered/expired/replaced questions', async () => {
    const snapshot = { transcriptId: 'transcript-1', clarification: { id: 'wait-1', status: 'open', expiresAt: Date.now() + 60_000 } };
    api.apiFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, payload: snapshot })));
    expect(await isNotificationActionable(event)).toBe(true);
    for (const replacement of [
      { ...snapshot, transcriptId: 'new-transcript' },
      { ...snapshot, clarification: { ...snapshot.clarification, status: 'queued' } },
      { ...snapshot, clarification: { ...snapshot.clarification, expiresAt: Date.now() - 1 } },
      { ...snapshot, clarification: null },
    ]) {
      api.apiFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, payload: replacement })));
      expect(await isNotificationActionable(event)).toBe(false);
    }
    api.apiFetch.mockResolvedValue(new Response('', { status: 503 }));
    await expect(isNotificationActionable(event)).rejects.toThrow('Could not refresh');
  });
});
