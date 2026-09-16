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

it('imports skills and context in one click through authenticated real Gateway HTTP and lazy bundles', async () => {
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
    const requestId = randomUUID();
    const result = await request('/sources/claude-code/import', { requestId });
    expect(result).toMatchObject({ skills: 1, context: 1, projects: 0, issues: [] });
    expect(existsSync(join(dir, 'skills/http-import-fixture/SKILL.md'))).toBe(true);
    expect(await request('/sources/claude-code/import', { requestId })).toEqual(result);
    const repeated = await request('/sources/claude-code/import', { requestId: randomUUID() });
    expect(repeated).toMatchObject({ skills: 0, context: 0, skipped: 2, issues: [] });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await request('/sources')).sources.find((s: { id: string }) => s.id === 'claude-code').lastImport.id).toBe(repeated.id);
    const invalid = await fetch(base + '/sources/codex/import', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), root: '/etc' }) });
    expect(invalid.status).toBe(400);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
