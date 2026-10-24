// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('@/lib/fetch', () => api);
vi.mock('@/stores/gateway-store', () => ({ useGatewayStore: (select: (state: { conversationId: string }) => unknown) =>
  select({ conversationId: 'browser-test' }) }));
vi.mock('@/features/personal-agent/personal-proactivity-setting', () => ({ PersonalProactivitySetting: () => null }));
vi.mock('@/features/extensions/extension-settings-nav', () => ({ ExtensionSettingsNav: () => null }));
vi.mock('@/components/shell/settings-mode-toggle', () => ({ SettingsModeToggle: () => null }));
vi.mock('@/lib/use-media-query', () => ({ useMediaQuery: () => false }));

import { SettingsPageLayout } from '@/components/shell/settings-page-layout';
import { PersonalSettingsPanel } from '../personal-settings-panel';
import { useLocaleStore } from '@/stores/locale-store';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const initialLanguage = useLocaleStore.getState().language;

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useLocaleStore.setState({ language: initialLanguage });
  vi.clearAllMocks();
});

async function render(language: 'zh' | 'en', displayName?: string) {
  useLocaleStore.setState({ language });
  api.fetchJson.mockResolvedValue({ ok: true, payload: displayName ? { agentId: 'ada', displayName, appearance: 'loopi' } : null });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter initialEntries={['/settings/personal']}>
        <Routes><Route element={<SettingsPageLayout />}><Route path="/settings/personal" element={<PersonalSettingsPanel />} /></Route></Routes>
      </MemoryRouter>
    </SWRConfig>,
  ));
}

function expectName(name: string) {
  expect(container.querySelector('a[href="/settings/personal"]')?.textContent).toBe(name);
  const headings = [...container.querySelectorAll('h1')];
  expect(headings).toHaveLength(2);
  expect(headings.map(heading => heading.textContent)).toEqual([name, name]);
  expect(container.textContent).not.toContain('Personal AI');
}

it('defaults the settings navigation and page titles to Ada', async () => {
  await render('zh');
  expectName('Ada');
  expect(container.textContent).toContain('设置 Ada 主动联系你的方式和免打扰时段。');
});

it.each(['zh', 'en'] as const)('keeps navigation, mobile title and description in sync after a rename (%s)', async language => {
  await render(language, 'Joyce');
  expectName('Joyce');
  await act(async () => {
    window.dispatchEvent(new CustomEvent('personal-agent-updated', {
      detail: { agentId: 'ada', displayName: 'Nova', appearance: 'loopi' },
    }));
  });
  expectName('Nova');
  expect(container.textContent).toContain(language === 'zh'
    ? '设置 Nova 主动联系你的方式和免打扰时段。'
    : 'Manage proactive messages from Nova and quiet hours.');
});
