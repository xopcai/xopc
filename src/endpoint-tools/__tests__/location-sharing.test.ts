import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocationSharingService } from '../location-sharing.js';
import { EndpointContextStore } from '../context-store.js';
import { EndpointRegistry } from '../registry.js';

const services: LocationSharingService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.close())); });
function fixture() {
  let now = 1_000_000;
  const registry = new EndpointRegistry(); const contexts = new EndpointContextStore(registry, () => now);
  const service = new LocationSharingService(registry, contexts, () => now); services.push(service);
  registry.register({ principalId: 'principal', endpointId: 'phone', connectionInstanceId: 'instance', displayName: 'Phone', kind: 'web', platform: 'web',
    appVersion: '1', availability: 'foreground', signedAt: now, signature: 'signature', nonce: 'nonce', tools: [] }, 'epoch', { readyState: 1, send() {}, close() {} });
  contexts.heartbeat('phone', { connectionEpoch: 'epoch', sequence: 1, availability: 'foreground' });
  const apply = vi.fn(async () => {}); const clear = vi.fn(async () => true); service.setConsumer({ apply, clear });
  const request = { conversationId: randomUUID(), phoneId: randomUUID(), precision: 'precise' as const, mode: 'while_in_use' as const, durationMs: 120_000 };
  const share = service.create('phone', request);
  const sample = { latitude: 31.234567, longitude: 121.345678, accuracyMeters: 12, precision: 'precise', coordinateSystem: 'WGS84', capturedAt: now };
  return { service, contexts, registry, request, share, sample, apply, clear, advance: (ms: number) => { now += ms; } };
}
describe('authorized location sharing', () => {
  it('keeps raw coordinates transient and expires the sample independently of heartbeats', async () => {
    const f = fixture();
    const summary = await f.service.sample(f.share.id, 'phone', { sequence: 1, sample: f.sample });
    expect(summary).toMatchObject({ status: 'fresh', sync: 'applied' });
    expect(JSON.stringify(summary)).not.toContain(String(f.sample.latitude));
    expect(f.apply.mock.calls[0][0].sample).toEqual(f.sample);
    f.advance(31_000); f.contexts.heartbeat('phone', { connectionEpoch: 'epoch', sequence: 2, availability: 'foreground' });
    await f.service.sweep();
    expect(f.service.list('phone')[0]).toMatchObject({ status: 'stale', sync: 'clean' });
    expect(f.service.list('phone')[0].valueRef).toBeUndefined();
    expect(f.clear).toHaveBeenCalledWith(f.share.id, f.share.phoneId);
  });
  it('rejects another source, stale samples, replay and reuse after revocation', async () => {
    const f = fixture();
    await expect(f.service.sample(f.share.id, 'another-endpoint', { sequence: 1, sample: f.sample })).rejects.toThrow('unavailable');
    await expect(f.service.sample(f.share.id, 'phone', { sequence: 1, sample: { ...f.sample, capturedAt: f.sample.capturedAt - 40_000 } })).rejects.toThrow('fresh');
    await f.service.sample(f.share.id, 'phone', { sequence: 1, sample: f.sample });
    await expect(f.service.sample(f.share.id, 'phone', { sequence: 1, sample: f.sample })).rejects.toThrow('consumed');
    await f.service.revoke(f.share.id, 'phone');
    await expect(f.service.sample(f.share.id, 'phone', { sequence: 2, sample: f.sample })).rejects.toThrow('no longer active');
    expect(f.service.list('phone')[0]).toMatchObject({ status: 'revoked', sync: 'clean' });
  });
  it('rounds approximate samples before sending them to a consumer', async () => {
    const f = fixture(); await f.service.revoke(f.share.id, 'phone');
    const share = f.service.create('phone', { ...f.request, precision: 'approximate' });
    await f.service.sample(share.id, 'phone', { sequence: 1, sample: f.sample });
    expect(f.apply.mock.calls[0][0].sample).toMatchObject({ latitude: 31.24, longitude: 121.34, precision: 'approximate', accuracyMeters: 3000 });
  });
  it('aborts an in-flight application on revoke and clears after the operation settles', async () => {
    const f = fixture();
    let received!: () => void; const started = new Promise<void>(resolve => { received = resolve; });
    f.apply.mockImplementation(async (_input, signal) => { received(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); });
    const running = f.service.sample(f.share.id, 'phone', { sequence: 1, sample: f.sample }); await started;
    await f.service.revoke(f.share.id, 'phone'); await running;
    expect(f.service.list('phone')[0].valueRef).toBeUndefined(); expect(f.clear).toHaveBeenCalled();
  });
  it('revokes on source loss and retains cleanup-pending rather than claiming success', async () => {
    const f = fixture(); f.clear.mockResolvedValue(false);
    await f.service.sample(f.share.id, 'phone', { sequence: 1, sample: f.sample });
    f.contexts.heartbeat('phone', { connectionEpoch: 'epoch', sequence: 2, availability: 'background' });
    await f.service.sweep();
    expect(f.service.list('phone')[0]).toMatchObject({ status: 'source_unavailable', sync: 'cleanup_pending' });
  });
  it('does not reuse a once-only grant for a second sample', async () => {
    const f = fixture(); await f.service.revoke(f.share.id, 'phone');
    const share = f.service.create('phone', { ...f.request, mode: 'once' });
    await f.service.sample(share.id, 'phone', { sequence: 1, sample: f.sample }); f.advance(1_000);
    await expect(f.service.sample(share.id, 'phone', { sequence: 2, sample: { ...f.sample, capturedAt: f.sample.capturedAt + 1_000 } })).rejects.toThrow('consumed');
  });
});
