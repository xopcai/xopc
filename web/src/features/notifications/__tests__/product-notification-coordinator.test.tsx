// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { ProductNotificationCoordinator } from '../product-notification-coordinator';
import { useActivityStore } from '@/stores/activity-store';
import { useLocaleStore } from '@/stores/locale-store';

vi.mock('../notification-api', () => ({ fetchNotificationCatchUp: async () => [], isNotificationActionable: async () => true, saveNotificationCursor: vi.fn(), acknowledgeProductNotification: async () => {} }));
vi.mock('../browser-notification-delivery', () => ({ deliverBrowserNotification: async () => false }));
vi.mock('../electron-notification-delivery', () => ({ deliverElectronNotification: async () => false }));

it('keeps the original execution link for each notification after newer events arrive', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' });
  useActivityStore.setState({ items: [] });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter><ProductNotificationCoordinator /></MemoryRouter>));
    for (const [runId, type, title] of [['first', 'automation.completed', 'First success'], ['second', 'automation.failed', 'Second failure']] as const) {
      await act(async () => { window.dispatchEvent(new CustomEvent('notification-created', { detail: { schemaVersion: 1, id: runId, type, target: { kind: 'automation_run', automationId: 'task', runId }, priority: 'normal', title: { en: title, zh: title }, payload: {}, createdAt: Date.now() } })); });
    }
    expect(useActivityStore.getState().items).toHaveLength(2);
    for (const [title, run] of [['First success', 'first'], ['Second failure', 'second']]) {
      expect(useActivityStore.getState().items.find(item => item.dedupeKey === run)).toMatchObject({
        title,
        href: `/automations?automation=task&run=${run}`,
        read: false,
      });
    }
  } finally { act(() => root.unmount()); container.remove(); useActivityStore.setState({ items: [] }); }
});
