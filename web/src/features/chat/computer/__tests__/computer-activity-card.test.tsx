// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComputerPreviewFrame, ComputerPreviewState } from '@xopcai/computer-control-contract';
import { useLocaleStore } from '@/stores/locale-store';
import { ComputerActivityCard } from '../computer-activity-card';

const state: ComputerPreviewState = { previewId: 'preview', conversationId: 'one', runId: 'run', computerSessionId: 'session',
  brokerEpoch: 'broker', targetEpoch: 1, appName: 'Fixture', status: 'available' };
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
let receive: (message: ComputerPreviewFrame | ComputerPreviewState) => void | Promise<void>;
let changed: (state: ComputerPreviewState) => void;
const api = { current: vi.fn(), onState: vi.fn(), subscribe: vi.fn(), setPreset: vi.fn(), unsubscribe: vi.fn(), stopControl: vi.fn() };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ language: 'en' });
  vi.resetAllMocks();
  api.current.mockImplementation(async id => id === 'one' ? state : undefined);
  api.onState.mockImplementation(callback => { changed = callback; return vi.fn(); });
  api.subscribe.mockImplementation(async (_input, callback) => { receive = callback; return { subscriptionId: 'subscription' }; });
  api.setPreset.mockResolvedValue(undefined); api.unsubscribe.mockResolvedValue(undefined); api.stopControl.mockResolvedValue(undefined);
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { computer: { preview: api } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('pauses a collapsed preview and releases the subscription when switching conversations', async () => {
  await act(async () => root.render(<ComputerActivityCard conversationId="one" />));
  expect(api.subscribe).toHaveBeenCalledExactlyOnceWith({ conversationId: 'one', runId: 'run', preset: 'compact' }, expect.any(Function));
  await act(async () => (container.querySelector('[aria-label="Hide preview"]') as HTMLButtonElement).click());
  expect(api.setPreset).toHaveBeenLastCalledWith('subscription', 'paused');
  await act(async () => root.render(<ComputerActivityCard conversationId="two" />));
  expect(api.unsubscribe).toHaveBeenCalledWith('subscription'); expect(container.textContent).toBe('');
  await act(async () => changed({ ...state, status: 'live' }));
  expect(container.textContent).toBe('');
});

it('only announces takeover after the host confirms control has stopped', async () => {
  await act(async () => root.render(<ComputerActivityCard conversationId="one" />));
  api.stopControl.mockRejectedValueOnce(new Error('stop unconfirmed'));
  const stop = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Stop and take over')!;
  await act(async () => stop().click());
  expect(container.textContent).toContain('Stop is unconfirmed');
  expect(container.textContent).not.toContain('Stopped — ready for you');
  await act(async () => stop().click());
  expect(container.textContent).toContain('Stopped — ready for you');
});

it('does not paint a decoded frame after the conversation has changed', async () => {
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as any);
  let finish!: (bitmap: ImageBitmap) => void;
  vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>(resolve => { finish = resolve; })));
  await act(async () => root.render(<ComputerActivityCard conversationId="one" />));
  const pending = receive({ version: 1, previewId: 'preview', targetEpoch: 1, streamEpoch: 1, sequence: 1,
    width: 10, height: 10, mimeType: 'image/jpeg', bytes: new Uint8Array([1]) });
  await act(async () => root.render(<ComputerActivityCard conversationId="two" />));
  const bitmap = { width: 10, height: 10, close: vi.fn() };
  await act(async () => { finish(bitmap); await pending; });
  expect(draw).not.toHaveBeenCalled(); expect(bitmap.close).toHaveBeenCalledOnce();
});
