import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';
import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('imports only selected content through authenticated real Gateway HTTP and lazy bundles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'xopc-import-http-'));
  vi.stubEnv('XOPC_STATE_DIR', dir);
  vi.stubEnv('HOME', dir);
  vi.stubEnv('CODEX_HOME', join(dir, '.codex'));
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(dir, '.claude'));
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(dir, 'xopc.db') });
  const token = 'capability-import-http-token';
  const refresh = vi.fn();
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, getExtensionLoader: () => null,
    projects: { list: () => ({ items: [] }) },
    agentService: { refreshSkillsAfterDiskChange: refresh, getWorkspaceTrust: () => ({ trusted: true }) },
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing Gateway address');
    const base = `http://127.0.0.1:${address.port}/api/imports`;
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
      const result = await response.json() as { data: any; error?: string };
      expect(response.status, result.error).toBe(200);
      return result.data;
    };
    expect((await fetch(base + '/sources')).status).toBe(401);
    expect((await request('/sources')).sources).toHaveLength(2);
    mkdirSync(join(dir, '.claude/skills/http-import-fixture'), { recursive: true });
    writeFileSync(join(dir, '.claude/skills/http-import-fixture/SKILL.md'), '---\nname: http-import-fixture\ndescription: Test import\n---\nRead a file.');
    writeFileSync(join(dir, '.claude/CLAUDE.md'), 'Prefer concise weekly reports.');
    const inventory = await request('/sources/claude-code/scan', {});
    expect(existsSync(join(dir, 'skills/http-import-fixture/SKILL.md'))).toBe(false);
    expect((await request(`/inventories/${inventory.id}`)).id).toBe(inventory.id);
    const candidateId = inventory.candidates.find((i: { kind: string }) => i.kind === 'skill').id;
    expect((await request(`/inventories/${inventory.id}/items/${candidateId}/preview`)).text).toContain('Read a file');
    const body = { inventoryId: inventory.id, candidateIds: [candidateId], requestId: randomUUID() };
    const result = await request('/runs', body);
    expect(result).toMatchObject({ skills: 1, context: 0, projects: 0, status: 'completed', issues: [] });
    expect(existsSync(join(dir, 'skills/http-import-fixture/SKILL.md'))).toBe(true);
    expect(await request('/runs', body)).toEqual(result);
    expect(await request(`/runs/${result.id}`)).toEqual(result);
    const rescanned = await request('/sources/claude-code/scan', {});
    expect(rescanned.candidates.find((i: { kind: string }) => i.kind === 'skill').status).toBe('existing');
    expect(refresh).toHaveBeenCalledTimes(1);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const invalid = await fetch(base + '/runs', { method: 'POST', headers, body: JSON.stringify({ ...body, root: '/etc' }) });
    expect(invalid.status).toBe(400);
    expect((await fetch(base + '/runs', { method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID() }) })).status).toBe(400);
    expect((await fetch(base + '/sources/claude-code/import', { method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID() }) })).status).toBe(404);

  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
