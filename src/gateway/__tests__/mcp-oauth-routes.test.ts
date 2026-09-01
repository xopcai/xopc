import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { McpOAuthStore } from '../../agent/mcp/oauth/mcp-oauth-store.js';
import type { Config } from '../../config/schema.js';
import { registerMcpRoutes } from '../hono/routes/mcp.js';
import type { GatewayService } from '../service.js';

describe('MCP OAuth routes', () => {
  let tempDir: string;
  let previousCredentialsDir: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-mcp-routes-'));
    previousCredentialsDir = process.env.XOPC_CREDENTIALS_DIR;
    process.env.XOPC_CREDENTIALS_DIR = join(tempDir, 'credentials');
  });

  afterEach(async () => {
    if (previousCredentialsDir === undefined) delete process.env.XOPC_CREDENTIALS_DIR;
    else process.env.XOPC_CREDENTIALS_DIR = previousCredentialsDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reports credential status and disconnects a configured OAuth server', async () => {
    const serverId = `private-${Date.now()}`;
    const serverUrl = 'https://mcp.example.com/api';
    const config = {
      agents: { list: [] },
      mcp: { servers: { [serverId]: { url: serverUrl, auth: { type: 'oauth' } } } },
    } as Config;
    const service = { currentConfig: config } as GatewayService;
    const passThrough = async (_c: unknown, next: () => Promise<void>) => next();
    const app = new Hono();
    registerMcpRoutes(app, {
      service,
      strictRateLimitMiddleware: passThrough,
    } as never);

    const disconnected = await app.request(`/api/mcp/servers/${serverId}/oauth`);
    expect(disconnected.status).toBe(200);
    await expect(disconnected.json()).resolves.toMatchObject({
      ok: true,
      payload: { configured: true, status: 'disconnected' },
    });

    await new McpOAuthStore().update(serverUrl, () => ({
      version: 1,
      serverUrl,
      tokens: { access_token: 'token', token_type: 'Bearer' },
      updatedAt: '',
    }));
    const connected = await app.request(`/api/mcp/servers/${serverId}/oauth`);
    await expect(connected.json()).resolves.toMatchObject({
      payload: { status: 'connected' },
    });

    const removed = await app.request(`/api/mcp/servers/${serverId}/oauth`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({
      payload: { status: 'disconnected' },
    });
    await expect(new McpOAuthStore().load(serverUrl)).resolves.toBeUndefined();
  });
});
