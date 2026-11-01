import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { DesktopContainerEngine, type DesktopContainerOwnership } from '../desktop/container-engine.js';

it('confines Docker configuration to fixed limits and owned volumes, refuses foreign ownership and detects Engine substitution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-engine-')), socket = join(root, 'engine.sock');
  const owner = { ownerId: randomUUID(), workspaceId: randomUUID(), operationId: randomUUID() }, id = 'a'.repeat(64), image = 'sha256:' + 'b'.repeat(64);
  let identity = 'fixture-engine', created: any, deleted = false;
  const requests: string[] = [];
  const server = http.createServer(async (request, response) => {
    requests.push(request.method + ' ' + request.url); response.setHeader('content-type', 'application/json');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    if (request.url === '/v1.45/info') response.end(JSON.stringify({ ID: identity, OSType: 'linux' }));
    else if (request.url?.includes('/images/')) response.end(JSON.stringify({ Id: image }));
    else if (request.url === '/v1.45/volumes/create') response.end(JSON.stringify({ Name: body.Name, Driver: 'local', Labels: body.Labels, Options: null }));
    else if (request.url?.startsWith('/v1.45/volumes/')) response.end(JSON.stringify({ Name: `xopc-workspace-${owner.ownerId}-${owner.workspaceId}`, Driver: 'local', Labels: { 'ai.xopc.owner': owner.ownerId, 'ai.xopc.workspace': owner.workspaceId }, Options: null }));
    else if (request.url?.startsWith('/v1.45/containers/create')) { created = body; response.writeHead(201).end(JSON.stringify({ Id: id })); }
    else if (request.url?.endsWith('/json')) {
      if (deleted) response.writeHead(404).end('{}');
      else response.end(JSON.stringify({ Id: id, Config: { Labels: created.Labels }, State: { Running: true, ExitCode: 0 } }));
    } else if (request.method === 'DELETE') { deleted = true; response.writeHead(204).end(); }
    else if (request.url?.endsWith('/start')) response.writeHead(204).end();
    else response.writeHead(404).end('{}');
  }).listen(socket); await once(server, 'listening');
  try {
    const engine = await DesktopContainerEngine.connect(socket);
    expect(await engine.resolveInstalledImage('node:fixture')).toBe(image);
    const volume = await engine.ensureWorkspace(owner.ownerId, owner.workspaceId);
    expect(await engine.create({ ...owner, imageId: image, argv: ['node', '-e', 'process.exit(0)'] })).toBe(id);
    expect(created).toMatchObject({ Image: image, Entrypoint: ['node'], Cmd: ['-e', 'process.exit(0)'], User: '1000:1000',
      HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], PidsLimit: 64,
        Memory: 268435456, Mounts: [{ Type: 'volume', Source: volume, Target: '/home/node' }] } });
    expect(created.HostConfig).not.toHaveProperty('Binds'); expect(created.HostConfig).not.toHaveProperty('Privileged');
    expect(created.Env).toEqual(['HOME=/home/node', 'PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8']);
    await engine.start(id, owner);
    expect(await engine.remove(id, { ...owner, operationId: randomUUID() })).toEqual({ confirmed: false }); expect(deleted).toBe(false);
    expect(await engine.remove(id, owner)).toEqual({ confirmed: true });
    identity = 'replacement-engine';
    await expect(engine.create({ ...owner, imageId: image, argv: ['node'] })).rejects.toThrow('ENGINE_CHANGED');
    expect(requests.filter(value => value.startsWith('POST /v1.45/containers/create'))).toHaveLength(1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.env.XOPC_CONTAINER_LIVE !== '1')('uses the real local Engine with a writable owned volume and destroys an entire detached-child container', async () => {
  const engine = await DesktopContainerEngine.connect(), image = await engine.resolveInstalledImage('node:26.12.1-bookworm-slim');
  const request = (engine as any).request.bind(engine);
  vi.spyOn(engine as any, 'request').mockImplementation(async (...args) => {
    const response = await request(...args);
    if (args[0] === 'POST' && String(args[1]).endsWith('/start') && response.status !== 204) console.info('Private Docker fixture start rejection', response.status, response.bytes.toString().slice(0, 2000));
    return response;
  });
  const base = { ownerId: randomUUID(), workspaceId: randomUUID() }, volume = await engine.ensureWorkspace(base.ownerId, base.workspaceId);
  const containers: Array<{ id: string; owner: DesktopContainerOwnership }> = [];
  try {
    const owner = { ...base, operationId: randomUUID() };
    const id = await engine.create({ ...owner, imageId: image, argv: ['node', '-e', "if(process.getuid()!==1000||process.env.XOPC_CONFIG_PATH||process.env.OPENAI_API_KEY)process.exit(3);require('fs').writeFileSync('/home/node/fixture.txt','private fixture');console.log('fixture stdout');console.error('fixture stderr')"] }); containers.push({ id, owner });
    const actual = JSON.parse(execFileSync('docker', ['--host', `unix://${engine.socketPath}`, 'inspect', id], { encoding: 'utf8' }))[0];
    expect(actual.Config.User).toBe('1000:1000'); expect(actual.HostConfig).toMatchObject({ NetworkMode: 'none', ReadonlyRootfs: true, PidsLimit: 64, Memory: 268435456, CapDrop: ['ALL'] });
    expect(actual.Mounts.map((mount: any) => ({ Type: mount.Type, Name: mount.Name, Destination: mount.Destination }))).toEqual([{ Type: 'volume', Name: volume, Destination: '/home/node' }]);
    await engine.start(id, owner);
    expect(await engine.wait(id, owner, AbortSignal.timeout(10000))).toBe(0);
    await vi.waitFor(async () => expect(await engine.inspect(id, owner)).toEqual({ Running: false, ExitCode: 0 }), { timeout: 10000 });
    expect(await engine.output(id, owner)).toEqual({ stdout: 'fixture stdout\n', stderr: 'fixture stderr\n', truncated: false });
    expect(await engine.remove(id, owner)).toEqual({ confirmed: true });
    const second = { ...base, operationId: randomUUID() };
    const child = await engine.create({ ...second, imageId: image, argv: ['node', '-e', "if(require('fs').readFileSync('/home/node/fixture.txt','utf8')!=='private fixture')process.exit(2);require('child_process').spawn('node',['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}).unref();setInterval(()=>{},1000)"] }); containers.push({ id: child, owner: second });
    await engine.start(child, second);
    expect(await engine.inspect(child, second)).toMatchObject({ Running: true });
    expect(await engine.remove(child, { ...second, ownerId: randomUUID() })).toEqual({ confirmed: false });
    expect(await engine.remove(child, second)).toEqual({ confirmed: true }); expect(await engine.inspect(child, second)).toBeUndefined();
  } finally {
    for (const item of containers) expect(await engine.remove(item.id, item.owner)).toEqual({ confirmed: true });
    // Only this test-created, UUID-named private volume is disposable.
    execFileSync('docker', ['--host', `unix://${engine.socketPath}`, 'volume', 'rm', volume], { stdio: 'ignore' });
  }
}, 30000);

it.skipIf(process.env.XOPC_CONTAINER_LIVE !== '1')('attaches a real isolated TTY before start, transfers raw bytes and applies resize without treating disconnect as stop', async () => {
  const engine = await DesktopContainerEngine.connect(), image = await engine.resolveInstalledImage('node:26.12.1-bookworm-slim');
  const owner = { ownerId: randomUUID(), workspaceId: randomUUID(), operationId: randomUUID() }, volume = await engine.ensureWorkspace(owner.ownerId, owner.workspaceId);
  const id = await engine.create({ ...owner, imageId: image, argv: ['/bin/sh'], tty: true });
  let socket: Awaited<ReturnType<DesktopContainerEngine['attachTerminal']>> | undefined;
  try {
    socket = await engine.attachTerminal(id, owner); let output = '';
    socket.on('error', () => {}); socket.on('data', bytes => { output = (output + bytes.toString()).slice(-16384); }); socket.resume();
    await engine.start(id, owner); await engine.resizeTerminal(id, owner, 100, 30);
    socket.write("printf 'TTY_%s\\n' READY\r");
    await vi.waitFor(() => expect(output).toContain('TTY_READY'), { timeout: 5000 });
    socket.write('stty size\r'); await vi.waitFor(() => expect(output).toContain('30 100'), { timeout: 5000 });
    socket.destroy(); expect(await engine.inspect(id, owner)).toMatchObject({ Running: true });
    expect(await engine.remove(id, owner)).toEqual({ confirmed: true }); expect(await engine.inspect(id, owner)).toBeUndefined();
  } finally { socket?.destroy(); expect(await engine.remove(id, owner)).toEqual({ confirmed: true }); execFileSync('docker', ['--host', `unix://${engine.socketPath}`, 'volume', 'rm', volume], { stdio: 'ignore' }); }
}, 30000);
