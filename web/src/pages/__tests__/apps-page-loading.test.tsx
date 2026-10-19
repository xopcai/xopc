// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';

vi.mock('@/features/extensions/extension-provider', () => ({
  useExtensions: () => [],
  useExtensionsLoading: () => true,
}));
vi.mock('@/features/extensions/extension-marketplace', () => ({
  ExtensionMarketplacePanel: () => <div>Marketplace content</div>,
}));
vi.mock('@/features/extensions/agent-plugin-dialog', () => ({ AgentPluginDialog: () => null }));

import { ExtensionsPage } from '@/pages/apps-page';

it('keeps tabs usable while installed extensions load', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/capabilities/extensions?tab=builtin']}>
        <ExtensionsPage embedded />
      </MemoryRouter>,
    ));
    const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs()).toHaveLength(3);
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => tabs()[0].click());
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => tabs()[1].click());
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(container.textContent).toContain('Marketplace content');
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
