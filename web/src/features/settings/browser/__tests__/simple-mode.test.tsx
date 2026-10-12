// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  update: vi.fn(),
  form: {
    enabled: true, driverKind: 'remote', headless: false, executablePath: '/custom/chromium',
    cdpEndpoint: 'http://localhost:9222', remoteProvider: 'browserbase', remoteApiKey: 'saved-key',
    remoteProjectId: 'project', remoteRegion: 'us-west', visualFallback: true,
    maxNodes: 180, maxCharacters: 12000, actionTimeoutMs: 30000, sessionTimeoutMs: 900000,
    maxSequenceLength: 5, allowedPrivateHosts: 'intranet.example', crossDomainNavigation: 'allow',
    consequentialActions: 'deny', uploads: 'deny',
  },
}));
vi.mock('../use-browser-settings-form', () => ({ useAgentDefaultsForm: () => ({ form: fixture.form, update: fixture.update }) }));
vi.mock('../browser-settings-route-layout', () => ({ AgentDefaultsRouteLayout: ({ children }: { children: ReactNode }) => children }));
vi.mock('../browser-status-panel', () => ({ BrowserStatusPanel: () => null }));

import { AgentBrowserSettingsPage } from '../browser-settings-page';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' });
  useSettingsModeStore.setState({ mode: 'simple' });
  fixture.update.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('retains remote connection credentials and authorization controls in simple mode', async () => {
  await act(async () => root.render(<MemoryRouter><AgentBrowserSettingsPage /></MemoryRouter>));
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('saved-key');
  expect(container.textContent).toContain('File uploads');
  expect(container.textContent).toContain('Consequential actions');
  expect(container.querySelector('input[type="number"]')).toBeNull();
  expect(fixture.update).not.toHaveBeenCalled();
  const reveal = [...container.querySelectorAll('button')].find(button => button.textContent === 'Show advanced settings')!;
  await act(async () => reveal.click());
  expect(container.querySelector('input[type="number"]')).not.toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('saved-key');
  expect(fixture.update).not.toHaveBeenCalled();
});
