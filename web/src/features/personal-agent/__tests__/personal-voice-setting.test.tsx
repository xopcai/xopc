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

async function render() {
  await act(async () => root.render(<MemoryRouter><PersonalVoiceSetting record={{ voicePreference: { provider: 'dashscope', model: 'qwen', voice: 'mia' } } as PersonalAgent} zh={false} onSelectVoice={select} /></MemoryRouter>));
}

async function choose(label: string) {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Choose call voice"]')?.click());
  await act(async () => Array.from(document.querySelectorAll('button')).find(button => button.textContent === label)?.click());
}

describe('Personal AI call voice selector', () => {
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
