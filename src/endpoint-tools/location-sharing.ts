import { randomUUID } from 'node:crypto';
import { locationShareRequestSchema, locationShareSampleSchema,
  type LocationSample, type LocationShareRequest, type LocationShareSummary } from '@xopcai/endpoint-tools-protocol';

import type { EndpointRegistry } from './registry.js';
import type { EndpointContextStore } from './context-store.js';

export class LocationSharingError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export interface LocationConsumer {
  apply(input: { shareId: string; conversationId: string; phoneId: string; sample: LocationSample;
    validUntil: number; assertCurrent(): void }, signal: AbortSignal): Promise<void>;
  clear(shareId: string, phoneId: string): Promise<boolean>;
  state?(shareId: string, phoneId: string): LocationShareSummary['sync'];
}
interface Share {
  summary: LocationShareSummary; epoch: string; sequence: number; sample?: LocationSample;
  controller: AbortController; operation: Promise<void>;
  sampleController?: AbortController;
}

/** Explicitly authorized coordinates remain transient and are never part of public context values. */
export class LocationSharingService {
  private readonly shares = new Map<string, Share>();
  private consumer?: LocationConsumer;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;
  constructor(private readonly registry: EndpointRegistry, private readonly contexts: EndpointContextStore, private readonly now = Date.now) {
    this.timer = setInterval(() => { void this.sweep(); }, 1_000); this.timer.unref();
    this.unsubscribe = registry.onChange(endpointId => {
      for (const share of this.shares.values()) if (share.summary.endpointId === endpointId) void this.invalidate(share, 'source_unavailable');
    });
  }
  setConsumer(consumer: LocationConsumer) { this.consumer = consumer; }
  create(endpointId: string, input: LocationShareRequest): LocationShareSummary {
    const request = locationShareRequestSchema.parse(input);
    const endpoint = this.registry.get(endpointId);
    if (!endpoint || this.contexts.view(endpointId)?.availability !== 'foreground') throw new LocationSharingError('SOURCE_UNAVAILABLE', 'Open the source device before sharing location');
    for (const [id, share] of this.shares) if (['revoked', 'expired', 'source_unavailable'].includes(share.summary.status) && share.summary.sync !== 'cleanup_pending') this.shares.delete(id);
    if (this.shares.size >= 64) throw new LocationSharingError('SHARING_CAPACITY', 'Too many location shares');
    if ([...this.shares.values()].some(share => share.summary.endpointId === endpointId && share.summary.conversationId === request.conversationId
      && !['revoked', 'expired', 'source_unavailable'].includes(share.summary.status))) throw new LocationSharingError('SHARING_EXISTS', 'Stop the current location share first');
    const summary: LocationShareSummary = { ...request, id: randomUUID(), endpointId,
      expiresAt: this.now() + request.durationMs, status: 'waiting', sync: request.phoneId ? 'pending' : 'not_requested' };
    const share: Share = { summary, epoch: endpoint.connectionId, sequence: 0, controller: new AbortController(), operation: Promise.resolve() };
    this.shares.set(summary.id, share);
    return { ...summary };
  }
  private usable(share: Share) {
    return !share.controller.signal.aborted && share.summary.expiresAt > this.now()
      && this.registry.get(share.summary.endpointId)?.connectionId === share.epoch
      && this.contexts.view(share.summary.endpointId)?.availability === 'foreground';
  }
  async sample(id: string, endpointId: string, input: unknown) {
    const share = this.require(id, endpointId);
    const parsed = locationShareSampleSchema.safeParse(input);
    if (!parsed.success) throw new LocationSharingError('LOCATION_INVALID', 'Invalid location sample');
    if (!this.usable(share)) { await this.invalidate(share, share.summary.expiresAt <= this.now() ? 'expired' : 'source_unavailable'); throw new LocationSharingError('GRANT_REVOKED', 'Location sharing is no longer active'); }
    const { sequence, sample } = parsed.data;
    if (sequence <= share.sequence || share.summary.mode === 'once' && share.sequence > 0) throw new LocationSharingError('LOCATION_REPLAY', 'Location sample was already consumed');
    if (sample.capturedAt < this.now() - 30_000 || sample.capturedAt > this.now() + 60_000
      || share.sample && sample.capturedAt <= share.sample.capturedAt) throw new LocationSharingError('CONTEXT_STALE', 'Acquire a fresh location sample');
    if (share.summary.precision === 'precise' && sample.precision !== 'precise') throw new LocationSharingError('PRECISION_UNAVAILABLE', 'Precise location is unavailable; choose approximate sharing');
    const approximate = share.summary.precision === 'approximate' || sample.precision === 'approximate';
    const value = approximate ? { ...sample, latitude: Math.round(sample.latitude * 50) / 50,
      longitude: Math.round(sample.longitude * 50) / 50, accuracyMeters: Math.max(3000, sample.accuracyMeters), precision: 'approximate' as const } : sample;
    share.sequence = sequence; share.sample = value;
    share.sampleController?.abort(); share.sampleController = new AbortController();
    const valueRef = randomUUID();
    Object.assign(share.summary, { status: 'fresh', capturedAt: value.capturedAt, accuracyMeters: value.accuracyMeters,
      validUntil: Math.min(value.capturedAt, this.now()) + 30_000, valueRef });
    share.summary.validUntil = Math.min(share.summary.validUntil!, share.summary.expiresAt);
    if (share.summary.phoneId) {
      share.summary.sync = 'pending';
      const consumer = this.consumer;
      if (!consumer) throw new LocationSharingError('PHONE_ENV_UNSUPPORTED', 'Phone location synchronization is unavailable');
      const validUntil = share.summary.validUntil!;
      const signal = AbortSignal.any([share.controller.signal, share.sampleController.signal, AbortSignal.timeout(Math.max(1, validUntil - this.now()))]);
      const assertCurrent = () => {
        if (!this.usable(share) || share.summary.valueRef !== valueRef || validUntil <= this.now()) throw new LocationSharingError('CONTEXT_STALE', 'Location authorization or sample expired');
      };
      share.operation = share.operation.catch(() => {}).then(async () => {
        try {
          assertCurrent();
          await consumer.apply({ shareId: id, conversationId: share.summary.conversationId, phoneId: share.summary.phoneId!, sample: value, validUntil, assertCurrent }, signal);
          assertCurrent(); share.summary.sync = 'applied';
        } catch {
          if (share.summary.valueRef === valueRef && share.summary.status === 'fresh') share.summary.sync = 'failed';
        }
      });
      await share.operation;
    }
    return this.summary(share);
  }
  private require(id: string, endpointId: string) {
    const share = this.shares.get(id);
    if (!share || share.summary.endpointId !== endpointId) throw new LocationSharingError('SHARE_NOT_FOUND', 'Location share is unavailable');
    return share;
  }
  private summary(share: Share): LocationShareSummary {
    const result = { ...share.summary };
    if (result.phoneId && ['applied', 'cleanup_pending'].includes(result.sync)) result.sync = this.consumer?.state?.(result.id, result.phoneId) ?? result.sync;
    if (!this.usable(share) || !share.sample || (result.validUntil ?? 0) <= this.now()) {
      delete result.valueRef;
      if (result.status === 'fresh') result.status = 'stale';
    }
    return result;
  }
  list(endpointId: string, conversationId?: string) {
    return [...this.shares.values()].filter(share => share.summary.endpointId === endpointId
      && (!conversationId || share.summary.conversationId === conversationId)).map(share => this.summary(share));
  }
  async revoke(id: string, endpointId: string) { return this.invalidate(this.require(id, endpointId), 'revoked'); }
  private async invalidate(share: Share, status: LocationShareSummary['status']) {
    share.controller.abort(); share.sampleController?.abort(); share.sample = undefined; delete share.summary.valueRef;
    if (!['revoked', 'expired', 'source_unavailable'].includes(share.summary.status)) share.summary.status = status;
    await this.clear(share);
    return this.summary(share);
  }
  private async clear(share: Share) {
    if (!share.summary.phoneId || !this.consumer) return;
    share.summary.sync = 'cleanup_pending';
    share.operation = share.operation.catch(() => {}).then(async () => {
      try { share.summary.sync = await this.consumer!.clear(share.summary.id, share.summary.phoneId!) ? 'clean' : 'cleanup_pending'; }
      catch { share.summary.sync = 'cleanup_pending'; }
    });
    await share.operation;
  }
  async sweep() {
    const pending: Promise<unknown>[] = [];
    for (const share of this.shares.values()) {
      if (share.summary.status === 'waiting' && share.summary.expiresAt > this.now()
        && this.registry.get(share.summary.endpointId)?.connectionId === share.epoch) continue;
      if (!share.controller.signal.aborted && !this.usable(share)) pending.push(this.invalidate(share, share.summary.expiresAt <= this.now() ? 'expired' : 'source_unavailable'));
      else if (share.sample && (share.summary.validUntil ?? 0) <= this.now()) {
        share.sampleController?.abort(); share.sample = undefined; delete share.summary.valueRef; share.summary.status = 'stale'; pending.push(this.clear(share));
      }
    }
    await Promise.all(pending);
  }
  async close() {
    clearInterval(this.timer); this.unsubscribe();
    await Promise.all([...this.shares.values()].map(share => this.invalidate(share, 'revoked')));
    this.shares.clear();
  }
}
