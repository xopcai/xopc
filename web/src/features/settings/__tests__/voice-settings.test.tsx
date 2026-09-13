// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

const mocks = vi.hoisted(() => ({ responses: new Map<string, unknown>() }));
vi.mock('swr', () => ({
  default: (key: unknown) => ({ data: mocks.responses.get(String(key)), mutate: vi.fn() }),
  mutate: vi.fn(),
}));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));

import { VoiceSettingsPanel } from '../voice-settings';

describe('voice settings navigation', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const v = messages('zh').voiceSettings;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    useGatewayStore.setState({ sessionKey: 'test-session' });
    useLocaleStore.setState({ language: 'zh' });
    useSettingsModeStore.setState({ mode: 'simple' });
    mocks.responses.set('/api/config', { payload: { config: {
      stt: { enabled: true, provider: 'openai', providers: { openai: { model: 'whisper-1' } } },
    } } });
    mocks.responses.set('/api/voice/models', {
      stt: { openai: [{ id: 'whisper-1', name: 'Whisper' }] }, tts: {}, ttsVoices: {},
    });
    mocks.responses.set('/api/voice/providers', { providers: [] });
    mocks.responses.set('/api/voice/stt-providers', { providers: [{
      id: 'openai', configured: true,
      fields: [{ key: 'model', label: 'STT model', type: 'string' }],
    }] });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    mocks.responses.clear();
    useGatewayStore.setState({ sessionKey: undefined });
    useSettingsModeStore.setState({ mode: 'simple' });
  });

  function tab(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>('nav button')]
      .find((button) => button.textContent === label);
  }

  async function render() {
    await act(async () => root.render(createElement(MemoryRouter, null, createElement(VoiceSettingsPanel))));
  }

  async function openService() {
    expect(tab(v.experience.service)).toBeDefined();
    await act(async () => tab(v.experience.service)!.click());
    const summary = [...container.querySelectorAll('summary')]
      .find((entry) => entry.textContent === v.experience.technical);
    expect(summary).toBeDefined();
    await act(async () => summary!.click());
    expect(summary!.parentElement!.hasAttribute('open')).toBe(true);
    expect(summary!.parentElement!.textContent).toContain('STT model');
    const choices = [...summary!.parentElement!.querySelectorAll('button')];
    expect(choices.some((button) => button.textContent?.includes('OpenAI'))).toBe(true);
    expect(choices.some((button) => button.textContent?.includes('Whisper'))).toBe(true);
  }

  it('keeps service and the configured model accessible in simple mode', async () => {
    await render();
    expect(tab(v.experience.diagnostics)).toBeUndefined();
    await openService();
  });

  it('keeps the service panel open when switching from advanced to simple mode', async () => {
    useSettingsModeStore.setState({ mode: 'advanced' });
    await render();
    expect(tab(v.experience.diagnostics)).toBeDefined();
    await openService();
    await act(async () => useSettingsModeStore.getState().setMode('simple'));
    expect(tab(v.experience.service)?.getAttribute('aria-pressed')).toBe('true');
    expect(tab(v.experience.diagnostics)).toBeUndefined();
    expect(container.textContent).toContain('Whisper');
  });
});
