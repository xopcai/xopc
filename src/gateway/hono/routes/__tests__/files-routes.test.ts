import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { ProjectService } from '../../../../projects/index.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../../storage/sqlite/index.js';
import type { GatewayService } from '../../../service.js';
import { registerFilesRoutes } from '../files.js';

describe('files routes', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;

  beforeEach(() => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-files-routes-'));
    process.env.XOPC_STATE_DIR = stateDir;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  function appFor(workspaceRoot: string) {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Files', workspaceRoot });
    const service = {
      currentConfig: ConfigSchema.parse({}),
      projects,
      agentService: { getResolvedWorkspaceForSession: () => workspaceRoot },
    } as unknown as GatewayService;
    const app = new Hono();
    registerFilesRoutes(app, { service } as never);
    return { app, project };
  }

  it('exposes managed project resources without host paths', async () => {
    const workspace = join(stateDir, 'workspace');
    mkdirSync(join(workspace, 'docs'), { recursive: true });
    writeFileSync(join(workspace, 'docs', 'brief.md'), '# Brief');
    const outside = join(stateDir, 'outside.txt');
    writeFileSync(outside, 'secret');
    symlinkSync(outside, join(workspace, 'escape.txt'));
    const { app, project } = appFor(workspace);

    const context = await app.request(`/api/files/contexts/project/${project.id}`);
    expect(context.status).toBe(200);
    const contextBody = await context.json() as { space: { id: string; root?: string } };
    expect(contextBody.space.root).toBeUndefined();

    const children = await app.request(`/api/files/spaces/${contextBody.space.id}/children`);
    const body = await children.json() as { items: Array<{ name: string; id: string }> };
    expect(body.items.map((item) => item.name)).toEqual(['docs']);

    const resolved = await app.request('/api/files/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spaceId: contextBody.space.id, path: 'docs/brief.md' }),
    });
    const resource = (await resolved.json() as { resource: { id: string; revision: string } }).resource;
    const content = await app.request(`/api/files/${encodeURIComponent(resource.id)}/content`);
    expect(await content.text()).toBe('# Brief');
    expect(content.headers.get('etag')).toBe(resource.revision);
  });

  it('uses revisions for edits and never overwrites uploads', async () => {
    const workspace = join(stateDir, 'workspace');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'note.txt'), 'one');
    const { app, project } = appFor(workspace);
    const context = await app.request(`/api/files/contexts/project/${project.id}`);
    const spaceId = (await context.json() as { space: { id: string } }).space.id;
    const resolved = await app.request('/api/files/resolve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spaceId, path: 'note.txt' }),
    });
    const resource = (await resolved.json() as { resource: { id: string; revision: string } }).resource;

    const edit = await app.request(`/api/files/${encodeURIComponent(resource.id)}/content`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'two', revision: resource.revision }),
    });
    expect(edit.status).toBe(200);
    expect(readFileSync(join(workspace, 'note.txt'), 'utf8')).toBe('two');
    const stale = await app.request(`/api/files/${encodeURIComponent(resource.id)}/content`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'three', revision: resource.revision }),
    });
    expect(stale.status).toBe(409);

    const form = new FormData();
    form.set('directory', '');
    form.set('file', new File(['replacement'], 'note.txt', { type: 'text/plain' }));
    expect((await app.request(`/api/files/spaces/${spaceId}/upload`, { method: 'POST', body: form })).status).toBe(409);
    expect(readFileSync(join(workspace, 'note.txt'), 'utf8')).toBe('two');
  });

  it('accepts only one concurrent edit for the same revision', async () => {
    const workspace = join(stateDir, 'workspace');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'note.txt'), 'one');
    const { app, project } = appFor(workspace);
    const context = await app.request(`/api/files/contexts/project/${project.id}`);
    const spaceId = (await context.json() as { space: { id: string } }).space.id;
    const resolved = await app.request('/api/files/resolve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spaceId, path: 'note.txt' }),
    });
    const resource = (await resolved.json() as { resource: { id: string; revision: string } }).resource;
    const url = `/api/files/${encodeURIComponent(resource.id)}/content`;
    const request = (content: string) => app.request(url, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, revision: resource.revision }),
    });

    const responses = await Promise.all([request('two'), request('three')]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(['two', 'three']).toContain(readFileSync(join(workspace, 'note.txt'), 'utf8'));
  });
});
