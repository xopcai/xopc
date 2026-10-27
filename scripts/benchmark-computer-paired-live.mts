/** Real model A/B through authenticated Gateway HTTP and signed desktop WebSocket. */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { createComputerFlowNetworkProxy } from './lib/computer-flow-network-proxy.mjs';

assert.equal(process.platform, 'darwin'); assert.ok(process.env.DASHSCOPE_API_KEY);
const repetitions = Number(process.argv[2] ?? 3);
assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 5);
const repo = resolve(import.meta.dirname, '..'), root = await mkdtemp(join(tmpdir(), 'xopc-paired-ui-'));
const cache = join(repo, '.cache/computer-paired'); await mkdir(cache, { recursive: true });
const fixture = join(root, 'XopcInputBenchmark.app/Contents'); await mkdir(join(fixture, 'MacOS'), { recursive: true });
await copyFile(join(repo, 'scripts/fixtures/ComputerInputBenchmark.swift'), join(root, 'fixture.swift'));
await writeFile(join(fixture, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.xopc.input-benchmark</string><key>CFBundleName</key><string>XopcInputBenchmark</string><key>CFBundleExecutable</key><string>XopcInputBenchmark</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>');
await promisify(execFile)('xcrun', ['swiftc', join(root, 'fixture.swift'), '-o', join(fixture, 'MacOS/XopcInputBenchmark')]);
await build({ entryPoints: [join(repo, 'scripts/verify-computer-paired-desktop.mts')], outfile: join(cache, 'desktop.mjs'), bundle: true,
  platform: 'node', format: 'esm', external: ['electron', '@trycua/cua-driver', '@earendil-works/*', 'sharp', 'better-sqlite3'],
  banner: { js: 'import {createRequire as __pairedRequire} from "node:module"; const require=__pairedRequire(import.meta.url);' } });
const free = createServer(); await new Promise<void>(resolve => free.listen(0, '127.0.0.1', resolve));
const port = (free.address() as any).port; await new Promise<void>(resolve => free.close(() => resolve()));
const token = randomBytes(32).toString('hex');
await writeFile(join(root, 'xopc.json'), JSON.stringify({ computer: { enabled: true }, gateway: { port, bind: 'loopback', auth: { mode: 'token', token } } }), { mode: 0o600 });
await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { 'ui-benchmark': {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', apiKey: 'DASHSCOPE_API_KEY',
  models: [{ id: 'qwen3.5-plus', name: 'Paired visual main model', reasoning: false, input: ['text', 'image'],
    contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, computerUse: { profile: 'structured-tools-v1' } }],
} } }), { mode: 0o600 });
await mkdir(join(root, 'workspace'));
const env: NodeJS.ProcessEnv = { ...process.env, XOPC_STATE_DIR: root, XOPC_HOME: root, XOPC_WORKSPACE: join(root, 'workspace'),
  XOPC_CONFIG_PATH: join(root, 'xopc.json'), XOPC_CREDENTIALS_DIR: join(root, 'credentials'),
  XOPC_SQLITE_ASSET_ROOT: join(repo, 'src/storage/sqlite'), XOPC_LOG_LEVEL: 'fatal', XOPC_LOG_FILE: 'false', XOPC_PAIR_TOKEN: token };
delete env.ELECTRON_RUN_AS_NODE;
function child(binary: string, args: string[], environment = env) {
  const proc = spawn(binary, args, { cwd: repo, env: environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = ''; const capture = (b: Buffer) => { output = (output + b).slice(-4000); void writeFile(join(root, `child-${proc.pid}.log`), output, {mode:0o600}); };
  proc.stdout.on('data', capture); proc.stderr.on('data', capture);
  const pending = new Map<string, { resolve(v: any): void; reject(e: Error): void }>();
  let readyResolve!: () => void, readyReject!: (e: Error) => void;
  const ready = new Promise<void>((r, j) => { readyResolve = r; readyReject = j; });
  const startup = setTimeout(() => readyReject(new Error(`Startup timeout: ${output}`)), 90_000);
  proc.on('message', (m: any) => { if(m.progress){console.log(JSON.stringify({phase:'model-progress',...m.progress}));return;} if (m.ready) { clearTimeout(startup); readyResolve(); return; } const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.value); } });
  proc.on('exit', () => { clearTimeout(startup); readyReject(new Error(`Child exited: ${output}`)); for (const p of pending.values()) p.reject(new Error(`Child exited: ${output}`)); });
  return { proc, ready, rpc: (op: string, fields: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
    if (!proc.connected) { reject(new Error('PAIR_CHILD_CLOSED')); return; }
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(new Error('PAIR_RPC_TIMEOUT')); }, 240_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    proc.send({ id, op, ...fields });
  }) };
}
const proxy = createComputerFlowNetworkProxy(port); await new Promise<void>(r => proxy.http.listen(0, '127.0.0.1', r));
const proxyPort = (proxy.http.address() as any).port;
const gateway = child(process.execPath, ['--import', 'tsx', join(repo, 'scripts/verify-computer-paired-gateway.mts')]);
let desktop: ReturnType<typeof child> | undefined, target: ReturnType<typeof spawn> | undefined;
const rows: any[] = [];
const resultPath = join(root, 'comparison.json');
const requestedRuns = repetitions * (process.env.XOPC_PAIR_MODE ? 1 : 2);
const checkpoint = async () => writeFile(resultPath, JSON.stringify({ version: 1, repetitions, requestedRuns, rows, network: proxy.counts }, null, 2), { mode: 0o600 });
try {
  await gateway.ready; console.log(JSON.stringify({phase:'gateway-ready',evidence:resultPath}));
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(`http://127.0.0.1:${proxyPort}/api/endpoint-tools/devices`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${proxyPort}/api/endpoint-tools/devices`, { headers })).status, 200);
  const desktopEnv: NodeJS.ProcessEnv = { ...env, XOPC_PAIR_PROXY_PORT: String(proxyPort) }; delete desktopEnv.DASHSCOPE_API_KEY;
  desktop = child(createRequire(import.meta.url)('electron') as string, [join(cache, 'desktop.mjs')], desktopEnv);
  await desktop.ready; console.log(JSON.stringify({phase:'desktop-ready'}));
  let endpointId: string | undefined;
  for (let i = 0; i < 300; i++) { const state = await gateway.rpc('status'); endpointId = state.endpoints[0]?.endpointId; if (endpointId) break; await delay(100); }
  assert.ok(endpointId, 'Signed desktop endpoint not connected');
  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (const mode of (repetition % 2 ? ['agent', 'gui'] : ['gui', 'agent']).filter(mode => !process.env.XOPC_PAIR_MODE || mode === process.env.XOPC_PAIR_MODE)) {
      const oracle = join(root, `oracle-${repetition}-${mode}.json`);
      target = spawn(join(fixture, 'MacOS/XopcInputBenchmark'), [oracle], { stdio: 'ignore' });
      for (let i = 0; i < 100; i++) { if (await readFile(oracle, 'utf8').then(() => true, () => false)) break; await delay(100); }
      const initial = JSON.parse(await readFile(oracle, 'utf8')); assert.equal(initial.text, ''); assert.equal(initial.count, 0);
      await desktop.rpc('access');
      const countsBefore = { ...proxy.counts };
      console.log(JSON.stringify({ phase: 'running', repetition, mode, evidence: resultPath }));
      let value: any;
      try { value = await gateway.rpc(process.env.XOPC_PAIR_PUBLIC === '1' ? 'public' : 'run', { mode, endpointId, ...(process.env.XOPC_PAIR_PUBLIC === '1' ? {claim: await desktop.rpc('claim')} : {}) }); }
      catch (error) { value = { mode, ok: false, error: error instanceof Error ? error.message : 'PAIR_FAILED' }; }
      await delay(100);
      const final = JSON.parse(await readFile(oracle, 'utf8'));
      const visualMain = mode !== 'agent' || (value.modelCalls?.some((call: any) => call.kind === 'main' && call.vision && call.ok)
        && !value.modelCalls?.some((call: any) => call.kind === 'gui'));
      const verified = visualMain && final.pid === target.pid && final.text === 'XOPC NETWORK VERIFIED' && final.count === 1;
      const network = Object.fromEntries(Object.entries(proxy.counts).map(([key, v]) => [key, v - (countsBefore as any)[key]]));
      const desktopState = await desktop.rpc('status');
      if (value.transport === 'public-session-input') value.released = desktopState.session?.status === 'stopped';
      rows.push({ repetition, ...value, verified, oracle: { exactField: final.text === 'XOPC NETWORK VERIFIED', count: final.count }, network,
        desktop: desktopState });
      await checkpoint(); console.log(JSON.stringify({ phase: 'finished', repetition, mode, verified, ok: value.ok, elapsedMs: value.elapsedMs, error: value.error }));
      const exiting = once(target, 'exit'); target.kill(); await exiting; target = undefined;
      if (!value.released || desktopState.session?.status !== 'stopped' || (value.report?.counters.unknownDispatches ?? 0) > 0) {
        throw new Error('PAIR_STOPPED_AFTER_UNCONFIRMED_CLEANUP');
      }
    }
  }
  await desktop.rpc('stop'); await gateway.rpc('stop');
} finally {
  target?.kill();
  const children = [desktop, gateway].filter(Boolean) as Array<ReturnType<typeof child>>;
  await Promise.race([Promise.allSettled(children.filter(child => child.proc.connected).map(child => child.rpc('stop'))), delay(2000)]);
  for (const child of children) if (child.proc.exitCode === null) child.proc.kill('SIGKILL');
  await proxy.close(); await checkpoint();
  console.log(JSON.stringify({ evidence: resultPath, completedRuns: rows.length, requestedRuns }));
}
