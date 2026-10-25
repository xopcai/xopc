import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTracingConfig } from '../config.js';
import { LocalTraceStore } from '../store.js';
import type { TraceRecord } from '../types.js';

let directory: string;
let store: LocalTraceStore;
const internal = () => store as unknown as { worker?: Worker; retryAfter: number; pendingBytes: number };
const record = (id: number): TraceRecord => ({ traceId: id.toString(16).padStart(32, '0'), spanId: id.toString(16).padStart(16, '0'), name: 'recovery test', type: 'agent', startedAt: Date.now(), endedAt: Date.now(), status: 'success', attributes: {} });
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'xopc-trace-recovery-'));
  store = new LocalTraceStore(defaultTracingConfig(), join(directory, 'traces.db'));
  await store.request('status');
});
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await store.close(); await rm(directory, { recursive: true, force: true }); });

describe('trace worker recovery', () => {
  it('loads the persisted epoch before the first implicit-epoch write after reopening', async () => {
    await store.clear();
    await store.close();
    store = new LocalTraceStore(defaultTracingConfig(), join(directory, 'traces.db'));
    await store.write(record(30));
    expect((await store.request('detail', record(30).traceId)).spans).toHaveLength(1);
  });
  it('reopens the same database with one replacement and preserves historical spans and costs', async () => {
    const root = record(1);
    const epoch = await store.begin(root);
    for (const [id, cost] of [[2, 0], [3, 0.25], [4, undefined]] as const) {
      await store.write({ ...record(id), traceId: root.traceId, parentSpanId: root.spanId, type: 'generation', attributes: { 'gen_ai.usage.input_tokens': 5, ...(cost === undefined ? {} : { 'langfuse.observation.cost_details': JSON.stringify({ total: cost }) }) } }, epoch);
    }
    const before = await store.request('detail', root.traceId);
    for (const [id, cost] of [[6, 0], [8, 0.5]] as const) {
      const parent = record(id);
      const accepted = await store.begin(parent);
      await store.write({ ...record(id + 1), traceId: parent.traceId, parentSpanId: parent.spanId, type: 'generation', attributes: { 'langfuse.observation.cost_details': JSON.stringify({ total: cost }) } }, accepted);
    }
    const previous = internal().worker!;
    await previous.terminate();
    expect(store.lastError).toContain('Trace worker stopped');
    await expect(store.request('status')).rejects.toThrow('Trace worker stopped');
    expect(internal().worker).toBeUndefined();
    internal().retryAfter = 0;
    const recovered = await Promise.all([store.request('status'), store.request('list', {}), store.request('detail', root.traceId)]);
    expect(recovered[0].traces).toBe(3);
    const summary = (id: number) => recovered[1].traces.find((item: TraceRecord) => item.traceId === record(id).traceId).stats;
    expect(summary(1)).toEqual({ generations: 3, tokens: 15, knownCostUsd: 0.25, unknownCostCalls: 1 });
    expect(summary(6)).toEqual({ generations: 1, tokens: 0, knownCostUsd: 0, unknownCostCalls: 0 });
    expect(summary(8)).toEqual({ generations: 1, tokens: 0, knownCostUsd: 0.5, unknownCostCalls: 0 });
    expect(recovered[2]).toEqual(before);
    const replacement = internal().worker;
    previous.emit('exit', 1);
    expect(internal().worker).toBe(replacement);
    expect(store.lastError).toBeUndefined();
    await store.write(record(5));
    expect((await store.request('status')).traces).toBe(4);
  });

  it('preserves the timeout cause, rejects the whole queue and recovers without replay', async () => {
    const worker = internal().worker!;
    vi.spyOn(worker, 'postMessage').mockImplementation(() => {});
    vi.useFakeTimers();
    const first = expect(store.request('put', { records: [record(10)], epoch: null })).rejects.toThrow('Trace storage timeout');
    const second = expect(store.request('status')).rejects.toThrow('Trace storage timeout');
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all([first, second]);
    vi.useRealTimers();
    expect(internal().pendingBytes).toBe(0);
    expect(store.lastError).toBe('Trace storage timeout');
    internal().retryAfter = 0;
    expect((await store.request('status')).traces).toBe(0);
    await store.write(record(11));
    expect((await store.request('status')).traces).toBe(1);
  });

  it('keeps clear epochs and never restarts after explicit shutdown', async () => {
    const stale = await store.begin(record(20));
    await store.clear();
    await internal().worker!.terminate();
    internal().retryAfter = 0;
    await store.write(record(20), stale);
    expect(await store.request('detail', record(20).traceId)).toBeNull();
    const epoch = await store.begin(record(21));
    await store.write(record(21), epoch);
    expect((await store.request('status')).traces).toBe(1);
    const closingRequest = expect(store.request('status')).rejects.toThrow('Trace store closed');
    await store.close();
    await closingRequest;
    internal().retryAfter = 0;
    await expect(store.request('status')).rejects.toThrow('Trace store closed');
    expect(internal().worker).toBeUndefined();
  });
});
