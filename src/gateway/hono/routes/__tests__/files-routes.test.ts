import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { fileResourceId, fileSpaceId } from '../../../../files/file-service.js';
import { effectiveWorkspacePathForSession } from '../../../../session/session-workspace.js';
import { getSessionConfig, setSessionConfig } from '../../../../storage/sqlite/config-repository.js';
import { getProjectForSession } from '../../../../projects/workspace.js';
import { patchSessionMetadata } from '../../../../storage/sqlite/session-repository.js';
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

  function appFor(workspaceRoot: string, config = ConfigSchema.parse({ agents: { list: [{ id: 'main', workspace: workspaceRoot }] } })) {
    const projects = new ProjectService();
    const project = projects.create({ name: 'Files', workspaceRoot });
    const service = {
      currentConfig: config,
      projects,
      agentService: { getResolvedWorkspaceForSession: () => workspaceRoot },
      sessions: { getEffectiveWorkspacePath: async (key: string) => effectiveWorkspacePathForSession(config, key, getSessionConfig(key), getProjectForSession(key)) },
    } as unknown as GatewayService;
    const app = new Hono();
    registerFilesRoutes(app, { service } as never);
    return { app, project };
  }

  it('restores persisted session workspaces for context and direct IDs after restart', async () => {
    const agentRoot = join(stateDir, 'agent');
    const overrideRoot = join(stateDir, 'session');
    mkdirSync(agentRoot);
    mkdirSync(overrideRoot);
    writeFileSync(join(overrideRoot, 'report.md'), 'session report');
    const key = 'agent:main:session:cold';
    setSessionConfig(key, { workingDirectoryOverride: overrideRoot }, agentRoot);
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const { app } = appFor(agentRoot);
    const id = fileResourceId(fileSpaceId(realpathSync(overrideRoot)), 'report.md');
    const direct = await app.request(`/api/files/${id}/content`);
    expect(direct.status).toBe(200);
    expect(await direct.text()).toBe('session report');
    const context = await app.request(`/api/files/contexts/session/${encodeURIComponent(key)}`);
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({ space: { id: fileSpaceId(realpathSync(overrideRoot)) } });
  });

  it('restores the project binding ahead of a session directory override', async () => {
    const agentRoot = join(stateDir, 'agent');
    const overrideRoot = join(stateDir, 'override');
    const projectRoot = join(stateDir, 'project');
    for (const root of [agentRoot, overrideRoot, projectRoot]) mkdirSync(root);
    const key = 'agent:main:session:project';
    setSessionConfig(key, { workingDirectoryOverride: overrideRoot }, agentRoot);
    const project = new ProjectService().create({ name: 'Bound project', workspaceRoot: projectRoot });
    patchSessionMetadata(key, { projectId: project.id });
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    const { app } = appFor(agentRoot);
    const response = await app.request(`/api/files/contexts/session/${encodeURIComponent(key)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ space: { id: fileSpaceId(realpathSync(projectRoot)) } });
    const spaces = await (await app.request('/api/files/spaces')).json() as { spaces: Array<{ id: string }> };
    expect(spaces.spaces.some((space) => space.id === fileSpaceId(realpathSync(overrideRoot)))).toBe(false);
  });

  it('uses the configured default agent regardless of workspace modification order', async () => {
    const main = join(stateDir, 'main');
    const alternate = join(stateDir, 'alternate');
    mkdirSync(main);
    mkdirSync(alternate);
    utimesSync(main, 1000, 1000);
    utimesSync(alternate, 2000, 2000);
    const { app } = appFor(main, ConfigSchema.parse({ agents: { default: 'main', list: [
      { id: 'alternate', workspace: alternate }, { id: 'main', workspace: main },
    ] } }));
    const response = await app.request('/api/files/default-space');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ space: { id: fileSpaceId(realpathSync(main)) } });
  });

  it('supports fuzzy paths and empty-query file suggestions', async () => {
    const root = join(stateDir, 'workspace');
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'report.md'), 'report');
    const { app } = appFor(root);
    const spaceId = fileSpaceId(realpathSync(root));
    for (const q of ['dcrpt', 'docs/', '']) {
      const response = await app.request(`/api/files/search?spaceId=${spaceId}&q=${encodeURIComponent(q)}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ items: [{ relativePath: 'docs/report.md' }] });
    }
  });

  it('edits .markdown documents using the returned revision', async () => {
    const root = join(stateDir, 'workspace');
    mkdirSync(root);
    writeFileSync(join(root, 'note.markdown'), '# Before');
    const { app } = appFor(root);
    const id = fileResourceId(fileSpaceId(realpathSync(root)), 'note.markdown');
    const resource = await (await app.request(`/api/files/${id}`)).json() as { resource: { revision: string; capabilities: string[] } };
    expect(resource.resource.capabilities).toContain('edit');
    const saved = await app.request(`/api/files/${id}/content`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# After', revision: resource.resource.revision }),
    });
    expect(saved.status).toBe(200);
    expect(readFileSync(join(root, 'note.markdown'), 'utf8')).toBe('# After');
  });

  it('lists and opens internal symlinks while rejecting escapes and terminating cycles', async () => {
    const root = join(stateDir, 'workspace');
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'report.md'), '# Linked');
    writeFileSync(join(stateDir, 'outside.md'), 'secret');
    symlinkSync(join(root, 'docs', 'report.md'), join(root, 'alias.md'));
    symlinkSync(join(root, 'docs'), join(root, 'shortcut'));
    symlinkSync(root, join(root, 'docs', 'cycle'));
    symlinkSync(join(stateDir, 'outside.md'), join(root, 'escape.md'));
    const { app } = appFor(root);
    const spaceId = fileSpaceId(realpathSync(root));
    const children = await (await app.request(`/api/files/spaces/${spaceId}/children`)).json() as { items: Array<{ name: string; id: string }> };
    expect(children.items.map((item) => item.name)).toEqual(['docs', 'shortcut', 'alias.md']);
    const alias = children.items.find((item) => item.name === 'alias.md')!;
    expect(await (await app.request(`/api/files/${alias.id}/content`)).text()).toBe('# Linked');
    const nested = await (await app.request(`/api/files/spaces/${spaceId}/children?path=shortcut`)).json() as { items: Array<{ relativePath: string }> };
    expect(nested.items.map((item) => item.relativePath)).toContain('shortcut/report.md');
    expect((await app.request('/api/files/recent')).status).toBe(200);
    expect((await app.request(`/api/files/${fileResourceId(spaceId, 'escape.md')}/content`)).status).toBe(400);
  });

  it('resolves external file actions without granting managed file access', async () => {
    const root = join(stateDir, 'workspace');
    mkdirSync(root);
    const outside = join(stateDir, 'report.pdf');
    writeFileSync(outside, 'external');
    const { app } = appFor(root);
    const spaceId = fileSpaceId(realpathSync(root));
    const resolveReference = (path: string) => app.request('/api/files/resolve-reference', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spaceId, path, sessionKey: 'session-one' }),
    });
    const response = await resolveReference(outside);
    expect(response.status).toBe(200);
    const { reference } = await response.json() as { reference: { fileRefId: string; capabilities: string[]; manageRoute?: string } };
    expect(reference.capabilities).toEqual(['openExternal', 'revealInFolder', 'copyPath']);
    expect(reference.manageRoute).toBe('/settings/gateway');
    const action = (sessionKey: string, kind = 'openExternal') => app.request(`/api/files/references/${reference.fileRefId}/action`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: kind, sessionKey }),
    });
    expect((await action('session-two')).status).toBe(403);
    expect((await action('session-one', 'edit')).status).toBe(403);
    const opened = await action('session-one');
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({ absolutePath: realpathSync(outside) });
    expect((await app.request(`/api/files/${spaceId + '.' + Buffer.from('../report.pdf').toString('base64url')}/content`)).status).toBe(400);
    const missing = await resolveReference(join(stateDir, 'missing.pdf'));
    expect(await missing.json()).toMatchObject({ reference: { scope: 'missing', exists: false } });
    const invalid = await resolveReference('../report.pdf');
    expect(await invalid.json()).toMatchObject({ reference: { scope: 'invalid', exists: false } });
  });

  it('serializes edits across a symlink and its target', async () => {
    const root = join(stateDir, 'workspace');
    mkdirSync(root);
    writeFileSync(join(root, 'note.md'), '# Before');
    symlinkSync(join(root, 'note.md'), join(root, 'alias.md'));
    const { app } = appFor(root);
    const spaceId = fileSpaceId(realpathSync(root));
    const id = fileResourceId(spaceId, 'note.md');
    const aliasId = fileResourceId(spaceId, 'alias.md');
    const { resource } = await (await app.request(`/api/files/${id}`)).json() as { resource: { revision: string } };
    const edit = (fileId: string) => app.request(`/api/files/${fileId}/content`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: fileId, revision: resource.revision }),
    });
    const responses = await Promise.all([edit(aliasId), edit(id)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winningIndex = responses.findIndex((response) => response.status === 200);
    expect(await responses[winningIndex].json()).toMatchObject({ resource: { id: [aliasId, id][winningIndex] } });
  });

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
    const hostPath = await app.request(`/api/files/${encodeURIComponent(resource.id)}/host-path`);
    expect(hostPath.status).toBe(200);
    expect(await hostPath.json()).toEqual({ absolutePath: realpathSync(join(workspace, 'docs', 'brief.md')) });
    const content = await app.request(`/api/files/${encodeURIComponent(resource.id)}/content`);
    expect(await content.text()).toBe('# Brief');
    expect(content.headers.get('etag')).toBe(resource.revision);
  });

  it('downloads files with non-ASCII names using an RFC 5987 content disposition', async () => {
    const workspace = join(stateDir, 'workspace');
    const fileName = '销售明细查询-按客户分类汇总.xlsx';
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, fileName), 'workbook');
    const { app, project } = appFor(workspace);

    const context = await app.request(`/api/files/contexts/project/${project.id}`);
    const spaceId = (await context.json() as { space: { id: string } }).space.id;
    const resolved = await app.request('/api/files/resolve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spaceId, path: fileName }),
    });
    const resource = (await resolved.json() as { resource: { id: string } }).resource;

    const response = await app.request(`/api/files/${encodeURIComponent(resource.id)}/content`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('workbook');
    expect(response.headers.get('content-type'))
      .toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(response.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent(fileName)}`);
  });

  it('resolves absolute file paths only when they stay inside the selected workspace', async () => {
    const workspace = join(stateDir, 'workspace');
    const inside = join(workspace, 'result.xlsx');
    const outside = join(stateDir, 'outside.xlsx');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(inside, 'inside');
    writeFileSync(outside, 'outside');
    const { app, project } = appFor(workspace);
    const context = await app.request(`/api/files/contexts/project/${project.id}`);
    const spaceId = (await context.json() as { space: { id: string } }).space.id;

    const resolvePath = (path: string) => app.request('/api/files/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spaceId, path }),
    });

    expect((await resolvePath(inside)).status).toBe(200);
    expect((await resolvePath(outside)).status).toBe(400);
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
