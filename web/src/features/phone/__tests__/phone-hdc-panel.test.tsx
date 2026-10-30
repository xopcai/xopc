// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { expect, it, vi } from 'vitest';

vi.mock('../use-phone-video', () => ({ usePhoneVideo: vi.fn(() => ({ status: 'connecting', fps: 0, frames: 0, cancel: () => {}, pointer: () => {}, retry: () => {} })) }));
vi.mock('../phone-live-api', async importOriginal => ({ ...await importOriginal<typeof import('../phone-live-api')>(), phoneFrame: vi.fn() }));
import { PhoneLivePanel } from '../phone-live-panel';
import { phoneFrame, type PhoneLiveState } from '../phone-live-api';
import { usePhoneVideo } from '../use-phone-video';
import { useLocaleStore } from '@/stores/locale-store';

it('starts HarmonyOS snapshots immediately without trying a video connection and disables automatic typing', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'zh' });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:hdc'), revokeObjectURL: vi.fn() });
  vi.mocked(phoneFrame).mockResolvedValue({ blob: new Blob(['png']), width: 100, height: 200, seq: 1, capturedAt: Date.now() });
  const state: PhoneLiveState = { media: 'snapshot', textInput: 'manual', report: { sessionId: 'phone', deviceName: 'Huawei', agentId: 'main', modelRef: 'test/model', status: 'paused', mode: 'control', controlOwner: 'human', handoff: 'idle', controlEpoch: 2, actions: 0, modelRequests: 0, updatedAt: Date.now() }, ownControl: true, frame: null };
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><PhoneLivePanel conversationId="test" state={state} onChange={() => {}} /></SWRConfig>));
    expect(usePhoneVideo).toHaveBeenCalledWith('test', 'phone', false, expect.anything(), 2, true, 8000);
    expect(phoneFrame).toHaveBeenCalled();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:hdc');
    expect((container.querySelector('[aria-label="手机输入"]') as HTMLButtonElement).disabled).toBe(true);
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); }
});

it('uses the existing video canvas and native startup timeout when HDC video is available', async () => {
  vi.mocked(phoneFrame).mockClear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const state: PhoneLiveState = { media: 'hdc-h264', textInput: 'manual', report: { sessionId: 'video', deviceName: 'Huawei', agentId: 'main', modelRef: 'test/model', status: 'paused', mode: 'control', controlOwner: 'human', handoff: 'idle', controlEpoch: 3, actions: 0, modelRequests: 0, updatedAt: Date.now() }, ownControl: true, frame: null };
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><PhoneLivePanel conversationId="native" state={state} onChange={() => {}} /></SWRConfig>));
    expect(usePhoneVideo).toHaveBeenLastCalledWith('native', 'video', true, expect.anything(), 3, true, 35000);
    expect(container.querySelector('canvas')).not.toBeNull(); expect(phoneFrame).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); }
});
