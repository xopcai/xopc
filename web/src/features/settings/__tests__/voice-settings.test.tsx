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
    useGatewayStore.setState({ conversationId: 'test-session' });
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
    useGatewayStore.setState({ conversationId: undefined });
    useSettingsModeStore.setState({ mode: 'simple' });
  });

  function tab(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>('nav button')]
      .find((button) => button.textContent === label);
  }

  async function render(initialEntries = ['/']) {
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries }, createElement(VoiceSettingsPanel))));
  }

  async function openService() {
    expect(tab(v.experience.service)).toBeDefined();
    await act(async () => tab(v.experience.service)!.click());
    expect(container.textContent).toContain(v.stt.model);
    const choices = [...container.querySelectorAll('button')];
    expect(choices.some((button) => button.textContent?.includes('OpenAI'))).toBe(true);
    expect(choices.some((button) => button.textContent?.includes('Whisper'))).toBe(true);
  }

  it('uses three task-focused groups and keeps provider configuration accessible', async () => {
    await render();
    expect(container.querySelectorAll('nav button')).toHaveLength(3);
    expect(tab(v.experience.diagnostics)).toBeUndefined();
    expect(tab(v.experience.input)).toBeUndefined();
    expect(container.textContent).toContain(v.experience.defaultMode);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    await openService();
  });

  it('keeps the service panel open when switching from advanced to simple mode', async () => {
    useSettingsModeStore.setState({ mode: 'advanced' });
    await render();
    expect(tab(v.experience.devices)).toBeDefined();
    await openService();
    await act(async () => useSettingsModeStore.getState().setMode('simple'));
    expect(tab(v.experience.service)?.getAttribute('aria-pressed')).toBe('true');
    expect(tab(v.experience.diagnostics)).toBeUndefined();
    expect(container.textContent).toContain('Whisper');
  });

  it('shows own-key provider and model controls outside technical settings', async () => {
    await render();
    await act(async () => tab(v.experience.service)!.click());
    const provider = container.querySelector<HTMLButtonElement>(`button[aria-label="${v.stt.provider}"]`);
    expect(provider).not.toBeNull();
    expect(provider!.closest('details')).toBeNull();
    expect(container.textContent).toContain('Whisper');
    expect(container.textContent).not.toContain('XOPC 托管语音模型');
    expect(container.querySelector<HTMLInputElement>('input[value="alibaba"]')?.checked).toBe(true);
  });

  it('replaces the hosted catalog with Alibaba configuration when selecting an own key', async () => {
    mocks.responses.set('/api/config', { payload: { config: {
      stt: { enabled: true, provider: 'xopc-cloud' },
    } } });
    mocks.responses.set('/api/voice/stt-providers', { providers: [{
      id: 'alibaba', configured: false,
      fields: [{ key: 'model', label: 'Model', type: 'select', defaultValue: 'qwen-audio-3.1-asr-flash' }],
      models: [{ id: 'qwen-audio-3.1-asr-flash', name: 'Qwen ASR' }],
    }] });
    await render();
    await act(async () => tab(v.experience.service)!.click());
    expect(container.textContent).toContain('XOPC 托管语音模型');
    await act(async () => container.querySelector<HTMLInputElement>('input[value="alibaba"]')!.click());
    expect(container.textContent).not.toContain('XOPC 托管语音模型');
    const provider = container.querySelector<HTMLButtonElement>(`button[aria-label="${v.stt.provider}"]`);
    expect(provider!.textContent).toContain(v.stt.alibaba);
    expect(container.textContent).toContain('Qwen ASR');
    expect(provider!.closest('details')).toBeNull();
  });

  it('keeps readout configuration in a closed independent section', async () => {
    mocks.responses.set('/api/config', { payload: { config: {
      stt: { enabled: true, provider: 'alibaba' },
      tts: { enabled: true, provider: 'alibaba', trigger: 'inbound', providers: {
        alibaba: { model: 'qwen-tts', voice: 'Cherry' },
      } },
    } } });
    mocks.responses.set('/api/voice/providers', { providers: [{
      id: 'alibaba', configured: true,
      fields: [{ key: 'model', label: 'TTS model', type: 'select' }, { key: 'voice', label: 'Voice', type: 'select' }],
      diagnostics: { requiresApiKey: true },
      models: [{ id: 'qwen-tts', name: 'Qwen TTS' }],
      voices: [{ id: 'Cherry', name: 'Cherry' }],
    }] });
    await render();
    await act(async () => tab(v.experience.service)!.click());
    const readout = container.querySelector<HTMLDetailsElement>('[data-voice-section="readout-service"]');
    expect(readout?.open).toBe(false);
    expect(container.textContent).not.toContain('Qwen TTS');
    await act(async () => readout!.querySelector('summary')!.click());
    expect(readout?.open).toBe(true);
    expect(container.textContent).toContain('Qwen TTS');
    expect(container.textContent).toContain('Cherry');
  });

  it('keeps a custom input provider selected when enabling realtime voice', async () => {
    await render();
    const toggle = container.querySelector<HTMLInputElement>('input[role="switch"]');
    await act(async () => toggle!.click());
    expect(toggle!.checked).toBe(true);
    await act(async () => tab(v.experience.service)!.click());
    expect(container.querySelector<HTMLButtonElement>(`button[aria-label="${v.stt.provider}"]`)?.textContent).toContain('OpenAI');
    expect(container.querySelector<HTMLInputElement>('input[value="alibaba"]')?.checked).toBe(true);
    expect(container.textContent).not.toContain('XOPC 托管语音模型');
  });
  it('makes device checks available without entering advanced mode', async () => {
    await render();
    await act(async () => tab(v.experience.devices)!.click());
    expect(container.textContent).toContain(v.experience.microphone);
    expect(container.textContent).toContain(v.experience.dictationReady);
    expect(container.textContent).toContain(v.experience.configurationOnly);
    expect(useSettingsModeStore.getState().mode).toBe('simple');
  });

  it('shows only one shared Alibaba credential field in the primary service form', async () => {
    mocks.responses.set('/api/config', { payload: { config: {
      stt: { enabled: true, provider: 'alibaba', providers: { alibaba: { apiKey: '••••••' } } },
    } } });
    mocks.responses.set('/api/voice/stt-providers', { providers: [{
      id: 'alibaba', configured: true,
      fields: [{ key: 'apiKey', label: 'API Key', type: 'password' }, { key: 'baseUrl', label: 'Base URL', type: 'string' }],
    }] });
    await render();
    await act(async () => tab(v.experience.service)!.click());
    expect(container.querySelectorAll('#voice-stt-alibaba-api-key')).toHaveLength(1);
    expect(container.querySelector('#realtime-api-key')).toBeNull();
    const advanced = [...container.querySelectorAll('summary')].find(entry => entry.textContent === v.experience.providerOptions);
    expect(advanced?.closest('details')?.open).toBe(false);
    expect(container.textContent).not.toContain(v.experience.defaultMode);
  });

  it('opens the selected group from a shareable URL', async () => {
    await render(['/?voiceTab=devices']);
    expect(tab(v.experience.devices)?.getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain(v.experience.microphone);
  });
  it('offers unified cloud speech models and only streaming-compatible voices for assistant output', async () => {
    mocks.responses.set('/api/config', { payload: { config: {
      stt: { enabled: true, provider: 'xopc-cloud' },
    } } });
    const voice = {
      protocolVersion: 1, serviceVersion: 5, modes: ['speech', 'speech.stream'],
      transport: 'websocket-pcm', inputFormat: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      outputFormat: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
      turnDetection: [], bargeIn: false, tools: false, resumable: false,
      defaultVoice: 'default', voices: [
        { id: 'default', name: 'Shared voice', languages: ['zh'], modes: ['speech', 'speech.stream'] },
        { id: 'http-only', name: 'HTTP only voice', languages: ['zh'], modes: ['speech'] },
      ], limits: { maxFrameBytes: 65536, maxSessionSeconds: 3600 },
    };
    mocks.responses.set('/api/voice/catalog', {
      revision: 'test-revision', catalogVersion: 'test-version',
      selections: [{ mode: 'speech.stream', model: 'tts', voice: 'default' }],
      models: [{ id: 'tts', name: 'XOPC Cloud Speech', voice }],
    });
    await render();
    await act(async () => tab(v.experience.service)!.click());
    const outputLabel = [...container.querySelectorAll('label')].find(entry => entry.textContent?.startsWith('语音助手输出'));
    const modelControl = outputLabel!.querySelector('button')!;
    expect(modelControl.disabled).toBe(false);
    expect(modelControl.textContent).toContain('XOPC Cloud Speech');
    const voiceControl = outputLabel!.parentElement!.querySelectorAll('label')[1].querySelector('button')!;
    await act(async () => voiceControl.click());
    expect(document.body.textContent).toContain('Shared voice');
    expect(document.body.textContent).not.toContain('HTTP only voice');
  });
});
