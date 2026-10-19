// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import type { ExtensionApiRow } from '@/features/extensions/types';
import { InstalledPluginConnectionRow, pluginHasConnection } from '../components/installed-plugin-connection-row';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; });
const plugin = (changes: Partial<ExtensionApiRow> = {}): ExtensionApiRow => ({
  id: 'plugin:example', pluginId: 'example', format: 'agent-plugin', name: 'example', source: 'agent-plugin',
  active: true, activationEligible: true, hasUi: false, authorizationStatus: 'not_required',
  components: { skills: [], mcp: [{ name: 'data', id: 'data', type: 'stdio' }] }, ...changes,
});

it('omits local unauthenticated tools and recognizes declared CLI and remote connections', () => {
  expect(pluginHasConnection(plugin())).toBe(false);
  expect(pluginHasConnection(plugin({ authorizationStatus: 'required' }))).toBe(true);
  expect(pluginHasConnection(plugin({ setup: { authorizations: [{ id: 'account', title: 'Account', servers: ['data'], methods: [] }], userConfig: {}, tasks: [] } }))).toBe(true);
  expect(pluginHasConnection(plugin({ components: { skills: [], mcp: [{ name: 'one', id: 'one', type: 'http' }, { name: 'two', id: 'two', type: 'http' }] } }))).toBe(true);
  expect(pluginHasConnection(plugin({ format: 'native-extension' }))).toBe(false);
});

it.each(['connected', 'required'] as const)('routes %s accounts to plugin setup without inventing credential fields', async authorizationStatus => {
  const host = document.createElement('div'); root = createRoot(host); const onOpen = vi.fn();
  await act(async () => root!.render(<InstalledPluginConnectionRow extension={plugin({ authorizationStatus })} language="zh" onOpen={onOpen} />));
  expect(host.textContent).toContain(authorizationStatus === 'connected' ? '已连接' : '需要授权');
  expect(host.textContent).not.toMatch(/API_KEY|stdio|xopc mcp|字段名|前缀|保存密钥/);
  expect(host.querySelectorAll('input')).toHaveLength(0);
  await act(async () => host.querySelector('button')!.click()); expect(onOpen).toHaveBeenCalledOnce();
});
