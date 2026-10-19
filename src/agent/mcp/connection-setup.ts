import { resolveMcpSetupConfig } from './effective-server.js';
import { createHash, randomUUID } from 'node:crypto';

import type { Config } from '../../config/schema.js';
import { isManagedConnectorServer } from '../../connectors/materialize.js';
import { createLogger } from '../../utils/logger.js';
import { classifyMcpConnectionError, type McpConnectionErrorCode } from './connection-errors.js';
import { prepareNativeMcpConfig } from './native-mcp.js';
import { discoverMcpTools, McpAuthenticationRequiredError, signInNativeMcp, type McpSessionOptions } from './tool-catalog.js';

const log = createLogger('McpConnectionSetup');

export type McpConnectionProbe = {
  state: 'connected' | 'oauth_required' | 'token_required' | 'error';
  toolCount?: number;
  error?: string;
  errorCode?: McpConnectionErrorCode;
};

function httpUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP or HTTPS MCP address without embedded credentials.');
  }
  return url;
}

async function metadata(url: URL, signal?: AbortSignal): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000), redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const result = await response.json();
    if (result && typeof result === 'object' && !Array.isArray(result)) return result as Record<string, unknown>;
  } catch {
    signal?.throwIfAborted();
    // An absent metadata endpoint is a common token-only configuration.
  }
}

/** A 401 alone is not evidence that a service supports OAuth. */
async function advertisesOAuth(config: Config, workspace: string, serverId: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  const loaded = await prepareNativeMcpConfig(config, workspace);
  signal?.throwIfAborted();
  const entry = loaded.servers.find(server => server.name === serverId);
  if (!entry || !('url' in entry.config)) return false;
  const url = httpUrl(entry.config.url);
  if (Object.keys(entry.config.headers ?? {}).some(name => name.toLowerCase() === 'authorization')) return false;
  const response = await fetch(url, { method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000), redirect: 'error',
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
      ...(entry.config.headers as Record<string, string> | undefined) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'xopc', version: '1' },
    } }),
  });
  const challenge = response.headers.get('WWW-Authenticate') ?? '';
  await response.body?.cancel();
  const resourceMetadata = /resource_metadata\s*=\s*"([^"\s]+)"/i.exec(challenge)?.[1];
  const candidates = [
    ...(resourceMetadata ? [httpUrl(resourceMetadata)] : []),
    new URL(`/.well-known/oauth-protected-resource${url.pathname === '/' ? '' : url.pathname}`, url),
    new URL('/.well-known/oauth-protected-resource', url),
  ];
  for (const candidate of candidates) {
    signal?.throwIfAborted();
    const data = await metadata(candidate, signal);
    if (data && typeof data.resource === 'string' && data.resource === url.href
      && Array.isArray(data.authorization_servers) && data.authorization_servers.some(value => {
        try { return typeof value === 'string' && Boolean(httpUrl(value)); } catch { return false; }
      })) return true;
  }
  // Older MCP services publish authorization-server metadata at the origin.
  if (!/\bBearer\b/i.test(challenge)) return false;
  const legacy = await metadata(new URL('/.well-known/oauth-authorization-server', url), signal);
  return Boolean(legacy && legacy.issuer === url.origin && typeof legacy.authorization_endpoint === 'string'
    && typeof legacy.token_endpoint === 'string');
}

export async function probeMcpConnection(config: Config, workspace: string, serverId: string, options?: McpSessionOptions): Promise<McpConnectionProbe> {
  config = resolveMcpSetupConfig(config, serverId);
  try {
    const tools = await discoverMcpTools(config, workspace, serverId, options);
    return { state: 'connected', toolCount: tools.length };
  } catch (error) {
    const failed = (cause: unknown): McpConnectionProbe => {
      const errorCode = classifyMcpConnectionError(cause);
      log.warn({ serverId, errorCode }, `MCP connection check failed: ${errorCode}`);
      return { state: 'error', error: cause instanceof Error ? cause.message : String(cause), errorCode };
    };
    const server = config.mcp?.servers?.[serverId];
    const rejectedCredential = /\b401\b|unauthorized|invalid_token/i.test(String(error));
    const hasCredentials = server?.auth || Object.keys(server?.headers ?? {}).some(name => name.toLowerCase() === 'authorization');
    if (error instanceof McpAuthenticationRequiredError || server?.url && rejectedCredential && !hasCredentials) {
      try {
        options?.signal?.throwIfAborted();
        return { state: await advertisesOAuth(config, workspace, serverId, options?.signal) ? 'oauth_required' : 'token_required' };
      } catch (cause) { return failed(cause); }
    }
    if (server?.url && hasCredentials && /\b(?:401|403)\b|unauthorized|forbidden/i.test(String(error))) return { state: 'token_required' };
    return failed(error);
  }
}

export type McpAuthorization = {
  id: string;
  serverId: string;
  state: 'starting' | 'authorizing' | 'connected' | 'error' | 'cancelled';
  authorizationUrl?: string;
  acceptsRedirect?: boolean;
  toolCount?: number;
  error?: string;
};
type Attempt = {
  scope: string;
  owner: string;
  fingerprint: string;
  controller: AbortController;
  result: McpAuthorization;
  redirect?: (url: string | undefined) => void;
  dispose?: () => void;
};
const attempts = new Map<string, Attempt>();
function fingerprint(config: Config, serverId: string): string {
  config = resolveMcpSetupConfig(config, serverId);
  const server = config.mcp?.servers?.[serverId];
  return createHash('sha256').update(JSON.stringify(server ? { ...server, xopcConnector: undefined } : null)).digest('hex');
}
function finish(attempt: Attempt): void {
  attempt.dispose?.();
  attempt.dispose = undefined;
  attempt.redirect?.(undefined);
  attempt.redirect = undefined;
  attempt.result.acceptsRedirect = false;
}
function cancel(attempt: Attempt): void {
  if (attempt.result.state === 'starting' || attempt.result.state === 'authorizing') {
    attempt.result.state = 'cancelled';
    attempt.controller.abort();
    finish(attempt);
  }
}

/** A UI bridge to native pi's login command; no host-owned OAuth client or token store. */
export function startMcpAuthorization(config: Config, workspace: string, serverId: string, owner: string, options?: McpSessionOptions & { authorizationScope?: string }): McpAuthorization {
  config = resolveMcpSetupConfig(config, serverId);
  const server = config.mcp?.servers?.[serverId];
  if (!server?.url || server.enabled === false || (isManagedConnectorServer(server) && server.xopcConnector.enabled === false)) throw new Error('An enabled HTTP MCP server is required.');
  if (typeof server.url === 'string') httpUrl(server.url);
  if (server.auth || Object.keys(server.headers ?? {}).some(name => name.toLowerCase() === 'authorization')) {
    throw new Error('This server uses configured credentials. Remove Authorization before using OAuth.');
  }
  const scope = options?.authorizationScope ?? serverId;
  for (const attempt of attempts.values()) if (attempt.owner === owner && attempt.scope === scope) cancel(attempt);
  if (attempts.size >= 100) throw new Error('Too many pending sign-ins. Try again later.');
  const attempt: Attempt = { owner, scope, fingerprint: fingerprint(config, serverId), controller: new AbortController(),
    result: { id: randomUUID(), serverId, state: 'starting' } };
  attempts.set(attempt.result.id, attempt);
  const expiry = setTimeout(() => cancel(attempt), 180_000);
  expiry.unref();
  const retention = setTimeout(() => { cancel(attempt); attempts.delete(attempt.result.id); }, 10 * 60_000);
  retention.unref();
  void signInNativeMcp(structuredClone(config), workspace, serverId, {
    signal: attempt.controller.signal,
    onAuthorizationUrl(url) {
      const parsed = httpUrl(url);
      if (attempt.controller.signal.aborted) return;
      attempt.result.authorizationUrl = parsed.href;
      attempt.result.state = 'authorizing';
    },
    requestRedirectUrl(signal) {
      if (signal?.aborted || attempt.controller.signal.aborted) return Promise.resolve(undefined);
      attempt.result.acceptsRedirect = true;
      return new Promise(resolve => {
        const stop = () => resolve(undefined);
        signal?.addEventListener('abort', stop, { once: true });
        attempt.redirect = resolve;
        attempt.dispose = () => signal?.removeEventListener('abort', stop);
      });
    },
  }, options).then(tools => {
    if (!attempt.controller.signal.aborted) {
      attempt.result.state = 'connected';
      attempt.result.toolCount = tools.length;
      delete attempt.result.authorizationUrl;
    }
  }).catch(error => {
    if (!attempt.controller.signal.aborted) {
      attempt.result.state = 'error';
      attempt.result.error = error instanceof Error ? error.message : String(error);
      delete attempt.result.authorizationUrl;
    }
  }).finally(() => { clearTimeout(expiry); finish(attempt); });
  return { ...attempt.result };
}

export function getMcpAuthorization(id: string, owner: string, config: Config): McpAuthorization | undefined {
  const attempt = attempts.get(id);
  if (!attempt || attempt.owner !== owner) return;
  if (attempt.fingerprint !== fingerprint(config, attempt.result.serverId)) {
    cancel(attempt);
    attempt.result = { id, serverId: attempt.result.serverId, state: 'cancelled' };
  }
  return { ...attempt.result };
}
export function cancelMcpAuthorization(id: string, owner: string): boolean {
  const attempt = attempts.get(id);
  if (!attempt || attempt.owner !== owner) return false;
  cancel(attempt);
  return true;
}
export function submitMcpRedirect(id: string, owner: string, redirectUrl: string, config: Config): boolean {
  const result = getMcpAuthorization(id, owner, config);
  const attempt = attempts.get(id);
  if (!result || !attempt?.redirect || result.state !== 'authorizing' || !result.authorizationUrl) return false;
  const authorization = new URL(result.authorizationUrl);
  const expected = authorization.searchParams.get('redirect_uri');
  if (!expected) return false;
  const target = new URL(expected);
  const actual = httpUrl(redirectUrl);
  if (actual.origin !== target.origin || actual.pathname !== target.pathname
    || actual.searchParams.get('state') !== authorization.searchParams.get('state')) return false;
  if (actual.searchParams.has('error')) {
    cancel(attempt);
    attempt.result.state = 'error';
    attempt.result.error = 'Sign-in was declined or could not be completed. Try again.';
    delete attempt.result.authorizationUrl;
    return true;
  }
  if (!actual.searchParams.get('code')) return false;
  attempt.redirect(actual.href);
  attempt.redirect = undefined;
  return true;
}
