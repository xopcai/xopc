// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { ResourceUnavailable } from './resource-unavailable';
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: (select: (state: { language: string }) => unknown) => select({ language: 'zh' }) }));
it.each(['project', 'app', 'plugin', 'plugin-page', 'plugin-settings', 'desktop'] as const)('has a localized explanation and an exit from a cold %s deep link', kind => {
  const html = renderToStaticMarkup(<MemoryRouter><ResourceUnavailable kind={kind} backTo="/capabilities/extensions" /></MemoryRouter>);
  expect(html).toContain('href="/capabilities/extensions"');
  expect(html).toContain('返回列表');
  expect(html).not.toMatch(/not found|has no UI/);
});
