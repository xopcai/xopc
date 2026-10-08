import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultTracingConfig } from '../config.js';
import { boundedJson } from '../sanitize.js';
import { LocalTraceStore } from '../store.js';
import type { TraceRecord } from '../types.js';

let directory: string;
let store: LocalTraceStore;
const row = (index: number, extra: Partial<TraceRecord> = {}): TraceRecord => ({ traceId: index.toString(16).padStart(32, '0'), spanId: index.toString(16).padStart(16, '0'), type: 'agent', name: 'test', startedAt: Date.now(), endedAt: Date.now(), status: 'success', attributes: {}, ...extra });
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'xopc-traces-')); const cfg = defaultTracingConfig(); cfg.local.maxTraces = 10; cfg.local.maxSpans = 100; store = new LocalTraceStore(cfg, join(directory, 'traces.db')); });
afterAll(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });

describe('bounded local tracing', () => {
  it('redacts secrets, skips media and bounds cyclic/large UTF-8 input', () => {
    const input: any = { apiKey: 'private-key', text: 'Bearer secret-token', image_url: 'base64-payload', huge: '你'.repeat(100000) }; input.circular = input;
    const text = boundedJson(input, 1024);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1024);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toContain('private-key'); expect(text).not.toContain('secret-token'); expect(text).not.toContain('base64-payload');
    expect(JSON.parse(text).truncated).toBe(true);
  });
  it('preserves parent relationships and queries stable cursor pages', async () => {
    await store.write(row(1)); await store.write(row(2));
    await store.write(row(1, { spanId: 'aaaaaaaaaaaaaaaa', parentSpanId: row(1).spanId, type: 'tool', name: 'tool.search' }));
    const detail = await store.request('detail', row(1).traceId); expect(detail.spans).toHaveLength(2);
    expect(detail.spans.find((s: TraceRecord) => s.type === 'tool').parentSpanId).toBe(row(1).spanId);
    const first = await store.request('list', { limit: 1 }); const second = await store.request('list', { limit: 1, cursor: first.nextCursor });
    expect(first.traces[0].traceId).not.toBe(second.traces[0].traceId);
  });
  it('evicts whole traces at count quota and keeps disk bounded', async () => {
    for (let i = 3; i < 25; i++) await store.write(row(i));
    await store.request('prune');
    const stats = await store.request('status'); expect(stats.traces).toBeLessThanOrEqual(10); expect(stats.spans).toBeLessThanOrEqual(100);
    expect(stats.physicalBytes).toBeLessThan(256 * 1048576);
  });
  it('rejects late spans from cleared epochs while new roots can record', async () => {
    const epoch = await store.begin(row(100, { endedAt: undefined, status: 'running' }));
    await store.clear();
    await store.write(row(100), epoch); expect(await store.request('detail', row(100).traceId)).toBeNull();
    const next = await store.begin(row(101, { endedAt: undefined })); await store.write(row(101), next);
    expect(await store.request('detail', row(101).traceId)).not.toBeNull();
  });
});

it('bounds physical growth under oversized payloads and two independent writers', async () => {
  const cfg = defaultTracingConfig(); cfg.local.maxStoreMiB = 16; cfg.local.maxWriteMiBPerMinute = 100;
  const first = new LocalTraceStore(cfg, join(directory, 'pressure.db'));
  const second = new LocalTraceStore(cfg, join(directory, 'pressure.db'));
  try {
    for (let i = 200; i < 320; i++) {
      const writer = i % 2 ? first : second;
      const epoch = await writer.begin(row(i, { status: 'running', endedAt: undefined }));
      await writer.write(row(i, { attributes: { 'langfuse.observation.input': 'a'.repeat(65536), 'langfuse.observation.output': 'b'.repeat(65536) } }), epoch);
    }
    await first.request('prune');
    const stats = await first.request('status');
    expect(stats.physicalBytes).toBeLessThan(16 * 1048576);
    expect(stats.traces).toBeGreaterThan(0);
    expect(stats.traces).toBeLessThan(120);
    expect(first.lastError).toBeUndefined(); expect(second.lastError).toBeUndefined();
  } finally { await first.close(); await second.close(); }
});
