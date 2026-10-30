// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComputerPreviewFrame, ComputerPreviewState } from '@xopcai/computer-control-contract';
import { useLocaleStore } from '@/stores/locale-store';
import { ComputerActivityCard } from '../computer-activity-card';
import { ComputerChatButton } from '../computer-chat-button';

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
  const listeners = new Set<(state: ComputerPreviewState) => void>();
  changed = next => { for (const callback of listeners) callback(next); };
  api.onState.mockImplementation(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; });
  api.subscribe.mockImplementation(async (_input, callback) => { receive = callback; return { subscriptionId: 'subscription' }; });
  api.setPreset.mockResolvedValue(undefined); api.unsubscribe.mockResolvedValue(undefined); api.stopControl.mockResolvedValue(undefined);
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { computer: { preview: api } } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('releases the subscription when switching conversations', async () => {
  await act(async () => root.render(<ComputerActivityCard conversationId="one" />));
  expect(api.subscribe).toHaveBeenCalledExactlyOnceWith({ conversationId: 'one', runId: 'run', preset: 'compact' }, expect.any(Function));
  await act(async () => root.render(<ComputerActivityCard conversationId="two" />));
  expect(api.unsubscribe).toHaveBeenCalledWith('subscription'); expect(container.textContent).toBe('');
  await act(async () => changed({ ...state, status: 'live' }));
  expect(container.textContent).toBe('');
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

it('opens a chat preview, paints frames and releases the subscription on close', async () => {
  const focusTarget = vi.fn().mockResolvedValue(undefined);
  Object.assign(window.electronAPI!.computer!, { focusTarget });
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as any);
  const bitmap = { width: 10, height: 10, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  await act(async () => root.render(<ComputerChatButton conversationId="one" />));
  expect(api.subscribe).not.toHaveBeenCalled();
  const button = container.querySelector('[aria-label="View computer preview"]') as HTMLButtonElement;
  await act(async () => button.click());
  expect(document.querySelector('[aria-label="Computer activity"]')).not.toBeNull();
  expect(api.subscribe).toHaveBeenCalledExactlyOnceWith({ conversationId: 'one', runId: 'run', preset: 'compact' }, expect.any(Function));
  expect(focusTarget).not.toHaveBeenCalled();
  await act(async () => receive({ version: 1, previewId: 'preview', targetEpoch: 1, streamEpoch: 1, sequence: 1,
    width: 10, height: 10, mimeType: 'image/jpeg', bytes: new Uint8Array([1]) }));
  expect(draw).toHaveBeenCalledWith(bitmap, 0, 0);
  expect(document.querySelector('canvas')?.classList.contains('invisible')).toBe(false);
  await act(async () => (document.querySelector('[aria-label="Switch to the active app"]') as HTMLButtonElement).click());
  expect(focusTarget).toHaveBeenCalledExactlyOnceWith('one', 'preview');
  await act(async () => button.click());
  expect(api.unsubscribe).toHaveBeenCalledWith('subscription');
  expect(document.querySelector('[aria-label="Computer activity"]')).toBeNull();
});

it('shows preview capture failure with a retry instead of an empty popup', async () => {
  await act(async () => root.render(<ComputerChatButton conversationId="one" />));
  await act(async () => (container.querySelector('[aria-label="View computer preview"]') as HTMLButtonElement).click());
  await act(async () => changed({ ...state, status: 'unavailable' }));
  expect(document.body.textContent).toContain('Preview unavailable. Retry preview');
  await act(async () => changed({ ...state, status: 'ended' }));
  expect(container.querySelector('button')).toBeNull();
  expect(document.querySelector('[aria-label="Computer activity"]')).toBeNull();
  expect(api.unsubscribe).toHaveBeenCalledWith('subscription');
});

it('closes the preview when switching conversations', async () => {
  await act(async () => root.render(<ComputerChatButton conversationId="one" />));
  await act(async () => (container.querySelector('[aria-label="View computer preview"]') as HTMLButtonElement).click());
  await act(async () => root.render(<ComputerChatButton conversationId="two" />));
  expect(document.querySelector('[aria-label="Computer activity"]')).toBeNull();
  expect(api.unsubscribe).toHaveBeenCalledWith('subscription');
});

it('adapts the popup and canvas proportions to portrait and landscape frames without resubscribing', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any);
  const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
  await act(async () => root.render(<ComputerChatButton conversationId="one" />));
  await act(async () => (container.querySelector('[aria-label="View computer preview"]') as HTMLButtonElement).click());
  const popup = document.querySelector('[aria-label="Computer preview"]') as HTMLElement;
  const widths: string[] = [];
  for (const [index, [width, height]] of [[270, 480], [960, 540]].entries()) {
    decode.mockResolvedValueOnce({ width, height, close: vi.fn() });
    await act(async () => receive({ version: 1, previewId: 'preview', targetEpoch: 1, streamEpoch: 1, sequence: index + 1,
      width, height, mimeType: 'image/jpeg', bytes: new Uint8Array([1]) }));
    const canvas = popup.querySelector('canvas')!;
    expect([canvas.width, canvas.height]).toEqual([width, height]);
    expect(Number.parseFloat(canvas.parentElement!.style.aspectRatio)).toBeCloseTo(width / height);
    expect(canvas.parentElement?.style.maxHeight).toBe('min(36dvh, 320px)');
    expect(canvas.classList.contains('object-contain')).toBe(true);
    widths.push(popup.style.getPropertyValue('--computer-preview-width'));
  }
  expect(widths.every(Boolean)).toBe(true);
  expect(widths[0]).not.toBe(widths[1]);
  expect(api.subscribe).toHaveBeenCalledTimes(1);
});

it('shows current operations at the top left of the picture without replacing its pixels', async () => {
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as any);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 270, height: 480, close: vi.fn() }));
  await act(async () => root.render(<ComputerActivityCard conversationId="one" />));
  await act(async () => receive({ version: 1, previewId: 'preview', targetEpoch: 1, streamEpoch: 1, sequence: 1,
    width: 270, height: 480, mimeType: 'image/jpeg', bytes: new Uint8Array([1]) }));
  for (const [phase, action, label] of [
    ['acting', 'typeText', 'Typing'], ['observing', 'typeText', 'Checking the result'], ['ready', 'pressKeys', 'Keys pressed'],
  ] as const) {
    await act(async () => changed({ ...state, status: 'live', activity: { phase, action } }));
    const overlay = container.querySelector('canvas')!.parentElement!.querySelector('[role="status"]')!;
    expect(overlay.textContent).toContain(label);
    expect(overlay.classList.contains('left-2')).toBe(true);
    expect(overlay.classList.contains('top-2')).toBe(true);
    expect(container.querySelector('canvas')?.classList.contains('invisible')).toBe(false);
  }
  expect(draw).toHaveBeenCalledOnce();
  expect(api.subscribe).toHaveBeenCalledOnce();
  await act(async () => changed({ ...state, status: 'ended' }));
  expect(container.textContent).not.toContain('Keys pressed');
});

it('shows only the projection with its app-switch control at the top left', async () => {
  const focusTarget = vi.fn().mockResolvedValue(undefined);
  Object.assign(window.electronAPI!.computer!, { focusTarget });
  await act(async () => root.render(<ComputerChatButton conversationId="one" />));
  await act(async () => (container.querySelector('[aria-label="View computer preview"]') as HTMLButtonElement).click());
  const popup = document.querySelector('[aria-label="Computer preview"]')!;
  expect(popup.textContent).not.toMatch(/Fixture|Live preview|Stop and take over|Switch to app/);
  expect(popup.querySelector('[aria-label="Expand preview"]')).toBeNull();
  expect(popup.querySelector('[aria-label="Hide preview"]')).toBeNull();
  expect(popup.querySelectorAll('button')).toHaveLength(1);
  const control = popup.querySelector('[aria-label="Switch to the active app"]')!;
  expect(control.parentElement?.classList.contains('left-2')).toBe(true);
  expect(control.parentElement?.classList.contains('top-2')).toBe(true);
  await act(async () => (control as HTMLButtonElement).click());
  expect(focusTarget).toHaveBeenCalledExactlyOnceWith('one', 'preview');
  expect(api.stopControl).not.toHaveBeenCalled();
});
