import { randomUUID } from 'node:crypto';

import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/connection.js';
import { PhoneRepository } from '../repository.js';
import { PhoneRuntime } from '../runtime.js';
import type { PhoneInteractiveProvider } from '../live-provider.js';

it('keeps one HDC encoder across view/control reconnects and drains it when unused', async () => {
  closeXopcDatabase(); openXopcDatabase({ path: ':memory:' }); vi.useFakeTimers();
  const repository = new PhoneRepository();
  const device = repository.save({ serial: 'HDC', platform: 'harmonyos', name: 'Huawei', enabled: true, appAccess: 'all', allowedApps: [] });
  const driver = { discover: async () => [{ serial: 'HDC', state: 'device', name: 'Huawei', emulator: false, platform: 'harmonyos' as const }],
    observe: async () => ({ platform: 'harmonyos' as const, package: 'com.huawei.hmos.settings', frameId: randomUUID(), capturedAt: Date.now(), width: 100, height: 200, rotation: 0, elements: [], frame: Buffer.from('pixels') }), execute: vi.fn() };
  const sources: PhoneInteractiveProvider[] = [];
  const factory = vi.fn(() => {
    const source: PhoneInteractiveProvider = { descriptor: { kind: 'hdc-h264', protocolVersion: 1, continuousTouch: false, maxPointers: 1 }, geometry: { width: 100, height: 200, version: 1, codec: 'avc1.64002a' },
      foreground: async () => 'com.huawei.hmos.settings', start: vi.fn(async () => {}), subscribe: () => () => {}, pointer: vi.fn(), refresh: vi.fn(), revoke: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    sources.push(source); return source;
  });
  const runtime = new PhoneRuntime(repository, undefined, async () => ({ predict: vi.fn() }), undefined, undefined, () => driver, factory);
  const context = { config: ConfigSchema.parse({ phone: { enabled: true } }), agentId: 'main', modelRef: 'test/phone' };
  const owner = randomUUID();
  try {
    const report = await runtime.execute(owner, { op: 'open', deviceId: device.id, mode: 'control' }, context) as { sessionId: string };
    const first = await runtime.liveVideo(owner, report.sessionId, context);
    const unview = first.subscribe('view', () => {}, () => {}); unview();
    await runtime.disconnectVideo(owner, report.sessionId, 'view'); await vi.advanceTimersByTimeAsync(1000);
    expect(sources[0].close).not.toHaveBeenCalled();
    expect(await runtime.liveVideo(owner, report.sessionId, context)).toBe(first); expect(factory).toHaveBeenCalledOnce();
    const uncontrol = first.subscribe('control', () => {}, () => {}); uncontrol();
    await runtime.disconnectVideo(owner, report.sessionId, 'control'); await vi.advanceTimersByTimeAsync(1600);
    expect(sources[0].close).toHaveBeenCalledOnce();
    expect(await runtime.liveVideo(owner, report.sessionId, context)).not.toBe(first); expect(factory).toHaveBeenCalledTimes(2);
  } finally { await runtime.shutdown(); vi.useRealTimers(); closeXopcDatabase(); }
});
