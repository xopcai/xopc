import type { Context, Hono } from 'hono';
import { CapabilityCallSchema } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { CapabilityError, type CapabilityContext } from '../../../capabilities/runtime/dispatcher.js';
import { authenticateMcpConnection, getMcpBearerToken, MCP_BRIDGE_PATH } from '../../../mcp/connection-grants.js';
import { mcpProductScopes } from '../../../mcp/product-tools.js';
import { scopedMcpIdempotencyKey } from '../../../mcp/tool-contract.js';
import { createLogger } from '../../../utils/logger.js';
import { createGatewayMcpDispatcher } from '../lib/mcp-dispatcher.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('Mcp:Bridge');
const BridgeCall = CapabilityCallSchema.extend({ capability: z.string() });

function bridgeContext(c: Context): CapabilityContext {
  const token = getMcpBearerToken(c.req.header('Authorization'));
  const grant = authenticateMcpConnection(token);
  if (!grant) throw new CapabilityError('FORBIDDEN', 'MCP connection is absent or revoked');
  const principalId = `mcp:${grant.connectionId}`;
  return {
    principalId, surface: 'mcp', actor: { kind: 'integration', id: principalId },
    allowedCapabilities: grant.capabilityIds,
    scopes: mcpProductScopes(grant.capabilityIds),
    authorize: id => grant.capabilityIds.includes(id),
    assertCurrent: () => {
      const current = authenticateMcpConnection(token);
      if (!current || current.capabilityIds.join('\n') !== grant.capabilityIds.join('\n')) {
        throw new CapabilityError('FORBIDDEN', 'MCP connection authorization changed');
      }
    },
    signal: c.req.raw.signal,
  };
}

export function registerMcpBridgeRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const dispatcher = createGatewayMcpDispatcher(deps.service);
  app.use(MCP_BRIDGE_PATH, async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get(MCP_BRIDGE_PATH, c => {
    try { return c.json({ capabilities: dispatcher.list(bridgeContext(c)) }); }
    catch (error) { return capabilityHttpError(c, error); }
  });
  app.post(MCP_BRIDGE_PATH, deps.strictRateLimitMiddleware, async c => {
    const startedAt = Date.now();
    let principalId: string | undefined;
    let capabilityId: string | undefined;
    let status = 'failed';
    try {
      const context = bridgeContext(c);
      principalId = context.principalId;
      const call = BridgeCall.safeParse(await c.req.json().catch(() => null));
      if (!call.success) throw new CapabilityError('INVALID_INPUT', 'Invalid MCP capability call');
      const { capability, input, idempotencyKey, ...contract } = call.data;
      if (!context.allowedCapabilities?.includes(capability)) {
        throw new CapabilityError('FORBIDDEN', 'Capability not granted to this connection');
      }
      capabilityId = capability;
      const result = await dispatcher.call(capabilityId, input, context, {
        ...contract, idempotencyKey: scopedMcpIdempotencyKey(principalId, capabilityId, idempotencyKey),
      });
      context.assertCurrent?.();
      status = 'succeeded';
      return c.json({ data: result });
    } catch (error) {
      status = error instanceof CapabilityError ? error.code : 'INTERNAL';
      return capabilityHttpError(c, error);
    } finally {
      log.info({ principalId, capabilityId, status, durationMs: Date.now() - startedAt }, 'MCP capability call completed');
    }
  });
}
