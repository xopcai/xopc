// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { ProductNotificationCoordinator } from '../product-notification-coordinator';
import { NotificationInbox } from '../notification-inbox';
import { useActivityStore } from '@/stores/activity-store';
import { useLocaleStore } from '@/stores/locale-store';

vi.mock('../notification-api', () => ({ fetchNotificationCatchUp: async () => [], isNotificationActionable: async () => true, saveNotificationCursor: vi.fn(), acknowledgeProductNotification: async () => {} }));
vi.mock('../browser-notification-delivery', () => ({ deliverBrowserNotification: async () => false }));
vi.mock('../electron-notification-delivery', () => ({ deliverElectronNotification: async () => false }));

it('receives success and failure events and opens each original execution after newer notifications arrive', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  useLocaleStore.setState({ language: 'en' });
  useActivityStore.setState({ items: [] });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  function Location() { const location = useLocation(); return <output>{location.pathname}{location.search}</output>; }
  try {
    await act(async () => root.render(<MemoryRouter><ProductNotificationCoordinator /><NotificationInbox /><Location /></MemoryRouter>));
    for (const [runId, type, title] of [['first', 'automation.completed', 'First success'], ['second', 'automation.failed', 'Second failure']] as const) {
      await act(async () => { window.dispatchEvent(new CustomEvent('notification-created', { detail: { schemaVersion: 1, id: runId, type, target: { kind: 'automation_run', automationId: 'task', runId }, priority: 'normal', title: { en: title, zh: title }, payload: {}, createdAt: Date.now() } })); });
    }
    expect(useActivityStore.getState().items).toHaveLength(2);
    for (const [title, run] of [['First success', 'first'], ['Second failure', 'second']]) {
      await act(async () => container.querySelector('button')!.click());
      const link = Array.from(document.querySelectorAll('a')).find(element => element.textContent?.includes(title));
      expect(link).toBeDefined();
      await act(async () => link!.click());
      expect(container.querySelector('output')?.textContent).toBe(`/automations?automation=task&run=${run}`);
      expect(useActivityStore.getState().items.find(item => item.dedupeKey === run)?.read).toBe(true);
    }
  } finally { act(() => root.unmount()); container.remove(); useActivityStore.setState({ items: [] }); }
});
