import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { RemoteFileSnapshots } from '../../../electron/files/remote-snapshots.js';
import { RemoteFileUpstream } from '../../../electron/files/remote-transport.js';
import { ShellUpstream } from '../../../electron/shell/upstream.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { EndpointToolRuntime } from '../../endpoint-tools/runtime.js';
import { fileResourceId, fileSpaceId } from '../../files/file-service.js';
import { ProjectService } from '../../projects/index.js';
import { RealtimeRuntime } from '../../realtime/runtime.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { ensureSessionRecord } from '../../storage/sqlite/session-repository.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('downloads and explicitly returns text snapshots through real owner authentication and lazy files routes; preserves conflicts and lost completion without retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-remote-files-http-')), workspace = join(root, 'server-workspace'), conversationId = randomUUID();
  const previousState = process.env.XOPC_STATE_DIR; process.env.XOPC_STATE_DIR = root;
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(root, 'gateway.db') });
  await mkdir(workspace); await writeFile(join(workspace, 'fixture.txt'), 'original');
  seedTestAgentCatalog({ agents: [{ id: 'main', workspace }] }); ensureSessionRecord(conversationId, workspace, { agentId: 'main' });
  const projects = new ProjectService(); projects.create({ name: 'Remote files fixture', workspaceRoot: workspace });
  const token = randomUUID(), config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const endpoints = new EndpointToolRuntime({ uploadRoot: join(root, 'uploads') }), realtime = new RealtimeRuntime(endpoints, () => false);
  const service = { currentConfig: config, endpointTools: endpoints, realtime, projects,
    agentService: { getResolvedWorkspaceForSession: () => workspace }, sessions: { getEffectiveWorkspacePath: async () => workspace },
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, isGatewayReady: () => true, getExtensionLoader: () => null,
    voiceRealtime: { disconnectPrincipal: vi.fn() }, phoneStreams: { disconnectPrincipal: vi.fn() }, emit: vi.fn(),
  } as unknown as GatewayService;
  const app = createHonoApp({ service }); let discard = false, writes = 0;
  const server = serve({ fetch: async (request, ...args) => {
    const response = await app.fetch(request, ...args);
    if (request.method === 'PUT' && new URL(request.url).pathname.endsWith('/content')) {
      writes += 1;
      if (discard && response.ok) return new Response('lost fixture reply', { status: 502 });
    }
    return response;
  }, hostname: '127.0.0.1', port: 0 });
  let upstream: ShellUpstream | undefined;
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
    const origin = `http://127.0.0.1:${address.port}`, id = fileResourceId(fileSpaceId(await realpath(workspace)), 'fixture.txt');
    expect((await fetch(`${origin}/api/files/${id}`)).status).toBe(401);
    upstream = new ShellUpstream({ origin, transport: 'ssh', token }); const identity = await upstream.authenticate();
    const transport = new RemoteFileUpstream(upstream);
    expect(await transport.browse(conversationId)).toEqual(expect.arrayContaining([expect.objectContaining({ id, name: 'fixture.txt' })]));
    let allowed = false;
    const store = new RemoteFileSnapshots({ root: join(root, 'client-cache'), namespace: { profileId: randomUUID(), ...identity },
      encryption: { available: async () => true, encrypt: async text => Buffer.from(text), decrypt: async bytes => bytes.toString() },
      transport, current: () => true, confirm: async () => allowed });
    const doc = await store.download(id); expect(doc.text).toBe('original'); await store.edit(doc.id, 'changed');
    await expect(store.upload(doc.id)).rejects.toThrow('USER_DENIED'); expect(writes).toBe(0);
    allowed = true; expect(await store.upload(doc.id)).toMatchObject({ state: 'clean' }); expect(await readFile(join(workspace, 'fixture.txt'), 'utf8')).toBe('changed');
    await store.edit(doc.id, 'client conflict draft'); await writeFile(join(workspace, 'fixture.txt'), 'external');
    expect(await store.upload(doc.id)).toMatchObject({ state: 'conflict', text: 'client conflict draft' });
    expect(await readFile(join(workspace, 'fixture.txt'), 'utf8')).toBe('external');
    const fresh = await store.download(id); await store.edit(fresh.id, 'applied before lost response'); discard = true;
    await expect(store.upload(fresh.id)).rejects.toThrow('OUTCOME_UNKNOWN'); expect(await readFile(join(workspace, 'fixture.txt'), 'utf8')).toBe('applied before lost response');
    const attempts = writes; await expect(store.upload(fresh.id)).rejects.toThrow('OUTCOME_UNKNOWN'); expect(writes).toBe(attempts);
    expect(await store.get(fresh.id)).toMatchObject({ state: 'unknown' });
  } finally {
    upstream?.close(); await new Promise<void>(resolve => server.close(() => resolve())); realtime.close(); endpoints.close();
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest();
    if (previousState === undefined) delete process.env.XOPC_STATE_DIR; else process.env.XOPC_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
