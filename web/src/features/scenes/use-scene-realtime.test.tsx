// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useSceneRealtime } from './use-scene-realtime';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), fetch: vi.fn(), subscribe: vi.fn(), stop: vi.fn() }));
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: mocks.mutate }) }));
vi.mock('@/features/gateway/gateway-realtime', () => ({ subscribeRealtimeTopic: mocks.subscribe }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mocks.fetch }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));

let root: Root;
let container: HTMLDivElement;
function Probe() { useSceneRealtime(); return null; }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  mocks.fetch.mockResolvedValue({ capabilities: [{ id: 'xopc.scenes.list' }] });
  mocks.subscribe.mockReturnValue(mocks.stop);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

it('invalidates the scene-local cache, deduplicates events and batches a transaction burst', async () => {
  await act(async () => root.render(<Probe />));
  expect(mocks.subscribe).toHaveBeenCalledWith('resources:scenes', expect.any(Object), 0);
  await act(async () => vi.advanceTimersByTime(50));
  mocks.mutate.mockClear();
  const listener = mocks.subscribe.mock.calls[0][1];
  const data = { eventId: 'one', kind: 'scene', id: 'scene', revision: 1, operation: 'updated' };
  for (const event of [data, data, { ...data, eventId: 'two', revision: 2 }]) {
    listener.onEvent({ event: 'resource.changed', topic: 'resources:scenes', data: event });
  }
  await act(async () => vi.advanceTimersByTime(50));
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  expect(mocks.mutate.mock.calls[0][0]('/activations')).toBe(true);
  listener.onEvent({ event: 'resource.changed', topic: 'resources:scenes', data });
  await act(async () => vi.advanceTimersByTime(50));
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  listener.onGap();
  await act(async () => vi.advanceTimersByTime(50));
  expect(mocks.mutate).toHaveBeenCalledTimes(2);
});

it('rediscovers permission on reconnect and stops an old subscription', async () => {
  await act(async () => root.render(<Probe />));
  mocks.fetch.mockResolvedValue({ capabilities: [] });
  await act(async () => window.dispatchEvent(new Event('gateway-realtime-connected')));
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(mocks.subscribe).toHaveBeenCalledTimes(1);
  expect(mocks.mutate).toHaveBeenCalledWith(expect.any(Function), undefined, { revalidate: true });
});

it('does not subscribe after the scene cache has unmounted', async () => {
  let resolve!: (value: unknown) => void;
  mocks.fetch.mockReturnValue(new Promise(value => { resolve = value; }));
  await act(async () => root.render(<Probe />));
  act(() => root.unmount());
  await act(async () => resolve({ capabilities: [{ id: 'xopc.scenes.list' }] }));
  expect(mocks.subscribe).not.toHaveBeenCalled();
});
