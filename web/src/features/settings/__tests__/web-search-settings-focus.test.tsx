// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { WebSearchSettingsPanel } from '../web-search-settings';
import { messages } from '@/i18n/messages';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

vi.mock('@/features/gateway/gateway-config-swr', () => {
  const data = { payload: { config: { tools: { web: { search: { providers: [
    { type: 'searxng', url: '', apiKey: '' }, { type: 'searxng', url: '', apiKey: '' },
  ] } } } } } };
  return { useGatewayConfigSwr: () => ({ data, isLoading: false, mutate: vi.fn() }) };
});
vi.mock('@/stores/gateway-store', () => ({ useGatewayStore: () => 'token' }));
vi.mock('@/stores/locale-store', () => ({ useLocaleStore: () => 'en' }));
vi.mock('@/lib/use-autosave', () => ({ useAutosave: () => ({ status: 'idle', onBlurCapture: vi.fn() }) }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useSettingsModeStore.setState({ mode: 'simple' }); });

it('keeps URL and API key focus while editing duplicate search provider rows', async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<WebSearchSettingsPanel />));
  const url = container.querySelector<HTMLInputElement>('input[type="url"]')!;
  const secret = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  for (const [input, value] of [[url, 'https://search.example'], [secret, 'test-key']] as const) {
    input.focus();
    for (const char of value) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, input.value + char);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(document.activeElement).toBe(input);
      expect(input.isConnected).toBe(true);
    }
    expect(input.value).toBe(value);
  }
  const labels = messages('en').webSearchSettings;
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(labels.addProvider))!.click());
  expect(container.querySelector('input[type="url"]')).toBe(url);
});


it('allows clearing the result count completely before entering a replacement', async () => {
  useSettingsModeStore.setState({ mode: 'advanced' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<WebSearchSettingsPanel />));
  const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
  expect(input.value).toBe('5');
  input.focus();
  for (const text of ['', '2', '25', '2', '']) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe(text);
    expect(document.activeElement).toBe(input);
  }
  await act(async () => input.blur());
  expect(input.value).toBe('2');
});
