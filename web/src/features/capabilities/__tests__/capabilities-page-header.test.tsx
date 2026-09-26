// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

vi.mock('@/features/capabilities/capability-header-actions', () => ({
  CapabilityHeaderActions: () => null,
}));
vi.mock('@/features/skills/skills-page', () => ({ SkillsPage: () => null }));
vi.mock('@/features/connectors/connectors-page', () => ({ ConnectorsPage: () => null }));
vi.mock('@/pages/apps-page', () => ({ ExtensionsPage: () => null }));
vi.mock('@/features/settings/agents', () => ({ AgentsSettingsPanel: () => null }));
vi.mock('@/features/settings/channels', () => ({ ChannelsSettingsPanel: () => null }));

import { CapabilitiesPage } from '@/features/capabilities/capabilities-page';

function HeaderMain() {
  const main = usePageHeaderStore((state) => state.main);
  return <header>{main}</header>;
}

describe('CapabilitiesPage header', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useLocaleStore.setState({ language: 'en' });
    usePageHeaderStore.getState().clearPageHeader();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    usePageHeaderStore.getState().clearPageHeader();
  });

  it.each([
    ['agents', 'Agents'],
    ['connectors', 'Connections'],
    ['channels', 'Channels'],
    ['extensions', 'Extensions'],
  ])('shows the %s section title in the app header', async (section, title) => {
    await act(async () => root.render(
      <MemoryRouter initialEntries={[`/capabilities/${section}`]}>
        <Routes>
          <Route
            path="/capabilities/:section?/:detailId?"
            element={<><CapabilitiesPage /><HeaderMain /></>}
          />
        </Routes>
      </MemoryRouter>,
    ));

    expect(container.querySelector('header h1')?.textContent).toBe(title);
  });
});
