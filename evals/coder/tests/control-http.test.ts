import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ControlStore } from '../../control/store.js';
import { createDashboard } from '../../control/server.js';
import { RequestPool, startPool } from '../../control/request-pool.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const a = server.address(); if (!a || typeof a === 'string') throw Error('No server');
  cleanups.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return `http://127.0.0.1:${a.port}`;
}

describe('developer HTTP surface', () => {
  it('serves views, scopes trial access, refuses writes and replays persisted SSE events', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-dashboard-'));
    const store = new ControlStore(join(root, 'index.db'));
    cleanups.push(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
    const path = join(root, 'summary.json');
    writeFileSync(path, JSON.stringify({ total: 1, cases: [{ id: '<script>unsafe</script>', status: 'passed' }] }));
    store.import({ path, kind: 'delivery', benchmark: 'personal-delivery', evidenceClass: 'deterministic', expected: 1 });
    store.event('checkpoint', { sequence: 1 });
    store.event('checkpoint', { sequence: 2 });
    const dashboard = createDashboard(store); const url = await listen(dashboard.server); cleanups.push(dashboard.disconnect);
    const html = await fetch(url); expect(await html.text()).toContain('场景评测');
    expect(html.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect((await fetch(url + '/api/overview')).status).toBe(200);
    expect((await fetch(url + '/api/evidence', { method: 'POST' })).status).toBe(405);
    expect((await fetch(url + '/etc/passwd')).status).toBe(404);
    const e = store.list().items[0]!;
    expect((await fetch(`${url}/api/evidence/${e.id}/runs/${'a'.repeat(20)}`)).status).toBe(400);
    const abort = new AbortController();
    const stream = await fetch(url + '/api/events', { signal: abort.signal, headers: { 'Last-Event-ID': '2' } });
    const reader = stream.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('id: 3'); expect(text).not.toContain('id: 2');
    abort.abort(); await reader.cancel().catch(() => {});
  });

  it('limits physical streaming fetches across child processes until EOF', async () => {
    let active = 0; let peak = 0;
    const provider = createServer((_req, res) => {
      active++; peak = Math.max(peak, active);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: start\n\n');
      setTimeout(() => { active--; res.end('data: done\n\n'); }, 60);
    });
    const origin = await listen(provider);
    const pool = new RequestPool({ generation: 4, judge: 2 }, 2);
    const globalPool = new RequestPool({ generation: 4, judge: 2 }, 2);
    const global = await startPool(globalPool);
    cleanups.push(() => new Promise<void>(resolve => { globalPool.close(); global.server.closeAllConnections(); global.server.close(() => resolve()); }));
    const broker = await startPool(pool, global);
    const otherPool = new RequestPool({ generation: 4, judge: 2 }, 4);
    const other = await startPool(otherPool, global);
    cleanups.push(() => new Promise<void>(resolve => { otherPool.close(); other.server.closeAllConnections(); other.server.close(() => resolve()); }));
    cleanups.push(() => new Promise<void>(resolve => { pool.close(); broker.server.closeAllConnections(); broker.server.close(() => resolve()); }));
    const run = async (endpoint: {url: string; token: string}) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('../../control/request-preload.mjs', import.meta.url)), '--input-type=module', '-e',
        `await Promise.all(Array.from({length:4}, async()=>{const r=await fetch(${JSON.stringify(origin)}+'/v1/chat/completions', {method: 'POST', body: JSON.stringify({model:'test'})});const text=await r.text();if(!text.includes('done'))throw Error('incomplete')}));`], {
        env: { ...process.env, XOPC_EVAL_POOL_URL: endpoint.url, XOPC_EVAL_POOL_TOKEN: endpoint.token, XOPC_EVAL_MODEL_ORIGINS: JSON.stringify([origin]) }, stdio: 'pipe',
      });
      let error = ''; child.stderr.on('data', chunk => { error += String(chunk); });
      child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(Error(error)));
    });
    await Promise.all([run(broker), run(other)]);
    expect(peak).toBe(2); expect(active).toBe(0);
    expect(pool.snapshot()).toMatchObject({ active: 0, queued: 0 });
    expect(otherPool.snapshot()).toMatchObject({ active: 0, queued: 0 });
    expect(globalPool.snapshot()).toMatchObject({ active: 0, queued: 0, peaks: { total: 2 }, admitted: 8 });
  });
  it('reclaims only OS-confirmed dead owners, including their shared parent lease', async () => {
    const parent = new RequestPool({ generation: 1 }, 1);
    const global = await startPool(parent);
    const pool = new RequestPool({ generation: 1 }, 1);
    const broker = await startPool(pool, global);
    for (const endpoint of [broker, global]) cleanups.push(() => new Promise<void>(resolve => { endpoint.server.closeAllConnections(); endpoint.server.close(() => resolve()); }));
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
    const response = await fetch(broker.url + '/acquire', {method:'POST', headers:{Authorization:`Bearer ${broker.token}`}, body:JSON.stringify({pool:'generation',context:{pid:child.pid}})});
    expect(response.ok).toBe(true); expect(parent.snapshot().active).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(parent.snapshot().active).toBe(1);
    child.kill('SIGKILL'); await new Promise(resolve => child.once('close',resolve));
    await vi.waitFor(() => expect(pool.snapshot().active).toBe(0), {timeout:2000});
    expect(parent.snapshot().active).toBe(0);
  });

  it('records unknown interrupted tails synchronously on process exit', async () => {
    const root=mkdtempSync(join(tmpdir(),'eval-process-tail-')),audit=join(root,'requests.jsonl');
    cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
    const provider=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: partial\n\n');});
    const origin=await listen(provider),pool=new RequestPool({generation:1},1),broker=await startPool(pool);
    cleanups.push(()=>new Promise<void>(resolve=>{broker.server.closeAllConnections();broker.server.close(()=>resolve());}));
    const child=spawn(process.execPath,['--import',fileURLToPath(new URL('../../control/request-preload.mjs',import.meta.url)),'--input-type=module','-e',
      `const r=await fetch(${JSON.stringify(origin)}+'/chat/completions',{method:'POST',body:JSON.stringify({model:'test'})});await r.body.getReader().read();process.exit(0);`],
      {env:{...process.env,XOPC_EVAL_POOL_URL:broker.url,XOPC_EVAL_POOL_TOKEN:broker.token,XOPC_EVAL_MODEL_ORIGINS:JSON.stringify([origin]),XOPC_EVAL_AUDIT_PATH:audit},stdio:'ignore'});
    await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('child failed')));});
    const rows=readFileSync(audit,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    expect(rows).toHaveLength(2);expect(rows[1]).toMatchObject({event:'end',terminalState:'interrupted',error:'process_exit',usage:null});
    await vi.waitFor(()=>expect(pool.snapshot().active).toBe(0),{timeout:2000});
  });

});
