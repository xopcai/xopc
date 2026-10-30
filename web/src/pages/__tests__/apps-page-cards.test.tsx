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

it.each(['required', 'connected', 'not_required', undefined] as const)('card action respects authorization status %s', async authorizationStatus => {
  const needsAuth = authorizationStatus === 'required' || authorizationStatus === undefined;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'zh' });
  fixtures.extensions = [{ id: 'demo', pluginId: 'demo-id', format: 'agent-plugin', name: 'Demo', description: 'Original description', version: '1.0.0', source: 'global', active: true, hasUi: false, authorizationStatus, ...(authorizationStatus === undefined ? { setup: { authorizations: [{ id: 'demo', title: 'Demo', servers: ['demo'], methods: [{ id: 'oauth', title: 'Connect', type: 'oauth' as const }] }], userConfig: {}, tasks: [] } } : {}), localizations: { 'zh-CN': { displayName: 'Demo 助手', description: '本地化简介' } } }];
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const router = createMemoryRouter([{ path: '/capabilities/extensions', element: <ExtensionsPage embedded /> }, { path: '/chat/new', element: <p>Chat draft</p> }], { initialEntries: ['/capabilities/extensions?tab=user&q=Demo'] });
  try {
    await act(async () => root.render(<RouterProvider router={router} />));
    const tabs = host.querySelector('[aria-label="插件分区"]');
    expect(tabs?.querySelector('[role="tab"]')?.textContent).toContain('已安装');
    const card = host.querySelector('article')!;
    expect(card.textContent).toContain('本地化简介');
    expect(card.textContent).not.toContain('Agent Plugin');
    const buttons = [...card.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    expect(buttons[1].textContent).toBe(needsAuth ? '去授权' : '开始使用');
    await act(async () => buttons[0].click());
    const target = router.state.location.pathname + router.state.location.search;
    expect(target).toBe('/capabilities/extensions?tab=user&q=Demo&plugin=demo-id');
    await act(async () => router.navigate('/capabilities/extensions?tab=user&q=Demo'));
    await act(async () => (host.querySelectorAll('article button')[1] as HTMLButtonElement).click());
    if (needsAuth) expect(router.state.location.pathname + router.state.location.search).toBe(target + '&connect=1');
    else {
      expect(router.state.location.pathname).toBe('/chat/new');
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get('draft')).toContain('"type":"plugin","id":"demo-id","name":"Demo 助手"');
      expect(params.get('draft')).toContain('目前只介绍用法，不执行实际任务');
      expect(params.get('projectScope')).toBe('none');
      expect(params.has('plugin')).toBe(false);
    }
  } finally { await act(async () => root.unmount()); router.dispose(); host.remove(); }
});
