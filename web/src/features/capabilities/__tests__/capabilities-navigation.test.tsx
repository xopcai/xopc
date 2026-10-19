// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const pendingModule = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
});

vi.mock('@/features/capabilities/capability-header-actions', () => ({ CapabilityHeaderActions: () => null }));
vi.mock('@/features/skills/skills-page', () => ({ SkillsPage: () => <p>Skills content</p> }));
vi.mock('@/pages/apps-page', async () => {
  await pendingModule.promise;
  return { ExtensionsPage: () => <p>Extensions content</p> };
});

import { CapabilitiesPage } from '@/features/capabilities/capabilities-page';

function Header() {
  const main = usePageHeaderStore(state => state.main);
  return <header>{main}</header>;
}

it('commits the target section and skeleton while its module is still loading', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const router = createMemoryRouter([
    { path: '/capabilities/:section', element: <><CapabilitiesPage /><Header /></> },
  ], { initialEntries: ['/capabilities/skills'] });

  try {
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(container.textContent).toContain('Skills content');

    await act(async () => { await router.navigate('/capabilities/extensions'); });
    expect(container.querySelector('header h1')?.textContent).toBe('Plugins');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Skills content');
    expect(container.textContent).not.toContain('Extensions content');

    await act(async () => { pendingModule.resolve(); });
    expect(container.textContent).toContain('Extensions content');
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  } finally {
    await act(async () => { pendingModule.resolve(); root.unmount(); });
    router.dispose();
    container.remove();
    usePageHeaderStore.getState().clearPageHeader();
  }
});
