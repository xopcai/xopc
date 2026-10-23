import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import { installRequestProtocol } from './request-protocol.mjs';

test('leases physical streaming requests until EOF and blocks foreign model before transport', async () => {
  const out = mkdtempSync(join(tmpdir(), 'xopc-pool-test-'));
  const child = spawn('python3', ['evals/personal/style/request_pools.py', '--out', join(out, 'pools')], { stdio: 'ignore' });
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.XOPC_STYLE_POOL_URL, oldToken = process.env.XOPC_STYLE_POOL_TOKEN;
  let live = 0, peak = 0, calls = 0;
  const server = createServer((_req, response) => {
    calls++; live++; peak = Math.max(peak, live);
    response.writeHead(200, { 'content-type': 'text/plain' }); response.write('first');
    setTimeout(() => { live--; response.end('last'); }, 25);
  });
  let protocol: ReturnType<typeof installRequestProtocol> | undefined;
  try {
    for (let n = 0; !existsSync(join(out, 'pools/endpoint.json')); n++) {
      if (n > 100) throw new Error('Pool startup timeout');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const endpoint = JSON.parse(readFileSync(join(out, 'pools/endpoint.json'), 'utf8'));
    process.env.XOPC_STYLE_POOL_URL = endpoint.url; process.env.XOPC_STYLE_POOL_TOKEN = endpoint.token;
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as any).port}/v1/responses`;
    protocol = installRequestProtocol({ out, expectedModel: 'test/gpt-5.6-sol', pool: 'generation', caseId: 'physical-cap' });
    await Promise.all(Array.from({ length: 12 }, async () => {
      const response = await fetch(url, { method: 'POST', body: JSON.stringify({ model: 'gpt-5.6-sol' }) });
      assert.equal(await response.text(), 'firstlast');
    }));
    assert.equal(peak, 4); assert.equal(calls, 12); assert.equal(live, 0);
    await assert.rejects(fetch(url, { method: 'POST', body: JSON.stringify({ model: 'unexpected' }) }), /unexpected model/);
    assert.equal(calls, 12);
    const events = readFileSync(join(out, 'model-requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.filter(event => event.event === 'start').length, 12);
    assert.equal(events.filter(event => event.event === 'end').length, 12);
    const status = await originalFetch(endpoint.url+'/status', { method: 'POST', headers: {
      Authorization: `Bearer ${endpoint.token}`, 'Content-Type': 'application/json' }, body: '{}' }).then(response => response.json()) as any;
    assert.equal(status.active.generation, 0);
  } finally {
    await protocol?.close(); globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.XOPC_STYLE_POOL_URL; else process.env.XOPC_STYLE_POOL_URL = oldUrl;
    if (oldToken === undefined) delete process.env.XOPC_STYLE_POOL_TOKEN; else process.env.XOPC_STYLE_POOL_TOKEN = oldToken;
    server.close(); if (child.exitCode === null) { child.kill('SIGINT'); await once(child, 'exit'); } rmSync(out, { recursive: true, force: true });
  }
});
