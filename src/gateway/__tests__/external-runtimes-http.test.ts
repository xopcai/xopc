import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { invalidateExternalRuntimeProbeCache } from '../../agent/external/index.js';
import { ConfigSchema } from '../../config/schema.js';
import { closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

describe('external runtimes authenticated Gateway HTTP routes', () => {
  let dir = '';
  const token = 'ext-runtime-http-token';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-ext-rt-http-'));
    vi.stubEnv('XOPC_STATE_DIR', dir);
    vi.stubEnv('XOPC_CODEX_BIN', join(dir, 'missing-codex'));
    vi.stubEnv('XOPC_AGY_BIN', join(dir, 'missing-agy'));
    vi.stubEnv('XOPC_CLAUDE_BIN', join(dir, 'missing-claude'));
    invalidateExternalRuntimeProbeCache();
    resetXopcDatabaseSingletonForTest();
    initializeTestAgentCatalog({
      defaults: {
        models: { chat: { primary: 'openai/gpt-5', fallbacks: [] }, intents: {} },
        skills: { mode: 'all-enabled', exclude: [] },
        tools: {},
        runtime: {},
      },
      agents: [{ id: 'main', enabled: true, profile: { name: 'Main' } }],
    });
  });

  afterEach(() => {
    invalidateExternalRuntimeProbeCache();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves fast detection, cached full probe, and idempotent quick-setup through lazy-loaded authenticated routes', async () => {
    const refreshAgentCatalog = vi.fn();
    const app = createHonoApp({
      service: {
        currentConfig: ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } }),
        getResolvedAuth: () => ({ mode: 'token', token }),
        getAuthToken: () => token,
        isGatewayReady: () => true,
        getExtensionLoader: () => null,
        refreshAgentCatalog,
      } as unknown as GatewayService,
    });

    const authHeaders = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    // Unauthenticated requests are rejected.
    const unauth = await app.request('http://127.0.0.1/api/agents/external-runtimes?mode=fast');
    expect(unauth.status).toBe(401);

    // Fast mode returns synchronous binary detections for all 3 built-in drivers.
    const fastRes = await app.request('http://127.0.0.1/api/agents/external-runtimes?mode=fast', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(fastRes.status).toBe(200);
    const fastBody = await fastRes.json() as {
      ok: boolean;
      payload: { mode: string; runtimes: Array<{ kind: string; installed: boolean }> };
    };
    expect(fastBody.ok).toBe(true);
    expect(fastBody.payload.mode).toBe('fast');
    expect(fastBody.payload.runtimes.map((r) => r.kind)).toEqual(['codex', 'agy', 'claude']);
    expect(fastBody.payload.runtimes.every((r) => r.installed === false)).toBe(true);

    // Full mode returns probe results with cache reuse.
    const fullRes = await app.request('http://127.0.0.1/api/agents/external-runtimes?timeoutMs=3000', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(fullRes.status).toBe(200);
    const fullBody = await fullRes.json() as {
      ok: boolean;
      payload: { mode: string; runtimes: Array<{ kind: string; status: string }> };
    };
    expect(fullBody.payload.mode).toBe('full');
    expect(fullBody.payload.runtimes.every((r) => r.status === 'not_installed')).toBe(true);

    // Invalid payload is rejected with 400.
    const badRes = await app.request('http://127.0.0.1/api/agents/external-runtimes/quick-setup', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ items: [] }),
    });
    expect(badRes.status).toBe(400);

    // Quick-setup creates external agents with open defaults and refreshes agent catalog.
    const setupRes = await app.request('http://127.0.0.1/api/agents/external-runtimes/quick-setup', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        items: [
          { kind: 'codex', permissionMode: 'full_access', contextAccess: 'read_write' },
          { kind: 'claude' },
        ],
      }),
    });
    expect(setupRes.status).toBe(200);
    const setupBody = await setupRes.json() as {
      ok: boolean;
      payload: {
        results: Array<{ kind: string; agentId?: string; created: boolean; reusedExisting?: boolean; status: string }>;
        agents: { agents: Array<{ id: string; override: { execution?: Record<string, unknown> } }> };
      };
    };
    expect(setupBody.ok).toBe(true);
    expect(setupBody.payload.results).toEqual([
      { kind: 'codex', agentId: 'codex', created: true, status: 'ok' },
      { kind: 'claude', agentId: 'claude-code', created: true, status: 'ok' },
    ]);
    expect(refreshAgentCatalog).toHaveBeenCalledTimes(1);
    const claudeAgent = setupBody.payload.agents.agents.find((a) => a.id === 'claude-code');
    expect(claudeAgent?.override.execution).toEqual({
      kind: 'claude',
      permissionMode: 'full_access',
      contextAccess: 'read_write',
    });

    // Second call is idempotent and reuses existing active agents.
    const secondRes = await app.request('http://127.0.0.1/api/agents/external-runtimes/quick-setup', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ items: [{ kind: 'codex' }] }),
    });
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json() as {
      payload: { results: Array<{ kind: string; agentId?: string; created: boolean; reusedExisting?: boolean; status: string }> };
    };
    expect(secondBody.payload.results).toEqual([
      { kind: 'codex', agentId: 'codex', created: false, reusedExisting: true, status: 'ok' },
    ]);
  });
});
