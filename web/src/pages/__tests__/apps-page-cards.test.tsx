// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import type { ExtensionApiRow } from '@/features/extensions/types';

const fixtures = vi.hoisted(() => ({ extensions: [] as ExtensionApiRow[] }));
vi.mock('@/features/extensions/extension-provider', () => ({ useExtensions: () => fixtures.extensions, useExtensionsLoading: () => false }));
vi.mock('@/features/extensions/extension-marketplace', () => ({ ExtensionMarketplacePanel: () => null }));
vi.mock('@/features/extensions/agent-plugin-dialog', () => ({ AgentPluginDialog: () => null }));

import { ExtensionsPage } from '../apps-page';

it.each([false, true])('card and action open the same contextual detail target (needs authorization: %s)', async needsAuth => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'zh' });
  fixtures.extensions = [{ id: 'demo', pluginId: 'demo-id', format: 'agent-plugin', name: 'Demo', description: 'Original description', version: '1.0.0', source: 'global', active: true, hasUi: false, authorizationStatus: needsAuth ? 'required' : 'connected', localizations: { 'zh-CN': { displayName: 'Demo 助手', description: '本地化简介' } } }];
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const router = createMemoryRouter([{ path: '/capabilities/extensions', element: <ExtensionsPage embedded /> }], { initialEntries: ['/capabilities/extensions?tab=user&q=Demo'] });
  try {
    await act(async () => root.render(<RouterProvider router={router} />));
    const card = host.querySelector('article')!;
    expect(card.textContent).toContain('本地化简介');
    expect(card.textContent).not.toContain('Agent Plugin');
    const buttons = [...card.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    expect(buttons[1].textContent).toBe(needsAuth ? '去授权' : '查看详情');
    await act(async () => buttons[0].click());
    const target = router.state.location.pathname + router.state.location.search;
    expect(target).toBe(`/capabilities/extensions?tab=user&q=Demo&plugin=demo-id${needsAuth ? '&connect=1' : ''}`);
    await act(async () => router.navigate('/capabilities/extensions?tab=user&q=Demo'));
    await act(async () => (host.querySelectorAll('article button')[1] as HTMLButtonElement).click());
    expect(router.state.location.pathname + router.state.location.search).toBe(target);
  } finally { await act(async () => root.unmount()); router.dispose(); host.remove(); }
});
