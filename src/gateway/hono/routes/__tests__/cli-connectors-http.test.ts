import { getSqliteDatabase } from '../../../../storage/sqlite/transaction.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../../../../config/schema.js';
import { getConnectorDefinition } from '../../../../connectors/catalog.js';
import { commitCliIdentity, createCliAuthorization, updateCliAuthorization } from '../../../../connectors/cli/store.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, getConnectorAccount, upsertConnectorInstallation } from '../../../../storage/sqlite/index.js';
import { auth } from '../../middleware/auth.js';
import { gatewayScopes } from '../../middleware/scopes.js';
import type { AuthenticatedRouteDeps } from '../deps.js';
import { getLoadedLazyRouteBundleIdsForTests, registerAuthenticatedLazyRouteFallback, resetLazyRouteBundlesForTests } from '../lazy-fallback.js';

describe('CLI connector authenticated HTTP routes', () => {
  let directory: string;
  let server: ReturnType<typeof serve>;
  let origin: string;
  const request = (path: string, method = 'GET', body?: unknown, authenticated = true) => fetch(`${origin}/api/connectors${path}`, {
    method, headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer cli-http-test' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'cli-http-')); vi.stubEnv('XOPC_STATE_DIR', directory);
    resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(directory, 'test.db') });
    resetLazyRouteBundlesForTests();
    const definition = getConnectorDefinition('feishu-workspace')!;
    const config = { connectors: { instances: { [definition.id]: { runtime: definition.runtime,
      xopcConnector: { managed: true, connectorId: definition.id, definition, enabled: true } } } } } as unknown as Config;
    upsertConnectorInstallation({ id: `${definition.id}-local-owner`, connectorId: definition.id, principalId: 'local-owner', enabled: true, allowedAgentIds: [], maxScope: 'read', confirmationPolicy: 'writes', selectedAccountIds: null });
    const pass = async (_c, next) => { await next(); };
    const deps = { service: { currentConfig: config }, strictRateLimitMiddleware: pass, chatRateLimitMiddleware: pass, xopcCloudPollRateLimitMiddleware: pass } as unknown as AuthenticatedRouteDeps;
    const app = new Hono();
    app.use(auth({ getResolvedAuth: () => ({ mode: 'token', token: 'cli-http-test', allowTailscale: false }) }));
    app.use(gatewayScopes());
    registerAuthenticatedLazyRouteFallback(app, deps);
    await new Promise<void>(resolve => { server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve()); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    vi.unstubAllEnvs(); closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); resetLazyRouteBundlesForTests(); rmSync(directory, { recursive: true, force: true });
  });
  it('authenticates before loading and manages policy through lazy dispatch', async () => {
    expect((await request('/feishu-workspace/accounts', 'GET', undefined, false)).status).toBe(401);
    expect(getLoadedLazyRouteBundleIdsForTests().authenticated).not.toContain('connectors');
    expect((await request('/feishu-workspace/executions')).status).toBe(200);
    const response = await request('/feishu-workspace/accounts');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, payload: { accounts: [], policy: { maxScope: 'read' } } });
    expect(getLoadedLazyRouteBundleIdsForTests().authenticated).toContain('connectors');
    expect((await request('/feishu-workspace/policy', 'PATCH', { maxScope: 'admin' })).status).toBe(400);
    const updated = await request('/feishu-workspace/policy', 'PATCH', { maxScope: 'write' });
    expect(await updated.json()).toMatchObject({ payload: { policy: { maxScope: 'write', confirmationPolicy: 'writes' } } });
  });
  it('downloads only a successful execution artifact belonging to this principal', async () => {
    const attempt = createCliAuthorization('feishu-workspace', 'feishu-workspace'); updateCliAuthorization(attempt.id, { phase: 'verifying' });
    const accountId = commitCliIdentity(attempt, { key: 'app:user', label: 'Test', scopes: [], identity: { openId: 'user' } });
    const connectionId = getConnectorAccount(accountId)!.currentConnectionId!;
    const id = '11111111-1111-4111-8111-111111111111';
    getSqliteDatabase().prepare("INSERT INTO connector_cli_executions(id,instance_id,account_id,connection_id,action_id,revision,arguments_hash,status,owner_id,started_at) VALUES (?,'feishu-workspace',?,?,'read','1','hash','success','test',1)").run(id, accountId, connectionId);
    const files = join(directory, 'connectors', 'cli', 'contexts', attempt.context_id, 'files'); mkdirSync(files, { recursive: true });
    writeFileSync(join(files, `${id}.json`), JSON.stringify({ value: 'export' }));
    expect((await request(`/executions/${id}/artifact`, 'GET', undefined, false)).status).toBe(401);
    const response = await request(`/executions/${id}/artifact`);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ value: 'export' });
    getSqliteDatabase().prepare("UPDATE connector_connections SET principal_id = 'other' WHERE id = ?").run(connectionId);
    expect((await request(`/executions/${id}/artifact`)).status).toBe(404);
  });
  it('resumes a pending authorization view and cancels without exposing its context', async () => {
    const attempt = createCliAuthorization('feishu-workspace', 'feishu-workspace');
    expect((await request('/feishu-workspace/executions')).status).toBe(200);
    const response = await request('/feishu-workspace/accounts');
    expect(await response.json()).toMatchObject({ payload: { authorization: { id: attempt.id, status: 'preparing' } } });
    const status = await request(`/authorizations/${attempt.id}`);
    const json = await status.json();
    expect(JSON.stringify(json)).not.toContain('context_id');
    expect((await request(`/authorizations/${attempt.id}/artifact`)).status).toBe(404);
    expect((await request(`/authorizations/${attempt.id}/cancel`, 'POST')).status).toBe(200);
    expect(await (await request(`/authorizations/${attempt.id}`)).json()).toMatchObject({ payload: { authorization: { status: 'cancelled' } } });
    expect((await request('/accounts/unknown', 'DELETE')).status).toBe(400);
  });
});
