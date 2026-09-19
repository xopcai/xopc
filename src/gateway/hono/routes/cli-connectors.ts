import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Hono, MiddlewareHandler } from 'hono';

import type { Config } from '../../../config/schema.js';
import { cancelCliAuthorization, requireCliInstance, startCliAuthorization } from '../../../connectors/cli/authorization.js';
import { cancelCliContext, cliContextPath, resolveCliArtifact } from '../../../connectors/cli/process.js';
import { cliAuthorizationView, readCliAuthorization, recoverCliExecutions } from '../../../connectors/cli/store.js';
import { getConnectorAccount, listConnectorAccounts, updateConnectorAccount } from '../../../storage/sqlite/connector-account-repository.js';
import { getConnectorInstallation, getConnectorConnection, listConnectorConnections, upsertConnectorInstallation, upsertConnectorConnection } from '../../../storage/sqlite/connector-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { hasGatewayScope } from '../../security/gateway-scopes.js';
import type { AuthenticatedRouteDeps } from './deps.js';

export function registerCliConnectorRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const admin: MiddlewareHandler = async (c, next) => {
    if (!hasGatewayScope(getGatewayPrincipal(c).scopes, 'gateway.admin')) return c.json({ ok: false, error: 'Connector administration requires gateway.admin.' }, 403);
    c.header('Cache-Control', 'no-store');
    await next();
  };
  const config = () => deps.service.currentConfig as Config;
  const failure = (error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : 'Connector request failed.' });

  app.get('/api/connectors/executions/:executionId/artifact', admin, async c => {
    const id = c.req.param('executionId');
    if (!/^[a-f0-9-]{36}$/.test(id)) return c.json({ ok: false, error: 'Artifact not found.' }, 404);
    const row = getSqliteDatabase().prepare("SELECT connection_id, instance_id FROM connector_cli_executions WHERE id = ? AND status = 'success'").get(id) as { connection_id: string; instance_id: string } | undefined;
    const connection = row ? getConnectorConnection(row.connection_id) : undefined;
    if (!connection || connection.principalId !== 'local-owner' || connection.provider !== 'cli') return c.json({ ok: false, error: 'Artifact not found.' }, 404);
    try {
      requireCliInstance(config(), row!.instance_id, { allowDisabled: true });
      const contextId = String(connection.metadata.contextId);
      const file = await resolveCliArtifact(contextId, join(cliContextPath(contextId), 'files', `${id}.json`));
      c.header('Content-Type', 'application/json'); c.header('Cache-Control', 'no-store');
      c.header('Content-Disposition', `attachment; filename="${id}.json"`);
      return c.body(new Uint8Array(await readFile(file)));
    } catch { return c.json({ ok: false, error: 'Artifact not found.' }, 404); }
  });
  app.get('/api/connectors/:id/executions', admin, c => {
    try {
      const id = c.req.param('id'); requireCliInstance(config(), id, { allowDisabled: true }); recoverCliExecutions();
      const executions = getSqliteDatabase().prepare('SELECT id, account_id, action_id, status, error_kind, started_at, finished_at FROM connector_cli_executions WHERE instance_id = ? ORDER BY started_at DESC LIMIT 25').all(id);
      return c.json({ ok: true, payload: { executions } });
    } catch (error) { return c.json(failure(error), 400); }
  });
  app.get('/api/connectors/:id/accounts', admin, c => {
    try {
      const instanceId = c.req.param('id'); requireCliInstance(config(), instanceId, { allowDisabled: true });
      const connections = listConnectorConnections({ principalId: 'local-owner' });
      const accounts = listConnectorAccounts({ principalId: 'local-owner' }).filter(account => account.runtimeInstanceId === instanceId).map(account => ({
        id: account.id, label: account.label, identity: account.identity, enabled: account.enabled,
        status: connections.find(connection => connection.id === account.currentConnectionId)?.status ?? 'unknown',
      }));
      const policy = getConnectorInstallation(`${instanceId}-local-owner`);
      const active = getSqliteDatabase().prepare("SELECT id FROM connector_cli_authorizations WHERE instance_id = ? AND principal_id = 'local-owner' AND phase IN ('preparing','awaiting_user','verifying')").get(instanceId) as { id: string } | undefined;
      const attempt = active ? readCliAuthorization(active.id) : undefined;
      return c.json({ ok: true, payload: { accounts, policy, authorization: attempt ? cliAuthorizationView(attempt) : undefined } });
    } catch (error) { return c.json(failure(error), 400); }
  });
  app.post('/api/connectors/:id/authorizations', admin, deps.strictRateLimitMiddleware, async c => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const authorization = startCliAuthorization(config(), c.req.param('id'), typeof body.accountId === 'string' ? body.accountId : undefined);
      return c.json({ ok: true, payload: { authorization } });
    } catch (error) { return c.json(failure(error), 400); }
  });
  app.get('/api/connectors/authorizations/:attemptId', admin, c => {
    const row = readCliAuthorization(c.req.param('attemptId'));
    return row ? c.json({ ok: true, payload: { authorization: cliAuthorizationView(row) } }) : c.json({ ok: false, error: 'Authorization not found.' }, 404);
  });
  app.post('/api/connectors/authorizations/:attemptId/cancel', admin, c => {
    try { cancelCliAuthorization(c.req.param('attemptId')); return c.json({ ok: true }); }
    catch (error) { return c.json(failure(error), 404); }
  });
  app.get('/api/connectors/authorizations/:attemptId/artifact', admin, async c => {
    const row = readCliAuthorization(c.req.param('attemptId'));
    if (!row || row.phase !== 'awaiting_user' || !row.challenge_json || JSON.parse(row.challenge_json).type !== 'qr_code') return c.json({ ok: false, error: 'QR code unavailable.' }, 404);
    try {
      const file = await resolveCliArtifact(row.context_id, join(cliContextPath(row.context_id), 'files', 'authorization.png'));
      const bytes = await readFile(file);
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid QR image.');
      c.header('Content-Type', 'image/png'); c.header('Cache-Control', 'no-store');
      return c.body(new Uint8Array(bytes));
    } catch (error) { return c.json(failure(error), 404); }
  });
  app.patch('/api/connectors/:id/policy', admin, async c => {
    try {
      const id = c.req.param('id'); requireCliInstance(config(), id, { allowDisabled: true });
      const policy = getConnectorInstallation(`${id}-local-owner`);
      if (!policy) throw new Error('Connector policy not found.');
      const body = await c.req.json();
      if (!['read', 'write'].includes(body.maxScope)) throw new Error('Select read or write scope.');
      const updated = upsertConnectorInstallation({ ...policy, maxScope: body.maxScope, confirmationPolicy: 'writes' });
      return c.json({ ok: true, payload: { policy: updated } });
    } catch (error) { return c.json(failure(error), 400); }
  });
  app.patch('/api/connectors/accounts/:accountId', admin, async c => {
    try {
      const id = c.req.param('accountId');
      const account = getConnectorAccount(id);
      if (account?.principalId !== 'local-owner' || !account.runtimeInstanceId) throw new Error('CLI account not found.');
      requireCliInstance(config(), account.runtimeInstanceId, { allowDisabled: true });
      const body = await c.req.json();
      if ((body.label !== undefined && typeof body.label !== 'string') || (body.enabled !== undefined && typeof body.enabled !== 'boolean')) throw new Error('Invalid account update.');
      return c.json({ ok: true, payload: { account: updateConnectorAccount(id, { label: body.label, enabled: body.enabled }) } });
    } catch (error) { return c.json(failure(error), 400); }
  });
  app.delete('/api/connectors/accounts/:accountId', admin, c => {
    try {
      const id = c.req.param('accountId');
      const account = getConnectorAccount(id);
      if (account?.principalId !== 'local-owner' || !account.runtimeInstanceId) throw new Error('CLI account not found.');
      requireCliInstance(config(), account.runtimeInstanceId, { allowDisabled: true });
      updateConnectorAccount(id, { enabled: false });
      for (const connection of listConnectorConnections({ principalId: 'local-owner' }).filter(connection => connection.accountId === id && connection.provider === 'cli')) {
        cancelCliContext(String(connection.metadata.contextId));
        upsertConnectorConnection({ ...connection, status: 'disabled' });
      }
      return c.json({ ok: true, payload: { localDisconnected: true, remotelyRevoked: false } });
    } catch (error) { return c.json(failure(error), 400); }
  });
}
