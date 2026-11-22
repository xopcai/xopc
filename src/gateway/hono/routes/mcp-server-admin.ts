import type { Context, Hono } from 'hono';
import { z } from 'zod';

import { listAllMcpConnectionStats, listMcpAuditEntries } from '../../../mcp/audit.js';
import { McpConnectionCallbackSchema } from '../../../mcp/callback-config.js';
import { createMcpConnection, listMcpConnections, revokeMcpConnection } from '../../../mcp/connection-grants.js';
import { deleteBuiltinOAuthClient, listBuiltinOAuthClients } from '../../../mcp/oauth-server.js';
import {
  isMcpProductTool, listMcpProductTools, MCP_TOOLSETS, resolveMcpToolsetCapabilities,
} from '../../../mcp/product-tools.js';
import {
  MCP_OAUTH_AS_METADATA_PATH, MCP_RESOURCE_METADATA_PATH, REMOTE_MCP_PATH,
  RemoteMcpConfigSchema, resolveRemoteMcpIssuer, resolveRemoteMcpMode,
} from '../../../mcp/remote-config.js';
import { grantRemoteMcpConnection, listRemoteMcpGrants, revokeRemoteMcpConnection } from '../../../mcp/remote-grants.js';
import { loadTunnelState } from '../../../tunnel/tunnel-state.js';
import { resolveEffectiveGatewayPort } from '../../host.js';
import { resolveReverseProxyPublicUrl } from '../../public-url.js';
import { getGatewayPrincipal } from '../../security/gateway-principal.js';
import { withGatewayConfigWriteLock } from '../lib/config-write-lock.js';
import type { AuthenticatedRouteDeps } from './deps.js';

const CreateLocalGrantSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  toolset: z.string().trim().min(1).max(64).optional(),
  write: z.boolean().optional(),
  capabilityIds: z.array(z.string().min(1)).min(1).optional(),
  projectIds: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(50).optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
  callback: McpConnectionCallbackSchema.optional(),
});

const CreateRemoteGrantSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().min(1).max(1024),
  clientId: z.string().trim().min(1).max(1024),
  toolset: z.string().trim().min(1).max(64).optional(),
  write: z.boolean().optional(),
  capabilityIds: z.array(z.string().min(1)).min(1).optional(),
  projectIds: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(50).optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
  callback: McpConnectionCallbackSchema.optional(),
});

const PatchRemoteConfigSchema = z.strictObject({
  enabled: z.boolean(),
  config: RemoteMcpConfigSchema.optional(),
});

function requireOwner(c: Context): Response | undefined {
  const principal = getGatewayPrincipal(c);
  if (principal.kind !== 'owner' || !principal.scopes.includes('gateway.admin')) {
    return c.json({ ok: false, error: 'Owner administration is required.' }, 403);
  }
  return undefined;
}

function buildClientSnippets(params: { port: number; remoteUrl?: string; tokenPlaceholder?: string }) {
  const token = params.tokenPlaceholder ?? '${XOPC_MCP_TOKEN}';
  const args = params.port === 18790 ? ['mcp', 'serve', '--stdio'] : ['mcp', 'serve', '--stdio', '--port', String(params.port)];
  return {
    claudeDesktop: JSON.stringify({
      mcpServers: {
        xopc: {
          command: 'xopc',
          args,
          env: { XOPC_MCP_TOKEN: token },
        },
      },
    }, null, 2),
    cursor: JSON.stringify({
      mcpServers: {
        xopc: {
          command: 'xopc',
          args,
          env: { XOPC_MCP_TOKEN: token },
        },
      },
    }, null, 2),
    codexToml: [
      '[mcp_servers.xopc]',
      'command = "xopc"',
      `args = ${JSON.stringify(args)}`,
      'env_vars = ["XOPC_MCP_TOKEN"]',
    ].join('\n'),
    claudeCodeCli: `claude mcp add xopc -e XOPC_MCP_TOKEN="${token}" -- xopc ${args.join(' ')}`,
    ...(params.remoteUrl ? {
      remoteUrl: params.remoteUrl,
      codexRemoteCli: `codex mcp add xopc-remote --url ${params.remoteUrl}`,
      claudeCodeRemoteCli: `claude mcp add --transport http xopc-remote ${params.remoteUrl}`,
    } : {}),
  };
}

function resolveCapabilitiesFromRequest(input: {
  toolset?: string;
  write?: boolean;
  capabilityIds?: string[];
}): { capabilityIds: string[]; includesWrite: boolean; toolset?: string } {
  if (input.capabilityIds?.length) {
    if (input.capabilityIds.some(id => !isMcpProductTool(id))) {
      throw new Error('Unknown MCP capability ID');
    }
    const readSet = new Set(listMcpProductTools(false));
    const includesWrite = input.capabilityIds.some(id => !readSet.has(id));
    if (includesWrite && input.write === false) {
      throw new Error('Write tools require write access to be enabled');
    }
    return { capabilityIds: [...new Set(input.capabilityIds)], includesWrite, toolset: input.toolset };
  }
  if (input.toolset) {
    const resolved = resolveMcpToolsetCapabilities(input.toolset, input.write);
    if (!resolved) throw new Error(`Unknown MCP toolset: ${input.toolset}`);
    const readSet = new Set(listMcpProductTools(false));
    return {
      capabilityIds: resolved,
      includesWrite: resolved.some(id => !readSet.has(id)),
      toolset: input.toolset,
    };
  }
  const includesWrite = Boolean(input.write);
  return {
    capabilityIds: listMcpProductTools(includesWrite),
    includesWrite,
    toolset: includesWrite ? 'full-write' : 'full-read',
  };
}

export function registerMcpServerAdminRoutes(app: Hono, deps: AuthenticatedRouteDeps): void {
  app.use('/api/mcp-server/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.get('/api/mcp-server/overview', c => {
    const denied = requireOwner(c);
    if (denied) return denied;
    const config = deps.service.currentConfig;
    const remoteConfig = config.gateway?.mcp;
    const port = resolveEffectiveGatewayPort(config);
    const tunnelUrl = loadTunnelState()?.publicUrl;
    const reverseProxyUrl = resolveReverseProxyPublicUrl(config);
    const suggestedBase = (tunnelUrl ?? reverseProxyUrl)?.replace(/\/$/, '');
    const suggestedRemoteResource = suggestedBase ? `${suggestedBase}${REMOTE_MCP_PATH}` : `http://127.0.0.1:${port}${REMOTE_MCP_PATH}`;

    const stats = listAllMcpConnectionStats();
    const localGrants = listMcpConnections().map(grant => ({
      ...grant,
      stats: stats[grant.connectionId] ?? null,
    }));
    const remoteGrants = listRemoteMcpGrants().map(grant => ({
      connectionId: grant.connectionId,
      name: grant.name,
      toolset: grant.toolset,
      subject: grant.subject,
      clientId: grant.clientId,
      issuer: grant.issuer,
      resource: grant.resource,
      capabilityIds: grant.capabilityIds,
      projectIds: grant.projectIds,
      maxConcurrentRuns: grant.maxConcurrentRuns,
      hasCallback: Boolean(grant.callback),
      callbackUrl: grant.callback?.url,
      grantedAt: grant.grantedAt,
      expiresAt: grant.expiresAt,
      stats: stats[grant.connectionId] ?? null,
    }));
    const oauthClients = listBuiltinOAuthClients().map(client => ({
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUris: client.redirectUris,
      tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
      createdAt: client.createdAt,
    }));
    const projects = deps.service.projects?.list({ limit: 100 }).items.map(project => ({
      id: project.id,
      name: project.name,
    })) ?? [];

    return c.json({
      ok: true,
      payload: {
        gatewayPort: port,
        remote: remoteConfig ? {
          enabled: true,
          mode: resolveRemoteMcpMode(remoteConfig),
          resource: remoteConfig.resource,
          issuer: resolveRemoteMcpIssuer(remoteConfig),
          jwksUrl: remoteConfig.jwksUrl,
          allowedOrigins: remoteConfig.allowedOrigins ?? [],
          acceptedTokenTypes: remoteConfig.acceptedTokenTypes ?? ['at+jwt'],
          clientIdClaims: remoteConfig.clientIdClaims ?? ['client_id'],
          requireJti: remoteConfig.requireJti ?? true,
          rateLimitMax: remoteConfig.rateLimitMax ?? 120,
          rateLimitWindowMs: remoteConfig.rateLimitWindowMs ?? 60_000,
          metadataUrl: new URL(MCP_RESOURCE_METADATA_PATH, remoteConfig.resource).href,
          oauthAsMetadataUrl: resolveRemoteMcpMode(remoteConfig) === 'builtin'
            ? new URL(MCP_OAUTH_AS_METADATA_PATH, remoteConfig.resource).href
            : undefined,
        } : {
          enabled: false,
          suggestedResource: suggestedRemoteResource,
        },
        suggestedRemoteResource,
        toolsets: [
          ...MCP_TOOLSETS,
          {
            id: 'full-read',
            label: 'Full Workspace Read-Only',
            description: 'All read-only capabilities across projects, notes, tasks, files, memory, automations, and agent discovery.',
            includesWrite: false,
            capabilityIds: listMcpProductTools(false),
          },
          {
            id: 'full-write',
            label: 'Full Workspace Read & Write',
            description: 'All published MCP capabilities including writes and agent delegation.',
            includesWrite: true,
            capabilityIds: listMcpProductTools(true),
          },
        ],
        allCapabilities: listMcpProductTools(true),
        readCapabilities: listMcpProductTools(false),
        projects,
        localGrants,
        remoteGrants,
        oauthClients,
        snippets: buildClientSnippets({ port, remoteUrl: remoteConfig?.resource }),
      },
    });
  });

  app.post('/api/mcp-server/grants/local', deps.strictRateLimitMiddleware, async c => {
    const denied = requireOwner(c);
    if (denied) return denied;
    const body = CreateLocalGrantSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ ok: false, error: 'Invalid local grant payload.' }, 400);
    try {
      const { capabilityIds, toolset } = resolveCapabilitiesFromRequest(body.data);
      const expiresAt = body.data.expiresInDays ? Date.now() + body.data.expiresInDays * 86_400_000 : undefined;
      const created = createMcpConnection(capabilityIds, {
        name: body.data.name,
        toolset,
        projectIds: body.data.projectIds,
        maxConcurrentRuns: body.data.maxConcurrentRuns,
        callback: body.data.callback,
        expiresAt,
      });
      const port = resolveEffectiveGatewayPort(deps.service.currentConfig);
      return c.json({
        ok: true,
        payload: {
          ...created,
          capabilityIds,
          toolset,
          projectIds: body.data.projectIds,
          expiresAt,
          snippets: buildClientSnippets({ port, tokenPlaceholder: created.token }),
        },
      }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to create local MCP grant.' }, 400);
    }
  });

  app.delete('/api/mcp-server/grants/local/:id', deps.strictRateLimitMiddleware, c => {
    const denied = requireOwner(c);
    if (denied) return denied;
    try {
      revokeMcpConnection(c.req.param('id'));
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false, error: 'Invalid local MCP connection ID.' }, 400);
    }
  });

  app.post('/api/mcp-server/grants/remote', deps.strictRateLimitMiddleware, async c => {
    const denied = requireOwner(c);
    if (denied) return denied;
    const remoteConfig = deps.service.currentConfig.gateway?.mcp;
    if (!remoteConfig) return c.json({ ok: false, error: 'Enable remote MCP server configuration first.' }, 400);
    const body = CreateRemoteGrantSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ ok: false, error: 'Invalid remote grant payload.' }, 400);
    try {
      const { capabilityIds, includesWrite, toolset } = resolveCapabilitiesFromRequest(body.data);
      const expiresAt = body.data.expiresInDays ? Date.now() + body.data.expiresInDays * 86_400_000 : undefined;
      const grant = grantRemoteMcpConnection(
        {
          resource: remoteConfig.resource,
          issuer: resolveRemoteMcpIssuer(remoteConfig),
          subject: body.data.subject,
          clientId: body.data.clientId,
        },
        {
          capabilityIds,
          write: includesWrite,
          name: body.data.name,
          toolset,
          projectIds: body.data.projectIds,
          maxConcurrentRuns: body.data.maxConcurrentRuns,
          callback: body.data.callback,
          expiresAt,
        },
      );
      return c.json({ ok: true, payload: grant }, 201);
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to create remote MCP grant.' }, 400);
    }
  });

  app.delete('/api/mcp-server/grants/remote/:id', deps.strictRateLimitMiddleware, c => {
    const denied = requireOwner(c);
    if (denied) return denied;
    const removed = revokeRemoteMcpConnection(c.req.param('id'));
    if (!removed) return c.json({ ok: false, error: 'Active remote MCP grant not found.' }, 404);
    return c.json({ ok: true });
  });

  app.delete('/api/mcp-server/oauth-clients/:id', deps.strictRateLimitMiddleware, c => {
    const denied = requireOwner(c);
    if (denied) return denied;
    const removed = deleteBuiltinOAuthClient(c.req.param('id'));
    if (!removed) return c.json({ ok: false, error: 'OAuth client not found.' }, 404);
    return c.json({ ok: true });
  });

  app.patch('/api/mcp-server/config', deps.strictRateLimitMiddleware, async c => {
    const denied = requireOwner(c);
    if (denied) return denied;
    const body = PatchRemoteConfigSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ ok: false, error: body.error.issues[0]?.message ?? 'Invalid remote MCP configuration.' }, 400);
    if (body.data.enabled && !body.data.config) {
      return c.json({ ok: false, error: 'config is required when enabling remote MCP.' }, 400);
    }
    return withGatewayConfigWriteLock(deps.service, async () => {
      const current = deps.service.currentConfig;
      const next = structuredClone(current);
      if (body.data.enabled) {
        next.gateway.mcp = body.data.config;
      } else {
        delete next.gateway.mcp;
      }
      const saved = await deps.service.saveConfig(next, structuredClone(current));
      if (saved.conflict) return c.json({ ok: false, error: 'Configuration changed; reload and retry.' }, 409);
      if (!saved.saved && !saved.persisted) return c.json({ ok: false, error: 'Could not save Gateway MCP configuration.' }, 500);
      return c.json({ ok: true, payload: { enabled: body.data.enabled, config: next.gateway.mcp ?? null } });
    });
  });

  app.get('/api/mcp-server/audit', c => {
    const denied = requireOwner(c);
    if (denied) return denied;
    const connectionId = c.req.query('connectionId') || undefined;
    const limit = Math.max(1, Math.min(200, Number(c.req.query('limit')) || 50));
    return c.json({
      ok: true,
      payload: {
        entries: listMcpAuditEntries({ connectionId, limit }),
        stats: listAllMcpConnectionStats(),
      },
    });
  });
}
