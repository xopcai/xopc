import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ installed: [] as string[] }));
vi.mock('../../runtime-tools/phone-dependencies.js', async () => {
  const { EventEmitter } = await import('node:events');
  return { PhoneDependencyManager: class extends EventEmitter {
    async status() { return []; }
    async install(kind: string) { fixture.installed.push(kind); }
  } };
});
vi.mock('../../phone/runtime.js', () => ({ getPhoneRuntime: () => ({ reports: () => [] }) }));

import { ConfigSchema } from '../../config/schema.js';
import { managedHdcPath, managedHosJar, managedJavaHome } from '../../runtime-tools/harmony-paths.js';
import { openXopcDatabase, closeXopcDatabase } from '../../storage/sqlite/connection.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

it('reaches HarmonyOS installers through authenticated Gateway lazy routes and saves managed paths', async () => {
  openXopcDatabase({ path: ':memory:' });
  fixture.installed.length = 0;
  const token = randomUUID();
  const service = { currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
    getResolvedAuth: () => ({ mode: 'token', token }), getAuthToken: () => token, emit: vi.fn(),
    saveConfig: vi.fn(async (next: ReturnType<typeof ConfigSchema.parse>) => { service.currentConfig = next; return { saved: true }; }),
  };
  const app = createHonoApp({ service: service as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}/api/runtime-tools/phone-dependencies`;
  try {
    expect((await fetch(`${base}/hdc/install/stream`, { method: 'POST', body: '{}' })).status).toBe(401);
    for (const kind of ['hdc', 'java', 'hoscrcpy']) {
      const response = await fetch(`${base}/${kind}/install/stream`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"ok":true');
    }
    expect(fixture.installed).toEqual(['hdc', 'java', 'hoscrcpy']);
    expect(service.currentConfig.phone).toMatchObject({ hdcPath: managedHdcPath(), hdcVideo: { javaHome: managedJavaHome(), sdkJar: managedHosJar() } });
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase();
  }
});
