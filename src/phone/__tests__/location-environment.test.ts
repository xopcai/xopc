import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import { PhoneLocationEnvironment } from '../location-environment.js';
import { WuyingLocationAdapter } from '../wuying-location.js';
import { LocationBaselineCipher } from '../location-baseline-store.js';
import { PhoneRepository } from '../repository.js';

let directory: string; const environments: PhoneLocationEnvironment[] = [];
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'xopc-location-env-')); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'xopc.db') }); });
afterEach(async () => { await Promise.all(environments.splice(0).map(environment => environment.close())); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  let now = Date.now(); let property = '-33.87,151.2,0,wgs'; const original = property;
  let offline = false; let loseWriteReceipt = false; let currentFingerprint = 'fixture-image-31';
  const command = vi.fn(async (args: string[]) => {
    if (offline) throw new Error('offline');
    if (args[0] === 'getprop' && args[1] === 'ro.build.version.sdk') return '31';
    if (args[0] === 'getprop' && args[1] === 'ro.build.fingerprint') return currentFingerprint;
    if (args[0] === 'getprop') return property;
    if (args[0] === 'setprop') { property = args[2]; if (loseWriteReceipt) { loseWriteReceipt = false; throw new Error('lost response'); } return ''; }
    const [latitude, longitude] = property.split(','); return `  last location=Location[gps ${latitude},${longitude} hAcc=10]\n`;
  });
  const adapter = new WuyingLocationAdapter(command);
  const repository = new PhoneRepository();
  const device = repository.save({ serial: '203.0.113.5:5555', name: 'Cloud phone', enabled: true, allowedApps: [],
    connection: { kind: 'aliyun-adb', endpoint: '203.0.113.5:5555', credentialId: randomUUID() } });
  const access = { adapter: async () => ({ adapter, close() {} }), exclusive: async <T>(_id: string, _owner: string, _cleanup: boolean, action: () => Promise<T>) => action() };
  const create = () => { const environment = new PhoneLocationEnvironment(repository, access, new LocationBaselineCipher(join(directory, 'keys')), () => now); environments.push(environment); return environment; };
  const environment = create();
  const owner = randomUUID(); const shareId = randomUUID();
  const sample = { latitude: 31.234567, longitude: 121.345678, accuracyMeters: 10, capturedAt: now,
    coordinateSystem: 'WGS84' as const, precision: 'precise' as const };
  const input = { shareId, conversationId: owner, phoneId: device.id, sample, validUntil: now + 30_000, assertCurrent() {} };
  return { environment, create, device, adapter, owner, input, command, original, property: () => property,
    advance: (ms: number) => { now += ms; }, setOffline: (value: boolean) => { offline = value; },
    loseReceipt: () => { loseWriteReceipt = true; }, changeImage: () => { currentFingerprint = 'other-image'; } };
}
describe('cloud phone location lifecycle', () => {
  it('verifies application and restores the original GPS without persisting source coordinates', async () => {
    const f = fixture(); await f.environment.apply(f.input, new AbortController().signal);
    expect(f.property()).toContain('31.2345670,121.3456780');
    expect(f.environment.status(f.device.id)).toMatchObject({ status: 'applied' });
    expect(() => f.environment.assertAllowed(f.device.id, f.owner)).not.toThrow();
    expect(() => f.environment.assertAllowed(f.device.id, 'another-conversation')).toThrow();
    const journal = JSON.stringify(new DurableState('phone.location-environment').values());
    expect(journal).not.toContain(String(f.input.sample.latitude)); expect(journal).not.toContain(f.original);
    expect(await f.environment.clear(f.input.shareId, f.device.id)).toBe(true);
    expect(f.property()).toBe(f.original); expect(f.environment.status(f.device.id)).toEqual({ status: 'clean' });
    expect(() => f.environment.assertAllowed(f.device.id, f.owner)).toThrow('fresh location');
  });
  it('expires applied location and blocks a dependent task until a new valid sample is applied', async () => {
    const f = fixture(); await f.environment.apply(f.input, new AbortController().signal); f.advance(31_000);
    expect(() => f.environment.assertAllowed(f.device.id, f.owner)).toThrow();
    await f.environment.sweep(); expect(f.property()).toBe(f.original);
    await f.environment.apply({ ...f.input, validUntil: f.input.validUntil + 31_000 }, new AbortController().signal);
    expect(() => f.environment.assertAllowed(f.device.id, f.owner)).not.toThrow();
  });
  it('keeps an uncertain write in the journal and recovers it after restart', async () => {
    const f = fixture(); f.loseReceipt();
    await expect(f.environment.apply(f.input, new AbortController().signal)).rejects.toThrow('cleanup');
    f.setOffline(true); expect(await f.environment.clear(f.input.shareId, f.device.id)).toBe(false);
    await f.environment.close();
    const restarted = f.create(); expect(() => restarted.assertAllowed(f.device.id, f.owner)).toThrow('pending');
    await expect(restarted.recover(f.device.id)).rejects.toThrow('cleanup');
    f.setOffline(false); await restarted.recover(f.device.id);
    expect(f.property()).toBe(f.original); expect(restarted.status(f.device.id)).toEqual({ status: 'clean' });
  });
  it('does not let a late cleanup for another grant undo the current application', async () => {
    const f = fixture(); await f.environment.apply(f.input, new AbortController().signal);
    expect(await f.environment.clear(randomUUID(), f.device.id)).toBe(true);
    expect(f.environment.status(f.device.id)).toMatchObject({ status: 'applied' });
    f.changeImage(); expect(await f.environment.clear(f.input.shareId, f.device.id)).toBe(false);
    expect(f.environment.status(f.device.id)).toMatchObject({ status: 'cleanup_pending' });
  });
  it('rejects unsupported property formats before any location write', async () => {
    const command = vi.fn(async (args: string[]) => args[1] === 'ro.build.version.sdk' ? '31' : 'unknown-format');
    await expect(new WuyingLocationAdapter(command).prepare(new AbortController().signal)).rejects.toThrow('unsupported');
    expect(command.mock.calls.some(([args]) => args[0] === 'setprop')).toBe(false);
  });
  it('recognizes GPS jitter while rejecting unrelated and ambiguous baselines', async () => {
    const command = vi.fn(async (args: string[]) => args[1] === 'ro.build.version.sdk' ? '31'
      : args[0] === 'dumpsys' ? ' last location=Location[gps -33.87003,151.20003 hAcc=10]'
        : args[1] === 'persist.location.data' ? '-33.87,151.2,0,wgs' : 'image');
    expect((await new WuyingLocationAdapter(command).prepare(new AbortController().signal)).order).toBe('latitude-first');
    command.mockImplementation(async args => args[1] === 'ro.build.version.sdk' ? '31'
      : args[0] === 'dumpsys' ? ' last location=Location[gps 31,31 hAcc=10]' : '31,31,0,wgs');
    await expect(new WuyingLocationAdapter(command).prepare(new AbortController().signal)).rejects.toThrow('coordinate order');
    expect(command.mock.calls.some(([args]) => args[0] === 'setprop')).toBe(false);
  });
});
