import { createHash } from 'node:crypto';
import {
  ENDPOINT_CONTEXT_OFFLINE_MS, canonicalJson, endpointContextReportSchema, endpointContextHeartbeatSchema,
  type EndpointContextField, type EndpointContextValues, type EndpointContextView,
} from '@xopcai/endpoint-tools-protocol';

import type { EndpointRegistry } from './registry.js';

export class EndpointContextError extends Error {
  constructor(readonly code: 'CONTEXT_INVALID' | 'CONTEXT_CONFLICT' | 'SOURCE_UNAVAILABLE', message: string) { super(message); }
}
type Reading = { value: EndpointContextValues[EndpointContextField]; capturedAt: number; receivedAt: number; validUntil: number };
interface Snapshot {
  epoch: string; revision: number; sequence: number; heartbeatSequence: number;
  lastSeenAt: number; availability: 'foreground' | 'background';
  fields: Map<EndpointContextField, Reading>;
  receipts: Map<string, { digest: string; revision: number }>;
}

/** Bounded, process-local observations. Heartbeats never refresh field timestamps. */
export class EndpointContextStore {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly unsubscribe: () => void;
  constructor(private readonly registry: EndpointRegistry, private readonly now = Date.now) {
    this.unsubscribe = registry.onChange((endpointId, reason) => {
      this.snapshots.delete(endpointId);
      const endpoint = registry.get(endpointId);
      if (reason === 'authorization' || !endpoint) return;
      if (this.snapshots.size >= 256) return;
      this.snapshots.set(endpointId, { epoch: endpoint.connectionId, revision: 0, sequence: 0, heartbeatSequence: 0,
        lastSeenAt: 0, availability: 'background', fields: new Map(), receipts: new Map() });
    });
  }
  private require(endpointId: string): Snapshot {
    const state = this.snapshots.get(endpointId);
    if (!state || this.registry.get(endpointId)?.connectionId !== state.epoch) {
      throw new EndpointContextError('SOURCE_UNAVAILABLE', 'Context source is unavailable');
    }
    return state;
  }
  connection(endpointId: string) {
    const state = this.require(endpointId);
    return { connectionEpoch: state.epoch, revision: state.revision, reportSequence: state.sequence, heartbeatSequence: state.heartbeatSequence };
  }
  report(endpointId: string, input: unknown) {
    const parsed = endpointContextReportSchema.safeParse(input);
    if (!parsed.success) throw new EndpointContextError('CONTEXT_INVALID', 'Invalid endpoint context report');
    const report = parsed.data;
    const state = this.require(endpointId);
    if (report.connectionEpoch !== state.epoch) throw new EndpointContextError('SOURCE_UNAVAILABLE', 'Context connection changed');
    const digest = createHash('sha256').update(canonicalJson(report)).digest('hex');
    const receipt = state.receipts.get(report.reportId);
    if (receipt) {
      if (receipt.digest !== digest) throw new EndpointContextError('CONTEXT_CONFLICT', 'Report identity was reused');
      return { revision: receipt.revision };
    }
    if (report.sequence <= state.sequence || (report.mode === 'patch' && report.baseRevision !== state.revision)) {
      throw new EndpointContextError('CONTEXT_CONFLICT', 'Context baseline or sequence changed; send a full report');
    }
    const now = this.now();
    if (report.capturedAt > now + 60_000 || report.capturedAt < now - 30_000) {
      throw new EndpointContextError('CONTEXT_INVALID', 'Context sample is stale or has an invalid clock');
    }
    const fields = report.mode === 'full' ? new Map<EndpointContextField, Reading>() : new Map(state.fields);
    for (const key of report.cleared) fields.delete(key);
    for (const [key, value] of Object.entries(report.values)) {
      if (value === undefined) continue;
      const field = key as EndpointContextField;
      const prior = state.fields.get(field);
      if (prior && report.capturedAt < prior.capturedAt) throw new EndpointContextError('CONTEXT_CONFLICT', 'Context sample moved backwards');
      if (prior && report.capturedAt === prior.capturedAt) {
        if (canonicalJson(prior.value) !== canonicalJson(value)) throw new EndpointContextError('CONTEXT_CONFLICT', 'Context sample identity changed');
        fields.set(field, prior);
        continue;
      }
      fields.set(field, { value: structuredClone(value), capturedAt: report.capturedAt, receivedAt: now,
        validUntil: Math.min(report.capturedAt, now) + (field === 'device.power' ? 30_000 : 300_000) });
    }
    state.fields = fields;
    state.sequence = report.sequence;
    state.revision += 1;
    state.receipts.set(report.reportId, { digest, revision: state.revision });
    if (state.receipts.size > 64) state.receipts.delete(state.receipts.keys().next().value!);
    return { revision: state.revision };
  }
  heartbeat(endpointId: string, input: unknown) {
    const parsed = endpointContextHeartbeatSchema.safeParse(input);
    if (!parsed.success) throw new EndpointContextError('CONTEXT_INVALID', 'Invalid context heartbeat');
    const state = this.require(endpointId);
    if (parsed.data.connectionEpoch !== state.epoch || parsed.data.sequence <= state.heartbeatSequence) {
      throw new EndpointContextError('CONTEXT_CONFLICT', 'Context heartbeat connection or sequence changed');
    }
    state.heartbeatSequence = parsed.data.sequence;
    state.lastSeenAt = this.now();
    state.availability = parsed.data.availability;
    return { revision: state.revision };
  }
  view(endpointId: string): EndpointContextView | undefined {
    let state: Snapshot;
    try { state = this.require(endpointId); } catch { return undefined; }
    const now = this.now();
    const availability = state.lastSeenAt === 0 || now - state.lastSeenAt >= ENDPOINT_CONTEXT_OFFLINE_MS ? 'offline'
      : this.registry.get(endpointId)?.kind !== 'browser' && this.registry.get(endpointId)?.availability === 'background' ? 'background' : state.availability;
    const fields: EndpointContextView['fields'] = {};
    for (const [key, reading] of state.fields) {
      const status = availability !== 'foreground' ? 'unavailable' : reading.validUntil <= now ? 'stale' : 'fresh';
      fields[key] = { status, capturedAt: reading.capturedAt, validUntil: reading.validUntil,
        ...(status === 'fresh' ? { value: structuredClone(reading.value) } : {}) };
    }
    return { version: 1, endpointId, revision: state.revision, availability, sourceValidUntil: state.lastSeenAt + ENDPOINT_CONTEXT_OFFLINE_MS, fields };
  }
  close() { this.unsubscribe(); this.snapshots.clear(); }
}
