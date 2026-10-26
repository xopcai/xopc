// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { pluginDetailPath } from '../capability-links';

const state = vi.hoisted(() => ({ mounts: 0 }));
vi.mock('@/features/capabilities/capability-header-actions', () => ({ CapabilityHeaderActions: () => null }));
function List() {
  useEffect(() => { state.mounts++; }, []);
  return <p>Original filtered list</p>;
}
vi.mock('@/pages/apps-page', () => ({ ExtensionsPage: () => <List /> }));
vi.mock('@/features/skills/skills-page', () => ({ SkillsPage: () => <List /> }));
vi.mock('@/features/connectors/connectors-page', () => ({ ConnectorsPage: () => <List /> }));
vi.mock('@/features/extensions/plugin-details-dialog', () => ({
  PluginDetailsDialog: ({ pluginId, initialConnect, onClose }: { pluginId: string; initialConnect: boolean; onClose: () => void }) => <div role="dialog" aria-label={pluginId}><span>{initialConnect ? 'Connect account' : 'Details'}</span><button onClick={onClose}>Close details</button></div>,
}));

import { CapabilitiesPage } from '../capabilities-page';

it.each([
  ['/capabilities/extensions?tab=user&q=CSV', 'installed'],
  ['/capabilities/skills?tab=installed&source=plugin&q=CSV', 'skills'],
  ['/capabilities/connectors?tab=connected&q=CSV', 'connections'],
] as const)('opens and closes details over %s without remounting the list', async (entry, from) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const router = createMemoryRouter([{ path: '/capabilities/:section/:detailId?', element: <CapabilitiesPage /> }], { initialEntries: [entry] });
  state.mounts = 0;
  try {
    await act(async () => root.render(<RouterProvider router={router} />));
    await act(async () => router.navigate(pluginDetailPath('demo', from, true, entry)));
    expect(host.textContent).toContain('Original filtered list');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Connect account');
    expect(state.mounts).toBe(1);
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(router.state.location.pathname + router.state.location.search).toBe(entry);
    expect(state.mounts).toBe(1);
    await act(async () => router.navigate(pluginDetailPath('demo', from, false, entry)));
    await act(async () => router.navigate(-1));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(state.mounts).toBe(1);
  } finally { await act(async () => root.unmount()); router.dispose(); host.remove(); }
});

it('opens an existing detail deep link as a modal over its originating list', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const router = createMemoryRouter([{ path: '/capabilities/:section/:detailId?', element: <CapabilitiesPage /> }], { initialEntries: ['/capabilities/extensions/demo?from=connections&connect=1'] });
  try {
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(router.state.location.pathname).toBe('/capabilities/connectors');
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('demo');
    expect(host.textContent).toContain('Original filtered list');
  } finally { await act(async () => root.unmount()); router.dispose(); host.remove(); }
});
