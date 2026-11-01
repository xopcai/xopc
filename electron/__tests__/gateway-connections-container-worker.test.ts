import { execFileSync, spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

import { canonicalJson, type DesktopOperationIntent } from '@xopcai/endpoint-tools-protocol';
import { expect, it, vi } from 'vitest';

import { DesktopContainerEngine } from '../desktop/container-engine.js';
import { DesktopContainerResources } from '../desktop/container-resources.js';
import { DesktopContainerWorker, stopRecordedContainer } from '../desktop/container-worker.js';
import { DesktopExecutionLease, DesktopOperationJournal } from '../desktop/operation-journal.js';
import { DesktopOperationSupervisor } from '../desktop/operation-supervisor.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xopc-container-worker-')), key = randomBytes(32), workspaceId = randomUUID();
  const encryption = {
    available: async () => true,
    encrypt: async (text: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decrypt: async (value: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(-16)); return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString(); },
  };
  const args = { workspaceId, argv: ['node', '-e', "console.log('private fixture')"] };
  const intent: DesktopOperationIntent = { operationId: randomUUID(), gatewayId: randomUUID(), deviceId: randomUUID(), workspaceId,
    tool: 'desktop.command.run', toolRevision: 'a'.repeat(64), argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex'), authorizationRevision: 1, expiresAt: Date.now() + 60000 };
  const resources = new DesktopContainerResources(join(root, 'resources'), encryption);
  const engine = { socketPath: '/private/synthetic-engine.sock', engineId: 'fixture-engine', create: vi.fn(async () => 'a'.repeat(64)), start: vi.fn(async () => {}),
    wait: vi.fn(async () => 0), output: vi.fn(async () => ({ stdout: 'private fixture\n', stderr: '', truncated: false })), remove: vi.fn(async () => ({ confirmed: true })) };
  const options = { resources, engine: engine as unknown as DesktopContainerEngine, intent, workspaceId, ownerId: randomUUID(), imageId: 'sha256:' + 'b'.repeat(64) };
  return { root, key, resources, engine, intent, args, options, cleanup: () => rm(root, { recursive: true, force: true }) };
}
it('persists encrypted resources and CID before start, removes before result and never starts on late cancellation', async () => {
  const f = await fixture();
  try {
    f.engine.start.mockImplementationOnce(async () => { expect(await f.resources.load(f.intent)).toMatchObject({ phase: 'created', containerId: 'a'.repeat(64) }); });
    const worker = new DesktopContainerWorker(f.options);
    expect(await worker.run(f.args, new AbortController().signal)).toMatchObject({ status: 'succeeded', result: { content: [{ value: { exitCode: 0 } }] } });
    expect(await f.resources.load(f.intent)).toMatchObject({ phase: 'stopped' }); expect(f.engine.remove).toHaveBeenCalledOnce();
    const encrypted = await readFile(join(f.root, 'resources', (await readdir(join(f.root, 'resources')))[0]));
    expect(encrypted.includes(Buffer.from('private fixture'))).toBe(false);
    await expect(worker.run(f.args, new AbortController().signal)).rejects.toThrow('ALREADY_STARTED');
    await expect(f.resources.load({ ...f.intent, deviceId: randomUUID() })).rejects.toThrow('IDENTITY_MISMATCH');
    const nextIntent = { ...f.intent, operationId: randomUUID() }, next = new DesktopContainerWorker({ ...f.options, intent: nextIntent });
    let finish!: (id: string) => void, created!: () => void;
    const reached = new Promise<void>(resolve => { created = resolve; });
    f.engine.create.mockImplementationOnce(() => { created(); return new Promise(resolve => { finish = resolve; }); });
    const run = next.run(f.args, new AbortController().signal), rejected = expect(run).rejects.toThrow('CANCELLED');
    await reached; const stopped = next.stop(); finish('c'.repeat(64));
    expect(await stopped).toEqual({ confirmed: true }); await rejected;
    expect(f.engine.start).toHaveBeenCalledOnce(); expect(await f.resources.load(nextIntent)).toMatchObject({ phase: 'stopped', containerId: 'c'.repeat(64) });
  } finally { await f.cleanup(); }
});
it('never sends start after CID persistence failure and retains unconfirmed removal for independent retry', async () => {
  const f = await fixture();
  try {
    vi.spyOn(f.resources, 'created').mockRejectedValueOnce(new Error('fixture fsync failure'));
    f.engine.remove.mockResolvedValue({ confirmed: false });
    const worker = new DesktopContainerWorker(f.options);
    await expect(worker.run(f.args, new AbortController().signal)).rejects.toThrow('fsync failure');
    expect(f.engine.start).not.toHaveBeenCalled(); expect(await worker.stop()).toEqual({ confirmed: false });
    expect(await f.resources.load(f.intent)).toMatchObject({ phase: 'prepared' });
    f.engine.remove.mockResolvedValue({ confirmed: true }); expect(await worker.stop()).toEqual({ confirmed: true });
    expect(await f.resources.load(f.intent)).toMatchObject({ phase: 'stopped' });
  } finally { await f.cleanup(); }
});
it.skipIf(process.env.XOPC_CONTAINER_LIVE !== '1')('uses the real journal/supervisor and local Docker; result is terminal only after verified container removal', async () => {
  const f = await fixture(), engine = await DesktopContainerEngine.connect();
  const imageId = await engine.resolveInstalledImage('node:26.12.1-bookworm-slim');
  const volume = await engine.ensureWorkspace(f.options.ownerId, f.options.workspaceId);
  const lease = new DesktopExecutionLease(f.root), journal = new DesktopOperationJournal(lease);
  try {
    const supervisor = new DesktopOperationSupervisor({ journal, authority: () => ({ gatewayId: f.intent.gatewayId, deviceId: f.intent.deviceId, workspaceId: f.intent.workspaceId,
      authorizationRevision: 1, toolRevision: f.intent.toolRevision, active: true, expiresAt: f.intent.expiresAt }),
      createWorker: () => new DesktopContainerWorker({ ...f.options, engine, imageId }) });
    const first = await supervisor.execute({ intent: f.intent, arguments: f.args, invocationId: randomUUID(), connectionInstanceId: randomUUID(), signal: new AbortController().signal });
    expect(first).toMatchObject({ repeated: false, receipt: { state: 'succeeded', executionStopped: true }, result: { content: [{ value: { exitCode: 0, stdout: 'private fixture\n' } }] } });
    const resource = await f.resources.load(f.intent); expect(resource).toMatchObject({ phase: 'stopped' });
    expect(await engine.inspect(resource.containerId!, { ownerId: resource.ownerId, workspaceId: resource.workspaceId, operationId: f.intent.operationId })).toBeUndefined();
    expect(await stopRecordedContainer(f.resources, f.intent)).toBe(true);
    const repeat = await supervisor.execute({ intent: f.intent, arguments: f.args, invocationId: randomUUID(), connectionInstanceId: randomUUID(), signal: new AbortController().signal });
    expect(repeat).toMatchObject({ repeated: true, receipt: { state: 'succeeded' } }); expect(repeat.result).toBeUndefined();
  } finally {
    journal.close(); lease.close(); execFileSync('docker', ['--host', `unix://${engine.socketPath}`, 'volume', 'rm', volume], { stdio: 'ignore' }); await f.cleanup();
  }
}, 30000);

it.skipIf(process.env.XOPC_CONTAINER_LIVE !== '1')('recovers a real parent SIGKILL using durable CID evidence; container removal preserves unknown and blocks new intents', async () => {
  const f = await fixture(), engine = await DesktopContainerEngine.connect();
  const imageId = await engine.resolveInstalledImage('node:26.12.1-bookworm-slim'), volume = await engine.ensureWorkspace(f.options.ownerId, f.options.workspaceId);
  const args = { workspaceId: f.args.workspaceId, argv: ['node', '-e', "require('child_process').spawn('node',['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}).unref();setInterval(()=>{},1000)"] };
  const intent = { ...f.intent, argumentHash: createHash('sha256').update(canonicalJson(args)).digest('hex') };
  const url = (name: string) => JSON.stringify(pathToFileURL(join(process.cwd(), 'electron/desktop', name + '.ts')).href);
  const code = `
    import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
    import { DesktopContainerEngine } from ${url('container-engine')};
    import { DesktopContainerResources } from ${url('container-resources')};
    import { DesktopContainerWorker } from ${url('container-worker')};
    import { DesktopExecutionLease,DesktopOperationJournal } from ${url('operation-journal')};
    import { DesktopOperationSupervisor } from ${url('operation-supervisor')};
    process.once('message', async message => {
      try {
        const key=Buffer.from(message.key,'base64');
        const encryption={available:async()=>true,encrypt:async text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]);},
          decrypt:async bytes=>{const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(-16));return Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]).toString();}};
        const engine=await DesktopContainerEngine.connect(message.socketPath,message.engineId),resources=new DesktopContainerResources(message.root+'/resources',encryption);
        const lease=new DesktopExecutionLease(message.root),journal=new DesktopOperationJournal(lease);
        const start=engine.start.bind(engine);engine.start=async(id,owner)=>{await start(id,owner);process.send({type:'started',id});};
        const supervisor=new DesktopOperationSupervisor({journal,authority:()=>({...message.intent,active:true}),
          createWorker:()=>new DesktopContainerWorker({engine,resources,intent:message.intent,ownerId:message.ownerId,workspaceId:message.intent.workspaceId,imageId:message.imageId})});
        await supervisor.execute({intent:message.intent,arguments:message.args,invocationId:message.invocationId,connectionInstanceId:message.connectionInstanceId,signal:new AbortController().signal});
        process.send({type:'unexpected-completion'});
      }catch(error){process.send({type:'error',message:String(error)});process.exit(1);}
    });`;
  const child = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', code], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: f.root, XOPC_LOG_LEVEL: 'fatal' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let logs = ''; child.stderr!.on('data', bytes => { logs = (logs + bytes.toString()).slice(-2000); });
  let lease: DesktopExecutionLease | undefined, journal: DesktopOperationJournal | undefined;
  try {
    const started = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Container parent fixture start timeout: ' + logs)), 10000);
      child.on('message', (message: any) => { clearTimeout(timer); message.type === 'started' ? resolve(message.id) : reject(new Error(JSON.stringify(message))); });
      child.once('error', reject); child.once('exit', () => { clearTimeout(timer); reject(new Error('Container parent fixture exited: ' + logs)); });
    });
    child.send({ root: f.root, socketPath: engine.socketPath, engineId: engine.engineId, imageId, ownerId: f.options.ownerId,
      key: f.key.toString('base64'), intent, args, invocationId: randomUUID(), connectionInstanceId: randomUUID() });
    const id = await started;
    expect(() => new DesktopExecutionLease(f.root)).toThrow('ALREADY_OWNED');
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    expect(await engine.inspect(id, { ownerId: f.options.ownerId, workspaceId: f.options.workspaceId, operationId: intent.operationId })).toMatchObject({ Running: true });
    lease = new DesktopExecutionLease(f.root); journal = new DesktopOperationJournal(lease);
    expect(journal.inspect(intent)).toMatchObject({ state: 'unknown', executionStopped: false });
    expect(await stopRecordedContainer(f.resources, intent)).toBe(true); journal.confirmUnknownStopped(intent);
    expect(journal.inspect(intent)).toMatchObject({ state: 'unknown', executionStopped: true }); expect(journal.hasUnknown()).toBe(true);
    const createWorker = vi.fn();
    const supervisor = new DesktopOperationSupervisor({ journal, authority: () => ({ ...intent, active: true }), createWorker });
    await expect(supervisor.execute({ intent: { ...intent, operationId: randomUUID() }, arguments: args, invocationId: randomUUID(), connectionInstanceId: randomUUID(), signal: new AbortController().signal })).rejects.toThrow('RECONCILIATION_REQUIRED');
    expect(createWorker).not.toHaveBeenCalled();
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    journal?.close(); lease?.close();
    await stopRecordedContainer(f.resources, intent).catch(() => false);
    execFileSync('docker', ['--host', `unix://${engine.socketPath}`, 'volume', 'rm', volume], { stdio: 'ignore' }); await f.cleanup();
  }
}, 30000);
