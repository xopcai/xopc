import {
  executionHostRegistrationSchema,
  executionHostTicketRequestSchema,
} from '@xopcai/realtime-protocol';
import type { Hono } from 'hono';
import { z } from 'zod';

import { parseP256PublicKey } from '../../../crypto/p256.js';
import {
  createExecutionHost,
  getExecutionHost,
  listExecutionHostEvents,
  listExecutionHosts,
  revokeExecutionHost,
} from '../../../execution-hosts/index.js';
import type { GatewayService } from '../../service.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const enrollmentRequestSchema = z.strictObject({
  code: z.string().min(16).max(160),
  registration: executionHostRegistrationSchema,
});

function publicHost(host: ReturnType<typeof getExecutionHost>, online: boolean) {
  if (!host) return undefined;
  const { publicKey: _publicKey, ...safe } = host;
  return { ...safe, online };
}

export function registerPublicExecutionHostRoutes(app: Hono, service: GatewayService): void {
  app.post('/api/execution-hosts/enroll', async (c) => {
    const parsed = enrollmentRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid execution host enrollment' } }, 400);
    }
    try {
      parseP256PublicKey(parsed.data.registration.publicKey);
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid execution host public key' } }, 400);
    }
    if (!service.executionHosts.enrollments.consume(parsed.data.code)) {
      return c.json({ ok: false, error: { code: 'INVALID_CODE', message: 'Enrollment code is invalid or expired' } }, 401);
    }
    if (getExecutionHost(parsed.data.registration.hostId)) {
      return c.json({ ok: false, error: { code: 'CONFLICT', message: 'Execution host already exists' } }, 409);
    }
    const host = createExecutionHost(parsed.data.registration);
    return c.json({ ok: true, payload: publicHost(host, false) }, 201);
  });

  app.post('/api/execution-hosts/tickets', async (c) => {
    const parsed = executionHostTicketRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid execution host ticket request' } }, 400);
    }
    try {
      service.executionHosts.authenticator.authenticateTicket(parsed.data);
      return c.json({
        ok: true,
        payload: service.realtime.tickets.issue(parsed.data.hostId, 'execution_host', {
          principalId: `execution-host:${parsed.data.hostId}`,
          scopes: [],
        }),
      });
    } catch {
      return c.json({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Execution host authentication failed' },
      }, 401);
    }
  });
}

export function registerExecutionHostRoutes(
  authenticated: Hono,
  deps: AuthenticatedRouteDeps,
): void {
  authenticated.get('/api/execution-hosts', (c) => {
    const online = new Set(deps.service.executionHosts.registry.list().map((host) => host.hostId));
    return c.json({
      ok: true,
      payload: listExecutionHosts().map((host) => publicHost(host, online.has(host.id))),
    });
  });

  authenticated.post('/api/execution-hosts/enrollment-codes', (c) => {
    try {
      return c.json({ ok: true, payload: deps.service.executionHosts.enrollments.issue() }, 201);
    } catch (error) {
      return c.json({
        ok: false,
        error: { code: 'LIMIT_REACHED', message: error instanceof Error ? error.message : 'Unable to create enrollment code' },
      }, 503);
    }
  });

  authenticated.get('/api/execution-hosts/:hostId/events', (c) => {
    const hostId = c.req.param('hostId');
    if (!getExecutionHost(hostId)) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Execution host not found' } }, 404);
    }
    return c.json({ ok: true, payload: listExecutionHostEvents(hostId) });
  });

  authenticated.delete('/api/execution-hosts/:hostId', (c) => {
    const hostId = c.req.param('hostId');
    const host = revokeExecutionHost(hostId);
    if (!host) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Active execution host not found' } }, 404);
    }
    deps.service.executionHosts.registry.disconnectHost(hostId, 'Execution host revoked');
    return c.json({ ok: true, payload: publicHost(host, false) });
  });
}
