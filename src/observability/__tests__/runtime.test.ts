import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultTracingConfig } from '../config.js';
import { closeTracing, configureTracing, flushTracing, localStore, startObservation, traceRun, traceTools, tracingStatus } from '../runtime.js';

let directory: string; let server: Server; let endpoint: string; const uploads: any[] = [];
const previous = { state: process.env.XOPC_STATE_DIR, pub: process.env.LANGFUSE_PUBLIC_KEY, secret: process.env.LANGFUSE_SECRET_KEY };
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'xopc-runtime-trace-')); process.env.XOPC_STATE_DIR = directory;
  process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test'; process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';
  server = createServer((req, res) => { let data = ''; req.on('data', chunk => { data += chunk; }); req.on('end', () => { uploads.push({ body: JSON.parse(data), auth: req.headers.authorization }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  const config = defaultTracingConfig(); config.langfuse = { enabled: true, baseUrl: endpoint }; await configureTracing(config);
});
afterAll(async () => { await closeTracing(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true });
  for (const [name, value] of [['XOPC_STATE_DIR', previous.state], ['LANGFUSE_PUBLIC_KEY', previous.pub], ['LANGFUSE_SECRET_KEY', previous.secret]]) if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
});

describe('trace runtime', () => {
  it('keeps parallel runs and tools isolated, without double wrapping or exporting secrets', async () => {
    const tools = traceTools(traceTools([{ name: 'search', execute: async () => { const generation = startObservation('llm', 'generation'); generation.input({ apiKey: 'plain-private', text: 'sk-lf-test' }); generation.finish('success', 'answer'); return { content: [] }; } }]));
    await Promise.all(['run-a', 'run-b'].map(runId => traceRun('agent.run', { runId, conversationId: 'conversation' }, async () => { await Promise.all([tools[0].execute(), tools[0].execute()]); return { ok: true }; })));
    await flushTracing(); await localStore().flush();
    const list = await localStore().request('list', {}); expect(list.traces).toHaveLength(2);
    expect(list.traces[0].traceId).not.toBe(list.traces[1].traceId);
    for (const row of list.traces) {
      const detail = await localStore().request('detail', row.traceId);
      expect(detail.spans).toHaveLength(5);
      const toolIds = detail.spans.filter((s: any) => s.type === 'tool').map((s: any) => s.spanId);
      for (const generation of detail.spans.filter((s: any) => s.type === 'generation')) expect(toolIds).toContain(generation.parentSpanId);
      expect(JSON.stringify(detail)).not.toContain('sk-lf-test'); expect(JSON.stringify(detail)).not.toContain('plain-private');
    }
    const exported = uploads.flatMap(row => row.body.resourceSpans[0].scopeSpans[0].spans);
    expect(exported).toHaveLength(10);
    expect(new Set(exported.map(s => s.traceId))).toEqual(new Set(list.traces.map((s: any) => s.traceId)));
    expect(uploads[0].auth).toBe(`Basic ${Buffer.from('pk-lf-test:sk-lf-test').toString('base64')}`);
    expect(JSON.stringify(exported)).not.toContain('sk-lf-test');
  });
  it('records errors and rejects ended spans after clearing the local cache', async () => {
    let finish!: () => void;
    const waiting = traceRun('agent.run', { runId: 'cleared' }, async () => { await new Promise<void>(resolve => { finish = resolve; }); return { ok: true }; });
    await localStore().flush(); await localStore().clear(); finish(); await waiting; await localStore().flush();
    expect((await localStore().request('list', {})).traces).toHaveLength(0);
    await expect(traceRun('agent.run', { runId: 'failed' }, async () => { throw new Error('failure'); })).rejects.toThrow('failure');
    await localStore().flush();
    expect((await localStore().request('list', {})).traces[0].status).toBe('error');
  });
  it('continues local recording when remote ingestion fails', async () => {
    const cfg = defaultTracingConfig(); cfg.langfuse = { enabled: true, baseUrl: 'http://127.0.0.1:1' }; await configureTracing(cfg);
    await traceRun('agent.run', { runId: 'offline' }, async () => ({ ok: true })); await flushTracing(); await localStore().flush();
    expect((await localStore().request('list', { runId: 'offline' })).traces).toHaveLength(1);
    const status = await tracingStatus(); expect(status.langfuse.state).toBe('degraded');
  });
});
