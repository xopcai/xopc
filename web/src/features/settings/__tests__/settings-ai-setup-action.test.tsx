// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { SettingsPageHeader } from '../settings-page-header';
import { useLocaleStore } from '@/stores/locale-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it.each([
  ['phone', 'configure-phone', 'zh', 'Phone Use'],
  ['browser', 'configure-xopc', 'en', 'Browser Use'],
] as const)('routes the %s header action into its supported configuration conversation', async (target, scene, language, subject) => {
  useLocaleStore.setState({ language });
  await act(async () => root.render(<MemoryRouter><SettingsPageHeader title="Settings" aiSetup={target} actions={<span>Saved</span>} /></MemoryRouter>));
  const link = container.querySelector('header a')!;
  expect(link.textContent).toBe(language === 'zh' ? 'AI 配置' : 'AI setup');
  const url = new URL(link.getAttribute('href')!, 'http://localhost');
  expect(url.pathname).toBe('/chat/new');
  expect(url.searchParams.get('skill')).toBe('configure-xopc');
  expect(url.searchParams.get('scene')).toBe(scene);
  expect(url.searchParams.get('draft')).toContain(subject);
  expect(url.searchParams.get('autoSend')).toBe('1');
  expect(container.querySelectorAll('a')).toHaveLength(1);
  expect(container.textContent).toContain('Saved');
});

it('leaves ordinary settings headers without an AI configuration entry', async () => {
  await act(async () => root.render(<SettingsPageHeader title="Settings" />));
  expect(container.querySelector('a')).toBeNull();
});
