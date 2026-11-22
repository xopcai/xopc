import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, Hono } from 'hono';
import { createMcpHandler, Server, specTypeSchemas } from '@modelcontextprotocol/server';

import { CapabilityError, type CapabilityContext, type CapabilityDispatcher } from '../../../capabilities/runtime/dispatcher.js';
import { recordMcpAudit } from '../../../mcp/audit.js';
import {
  cancelMcpProtocolTask, getMcpProtocolTask, getMcpProtocolTaskResult, listMcpProtocolTasks,
} from '../../../mcp/mcp-tasks.js';
import { listMcpProductTools, mcpProductScopes } from '../../../mcp/product-tools.js';
import { createRemoteMcpVerifier, remoteMcpChallenge } from '../../../mcp/remote-auth.js';
import {
  MCP_READ_SCOPE, MCP_RESOURCE_METADATA_PATH, MCP_ROOT_RESOURCE_METADATA_PATH, MCP_WRITE_SCOPE,
  REMOTE_MCP_PATH, resolveRemoteMcpIssuer, resolveRemoteMcpJwksUrl, resolveRemoteMcpMode,
  type RemoteMcpConfig,
} from '../../../mcp/remote-config.js';
import { findRemoteMcpGrant } from '../../../mcp/remote-grants.js';
import {
  getMcpPrompt, listMcpPrompts, listMcpResources, listMcpResourceTemplates, readMcpResource,
} from '../../../mcp/resources-and-prompts.js';
import { createMcpProjectScopeAuthorizer, filterMcpOutputForProjects } from '../../../mcp/scope-guard.js';
import {
  describeTool, MCP_SERVER_INSTRUCTIONS, parseToolArguments, safeCapabilityHint,
  scopedMcpIdempotencyKey, toolFailure, toolName, toolResult,
} from '../../../mcp/tool-contract.js';
import { PACKAGE_VERSION } from '../../../package-version.js';
import { createLogger } from '../../../utils/logger.js';
import { isLoopbackIpAddress, isTrustedProxyAddress } from '../../client-ip.js';
import { getGatewayFileSpaceService } from '../../file-space-service.js';
import type { GatewayService } from '../../service.js';
import { createGatewayMcpDispatcher } from '../lib/mcp-dispatcher.js';
import { registerBuiltinMcpOAuthRoutes } from './mcp-oauth.js';

const log = createLogger('Mcp:Remote');
const readTools = new Set(listMcpProductTools(false));

const DEFAULT_RATE_LIMIT_MAX = 120;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const MCP_CORS_ALLOW_HEADERS = 'Content-Type, Authorization, Accept, MCP-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name, Last-Event-ID';
const MCP_CORS_EXPOSE_HEADERS = 'Mcp-Session-Id, WWW-Authenticate, MCP-Protocol-Version';

function isAllowedOrigin(origin: string | undefined, resource: URL, allowedOrigins: readonly string[] | undefined): boolean {
  if (origin === undefined) return true;
  if (origin === resource.origin) return true;
  if (!allowedOrigins?.length) return false;
  return allowedOrigins.includes(origin);
}

function applyMcpCorsHeaders(c: Context, resource: URL, allowedOrigins: readonly string[] | undefined): void {
  const origin = c.req.header('Origin');
  if (origin && isAllowedOrigin(origin, resource, allowedOrigins)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', MCP_CORS_ALLOW_HEADERS);
    c.header('Access-Control-Expose-Headers', MCP_CORS_EXPOSE_HEADERS);
    c.header('Vary', 'Origin');
  }
}

function resourceRequestAllowed(c: Context, resource: URL, config: RemoteMcpConfig, trustedProxies: string[] | undefined): boolean {
  const origin = c.req.header('Origin');
  if (c.req.header('Host')?.toLowerCase() !== resource.host || !isAllowedOrigin(origin, resource, config.allowedOrigins)) {
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
  if (!config) return '';
  return JSON.stringify([
    resolveRemoteMcpMode(config),
    config.resource,
    resolveRemoteMcpIssuer(config),
    resolveRemoteMcpJwksUrl(config),
    config.acceptedTokenTypes ?? ['at+jwt'],
    config.clientIdClaims ?? ['client_id'],
    config.requireJti ?? true,
    config.introspectionUrl ?? '',
  ]);
}

function createSlidingRateLimiter() {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (key: string, max: number, windowMs: number): { allowed: boolean; retryAfterSec: number } => {
    const now = Date.now();
    if (buckets.size > 2_000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    if (existing.count >= max) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSec: 0 };
  };
}

export function registerRemoteMcpRoutes(app: Hono, service: GatewayService): void {
  let dispatcher: CapabilityDispatcher | undefined;
  const getConfig = () => service.currentConfig.gateway?.mcp;
  let verifier: { key: string; verify: ReturnType<typeof createRemoteMcpVerifier> } | undefined;
  const checkRateLimit = createSlidingRateLimiter();

  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  // Register built-in OAuth 2.1 Authorization Server endpoints (active only in builtin mode)
  registerBuiltinMcpOAuthRoutes(app, service);

  const handleResourceMetadata = (c: Context) => {
    const config = getConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    const resource = new URL(config.resource);
    if (!resourceRequestAllowed(c, resource, config, service.currentConfig.gateway?.trustedProxies)) {
      return c.json({ error: 'access_denied' }, 403);
    }
    applyMcpCorsHeaders(c, resource, config.allowedOrigins);
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    return c.json({
      resource: config.resource,
      authorization_servers: [resolveRemoteMcpIssuer(config)],
      scopes_supported: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'xopc Gateway',
    });
  };

  app.on(['GET', 'OPTIONS'], MCP_RESOURCE_METADATA_PATH, handleResourceMetadata);
  app.on(['GET', 'OPTIONS'], MCP_ROOT_RESOURCE_METADATA_PATH, handleResourceMetadata);

  app.all(REMOTE_MCP_PATH, async c => {
    const config = getConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    const resource = new URL(config.resource);
    if (!resourceRequestAllowed(c, resource, config, service.currentConfig.gateway?.trustedProxies)) {
      return c.json({ error: 'access_denied' }, 403);
    }
    applyMcpCorsHeaders(c, resource, config.allowedOrigins);
    if (c.req.method === 'OPTIONS') return c.body(null, 204);

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

    const rateResult = checkRateLimit(
      grant.connectionId,
      config.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX,
      config.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    );
    if (!rateResult.allowed) {
      c.header('Retry-After', String(rateResult.retryAfterSec));
      return c.json({ error: 'rate_limit_exceeded' }, 429);
    }

    const product = dispatcher ??= createGatewayMcpDispatcher(service);
    const principalId = `mcp:${grant.connectionId}`;
    const assertCurrent = () => {
      if (key !== verifierKey(getConfig()) || findRemoteMcpGrant(verified.identity)?.connectionId !== grant.connectionId) {
        throw new CapabilityError('FORBIDDEN', 'MCP connection was revoked');
      }
    };
    const capabilityIds = verified.hasWriteScope ? grant.capabilityIds : grant.capabilityIds.filter(id => readTools.has(id));
    const authorize = createMcpProjectScopeAuthorizer(capabilityIds, grant.projectIds, {
      getProjects: () => service.projects,
      getFiles: () => getGatewayFileSpaceService(service),
    });
    const context: CapabilityContext = {
      principalId, surface: 'mcp', actor: { kind: 'integration', id: principalId },
      allowedCapabilities: capabilityIds, scopes: mcpProductScopes(capabilityIds),
      authorize, assertCurrent,
    };
    const catalog = () => {
      assertCurrent();
      return product.list(context).filter(item => item.effect === 'read' || item.effect === 'local-write');
    };
    const hasDelegationTasks = capabilityIds.includes('xopc.agent_runs.get') || capabilityIds.includes('xopc.agent_runs.list');

    const handler = createMcpHandler(() => {
      const server = new Server(
        { name: 'xopc-gateway', version: PACKAGE_VERSION },
        {
          instructions: MCP_SERVER_INSTRUCTIONS,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
            ...(hasDelegationTasks ? { tasks: { list: {}, cancel: {} } } : {}),
          },
        },
      );
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
            return toolFailure(status, undefined, item.effect === 'read'
              ? 'Read tools do not accept idempotencyKey.'
              : 'Write tools require a non-empty string idempotencyKey.');
          }
          const rawResult = await product.call(item.id, args.input, { ...context, signal }, {
            majorVersion: item.majorVersion, descriptorDigest: item.descriptorDigest,
            idempotencyKey: scopedMcpIdempotencyKey(principalId, item.id, args.idempotencyKey),
          });
          assertCurrent();
          const filtered = filterMcpOutputForProjects(item.id, rawResult, grant.projectIds);
          status = 'succeeded';
          return toolResult(filtered as Record<string, unknown>);
        } catch (error) {
          status = error instanceof CapabilityError ? error.code : 'INTERNAL';
          operationId = error instanceof CapabilityError ? error.operationId : undefined;
          if (status === 'INTERNAL') log.error({ err: error, principalId, capabilityId }, 'MCP tool call failed');
          return toolFailure(status, operationId, safeCapabilityHint(error));
        } finally {
          const durationMs = Date.now() - startedAt;
          if (capabilityId) {
            recordMcpAudit({
              transport: 'remote',
              principalId,
              connectionId: grant.connectionId,
              capabilityId,
              status,
              durationMs,
              ...(operationId ? { operationId } : {}),
            });
          }
          log.info({ principalId, capabilityId, status, durationMs }, 'Remote MCP tool call completed');
        }
      });

      server.setRequestHandler('resources/list', () => ({
        resources: listMcpResources(product, context),
      }));
      server.setRequestHandler('resources/templates/list', () => ({
        resourceTemplates: listMcpResourceTemplates(product, context),
      }));
      server.setRequestHandler('resources/read', async ({ params }, ctx) => {
        const signal = AbortSignal.any([c.req.raw.signal, ctx.mcpReq.signal, AbortSignal.timeout(30_000)]);
        return readMcpResource(
          params.uri,
          product,
          { ...context, signal },
          (id, res) => filterMcpOutputForProjects(id, res, grant.projectIds),
        );
      });

      server.setRequestHandler('prompts/list', () => ({
        prompts: listMcpPrompts(product, context),
      }));
      server.setRequestHandler('prompts/get', ({ params }) =>
        getMcpPrompt(params.name, params.arguments as Record<string, string> | undefined, product, context),
      );

      if (hasDelegationTasks) {
        type LegacyTaskServer = {
          setRequestHandler: (
            method: string,
            handler: (
              request: { params?: Record<string, unknown> },
              ctx: { mcpReq: { signal: AbortSignal } },
            ) => unknown | Promise<unknown>,
          ) => void;
        };
        const taskServer = server as unknown as LegacyTaskServer;
        taskServer.setRequestHandler('tasks/list', ({ params }) =>
          listMcpProtocolTasks(context, typeof params?.cursor === 'string' ? params.cursor : undefined),
        );
        taskServer.setRequestHandler('tasks/get', ({ params }) =>
          getMcpProtocolTask(String(params?.taskId ?? ''), context),
        );
        taskServer.setRequestHandler('tasks/result', async ({ params }, ctx) => {
          const signal = AbortSignal.any([c.req.raw.signal, ctx.mcpReq.signal, AbortSignal.timeout(30_000)]);
          return getMcpProtocolTaskResult(String(params?.taskId ?? ''), product, { ...context, signal });
        });
        taskServer.setRequestHandler('tasks/cancel', async ({ params }, ctx) => {
          const signal = AbortSignal.any([c.req.raw.signal, ctx.mcpReq.signal, AbortSignal.timeout(30_000)]);
          return cancelMcpProtocolTask(String(params?.taskId ?? ''), product, { ...context, signal });
        });
      }

      return server;
    }, { legacy: 'stateless', maxRequestBodySize: capabilityIds.some(id => !readTools.has(id)) ? 16 * 1024 * 1024 : 64 * 1024, maxSubscriptions: 0 });
    return handler.fetch(c.req.raw);
  });
}
