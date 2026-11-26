import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { createHonoApp } from '../hono/app.js';
import { GatewayService } from '../service.js';

it('probes the configured FFmpeg through the authenticated Gateway and rechecks after repair', async () => {
  initializeTestAgentCatalog();
  const state = process.env.XOPC_STATE_DIR!;
  const configPath = join(state, 'preflight-config.json');
  const token = 'discussion-preflight-test-token';
  writeFileSync(configPath, JSON.stringify(ConfigSchema.parse({
    gateway: { auth: { mode: 'token', token }, heartbeat: { enabled: false } },
  })));
  const service = new GatewayService({ configPath, enableHotReload: false });
  const app = createHonoApp({ service, listenHost: '127.0.0.1' });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/discussion-capture/preflight`;
  const request = () => fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  try {
    expect((await fetch(url)).status).toBe(401);

    for (const unusable of [join(state, 'missing-ffmpeg'), process.execPath]) {
      // Node exists but exits unsuccessfully for FFmpeg's -version flag.
      vi.stubEnv('XOPC_FFMPEG_PATH', unusable);
      const result = await request();
      expect(result.status).toBe(200);
      expect(result.headers.get('cache-control')).toContain('no-store');
      expect(await result.json()).toEqual({ available: false, platform: process.platform });
    }

    if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5_000 }).status === 0) {
      vi.stubEnv('XOPC_FFMPEG_PATH', 'ffmpeg');
      const result = await request();
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ available: true, platform: process.platform });
    }
  } finally {
    vi.unstubAllEnvs();
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await service.stop();
  }
}, 30_000);
