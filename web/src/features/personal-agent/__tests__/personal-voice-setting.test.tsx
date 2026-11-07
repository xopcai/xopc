// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: vi.fn(), voices: vi.fn(), preview: vi.fn(), start: vi.fn(), enqueue: vi.fn(), close: vi.fn() }));
vi.mock('@/features/settings/voice-config-api', () => ({ fetchRealtimeVoiceStatus: mocks.status, fetchTtsVoices: mocks.voices, previewRealtimeVoice: mocks.preview }));
vi.mock('@/features/voice/realtime/pcm-player', () => ({ PcmPlayer: class { start = mocks.start; enqueue = mocks.enqueue; close = mocks.close; } }));

import { PersonalVoiceSetting } from '../personal-voice-setting';
import type { PersonalAgent } from '../personal-page';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const select = vi.fn();
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  mocks.status.mockResolvedValue({ enabled: true, tts: { provider: 'dashscope', model: 'qwen' } });
  mocks.voices.mockResolvedValue([{ id: 'mia', name: 'Mia', description: 'Warm voice' }, { id: 'kai', name: 'Kai', style: 'Calm voice' }]);
  mocks.preview.mockResolvedValue(new ArrayBuffer(8)); mocks.start.mockResolvedValue(undefined); mocks.close.mockResolvedValue(undefined);
  select.mockResolvedValue(true);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

async function render(zh = false) {
  await act(async () => root.render(<MemoryRouter><PersonalVoiceSetting record={{ voicePreference: { provider: 'dashscope', model: 'qwen', voice: 'mia' } } as PersonalAgent} zh={zh} onSelectVoice={select} /></MemoryRouter>));
}

async function choose(label: string) {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Choose call voice"]')?.click());
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent === label)?.click());
}

describe('Personal AI call voice selector', () => {
  it('shows a localized unsupported-voice hint and keeps the saved selection after preview failure', async () => {
    mocks.preview.mockRejectedValueOnce(Object.assign(new Error('Selected voice unavailable'), {
      body: { error: { code: 'unsupported_voice' } },
    }));
    await render(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="试听Mia"]')?.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('请刷新语音目录');
    expect(container.querySelector('[aria-label="选择通话音色"]')?.textContent).toContain('Mia');
    expect(mocks.close).toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
  it('shows the greeting switch only when the Gateway advertises support', async () => {
    const onGreetingChange = vi.fn(async () => true);
    mocks.status.mockResolvedValue({ enabled: true, openingGreeting: true, tts: { provider: 'dashscope', model: 'qwen' } });
    await act(async () => root.render(<MemoryRouter><PersonalVoiceSetting record={{ voicePreference: { provider: 'dashscope', model: 'qwen', voice: 'mia' } } as PersonalAgent} zh={false}
      onSelectVoice={select} onGreetingChange={onGreetingChange} /></MemoryRouter>));
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(toggle?.checked).toBe(true);
    await act(async () => toggle?.click());
    expect(onGreetingChange).toHaveBeenCalledWith(false);
  });

  it('saves the greeting switch independently of the voice selector and restores it on failure', async () => {
    let resolveSave!: (saved: boolean) => void;
    const save = new Promise<boolean>(resolve => { resolveSave = resolve; });
    const onGreetingChange = vi.fn(() => save);
    mocks.status.mockResolvedValue({ enabled: true, openingGreeting: true, tts: { provider: 'dashscope', model: 'qwen' } });
    await act(async () => root.render(<MemoryRouter><PersonalVoiceSetting record={{ voicePreference: { provider: 'dashscope', model: 'qwen', voice: 'mia' } } as PersonalAgent}
      zh={false} onSelectVoice={select} onGreetingChange={onGreetingChange} /></MemoryRouter>));
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const voice = container.querySelector<HTMLButtonElement>('[aria-label="Choose call voice"]')!;
    await act(async () => toggle.click());
    expect(toggle.checked).toBe(false);
    expect(voice.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Preview Mia"]')?.disabled).toBe(false);
    await act(async () => resolveSave(false));
    expect(toggle.checked).toBe(true);
    expect(voice.disabled).toBe(false);
  });

  it('shows the selected voice compactly and saves a dropdown selection', async () => {
    await render();
    expect(container.querySelector('[aria-label="Choose call voice"]')?.textContent).toContain('Mia');
    expect(container.textContent).toContain('Warm voice');
    expect(container.textContent).not.toContain('Kai');
    await choose('Kai');
    expect(select).toHaveBeenCalledWith({ provider: 'dashscope', model: 'qwen', voice: 'kai' });
    expect(container.textContent).toContain('Calm voice');
  });

  it('allows previewing and stopping the current voice without changing the selection', async () => {
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Preview Mia"]')?.click());
    expect(mocks.preview).toHaveBeenCalledWith(expect.any(AbortSignal), 'mia');
    expect(mocks.enqueue).toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Stop preview"]')?.click());
    expect(mocks.close).toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Preview Mia"]')).not.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('stops preview when its panel becomes inactive and retains the loaded voices', async () => {
    await render();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Preview Mia"]')?.click());
    const signal = mocks.preview.mock.calls[0]![0] as AbortSignal;
    await act(async () => root.render(<MemoryRouter><PersonalVoiceSetting record={{ voicePreference: { provider: 'dashscope', model: 'qwen', voice: 'mia' } } as PersonalAgent}
      zh={false} active={false} onSelectVoice={select} /></MemoryRouter>));
    expect(signal.aborted).toBe(true);
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.voices).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="Choose call voice"]')?.textContent).toContain('Mia');
  });

  it('can restore the default voice', async () => {
    await render(); await choose('Default voice');
    expect(select).toHaveBeenCalledWith(null);
    expect(container.textContent).toContain('Uses the voice service');
  });

  it('restores the previous selection if saving fails', async () => {
    select.mockRejectedValueOnce(new Error('Save failed'));
    await render(); await choose('Kai');
    expect(container.querySelector('[aria-label="Choose call voice"]')?.textContent).toContain('Mia');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Save failed');
  });
});
