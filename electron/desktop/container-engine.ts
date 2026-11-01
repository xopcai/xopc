import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';

import { z } from 'zod';

const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/), containerId = z.string().regex(/^[a-f0-9]{64}$/);
const ownership = z.strictObject({ ownerId: z.uuid(), workspaceId: z.uuid(), operationId: z.uuid() });
export type DesktopContainerOwnership = z.infer<typeof ownership>;
const labels = (owner: DesktopContainerOwnership) => ({ 'ai.xopc.owner': owner.ownerId, 'ai.xopc.workspace': owner.workspaceId, 'ai.xopc.operation': owner.operationId });
const volumeName = (ownerId: string, workspaceId: string) => `xopc-workspace-${z.uuid().parse(ownerId)}-${z.uuid().parse(workspaceId)}`;

/** Private local Engine adapter. Its callers are Main-owned coordinators, never IPC payloads or Agent supplied Docker options. */
export class DesktopContainerEngine {
  private constructor(readonly socketPath: string, readonly engineId: string) {}
  static async connect(path = '/var/run/docker.sock', expectedId?: string) {
    const socket = await realpath(path), info = await stat(socket);
    if (!info.isSocket() || process.getuid && ![0, process.getuid()].includes(info.uid)) throw new Error('DESKTOP_CONTAINER_LOCAL_SOCKET_REQUIRED');
    const provisional = new DesktopContainerEngine(socket, '');
    const response = await provisional.json('GET', '/info');
    const identity = z.object({ ID: z.string().regex(/^[A-Za-z0-9:-]{1,128}$/), OSType: z.literal('linux') }).parse(response);
    if (expectedId && identity.ID !== expectedId) throw new Error('DESKTOP_CONTAINER_ENGINE_CHANGED');
    return new DesktopContainerEngine(socket, identity.ID);
  }
  async verifyIdentity(): Promise<void> {
    const response = z.object({ ID: z.string() }).parse(await this.json('GET', '/info'));
    if (response.ID !== this.engineId) throw new Error('DESKTOP_CONTAINER_ENGINE_CHANGED');
  }
  async resolveInstalledImage(reference: string) {
    if (!reference || reference.length > 256 || /[\x00-\x20?#]/.test(reference)) throw new Error('DESKTOP_CONTAINER_IMAGE_INVALID');
    await this.verifyIdentity();
    return imageId.parse(z.object({ Id: imageId }).parse(await this.json('GET', `/images/${encodeURIComponent(reference)}/json`)).Id);
  }
  async ensureWorkspace(ownerId: string, workspaceId: string): Promise<string> {
    const name = volumeName(ownerId, workspaceId); await this.verifyIdentity();
    const expected = { 'ai.xopc.owner': ownerId, 'ai.xopc.workspace': workspaceId };
    const result = z.object({ Name: z.literal(name), Driver: z.literal('local'), Labels: z.record(z.string(), z.string()), Options: z.record(z.string(), z.string()).nullable().optional() }).parse(
      await this.json('POST', '/volumes/create', { Name: name, Driver: 'local', Labels: expected }));
    if (Object.entries(expected).some(([key, value]) => result.Labels[key] !== value) || result.Options && Object.keys(result.Options).length) throw new Error('DESKTOP_CONTAINER_WORKSPACE_IDENTITY_MISMATCH');
    return name;
  }
  private async verifyWorkspace(owner: DesktopContainerOwnership) {
    const name = volumeName(owner.ownerId, owner.workspaceId);
    const result = z.object({ Name: z.literal(name), Driver: z.literal('local'), Labels: z.record(z.string(), z.string()), Options: z.record(z.string(), z.string()).nullable().optional() }).parse(await this.json('GET', `/volumes/${name}`));
    if (result.Labels['ai.xopc.owner'] !== owner.ownerId || result.Labels['ai.xopc.workspace'] !== owner.workspaceId
      || result.Options && Object.keys(result.Options).length) throw new Error('DESKTOP_CONTAINER_WORKSPACE_IDENTITY_MISMATCH');
  }
  async create(input: DesktopContainerOwnership & { imageId: string; argv: string[]; tty?: boolean }) {
    const owner = ownership.parse({ ownerId: input.ownerId, workspaceId: input.workspaceId, operationId: input.operationId });
    const image = imageId.parse(input.imageId), argv = z.array(z.string().max(8192).refine(value => !value.includes('\0'))).min(1).max(128).parse(input.argv);
    if (!argv[0] || Buffer.byteLength(JSON.stringify(argv)) > 32768) throw new Error('DESKTOP_CONTAINER_ARGUMENT_LIMIT');
    await this.verifyIdentity();
    await this.verifyWorkspace(owner);
    const name = `xopc-operation-${owner.operationId}`;
    const result = z.object({ Id: containerId }).parse(await this.json('POST', `/containers/create?name=${name}`, {
      Image: image, Entrypoint: [argv[0]], Cmd: argv.slice(1), User: '1000:1000', WorkingDir: '/home/node',
      Env: ['HOME=/home/node', 'PATH=/usr/local/bin:/usr/bin:/bin', 'LANG=C.UTF-8'], Labels: labels(owner),
      AttachStdout: true, AttachStderr: true, AttachStdin: Boolean(input.tty), OpenStdin: Boolean(input.tty), Tty: Boolean(input.tty),
      HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'],
        PidsLimit: 64, Memory: 256 * 1024 * 1024, MemorySwap: 256 * 1024 * 1024, NanoCpus: 1000000000,
        RestartPolicy: { Name: 'no' }, Init: true, AutoRemove: false,
        Ulimits: [{ Name: 'nofile', Soft: 1024, Hard: 1024 }],
        Tmpfs: { '/tmp': 'rw,nosuid,nodev,noexec,size=16777216' },
        Mounts: [{ Type: 'volume', Source: volumeName(owner.ownerId, owner.workspaceId), Target: '/home/node', ReadOnly: false }],
        LogConfig: { Type: 'local', Config: { 'max-size': '1m', 'max-file': '1', compress: 'false' } },
      },
    }));
    return result.Id;
  }
  async inspect(id: string, owner: DesktopContainerOwnership) {
    containerId.parse(id); ownership.parse(owner);
    const response = await this.request('GET', `/containers/${id}/json`);
    if (response.status === 404) return;
    if (response.status !== 200) throw new Error('DESKTOP_CONTAINER_INSPECT_FAILED');
    const value = z.object({ Id: z.literal(id), Config: z.object({ Labels: z.record(z.string(), z.string()) }),
      State: z.object({ Running: z.boolean(), ExitCode: z.number().int() }) }).parse(JSON.parse(response.bytes.toString()));
    if (Object.entries(labels(owner)).some(([key, expected]) => value.Config.Labels[key] !== expected)) throw new Error('DESKTOP_CONTAINER_IDENTITY_MISMATCH');
    return value.State;
  }
  /** CID must already be durably recorded before this method is called. Never retried implicitly. */
  async start(id: string, owner: DesktopContainerOwnership) {
    await this.verifyIdentity();
    if (!await this.inspect(id, owner)) throw new Error('DESKTOP_CONTAINER_NOT_FOUND');
    const response = await this.request('POST', `/containers/${containerId.parse(id)}/start`);
    if (response.status !== 204) throw new Error('DESKTOP_CONTAINER_START_UNKNOWN');
  }
  async wait(id: string, owner: DesktopContainerOwnership, signal: AbortSignal): Promise<number> {
    if (!await this.inspect(id, owner)) throw new Error('DESKTOP_CONTAINER_NOT_FOUND');
    const response = await this.request('POST', `/containers/${containerId.parse(id)}/wait?condition=not-running`, undefined, signal);
    if (response.status !== 200) throw new Error('DESKTOP_CONTAINER_WAIT_UNKNOWN');
    const result = z.object({ StatusCode: z.number().int(), Error: z.object({ Message: z.string() }).nullable().optional() }).parse(JSON.parse(response.bytes.toString()));
    if (result.Error?.Message) throw new Error('DESKTOP_CONTAINER_WAIT_UNKNOWN');
    await this.verifyIdentity(); return result.StatusCode;
  }
  async output(id: string, owner: DesktopContainerOwnership) {
    if (!await this.inspect(id, owner)) throw new Error('DESKTOP_CONTAINER_NOT_FOUND');
    const response = await this.request('GET', `/containers/${containerId.parse(id)}/logs?stdout=true&stderr=true&timestamps=false`, undefined, undefined, true);
    if (response.status !== 200) throw new Error('DESKTOP_CONTAINER_OUTPUT_UNKNOWN');
    let offset = 0, stdout = '', stderr = '', truncated = response.truncated;
    while (offset + 8 <= response.bytes.length) {
      const stream = response.bytes[offset], length = response.bytes.readUInt32BE(offset + 4);
      if (![1, 2].includes(stream) || response.bytes.subarray(offset + 1, offset + 4).some(byte => byte !== 0)) throw new Error('DESKTOP_CONTAINER_OUTPUT_INVALID');
      const end = Math.min(offset + 8 + length, response.bytes.length), text = response.bytes.subarray(offset + 8, end).toString('utf8');
      if (stream === 1) stdout += text; else stderr += text;
      if (end < offset + 8 + length) truncated = true;
      offset = end;
    }
    if (offset !== response.bytes.length) truncated = true;
    // Preserve room for the signed Endpoint frame even with escaped control characters.
    while (Buffer.byteLength(JSON.stringify({ stdout, stderr })) > 32768) { stdout = stdout.slice(0, Math.floor(stdout.length / 2)); stderr = stderr.slice(0, Math.floor(stderr.length / 2)); truncated = true; }
    return { stdout, stderr, truncated };
  }
  async remove(id: string, owner: DesktopContainerOwnership): Promise<{ confirmed: boolean }> {
    try {
      await this.verifyIdentity();
      if (await this.inspect(id, owner)) {
        const response = await this.request('DELETE', `/containers/${containerId.parse(id)}?force=true&v=false`);
        if (![204, 404].includes(response.status)) return { confirmed: false };
      }
      const absent = !await this.inspect(id, owner); await this.verifyIdentity();
      return { confirmed: absent };
    } catch { return { confirmed: false }; }
  }
  private async json(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.request(method, path, body);
    if (response.status < 200 || response.status >= 300) throw new Error('DESKTOP_CONTAINER_REQUEST_FAILED');
    try { return JSON.parse(response.bytes.toString('utf8')); } catch { throw new Error('DESKTOP_CONTAINER_RESPONSE_INVALID'); }
  }
  private request(method: string, path: string, body?: unknown, signal?: AbortSignal, truncate = false) {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<{ status: number; bytes: Buffer; truncated: boolean }>((resolve, reject) => {
      const request = http.request({ socketPath: this.socketPath, path: '/v1.45' + path, method, agent: false, signal: signal ?? AbortSignal.timeout(1000),
        headers: encoded === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(encoded)) } });
      request.on('error', () => reject(new Error('DESKTOP_CONTAINER_NETWORK_FAILED')));
      request.on('response', response => {
        let bytes = 0; const chunks: Buffer[] = [];
        response.on('data', chunk => {
          const maximum = truncate ? 16384 : 65536, available = Math.max(0, maximum - bytes); bytes += chunk.length;
          if (bytes > maximum) {
            if (!truncate) response.destroy(new Error('DESKTOP_CONTAINER_RESPONSE_LIMIT'));
            else { chunks.push(chunk.subarray(0, available)); resolve({ status: response.statusCode ?? 0, bytes: Buffer.concat(chunks), truncated: true }); response.destroy(); }
          } else chunks.push(chunk);
        });
        response.on('error', () => reject(new Error('DESKTOP_CONTAINER_RESPONSE_FAILED')));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, bytes: Buffer.concat(chunks), truncated: false }));
      });
      request.end(encoded);
    });
  }
}
