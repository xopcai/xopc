import { afterEach, describe, expect, it, vi } from 'vitest';

import { EndpointContextPublisher } from './context.js';

afterEach(() => vi.useRealTimers());
describe('EndpointContextPublisher', () => {
  it('reports while in use, sends background heartbeats and stops on disconnect', async () => {
    vi.useFakeTimers();
    let foreground = true;
    let now = 1_000_000;
    const capture = vi.fn(() => ({ 'environment.timezone': 'Asia/Shanghai' }));
    const request = vi.fn(async (_path: string, _body?: unknown) => ({ ok: true, payload: { connectionEpoch: 'epoch', revision: 1 } }));
    const publisher = new EndpointContextPublisher({ request, capture, isForeground: () => foreground, createId: () => 'r1', now: () => now });
    publisher.start({ endpointId: 'phone', token: 'token' });
    await publisher.tick();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.some(([path]) => path.endsWith('/reports'))).toBe(true);
    now += 15_000; await publisher.tick();
    expect(capture).toHaveBeenCalledTimes(1);
    foreground = false; now += 60_000; await publisher.refresh();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenLastCalledWith(expect.stringContaining('/heartbeats'), expect.objectContaining({
      heartbeat: expect.objectContaining({ availability: 'background' }),
    }), expect.any(AbortSignal));
    foreground = true; await publisher.refresh();
    expect(capture).toHaveBeenCalledTimes(2);
    publisher.stop();
    const count = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(count);
  });
  it('ignores delayed responses after reconnect and never publishes the old identity', async () => {
    vi.useFakeTimers();
    let resolve!: (value: { ok: boolean; payload: { connectionEpoch: string; revision: number } }) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; }))
      .mockResolvedValue({ ok: true, payload: { connectionEpoch: 'new', revision: 0 } });
    const publisher = new EndpointContextPublisher({ request, capture: () => ({}), isForeground: () => true, createId: () => 'r' });
    publisher.start({ endpointId: 'old', token: 'old-token' });
    publisher.start({ endpointId: 'new', token: 'new-token' });
    await publisher.tick();
    const count = request.mock.calls.length;
    resolve({ ok: true, payload: { connectionEpoch: 'old', revision: 0 } });
    await Promise.resolve(); await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(count);
    expect(request.mock.calls.filter(([path]) => path.endsWith('/reports')).map(([, body]) => body.origin.endpointId)).toEqual(['new']);
    publisher.stop();
  });
});
