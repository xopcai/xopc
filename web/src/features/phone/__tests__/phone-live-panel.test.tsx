// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../phone-live-api', async importOriginal => ({ ...await importOriginal<typeof import('../phone-live-api')>(), phoneFrame: vi.fn(), controlPhone: vi.fn() }));
import { PhoneLivePanel } from '../phone-live-panel';
import { controlPhone, phoneFrame, type PhoneLiveState } from '../phone-live-api';
import { useLocaleStore } from '@/stores/locale-store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('keeps preview refreshing while a manual input acknowledgement is pending', async () => {
  vi.useFakeTimers(); useLocaleStore.setState({ language: 'zh' });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:live'), revokeObjectURL: vi.fn() });
  const state: PhoneLiveState = { report: { sessionId: 'phone', deviceName: 'Emulator', agentId: 'main', modelRef: 'phone/model', status: 'paused', mode: 'control', controlOwner: 'human', controlEpoch: 2, handoff: 'idle', actions: 0, modelRequests: 0, updatedAt: Date.now() }, ownControl: true, frame: null };
  let finish!: (value: PhoneLiveState) => void;
  vi.mocked(controlPhone).mockImplementation(async (_id, _state, op) => op === 'input' ? new Promise(resolve => { finish = resolve; }) : state);
  vi.mocked(phoneFrame).mockImplementation(async () => ({ blob: new Blob(['pixels']), width: 100, height: 200, seq: 1, capturedAt: Date.now() }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<PhoneLivePanel conversationId="conversation" state={state} onChange={vi.fn()} />));
  const before = vi.mocked(phoneFrame).mock.calls.length;
  await act(async () => (container!.querySelector('[aria-label="手机返回"]') as HTMLButtonElement).click());
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(vi.mocked(phoneFrame).mock.calls.length).toBeGreaterThan(before);
  expect(controlPhone).toHaveBeenCalledWith('conversation', state, 'input', expect.objectContaining({ action: { type: 'back' } }));
  await act(async () => finish(state));
});
