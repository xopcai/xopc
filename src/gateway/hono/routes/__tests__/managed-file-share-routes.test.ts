import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { saveMediaBuffer } from '../../../../media/store.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { fileResourceId } from '../../../../files/file-service.js';
import { getShareStore, resetShareStoreForTests } from '../../../../share/share-store.js';
import { getSiteShareStore, resetSiteShareStoreForTests } from '../../../../share/site-share-store.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import type { GatewayService } from '../../../service.js';
import { registerFilesRoutes } from '../files.js';
import { registerShareRoutes } from '../shares.js';

describe('managed file sharing', () => {
  let stateDir: string;
  let previousStateDir: string | undefined;
  let app: Hono;
  let referencedUri: string | null;
  let roots: Record<'agent' | 'project' | 'session', string>;

  beforeEach(() => {
    referencedUri = null;
    previousStateDir = process.env.XOPC_STATE_DIR;
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-managed-share-'));
    process.env.XOPC_STATE_DIR = stateDir;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
    resetShareStoreForTests();
    resetSiteShareStoreForTests();
    roots = { agent: join(stateDir, 'agent'), project: join(stateDir, 'project'), session: join(stateDir, 'session') };
    for (const [kind, root] of Object.entries(roots)) {
      mkdirSync(root);
      writeFileSync(join(root, 'brief.txt'), `${kind} content`);
    }
    const project = { id: 'project-1', name: 'Project', workspaceRoot: roots.project };
    const service = {
      currentConfig: ConfigSchema.parse({
        agents: { default: 'main', list: [{ id: 'main', workspace: roots.agent }] },
      }),
      projects: {
        list: () => ({ items: [project], hasMore: false }),
        get: (id: string) => id === project.id ? project : null,
      },
      sessions: { getEffectiveWorkspacePath: async () => roots.session },
      sessionIndexInstance: {
        loadMessages: async (key: string) => key === 'session-1' && referencedUri
          ? [{ role: 'assistant', content: [], attachments: [{ uri: referencedUri }] }]
          : [],
      },
    } as unknown as GatewayService;
    app = new Hono();
    registerFilesRoutes(app, { service } as never);
    registerShareRoutes(app, { service } as never);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    resetShareStoreForTests();
    resetSiteShareStoreForTests();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
  });

  async function resolveFile(kind: keyof typeof roots, path = 'brief.txt') {
    const contextId = kind === 'agent' ? 'main' : kind === 'project' ? 'project-1' : 'session-1';
    const context = await app.request(`/api/files/contexts/${kind}/${contextId}`);
    expect(context.status).toBe(200);
    const { space } = await context.json() as { space: { id: string } };
    const response = await app.request('/api/files/resolve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spaceId: space.id, path }),
    });
    expect(response.status).toBe(200);
    return (await response.json() as { resource: { id: string; spaceId: string } }).resource;
  }

  function share(body: Record<string, unknown>) {
    return app.request('/api/shares/auto', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify({ audience: 'friend', thumbnail: false, ...body }),
    });
  }

  function createFileShare(body: Record<string, unknown>) {
    return app.request('/api/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify(body),
    });
  }

  it('shares a project file through the common file-share endpoint', async () => {
    const resource = await resolveFile('project');
    const response = await createFileShare({ fileId: resource.id, fileName: 'brief.txt' });
    expect(response.status).toBe(201);
    const { payload } = await response.json() as { payload: { id: string } };
    expect(getShareStore().getById(payload.id)).toMatchObject({
      workspaceRoot: realpathSync(roots.project), workspaceRelativePath: 'brief.txt',
    });
  });

  it('shares the scoped HTML artifact and preserves its display name', async () => {
    const html = '<html><body>Delivered report</body></html>';
    const media = await saveMediaBuffer(Buffer.from(html), {
      bucket: 'outbound', contentType: 'text/html', originalFilename: 'index.html',
    });
    referencedUri = media.uri;
    const response = await createFileShare({ uri: media.uri, sessionKey: 'session-1', fileName: 'index.html' });
    expect(response.status).toBe(201);
    const { payload } = await response.json() as { payload: { id: string; fileName: string } };
    expect(payload.fileName).toBe('index.html');
    const record = getShareStore().getById(payload.id);
    expect(record).toMatchObject({ kind: 'file', mimeType: 'text/html', absolutePath: media.path });
    if (record?.kind !== 'file') throw new Error('Expected file share');
    expect(readFileSync(record.absolutePath, 'utf8')).toBe(html);
  });

  it('rejects media outside the supplied session and ambiguous share targets', async () => {
    const media = await saveMediaBuffer(Buffer.from('private'), { bucket: 'outbound', contentType: 'text/plain' });
    referencedUri = media.uri;
    expect((await createFileShare({ uri: media.uri })).status).toBe(400);
    expect((await createFileShare({ uri: media.uri, sessionKey: 'another-session' })).status).toBe(404);
    expect((await createFileShare({ uri: media.uri, path: 'brief.txt', sessionKey: 'session-1' })).status).toBe(400);
    expect(getShareStore().getAllShares()).toHaveLength(0);
  });

  it.each(['agent', 'project', 'session'] as const)('shares the selected %s file without falling back to the default workspace', async (kind) => {
    const resource = await resolveFile(kind);
    const response = await share({ fileId: resource.id });
    expect(response.status).toBe(201);
    const { payload } = await response.json() as { payload: { share: { id: string; kind: string; shareUrl: string } } };
    expect(payload.share.kind).toBe('file');
    expect(payload.share.shareUrl).toContain('/s/');
    const record = getShareStore().getById(payload.share.id);
    expect(record?.kind).toBe('file');
    if (record?.kind !== 'file') throw new Error('Expected file share');
    expect(record.workspaceRoot).toBe(realpathSync(roots[kind]));
    expect(readFileSync(record.absolutePath, 'utf8')).toBe(`${kind} content`);
  });

  it('shares the root folder by managed ID', async () => {
    const resource = await resolveFile('project', '.');
    const response = await share({ fileId: resource.id });
    expect(response.status).toBe(201);
    const { payload } = await response.json() as { payload: { share: { id: string; kind: string } } };
    expect(payload.share.kind).toBe('file');
    expect(getShareStore().getById(payload.share.id)).toMatchObject({ kind: 'directory', workspaceRoot: realpathSync(roots.project) });
  });

  it('keeps HTML auto-routing to a site in the selected project workspace', async () => {
    const html = '<html><body>Project report</body></html>';
    writeFileSync(join(roots.project, 'report.html'), html);
    const resource = await resolveFile('project', 'report.html');
    const response = await share({ fileId: resource.id });
    expect(response.status).toBe(201);
    const { payload } = await response.json() as { payload: { share: { id: string; kind: string } } };
    expect(payload.share.kind).toBe('site');
    const record = getSiteShareStore().getById(payload.share.id);
    expect(record?.source.kind).toBe('static');
    if (record?.source.kind !== 'static') throw new Error('Expected static site');
    expect(record.source.workspaceRoot).toBe(realpathSync(roots.project));
    expect(readFileSync(join(record.source.rootDir, 'index.html'), 'utf8')).toBe(html);
  });

  it('retains path-based share requests', async () => {
    const response = await share({ path: 'brief.txt', agentId: 'main' });
    expect(response.status).toBe(201);
    const { payload } = await response.json() as { payload: { share: { id: string } } };
    expect(getShareStore().getById(payload.share.id)).toMatchObject({
      workspaceRoot: roots.agent, workspaceRelativePath: 'brief.txt',
    });
  });

  it('rejects invalid or missing IDs instead of sharing a same-named fallback file', async () => {
    const resource = await resolveFile('project');
    expect((await share({ fileId: 'invalid', path: 'brief.txt', agentId: 'main' })).status).toBe(400);
    expect((await share({ fileId: fileResourceId(resource.spaceId, 'missing.txt') })).status).toBe(404);
    expect(getShareStore().getAllShares()).toHaveLength(0);
  });

  it('rejects a managed file replaced by a symlink outside its space', async () => {
    const resource = await resolveFile('project');
    rmSync(join(roots.project, 'brief.txt'));
    symlinkSync(join(roots.agent, 'brief.txt'), join(roots.project, 'brief.txt'));
    expect((await share({ fileId: resource.id })).status).toBe(400);
    expect(getShareStore().getAllShares()).toHaveLength(0);
  });
});
