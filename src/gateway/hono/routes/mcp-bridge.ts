import type { Context, Hono } from 'hono';
import { CapabilityCallSchema } from '@xopcai/gateway-contract';
import { z } from 'zod';

import { authorizeExternalMcpConnection } from '../../../agent/external/mcp-bridge.js';
import { capabilityHttpError } from '../../../capabilities/adapters/http.js';
import { CapabilityError, type CapabilityContext } from '../../../capabilities/runtime/dispatcher.js';
import { recordMcpAudit } from '../../../mcp/audit.js';
import { authenticateMcpConnection, getMcpBearerToken, MCP_BRIDGE_PATH } from '../../../mcp/connection-grants.js';
import {
  cancelMcpProtocolTask, getMcpProtocolTask, getMcpProtocolTaskResult, listMcpProtocolTasks,
} from '../../../mcp/mcp-tasks.js';
import { mcpProductScopes } from '../../../mcp/product-tools.js';
import {
  getMcpPrompt, listMcpPrompts, listMcpResources, listMcpResourceTemplates, readMcpResource,
} from '../../../mcp/resources-and-prompts.js';
import { createMcpProjectScopeAuthorizer, filterMcpOutputForProjects } from '../../../mcp/scope-guard.js';
import { scopedMcpIdempotencyKey } from '../../../mcp/tool-contract.js';
import { createLogger } from '../../../utils/logger.js';
import { getGatewayFileSpaceService } from '../../file-space-service.js';
import type { GatewayService } from '../../service.js';
import { createGatewayMcpDispatcher } from '../lib/mcp-dispatcher.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const log = createLogger('Mcp:Bridge');
const BridgeCall = CapabilityCallSchema.extend({ capability: z.string() });
const BridgeProtocolAction = z.discriminatedUnion('bridgeAction', [
  z.strictObject({ bridgeAction: z.literal('resources/list') }),
  z.strictObject({ bridgeAction: z.literal('resources/templates/list') }),
  z.strictObject({ bridgeAction: z.literal('resources/read'), uri: z.string().min(1).max(2048) }),
  z.strictObject({ bridgeAction: z.literal('prompts/list') }),
  z.strictObject({
    bridgeAction: z.literal('prompts/get'),
    name: z.string().min(1).max(200),
    arguments: z.record(z.string(), z.string()).optional(),
  }),
  z.strictObject({ bridgeAction: z.literal('tasks/list'), cursor: z.string().max(128).optional() }),
  z.strictObject({ bridgeAction: z.literal('tasks/get'), taskId: z.string().min(1).max(128) }),
  z.strictObject({ bridgeAction: z.literal('tasks/result'), taskId: z.string().min(1).max(128) }),
  z.strictObject({ bridgeAction: z.literal('tasks/cancel'), taskId: z.string().min(1).max(128) }),
]);

function bridgeContext(c: Context, service: GatewayService): {
  context: CapabilityContext;
  connectionId: string;
  projectIds?: string[];
} {
  const token = getMcpBearerToken(c.req.header('Authorization'));
  const grant = authenticateMcpConnection(token);
  if (!grant) throw new CapabilityError('FORBIDDEN', 'MCP connection is absent or revoked');
  const conversationId = grant.toolset ? authorizeExternalMcpConnection(grant.connectionId, service.getConfig()) : undefined;
  if (grant.toolset && !conversationId) throw new CapabilityError('FORBIDDEN', 'External MCP authorization changed');
  const principalId = `mcp:${grant.connectionId}`;
  const authorize = createMcpProjectScopeAuthorizer(grant.capabilityIds, grant.projectIds, {
    getProjects: () => service.projects,
    getFiles: () => getGatewayFileSpaceService(service),
  });
  return {
    connectionId: grant.connectionId,
    projectIds: grant.projectIds,
    context: {
      principalId, surface: 'mcp', actor: { kind: 'integration', id: principalId },
      allowedCapabilities: grant.capabilityIds,
      conversationId,
      mcpProjectIds: grant.projectIds,
      scopes: mcpProductScopes(grant.capabilityIds),
      authorize,
      assertCurrent: () => {
        const current = authenticateMcpConnection(token);
        if (!current || (grant.toolset && authorizeExternalMcpConnection(grant.connectionId, service.getConfig()) !== conversationId)
          || current.capabilityIds.join('\n') !== grant.capabilityIds.join('\n')
          || (current.projectIds ?? []).join('\n') !== (grant.projectIds ?? []).join('\n')) {
          throw new CapabilityError('FORBIDDEN', 'MCP connection authorization changed');
        }
      },
      signal: c.req.raw.signal,
    },
  };
}

export function registerMcpBridgeRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  const dispatcher = createGatewayMcpDispatcher(deps.service);
  app.use(MCP_BRIDGE_PATH, async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get(MCP_BRIDGE_PATH, c => {
    try {
      const { context } = bridgeContext(c, deps.service);
      return c.json({ capabilities: dispatcher.list(context) });
    } catch (error) {
      return capabilityHttpError(c, error);
    }
  });
  app.post(MCP_BRIDGE_PATH, deps.strictRateLimitMiddleware, async c => {
    const startedAt = Date.now();
    let principalId: string | undefined;
    let connectionId: string | undefined;
    let capabilityId: string | undefined;
    let status = 'failed';
    let operationId: string | undefined;
    try {
      const resolved = bridgeContext(c, deps.service);
      const { context, projectIds } = resolved;
      principalId = context.principalId;
      connectionId = resolved.connectionId;

      const rawBody = await c.req.json().catch(() => null);
      if (rawBody && typeof rawBody === 'object' && 'bridgeAction' in rawBody) {
        const action = BridgeProtocolAction.safeParse(rawBody);
        if (!action.success) throw new CapabilityError('INVALID_INPUT', 'Invalid MCP bridge protocol action');
        const payload = action.data;
        capabilityId = `protocol:${payload.bridgeAction}`;
        let data: unknown;
        switch (payload.bridgeAction) {
          case 'resources/list':
            data = { resources: listMcpResources(dispatcher, context) };
            break;
          case 'resources/templates/list':
            data = { resourceTemplates: listMcpResourceTemplates(dispatcher, context) };
            break;
          case 'resources/read':
            data = await readMcpResource(payload.uri, dispatcher, context, (id, res) => filterMcpOutputForProjects(id, res, projectIds));
            break;
          case 'prompts/list':
            data = { prompts: listMcpPrompts(dispatcher, context) };
            break;
          case 'prompts/get':
            data = getMcpPrompt(payload.name, payload.arguments, dispatcher, context);
            break;
          case 'tasks/list':
            data = listMcpProtocolTasks(context, payload.cursor);
            break;
          case 'tasks/get':
            data = getMcpProtocolTask(payload.taskId, context);
            break;
          case 'tasks/result':
            data = await getMcpProtocolTaskResult(payload.taskId, dispatcher, context);
            break;
          case 'tasks/cancel':
            data = await cancelMcpProtocolTask(payload.taskId, dispatcher, context);
            break;
        }
        status = 'succeeded';
        return c.json({ data });
      }

      const call = BridgeCall.safeParse(rawBody);
      if (!call.success) throw new CapabilityError('INVALID_INPUT', 'Invalid MCP capability call');
      const { capability, input, idempotencyKey, ...contract } = call.data;
      if (!context.allowedCapabilities?.includes(capability)) {
        throw new CapabilityError('FORBIDDEN', 'Capability not granted to this connection');
      }
      capabilityId = capability;
      const rawResult = await dispatcher.call(capabilityId, input, context, {
        ...contract, idempotencyKey: scopedMcpIdempotencyKey(principalId, capabilityId, idempotencyKey),
      });
      context.assertCurrent?.();
      const result = filterMcpOutputForProjects(capabilityId, rawResult, projectIds);
      status = 'succeeded';
      return c.json({ data: result });
    } catch (error) {
      status = error instanceof CapabilityError ? error.code : 'INTERNAL';
      operationId = error instanceof CapabilityError ? error.operationId : undefined;
      return capabilityHttpError(c, error);
    } finally {
      const durationMs = Date.now() - startedAt;
      if (connectionId && principalId && capabilityId && !capabilityId.startsWith('protocol:')) {
        recordMcpAudit({
          transport: 'stdio',
          principalId,
          connectionId,
          capabilityId,
          status,
          durationMs,
          ...(operationId ? { operationId } : {}),
        });
      }
      log.info({ principalId, capabilityId, status, durationMs }, 'MCP capability call completed');
    }
  });
}
