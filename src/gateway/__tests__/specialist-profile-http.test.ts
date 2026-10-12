import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('edits specialist profiles through authenticated live HTTP with revision checks', async () => {
  const state = mkdtempSync(join(tmpdir(), 'xopc-specialist-http-'));
  vi.stubEnv('XOPC_STATE_DIR', state);
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(state, 'xopc.db') });
  const catalog = seedTestAgentCatalog({ agents: [{ id: 'main', profile: { name: 'Main' } }] });
  const token = 'specialist-fixture-token';
  const app = createHonoApp({ service: {
    currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token,
    isGatewayReady: () => true, refreshAgentCatalog: vi.fn(),
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const url = `http://127.0.0.1:${address.port}/api/agents/main`;
    const profile = { version: 1, domains: ['data'], taskTypes: ['data_analysis'], inputKinds: ['csv'],
      outputKinds: ['report'], specialties: ['Data analysis'], examples: [], limitations: [] };
    const revision = catalog.get('main')!.revision;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    expect((await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ specialistProfile: profile }) })).status).toBe(401);
    const edited = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ expectedRevision: revision, specialistProfile: profile }) });
    expect(edited.status).toBe(200);
    const payload = await edited.json() as { payload: { agents: Array<{ effective: { specialistProfile?: unknown }; revision: number }> } };
    expect(payload.payload.agents[0]?.effective.specialistProfile).toEqual(profile);
    expect(payload.payload.agents[0]?.revision).toBeGreaterThan(revision);
    expect((await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ expectedRevision: revision, specialistProfile: null }) })).status).toBe(400);
    expect(catalog.get('main')?.specialistProfile).toEqual(profile);
    expect((await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ specialistProfile: { ...profile, unexpected: true } }) })).status).toBe(400);
    expect((await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ specialistProfile: null }) })).status).toBe(200);
    expect(catalog.get('main')?.specialistProfile).toBeUndefined();
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  }
}, 30000);
