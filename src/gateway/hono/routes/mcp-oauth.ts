import type { Context, Hono } from 'hono';

import {
  approveBuiltinOAuthAuthorization,
  buildBuiltinOAuthAsMetadata,
  exchangeBuiltinOAuthCode,
  getBuiltinOAuthClient,
  getBuiltinOAuthJwks,
  refreshBuiltinOAuthToken,
  registerBuiltinOAuthClient,
  revokeBuiltinOAuthToken,
} from '../../../mcp/oauth-server.js';
import { MCP_TOOLSETS } from '../../../mcp/product-tools.js';
import {
  MCP_OAUTH_AS_METADATA_PATH,
  MCP_OAUTH_BASE_PATH,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  resolveRemoteMcpMode,
} from '../../../mcp/remote-config.js';
import { authenticateBrowserSession } from '../../../storage/sqlite/browser-session-repository.js';
import { readBrowserSessionCookie } from '../../security/browser-session.js';
import { safeEqualSecret } from '../../security/secret-equal.js';
import type { GatewayService } from '../../service.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isOwnerAuthenticated(c: Context, service: GatewayService, providedSecret?: string): boolean {
  const auth = service.getResolvedAuth();
  const cookie = readBrowserSessionCookie(c);
  if (cookie && authenticateBrowserSession(cookie, auth)) return true;
  if (auth.mode === 'none') return true;
  const expected = auth.mode === 'token' ? auth.token : auth.mode === 'password' ? auth.password : undefined;
  if (!expected) return false;
  const candidate = providedSecret?.trim()
    || c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  return Boolean(candidate && safeEqualSecret(candidate, expected));
}

function parseBasicClientAuth(header: string | undefined): { clientId?: string; clientSecret?: string } {
  if (!header?.toLowerCase().startsWith('basic ')) return {};
  try {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return {};
    return {
      clientId: decodeURIComponent(decoded.slice(0, idx)),
      clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
    };
  } catch {
    return {};
  }
}

function renderConsentHtml(params: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  resource: string;
  scopes: string[];
  needsOwnerSecret: boolean;
  projects: Array<{ id: string; name: string }>;
  error?: string;
}): string {
  const scopeList = params.scopes.join(' ');
  const includesWrite = params.scopes.includes(MCP_WRITE_SCOPE);
  const toolsetOptions = [
    ...MCP_TOOLSETS.filter(t => includesWrite || !t.includesWrite),
    ...(includesWrite ? [{ id: 'full-write', label: 'Full Workspace Read & Write' }] : [{ id: 'full-read', label: 'Full Workspace Read-Only' }]),
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Authorize ${escapeHtml(params.clientName)} — xopc Gateway MCP</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; display: flex; justify-content: center; }
    .card { width: 100%; max-width: 520px; background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 24px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 13px; color: #94a3b8; margin: 0 0 16px; line-height: 1.5; }
    label { display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin: 12px 0 6px; }
    input[type=password], select { width: 100%; box-sizing: border-box; padding: 9px 10px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; font-size: 13px; }
    .meta { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; font-size: 12px; margin-bottom: 12px; }
    .meta div { margin: 4px 0; word-break: break-all; }
    .error { background: #450a0a; border: 1px solid #dc2626; color: #fecaca; border-radius: 8px; padding: 10px; font-size: 12px; margin-bottom: 12px; }
    .actions { display: flex; gap: 10px; margin-top: 20px; }
    button { flex: 1; padding: 10px 14px; border-radius: 8px; border: 0; font-size: 13px; font-weight: 600; cursor: pointer; }
    .approve { background: #2563eb; color: #fff; }
    .deny { background: #334155; color: #e2e8f0; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="${MCP_OAUTH_BASE_PATH}/authorize">
    <h1>Authorize External AI Client</h1>
    <p><strong>${escapeHtml(params.clientName)}</strong> requests MCP access to your xopc Gateway.</p>
    ${params.error ? `<div class="error">${escapeHtml(params.error)}</div>` : ''}
    <div class="meta">
      <div><strong>Client ID:</strong> ${escapeHtml(params.clientId)}</div>
      <div><strong>Resource:</strong> ${escapeHtml(params.resource)}</div>
      <div><strong>Scopes:</strong> ${escapeHtml(scopeList)}</div>
      <div><strong>Redirect:</strong> ${escapeHtml(params.redirectUri)}</div>
    </div>
    <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}" />
    <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}" />
    <input type="hidden" name="state" value="${escapeHtml(params.state)}" />
    <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}" />
    <input type="hidden" name="code_challenge_method" value="S256" />
    <input type="hidden" name="resource" value="${escapeHtml(params.resource)}" />
    <input type="hidden" name="scope" value="${escapeHtml(scopeList)}" />
    <label for="toolset">Capability Profile (Toolset)</label>
    <select id="toolset" name="toolset">
      ${toolsetOptions.map(opt => `<option value="${escapeHtml(opt.id)}">${escapeHtml(opt.label)}</option>`).join('')}
    </select>
    ${params.projects.length ? `
      <label for="project_id">Scope to Project (Optional)</label>
      <select id="project_id" name="project_id">
        <option value="">Entire personal workspace</option>
        ${params.projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
      </select>` : ''}
    ${params.needsOwnerSecret ? `
      <label for="owner_secret">xopc Gateway Token / Password</label>
      <input id="owner_secret" type="password" name="owner_secret" required autocomplete="current-password" />` : ''}
    <div class="actions">
      <button class="deny" type="submit" name="decision" value="deny">Deny</button>
      <button class="approve" type="submit" name="decision" value="approve">Approve &amp; Connect</button>
    </div>
  </form>
</body>
</html>`;
}

export function registerBuiltinMcpOAuthRoutes(app: Hono, service: GatewayService): void {
  const getBuiltinConfig = () => {
    const config = service.currentConfig.gateway?.mcp;
    if (!config || resolveRemoteMcpMode(config) !== 'builtin') return undefined;
    return config;
  };

  const applyOAuthCors = (c: Context) => {
    const config = getBuiltinConfig();
    if (!config) return;
    const origin = c.req.header('Origin');
    if (!origin) return;
    const resourceOrigin = new URL(config.resource).origin;
    if (origin === resourceOrigin || config.allowedOrigins?.includes(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
      c.header('Vary', 'Origin');
    }
  };

  for (const path of [
    MCP_OAUTH_AS_METADATA_PATH,
    `${MCP_OAUTH_BASE_PATH}/jwks`,
    `${MCP_OAUTH_BASE_PATH}/register`,
    `${MCP_OAUTH_BASE_PATH}/token`,
    `${MCP_OAUTH_BASE_PATH}/revoke`,
  ]) {
    app.options(path, c => {
      applyOAuthCors(c);
      return c.body(null, 204);
    });
  }

  app.get(MCP_OAUTH_AS_METADATA_PATH, c => {
    const config = getBuiltinConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    applyOAuthCors(c);
    return c.json(buildBuiltinOAuthAsMetadata(config.resource));
  });

  app.get(`${MCP_OAUTH_BASE_PATH}/jwks`, async c => {
    const config = getBuiltinConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    applyOAuthCors(c);
    return c.json(await getBuiltinOAuthJwks());
  });

  app.post(`${MCP_OAUTH_BASE_PATH}/register`, async c => {
    const config = getBuiltinConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    applyOAuthCors(c);
    const body = await c.req.json().catch(() => null);
    try {
      const { client, clientSecret } = registerBuiltinOAuthClient(body);
      return c.json({
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        grant_types: client.grantTypes,
        response_types: client.responseTypes,
        client_id_issued_at: Math.floor(client.createdAt / 1000),
        ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      }, 201);
    } catch (error) {
      return c.json({
        error: 'invalid_client_metadata',
        error_description: error instanceof Error ? error.message : 'Invalid client registration',
      }, 400);
    }
  });

  app.get(`${MCP_OAUTH_BASE_PATH}/authorize`, c => {
    const config = getBuiltinConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    const clientId = c.req.query('client_id') ?? '';
    const redirectUri = c.req.query('redirect_uri') ?? '';
    const responseType = c.req.query('response_type') ?? '';
    const codeChallenge = c.req.query('code_challenge') ?? '';
    const codeChallengeMethod = c.req.query('code_challenge_method') ?? '';
    const state = c.req.query('state') ?? '';
    const resource = c.req.query('resource') || config.resource;
    const rawScopes = (c.req.query('scope') ?? MCP_READ_SCOPE).split(/\s+/).filter(Boolean);

    const client = getBuiltinOAuthClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return c.json({ error: 'invalid_request', error_description: 'Unknown client_id or unregistered redirect_uri' }, 400);
    }
    if (responseType !== 'code' || codeChallengeMethod !== 'S256' || !codeChallenge) {
      return c.json({ error: 'invalid_request', error_description: 'response_type=code and PKCE S256 are required' }, 400);
    }
    if (resource !== config.resource) {
      return c.json({ error: 'invalid_target', error_description: 'Requested resource does not match Gateway MCP resource' }, 400);
    }
    const scopes = rawScopes.filter(s => s === MCP_READ_SCOPE || s === MCP_WRITE_SCOPE);
    if (!scopes.includes(MCP_READ_SCOPE)) scopes.unshift(MCP_READ_SCOPE);
    const projects = service.projects?.list({ limit: 50 }).items.map(p => ({ id: p.id, name: p.name })) ?? [];
    const html = renderConsentHtml({
      clientName: client.clientName,
      clientId: client.clientId,
      redirectUri,
      state,
      codeChallenge,
      resource,
      scopes,
      needsOwnerSecret: !isOwnerAuthenticated(c, service),
      projects,
    });
    return c.html(html, 200, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
  });

  app.post(`${MCP_OAUTH_BASE_PATH}/authorize`, async c => {
    const config = getBuiltinConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    const contentType = c.req.header('content-type') ?? '';
    let form: Record<string, string>;
    if (contentType.includes('application/json')) {
      const json = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      form = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
    } else {
      const parsed = await c.req.parseBody();
      form = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
    }
    const clientId = form.client_id ?? '';
    const redirectUri = form.redirect_uri ?? '';
    const state = form.state ?? '';
    const codeChallenge = form.code_challenge ?? '';
    const resource = form.resource || config.resource;
    const scopes = (form.scope || MCP_READ_SCOPE).split(/\s+/).filter(Boolean);
    const decision = form.decision ?? 'approve';

    const client = getBuiltinOAuthClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return c.json({ error: 'invalid_request', error_description: 'Unknown client_id or redirect_uri' }, 400);
    }
    if (resource !== config.resource) {
      return c.json({ error: 'invalid_target' }, 400);
    }

    const redirect = new URL(redirectUri);
    if (decision === 'deny') {
      redirect.searchParams.set('error', 'access_denied');
      if (state) redirect.searchParams.set('state', state);
      return c.redirect(redirect.href, 302);
    }

    if (!isOwnerAuthenticated(c, service, form.owner_secret)) {
      if (contentType.includes('application/json')) {
        return c.json({ error: 'unauthorized', error_description: 'Owner authentication is required' }, 401);
      }
      const projects = service.projects?.list({ limit: 50 }).items.map(p => ({ id: p.id, name: p.name })) ?? [];
      return c.html(renderConsentHtml({
        clientName: client.clientName,
        clientId: client.clientId,
        redirectUri,
        state,
        codeChallenge,
        resource,
        scopes,
        needsOwnerSecret: true,
        projects,
        error: 'Invalid Gateway owner token or password.',
      }), 401, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
    }

    try {
      const { code } = approveBuiltinOAuthAuthorization({
        clientId,
        redirectUri,
        codeChallenge,
        resource,
        scopes,
        toolset: form.toolset || undefined,
        projectIds: form.project_id ? [form.project_id] : undefined,
      });
      redirect.searchParams.set('code', code);
      if (state) redirect.searchParams.set('state', state);
      return c.redirect(redirect.href, 302);
    } catch (error) {
      return c.json({
        error: 'invalid_request',
        error_description: error instanceof Error ? error.message : 'Authorization failed',
      }, 400);
    }
  });

  app.post(`${MCP_OAUTH_BASE_PATH}/token`, async c => {
    const config = getBuiltinConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    applyOAuthCors(c);
    const contentType = c.req.header('content-type') ?? '';
    let params: Record<string, string>;
    if (contentType.includes('application/json')) {
      const json = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      params = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
    } else {
      const parsed = await c.req.parseBody();
      params = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
    }
    const basic = parseBasicClientAuth(c.req.header('Authorization'));
    const clientId = basic.clientId ?? params.client_id ?? '';
    const clientSecret = basic.clientSecret ?? params.client_secret;
    const grantType = params.grant_type;

    try {
      if (grantType === 'authorization_code') {
        const result = await exchangeBuiltinOAuthCode({
          code: params.code ?? '',
          clientId,
          clientSecret,
          redirectUri: params.redirect_uri ?? '',
          codeVerifier: params.code_verifier ?? '',
          resource: params.resource || undefined,
        });
        return c.json(result);
      }
      if (grantType === 'refresh_token') {
        const result = await refreshBuiltinOAuthToken({
          refreshToken: params.refresh_token ?? '',
          clientId,
          clientSecret,
          resource: params.resource || undefined,
        });
        return c.json(result);
      }
      return c.json({ error: 'unsupported_grant_type' }, 400);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_grant';
      const status = code === 'invalid_client' ? 401 : 400;
      return c.json({ error: code }, status);
    }
  });

  app.post(`${MCP_OAUTH_BASE_PATH}/revoke`, async c => {
    const config = getBuiltinConfig();
    if (!config) return c.json({ error: 'not_found' }, 404);
    applyOAuthCors(c);
    const parsed = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const token = typeof parsed.token === 'string' ? parsed.token : '';
    if (token) revokeBuiltinOAuthToken(token);
    return c.body(null, 200);
  });
}
