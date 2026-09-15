import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { ProjectService } from '../../../../projects/project-service.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { getProjectUnderstandingRun } from '../../../../work-discovery/repository.js';
import { WorkDiscoveryService } from '../../../../work-discovery/service.js';
import { auth } from '../../middleware/auth.js';
import { registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests, getLoadedLazyRouteBundleIdsForTests } from '../lazy-fallback.js';
import { registerProjectsRoutes } from '../projects.js';

describe('project understanding through authenticated Gateway HTTP and lazy dispatch', () => {
  let root: string;
  let origin: string;
  let server: ReturnType<typeof serve>;
  let projects: ProjectService;
  let understanding: WorkDiscoveryService;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'xopc-project-http-'));
    resetXopcDatabaseSingletonForTest();
    resetLazyRouteBundlesForTests();
    openXopcDatabase({ path: join(root, 'test.db') });
    projects = new ProjectService();
    vi.spyOn(WorkDiscoveryService.prototype, 'getModelProcessingTarget').mockImplementation(() => { throw new Error('No model configured'); });
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'project-test-token', allowTailscale: false }) }));
    const config = ConfigSchema.parse({});
    understanding = new WorkDiscoveryService({ projects, sessions: {} as never, getConfig: () => config, emit: vi.fn() });
    const deps = { service: { projects, workDiscovery: understanding, currentConfig: config, emit: vi.fn() } } as never;
    registerProjectsRoutes(app, deps);
    registerAuthenticatedLazyRouteFallback(app, deps);
    await new Promise<void>((resolve) => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve()); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await understanding.stop();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    vi.restoreAllMocks();
    resetLazyRouteBundlesForTests();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(root, { recursive: true, force: true });
  });

  const request = (path: string, method = 'GET', body?: unknown, authenticated = true) => fetch(`${origin}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer project-test-token' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  it('keeps unchecked creation idle and exposes status/correction through the lazy route', async () => {
    const workspaceRoot = join(root, 'workspace');
    mkdirSync(workspaceRoot);
    const created = await request('/api/projects', 'POST', { name: 'Example', workspaceRoot, autoUnderstand: false });
    expect(created.status).toBe(201);
    const { project } = await created.json();
    expect(getProjectUnderstandingRun(project.id)).toBeNull();
    const path = `/api/projects/${project.id}/understanding`;
    expect((await request(path, 'GET', undefined, false)).status).toBe(401);
    expect((await request(path)).status).toBe(200);
    expect(getLoadedLazyRouteBundleIdsForTests().authenticated).toContain('project-understanding');
    expect((await (await request(path)).json()).status).toBe('not_started');
    expect((await request(path, 'PATCH', { content: 'Run pnpm test. Goal remains unknown.' })).status).toBe(200);
    expect((await (await request(path)).json()).overview).toContain('pnpm test');
    expect((await request(`${path}-other`)).status).toBe(404);
    expect((await request('/api/projects/missing/understanding')).status).toBe(404);
  });

  it('creates the project even if understanding fails and supports one-click retry', async () => {
    const workspaceRoot = join(root, 'workspace');
    mkdirSync(workspaceRoot);
    const created = await request('/api/projects', 'POST', { name: 'Example', workspaceRoot, autoUnderstand: true });
    expect(created.status).toBe(201);
    const { project } = await created.json();
    await vi.waitFor(() => expect(getProjectUnderstandingRun(project.id)?.attempts).toBe(2));
    await vi.waitFor(() => expect(getProjectUnderstandingRun(project.id)?.status).toBe('failed'));
    const firstId = getProjectUnderstandingRun(project.id)!.id;
    const path = `/api/projects/${project.id}/understanding`;
    expect((await request(path, 'POST')).status).toBe(202);
    expect(getProjectUnderstandingRun(project.id)!.id).not.toBe(firstId);
    await vi.waitFor(() => expect(getProjectUnderstandingRun(project.id)?.attempts).toBe(2));
    await vi.waitFor(() => expect(getProjectUnderstandingRun(project.id)?.status).toBe('failed'));
    expect((await request(`/api/projects/${project.id}`, 'DELETE')).status).toBe(200);
    expect(getProjectUnderstandingRun(project.id)).toBeNull();
  });
});
