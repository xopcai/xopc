import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';
import { createMcpHandler, Server, specTypeSchemas } from '@modelcontextprotocol/server';

import { CapabilityError, type CapabilityContext, type CapabilityDispatcher } from '../../../capabilities/runtime/dispatcher.js';
import { listMcpProductTools, mcpProductScopes } from '../../../mcp/product-tools.js';
import { createRemoteMcpVerifier, remoteMcpChallenge } from '../../../mcp/remote-auth.js';
import {
  MCP_READ_SCOPE, MCP_WRITE_SCOPE, MCP_RESOURCE_METADATA_PATH, REMOTE_MCP_PATH, type RemoteMcpConfig,
} from '../../../mcp/remote-config.js';
import { findRemoteMcpGrant } from '../../../mcp/remote-grants.js';
import { describeTool, parseToolArguments, scopedMcpIdempotencyKey, toolFailure, toolName, toolResult } from '../../../mcp/tool-contract.js';
import { PACKAGE_VERSION } from '../../../package-version.js';
import { createLogger } from '../../../utils/logger.js';
import { isLoopbackIpAddress, isTrustedProxyAddress } from '../../client-ip.js';
import type { GatewayService } from '../../service.js';
import { createGatewayMcpDispatcher } from '../lib/mcp-dispatcher.js';

const log = createLogger('Mcp:Remote');
const readTools = new Set(listMcpProductTools(false));

function resourceRequestAllowed(c: Context, resource: URL, trustedProxies: string[] | undefined): boolean {
  const origin = c.req.header('Origin');
  if (c.req.header('Host')?.toLowerCase() !== resource.host || (origin !== undefined && origin !== resource.origin)) {
    return false;
  }
  try {
    const peer = getConnInfo(c).remote.address;
    if (isLoopbackIpAddress(peer)) return true;
    return resource.protocol === 'https:' && (c.env?.incoming?.socket?.encrypted === true
      || (peer !== undefined && isTrustedProxyAddress(peer, trustedProxies)));
  } catch {
    return false;
  }
}

function verifierKey(config: RemoteMcpConfig | undefined): string {
  return config ? JSON.stringify([config.resource, config.issuer, config.jwksUrl]) : '';
}

export function registerRemoteMcpRoutes(app: Hono, service: GatewayService): void {
  let dispatcher: CapabilityDispatcher | undefined;
  const getConfig = () => service.currentConfig.gateway?.mcp;
  let verifier: { key: string; verify: ReturnType<typeof createRemoteMcpVerifier> } | undefined;

  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.get(MCP_RESOURCE_METADATA_PATH, c => {
    const config = getConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    if (!resourceRequestAllowed(c, new URL(config.resource), service.currentConfig.gateway?.trustedProxies)) return c.json({ error: 'access_denied' }, 403);
    return c.json({
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'xopc Gateway',
    });
  });

  app.all(REMOTE_MCP_PATH, async c => {
    const config = getConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    if (!resourceRequestAllowed(c, new URL(config.resource), service.currentConfig.gateway?.trustedProxies)) return c.json({ error: 'access_denied' }, 403);

    const key = verifierKey(config);
    if (verifier?.key !== key) verifier = { key, verify: createRemoteMcpVerifier(config) };
    const authorization = c.req.header('Authorization');
    const verified = await verifier.verify(authorization);
    if (!verified) {
      c.header('WWW-Authenticate', remoteMcpChallenge(config, authorization ? 'invalid_token' : undefined));
      return c.json({ error: authorization ? 'invalid_token' : 'unauthorized' }, 401);
    }
    if (!verified.hasReadScope) {
      c.header('WWW-Authenticate', remoteMcpChallenge(config, 'insufficient_scope'));
      return c.json({ error: 'insufficient_scope' }, 403);
    }

    const grant = findRemoteMcpGrant(verified.identity);
    if (!grant || key !== verifierKey(getConfig())) return c.json({ error: 'access_denied' }, 403);

    const product = dispatcher ??= createGatewayMcpDispatcher(service);
    const principalId = `mcp:${grant.connectionId}`;
    const assertCurrent = () => {
      if (key !== verifierKey(getConfig()) || findRemoteMcpGrant(verified.identity)?.connectionId !== grant.connectionId) {
        throw new CapabilityError('FORBIDDEN', 'MCP connection was revoked');
      }
    };
    const capabilityIds = verified.hasWriteScope ? grant.capabilityIds : grant.capabilityIds.filter(id => readTools.has(id));
    const context: CapabilityContext = {
      principalId, surface: 'mcp', actor: { kind: 'integration', id: principalId },
      allowedCapabilities: capabilityIds, scopes: mcpProductScopes(capabilityIds),
      authorize: id => capabilityIds.includes(id), assertCurrent,
    };
    const catalog = () => {
      assertCurrent();
      return product.list(context).filter(item => item.effect === 'read' || item.effect === 'local-write');
    };

    const handler = createMcpHandler(() => {
      const server = new Server({ name: 'xopc-gateway', version: PACKAGE_VERSION }, { capabilities: { tools: {} } });
      server.setRequestHandler('tools/list', () => {
        const result = specTypeSchemas.ListToolsResult['~standard'].validate({ tools: catalog().map(describeTool) });
        if (!('value' in result)) throw new Error('Invalid Gateway MCP tool catalog');
        return result.value;
      });
      server.setRequestHandler('tools/call', async ({ params }, ctx) => {
        const startedAt = Date.now();
        let capabilityId: string | undefined;
        let status = 'FORBIDDEN';
        let operationId: string | undefined;
        try {
          const item = catalog().find(tool => toolName(tool.id) === params.name);
          if (!item) return toolFailure(status);
          capabilityId = item.id;
          const signal = AbortSignal.any([c.req.raw.signal, ctx.mcpReq.signal, AbortSignal.timeout(30_000)]);
          const args = parseToolArguments(item, params.arguments);
          if (!args) {
            status = 'INVALID_INPUT';
            return toolFailure(status);
          }
          const result = await product.call(item.id, args.input, { ...context, signal }, {
            majorVersion: item.majorVersion, descriptorDigest: item.descriptorDigest,
            idempotencyKey: scopedMcpIdempotencyKey(principalId, item.id, args.idempotencyKey),
          });
          assertCurrent();
          status = 'succeeded';
          return toolResult(result as Record<string, unknown>);
        } catch (error) {
          status = error instanceof CapabilityError ? error.code : 'INTERNAL';
          operationId = error instanceof CapabilityError ? error.operationId : undefined;
          if (status === 'INTERNAL') log.error({ err: error, principalId, capabilityId }, 'MCP tool call failed');
          return toolFailure(status, operationId);
        } finally {
          log.info({ principalId, capabilityId, status, durationMs: Date.now() - startedAt }, 'Remote MCP tool call completed');
        }
      });
      return server;
    }, { legacy: 'stateless', maxRequestBodySize: capabilityIds.some(id => !readTools.has(id)) ? 16 * 1024 * 1024 : 64 * 1024, maxSubscriptions: 0 });
    return handler.fetch(c.req.raw);
  });
}
