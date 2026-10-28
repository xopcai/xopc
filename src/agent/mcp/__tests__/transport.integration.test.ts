import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { McpClient } from '@earendil-works/pi-mcp';
import { expect, it, vi } from 'vitest';

import { createXopcMcpTransport, retryAfter, type McpObservation } from '../transport.js';

it('uses the native client on a real legacy SSE connection with a custom API-Key header', async () => {
  let stream: import('node:http').ServerResponse | undefined;
  const seen: string[] = [];
  const server = createServer((request, response) => { void (async () => {
    expect(request.headers['x-api-key']).toBe('fixture-api-key');
    if (request.method === 'GET') { stream = response; response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write('event: endpoint\ndata: /messages\n\n'); return; }
    let raw = ''; for await (const chunk of request) raw += chunk;
    const message = JSON.parse(raw); seen.push(message.method); response.writeHead(202).end(); if (message.id === undefined) return;
    const result = message.method === 'initialize' ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'legacy-fixture', version: '1' } }
      : message.method === 'tools/list' ? { tools: [{ name: 'read_profile', description: 'Read the fixture', inputSchema: { type: 'object', properties: {} } }] }
      : { content: [{ type: 'text', text: 'LEGACY-READ-VERIFIED' }] };
    stream!.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`);
  })().catch(() => response.writeHead(500).end()); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address() as { port: number };
  const client = new McpClient({ name: 'xopc-test', version: '1', requestTimeoutMs: 5000 });
  try {
    const transport = createXopcMcpTransport()({ name: 'legacy', config: { type: 'http', url: `http://127.0.0.1:${address.port}/legacy`, headers: { 'X-API-Key': 'fixture-api-key' }, xopcLegacySse: true } as any, source: 'test', scope: 'extension' }, process.cwd(), undefined);
    await client.connect(transport); expect((await client.listTools())[0].name).toBe('read_profile');
    expect(await client.callTool('read_profile', {})).toMatchObject({ content: [{ text: 'LEGACY-READ-VERIFIED' }] });
    expect(seen).toContain('initialize');
  } finally { await client.close(); stream?.end(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 15_000);

it('keeps optional GET 405 compatible with Streamable HTTP and exposes safe request diagnostics', async () => {
  const observations: McpObservation[] = [];
  const server = createServer((request, response) => { void (async () => {
    if (request.method === 'GET' || request.method === 'DELETE') { response.writeHead(405).end(); return; }
    let raw = ''; for await (const c of request) raw += c; const message = JSON.parse(raw);
    if (message.id === undefined) { response.writeHead(202).end(); return; }
    const result = message.method === 'initialize' ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'http-fixture', version: '1' } } : { tools: [] };
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  })().catch(() => response.writeHead(500).end()); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address() as { port: number };
  const client = new McpClient({ name: 'xopc-test', version: '1', requestTimeoutMs: 5000 });
  try {
    await client.connect(createXopcMcpTransport({ observe: value => observations.push(value) })({ name: 'http', config: { type: 'http', url: `http://127.0.0.1:${address.port}/mcp` }, source: 'test', scope: 'extension' }, process.cwd(), undefined));
    expect(await client.listTools()).toEqual([]); expect(observations.some(o => o.stage === 'initialize' && o.status === 200)).toBe(true);
    await vi.waitFor(() => expect(observations.some(o => o.method === 'GET' && o.status === 405)).toBe(true));
  } finally { await client.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 15_000);

it('executes a reviewed stdio plan with restricted environment and kills descendant processes on close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-stdio-transport-'));
  const fixture = join(root, 'server.mjs'), pidFile = join(root, 'child.pid');
  await writeFile(fixture, `import {createInterface} from 'node:readline';import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'local-fixture',version:'1'}}:m.method==='tools/list'?{tools:[{name:'read_profile',description:'Read fixture',inputSchema:{type:'object',properties:{}}}]}:{content:[{type:'text',text:JSON.stringify({authorized:process.env.TEST_SECRET==='fixture-secret',hostSecretPresent:!!process.env.XOPC_TEST_HOST_SECRET})}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
  vi.stubEnv('XOPC_TEST_HOST_SECRET', 'must-not-be-inherited');
  const client = new McpClient({ name: 'xopc-test', version: '1', requestTimeoutMs: 5000 });
  try {
    const transport = createXopcMcpTransport()({ name: 'local', config: { type: 'stdio', command: process.execPath, args: [fixture], cwd: root, env: { TEST_SECRET: 'fixture-secret' }, xopcManagedStdio: true } as any, source: 'test', scope: 'extension' }, root, undefined);
    await client.connect(transport); await client.listTools();
    const result = await client.callTool('read_profile', {}); expect(result).toMatchObject({ content: [{ text: JSON.stringify({ authorized: true, hostSecretPresent: false }) }] });
    const pid = Number(await readFile(pidFile, 'utf8')); await client.close();
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 4000 });
  } finally { await client.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
}, 15_000);

it('parses Retry-After without truncating a server-requested delay', () => {
  expect(retryAfter('120', 1000)).toBe(121000); expect(retryAfter(new Date(120000).toUTCString(), 1000)).toBe(120000);
  expect(retryAfter('invalid', 1000)).toBeUndefined();
});
