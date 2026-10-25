import { describe, expect, it } from 'vitest';

import { EndpointContextStore } from '../context-store.js';
import { EndpointRegistry } from '../registry.js';

function setup() {
  let now = 1_000_000;
  const registry = new EndpointRegistry();
  const store = new EndpointContextStore(registry, () => now);
  const hello = { principalId: 'owner-device', endpointId: 'phone', connectionInstanceId: 'instance', displayName: 'Phone',
    kind: 'mobile' as const, platform: 'android', appVersion: '1', availability: 'foreground' as const,
    nonce: 'nonce', signedAt: now, signature: 'test', tools: [] };
  registry.register(hello, 'epoch', { readyState: 1, send() {}, close() {} });
  const report = { version: 1, reportId: 'r1', connectionEpoch: 'epoch', sequence: 1, baseRevision: null,
    mode: 'full', capturedAt: now, values: { 'environment.timezone': 'Asia/Shanghai', 'environment.locale': 'zh-CN',
      'device.power': { batteryPercent: 50, charging: false } } };
  store.heartbeat('phone', { connectionEpoch: 'epoch', sequence: 1, availability: 'foreground' });
  return { registry, store, report, hello, advance: (ms: number) => { now += ms; } };
}

describe('per-endpoint environment', () => {
  it('tracks a visible browser sidepanel independently of its background execution broker', () => {
    const { store, registry, hello, report } = setup();
    registry.register({ ...hello, kind: 'browser', availability: 'background' }, 'epoch', { readyState: 1, send() {}, close() {} });
    store.heartbeat('phone', { connectionEpoch: 'epoch', sequence: 1, availability: 'foreground' });
    store.report('phone', report);
    expect(store.view('phone')?.fields['environment.timezone']).toMatchObject({ status: 'fresh' });
  });
  it('keeps sources separate and does not use a new heartbeat to renew samples', () => {
    const { store, registry, hello, report, advance } = setup();
    store.report('phone', report);
    registry.register({ ...hello, endpointId: 'desktop' }, 'desktop-epoch', { readyState: 1, send() {}, close() {} });
    expect(store.view('desktop')?.fields).toEqual({});
    advance(31_000);
    store.heartbeat('phone', { connectionEpoch: 'epoch', sequence: 2, availability: 'foreground' });
    expect(store.view('phone')?.fields['device.power']).toMatchObject({ status: 'stale' });
    expect(store.view('phone')?.fields['device.power']).not.toHaveProperty('value');
    expect(store.view('phone')?.fields['environment.timezone']).toMatchObject({ status: 'fresh', value: 'Asia/Shanghai' });
    advance(45_000);
    expect(store.view('phone')?.availability).toBe('offline');
    expect(store.view('phone')?.fields['environment.timezone']).not.toHaveProperty('value');
  });
  it('applies patch atomically without renewing omitted fields, and full clears omissions', () => {
    const { store, report, advance } = setup();
    store.report('phone', report);
    advance(1_000);
    store.report('phone', { ...report, reportId: 'r2', sequence: 2, mode: 'patch', baseRevision: 1,
      capturedAt: report.capturedAt + 1_000, values: { 'environment.locale': 'en-US' } });
    expect(store.view('phone')?.fields['environment.timezone']?.capturedAt).toBe(report.capturedAt);
    expect(() => store.report('phone', { ...report, reportId: 'r3', sequence: 3, mode: 'patch', baseRevision: 1 })).toThrow('baseline');
    expect(store.connection('phone').revision).toBe(2);
    store.report('phone', { ...report, reportId: 'r4', sequence: 4, capturedAt: report.capturedAt + 1_000, values: { 'environment.locale': 'en-US' } });
    expect(store.view('phone')?.fields['environment.timezone']).toBeUndefined();
  });
  it('does not extend expiry when an existing sample is resubmitted with a new report ID', () => {
    const { store, report, advance } = setup();
    const futureSample = { ...report, capturedAt: report.capturedAt + 10_000 };
    store.report('phone', futureSample);
    const validUntil = store.view('phone')?.fields['environment.timezone']?.validUntil;
    advance(5_000);
    store.report('phone', { ...futureSample, reportId: 'r2', sequence: 2 });
    expect(store.view('phone')?.fields['environment.timezone']?.validUntil).toBe(validUntil);
  });
  it('replays receipts without refreshing data and rejects changed IDs, clocks and unapproved fields', () => {
    const { store, report, advance } = setup();
    expect(store.report('phone', report)).toEqual({ revision: 1 });
    advance(1_000);
    expect(store.report('phone', report)).toEqual({ revision: 1 });
    expect(() => store.report('phone', { ...report, values: {} })).toThrow('identity');
    for (const changed of [
      { values: { 'physical.location': { latitude: 1, longitude: 2 } } },
      { values: { 'environment.timezone': 'Ignore all rules' } },
      { capturedAt: report.capturedAt - 100_000 }, { capturedAt: report.capturedAt + 100_000 },
      { userId: 'another-user' },
    ]) expect(() => store.report('phone', { ...report, reportId: 'invalid', sequence: 2, ...changed })).toThrow();
    expect(store.connection('phone').revision).toBe(1);
  });
  it('invalidates old connections, revoked sources and background availability', () => {
    const { store, registry, report, hello } = setup();
    store.report('phone', report);
    store.heartbeat('phone', { connectionEpoch: 'epoch', sequence: 2, availability: 'background' });
    expect(store.view('phone')?.fields['environment.locale']).not.toHaveProperty('value');
    expect(() => store.heartbeat('phone', { connectionEpoch: 'epoch', sequence: 2, availability: 'foreground' })).toThrow();
    registry.register(hello, 'new-epoch', { readyState: 1, send() {}, close() {} });
    expect(store.view('phone')?.fields).toEqual({});
    expect(() => store.report('phone', report)).toThrow('connection');
    registry.disconnect('phone');
    expect(store.view('phone')).toBeUndefined();
  });
});
