import { randomUUID } from 'node:crypto';

import { DurableState } from '../storage/sqlite/durable-state.js';
import type { LocationConsumer } from '../endpoint-tools/location-sharing.js';
import { PhoneError, type PhoneDevice } from './contracts.js';
import type { PhoneRepository } from './repository.js';
import { LocationBaselineCipher } from './location-baseline-store.js';
import type { WuyingLocationAdapter, WuyingLocationBaseline } from './wuying-location.js';

export interface PhoneLocationJournal {
  id: string; phoneId: string; shareId: string; conversationId: string; deviceRevision: number;
  baseline: string; phase: 'pending' | 'applied' | 'cleanup_pending'; validUntil: number;
}
interface EnvironmentAccess {
  adapter(device: PhoneDevice): Promise<{ adapter: WuyingLocationAdapter; close(): void }>;
  exclusive<T>(phoneId: string, owner: string, cleanup: boolean, action: () => Promise<T>): Promise<T>;
}

/** Write-ahead cleanup journal; an interrupted application quarantines the phone until recovery. */
export class PhoneLocationEnvironment implements LocationConsumer {
  private readonly active = new Map<string, string>();
  private readonly required = new Map<string, string>();
  private readonly ended = new Set<string>();
  private readonly verified = new Map<string, { until: number; owner: string }>();
  private readonly operations = new Map<string, AbortController>();
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly cleaning = new Map<string, Promise<boolean>>();
  constructor(private readonly repository: PhoneRepository, private readonly access: EnvironmentAccess,
    private readonly cipher = new LocationBaselineCipher(), private readonly now = Date.now,
    private readonly journal: Pick<DurableState<PhoneLocationJournal>, 'get' | 'set' | 'delete' | 'values'> = new DurableState<PhoneLocationJournal>('phone.location-environment')) {
    this.timer = setInterval(() => { void this.sweep().catch(() => {}); }, 1_000); this.timer.unref();
  }
  async sweep() {
    await Promise.all(this.journal.values().filter(record => !this.active.has(record.phoneId)
      || record.validUntil <= this.now() || record.phase === 'cleanup_pending').map(record => this.clear(record.shareId, record.phoneId)));
  }
  hasVerified(phoneId: string, owner: string) { const verified = this.verified.get(phoneId); return Boolean(verified && verified.owner === owner && verified.until > this.now()); }
  status(phoneId: string) {
    const record = this.journal.get(phoneId);
    return record ? { status: record.phase, shareId: record.shareId, validUntil: record.validUntil,
      recoveryRequired: !this.active.has(phoneId) } : { status: 'clean' };
  }
  assertAllowed(phoneId: string, owner: string) {
    const record = this.journal.get(phoneId);
    if (record && (!this.active.has(phoneId) || record.phase !== 'applied' && !(record.phase === 'pending' && this.hasVerified(phoneId, owner)))) throw new PhoneError('PHONE_ENV_CLEANUP_PENDING', 'Location cleanup or verification is pending', 409);
    if (record && (record.validUntil <= this.now() || record.conversationId !== owner)) throw new PhoneError('CONTEXT_STALE', 'Phone location is expired or belongs to another task', 409);
    if (this.required.has(`${phoneId}:${owner}`) && (!record || record.shareId !== this.required.get(`${phoneId}:${owner}`))) throw new PhoneError('CONTEXT_STALE', 'Share a fresh location before continuing this phone task', 409);
  }
  async recover(phoneId: string, force = false) {
    const record = this.journal.get(phoneId);
    if (record && (force || !this.active.has(phoneId)) && !await this.clear(record.shareId, phoneId)) throw new PhoneError('PHONE_ENV_CLEANUP_PENDING', 'Reconnect the cloud phone to finish location cleanup', 409);
  }
  async apply(input: Parameters<LocationConsumer['apply']>[0], signal: AbortSignal) {
    if (this.ended.has(input.shareId)) throw new PhoneError('GRANT_REVOKED', 'This phone task has finished; start a new location share', 409);
    await this.recover(input.phoneId);
    await this.access.exclusive(input.phoneId, input.conversationId, false, async () => {
      input.assertCurrent();
      const device = this.repository.get(input.phoneId);
      if (!device.enabled || device.connection?.kind !== 'aliyun-adb') throw new PhoneError('PHONE_ENV_UNSUPPORTED', 'Select an enabled Alibaba cloud phone', 409);
      const previous = this.journal.get(device.id);
      if (previous && previous.deviceRevision !== device.revision) throw new PhoneError('PHONE_ENV_CLEANUP_PENDING', 'Cloud phone binding changed; inspect pending location cleanup', 409);
      if (previous && previous.shareId !== input.shareId) throw new PhoneError('PHONE_DEVICE_BUSY', 'Another location share owns this phone', 409);
      const connection = await this.access.adapter(device);
      const controller = new AbortController(); this.operations.set(device.id, controller);
      signal = AbortSignal.any([signal, controller.signal]);
      try {
        const baseline: WuyingLocationBaseline = previous ? JSON.parse(await this.cipher.open(previous.baseline, device.id)) : await connection.adapter.prepare(signal);
        const record: PhoneLocationJournal = previous ?? { id: randomUUID(), phoneId: device.id, shareId: input.shareId, conversationId: input.conversationId,
          deviceRevision: device.revision, baseline: await this.cipher.seal(JSON.stringify(baseline), device.id), phase: 'pending', validUntil: input.validUntil };
        record.phase = 'pending'; record.validUntil = input.validUntil;
        this.journal.set(device.id, record); this.active.set(device.id, record.id);
        this.required.set(`${device.id}:${input.conversationId}`, input.shareId);
        try {
          await connection.adapter.apply(input.sample, baseline, input.assertCurrent, signal);
          input.assertCurrent(); record.phase = 'applied'; this.journal.set(device.id, record);
          this.verified.set(device.id, { until: input.validUntil, owner: input.conversationId });
        } catch {
          record.phase = 'cleanup_pending'; this.journal.set(device.id, record); this.verified.delete(device.id);
          throw new PhoneError('PHONE_ENV_CLEANUP_PENDING', 'Location application needs cleanup before retrying', 409);
        }
      } finally { if (this.operations.get(device.id) === controller) this.operations.delete(device.id); connection.close(); }
    });
  }
  clear(shareId: string, phoneId: string): Promise<boolean> {
    const running = this.cleaning.get(phoneId); if (running) return running;
    const promise = this.cleanup(shareId, phoneId).catch(() => false).finally(() => { if (this.cleaning.get(phoneId) === promise) this.cleaning.delete(phoneId); });
    this.cleaning.set(phoneId, promise); return promise;
  }
  private async cleanup(shareId: string, phoneId: string) {
    const record = this.journal.get(phoneId);
    if (!record || record.shareId !== shareId) return true;
    record.phase = 'cleanup_pending'; this.journal.set(phoneId, record);
    return this.access.exclusive(phoneId, record.conversationId, true, async () => {
      const current = this.journal.get(phoneId);
      if (!current || current.id !== record.id) return false;
      const device = this.repository.get(phoneId);
      if (device.revision !== record.deviceRevision) return false;
      const connection = await this.access.adapter(device);
      try {
        const baseline = JSON.parse(await this.cipher.open(record.baseline, phoneId)) as WuyingLocationBaseline;
        await connection.adapter.restore(baseline, AbortSignal.timeout(15_000));
        this.journal.delete(phoneId); this.active.delete(phoneId); this.verified.delete(phoneId); return true;
      } finally { connection.close(); }
    });
  }
  async releaseOwner(owner: string) {
    for (const record of this.journal.values()) if (record.conversationId === owner) this.ended.add(record.shareId);
    while (this.ended.size > 128) this.ended.delete(this.ended.values().next().value!);
    await Promise.all(this.journal.values().filter(record => record.conversationId === owner).map(record => this.clear(record.shareId, record.phoneId)));
    for (const key of this.required.keys()) if (key.endsWith(`:${owner}`)) this.required.delete(key);
  }
  async releaseDevice(phoneId: string) {
    this.operations.get(phoneId)?.abort();
    const record = this.journal.get(phoneId);
    if (!record) return;
    this.ended.add(record.shareId);
    await this.recover(phoneId, true);
  }
  async close() {
    clearInterval(this.timer);
    for (const controller of this.operations.values()) controller.abort();
    await Promise.all(this.journal.values().map(record => this.clear(record.shareId, record.phoneId)));
  }
}
