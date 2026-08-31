import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { registerHostFsRoutes } from '../host-fs.js';

describe('host fs routes', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function app(): Hono {
    const app = new Hono();
    registerHostFsRoutes(app, {} as never);
    return app;
  }

  it('creates a child directory and makes it available to the picker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-host-fs-'));
    roots.push(root);

    const created = await app().request('/api/host/fs/directory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentPath: root, name: 'new-project' }),
    });

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({
      ok: true,
      payload: { absolutePath: join(realpathSync(root), 'new-project') },
    });
    expect(existsSync(join(root, 'new-project'))).toBe(true);

    const listed = await app().request(`/api/host/fs/list?path=${encodeURIComponent(root)}`);
    await expect(listed.json()).resolves.toMatchObject({
      ok: true,
      payload: {
        entries: [
          { name: 'new-project', absolutePath: join(realpathSync(root), 'new-project'), isDirectory: true },
        ],
      },
    });
  });

  it('rejects traversal names and existing entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xopc-host-fs-'));
    roots.push(root);
    const request = (name: string) => app().request('/api/host/fs/directory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentPath: root, name }),
    });

    expect((await request('../outside')).status).toBe(400);
    expect((await request('project')).status).toBe(201);
    expect((await request('project')).status).toBe(409);
  });
});
