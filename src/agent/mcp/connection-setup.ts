import { resolveMcpSetupConfig } from './effective-server.js';
import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns';
import { Agent } from 'undici';

import type { Config } from '../../config/schema.js';
import { isManagedConnectorServer } from '../../connectors/materialize.js';
import { createLogger } from '../../utils/logger.js';
import { checkUrlSafety } from '../tools/url-safety.js';
import { classifyMcpConnectionError, type McpConnectionErrorCode } from './connection-errors.js';
import { prepareNativeMcpConfig } from './native-mcp.js';
import { discoverMcpTools, McpAuthenticationRequiredError, signInNativeMcp, type McpSessionOptions } from './tool-catalog.js';
import { retryAfter, type McpObservation } from './transport.js';

const log = createLogger('McpConnectionSetup');
export type McpMetadataState = 'valid' | 'absent' | 'unreachable' | 'invalid' | 'not_checked';
export type McpRecovery = { kind: 'choose_auth' | 'enter_secret' | 'authorize' | 'verify_documented_endpoint' | 'report_blocker' | 'wait'; retryAt?: number; reason?: string };
export type McpConnectionProbe = {
  state: 'connected' | 'oauth_required' | 'token_required' | 'auth_unknown' | 'error';
  toolCount?: number; error?: string; errorCode?: McpConnectionErrorCode;
  auth?: { method: 'oauth' | 'unknown' | 'credential'; metadata: McpMetadataState; credential: 'missing' | 'present' | 'rejected' | 'unknown' };
  observation?: Omit<McpObservation, 'challenge'>; recovery?: McpRecovery;
};
function httpUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS MCP address without embedded credentials.');
  return url;
}
async function metadata(url: URL, endpoint: URL, signal?: AbortSignal, publicOnly = false): Promise<{ state: McpMetadataState; data?: Record<string, unknown>; retryAt?: number }> {
  const sameOrigin = endpoint.origin === url.origin && !publicOnly;
  if (!sameOrigin && !checkUrlSafety(url.href).safe) return { state: 'invalid' };
  const dispatcher = new Agent({ connect: { lookup(host, options, callback) {
    lookup(host, { all: true }, (error, addresses) => {
      if (error) { callback(error, '', 4); return; }
      if (!sameOrigin && addresses.some(a => !checkUrlSafety(`http://${a.family === 6 ? `[${a.address}]` : a.address}`).safe)) { callback(new Error('Non-public authorization metadata destination'), '', 4); return; }
      if (options.all) callback(null, addresses); else if (addresses[0]) callback(null, addresses[0].address, addresses[0].family); else callback(new Error('No metadata address'), '', 4);
    });
  } } });
  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000), redirect: 'error', headers: { Accept: 'application/json' }, dispatcher } as RequestInit);
    if (!response.ok) { await response.body?.cancel(); return { retryAt: response.status === 429 || response.status === 503 ? retryAfter(response.headers.get('Retry-After')) ?? Date.now() + 2000 : undefined, state: response.status === 404 || response.status === 410 ? 'absent' : response.status >= 500 || response.status === 429 ? 'unreachable' : 'invalid' }; }
    const reader = response.body?.getReader(); if (!reader) return { state: 'invalid' };
    const decoder = new TextDecoder(); let text = '', bytes = 0;
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
        if (bytes > 100_000) return { state: 'invalid' }; text += decoder.decode(chunk.value, { stream: true }); }
      text += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? { state: 'valid', data } : { state: 'invalid' };
  } catch (error) { signal?.throwIfAborted(); return { state: error instanceof SyntaxError ? 'invalid' : 'unreachable' }; }
  finally { await dispatcher.close(); }
}
async function authentication(config: Config, workspace: string, serverId: string, challenge: string | undefined, options?: McpSessionOptions) {
  const loaded = await prepareNativeMcpConfig(config, workspace);
  const entry = loaded.servers.find(s => s.name === serverId);
  if (!entry || !('url' in entry.config)) return { method: 'unknown' as const, metadata: 'not_checked' as McpMetadataState };
  const url = httpUrl(entry.config.url);
  const publicOnly = config.mcp?.servers?.[serverId]?.xopcPublicOnly === true;
  const allowedIssuer = (value: unknown) => {
    try { if (typeof value !== 'string') return false; const issuer = httpUrl(value);
      return issuer.protocol === 'https:' && checkUrlSafety(issuer.href).safe || !publicOnly && issuer.origin === url.origin && ['localhost', '127.0.0.1', '[::1]'].includes(issuer.hostname);
    } catch { return false; }
  };
  challenge ??= '';
  const reference = /resource_metadata\s*=\s*"([^"\s]+)"/i.exec(challenge)?.[1];
  const candidates = [...(reference ? [httpUrl(reference)] : []), new URL(`/.well-known/oauth-protected-resource${url.pathname === '/' ? '' : url.pathname}`, url), new URL('/.well-known/oauth-protected-resource', url)];
  let state: McpMetadataState = 'absent';
  for (const candidate of [...new Map(candidates.map(c => [c.href, c])).values()]) {
    options?.signal?.throwIfAborted(); options?.diagnostics?.beforeRequest?.({ method: 'GET', stage: 'authorization_metadata' }); const result = await metadata(candidate, url, options?.signal, publicOnly);
    if (result.retryAt) return { method: 'unknown' as const, metadata: result.state, retryAt: result.retryAt };
    if (result.state !== 'absent') state = result.state;
    const data = result.data;
    if (data && typeof data.resource === 'string' && data.resource === url.href && Array.isArray(data.authorization_servers)
      && data.authorization_servers.some(allowedIssuer)) return { method: 'oauth' as const, metadata: 'valid' as McpMetadataState };
    if (data) state = 'invalid';
  }
  if (/\bBearer\b/i.test(challenge)) {
    options?.diagnostics?.beforeRequest?.({ method: 'GET', stage: 'authorization_metadata' });
    const result = await metadata(new URL('/.well-known/oauth-authorization-server', url), url, options?.signal, publicOnly);
    if (result.retryAt) return { method: 'unknown' as const, metadata: result.state, retryAt: result.retryAt };
    const data = result.data;
    if (data && data.issuer === url.origin && allowedIssuer(data.issuer) && typeof data.authorization_endpoint === 'string' && typeof data.token_endpoint === 'string' && allowedIssuer(data.authorization_endpoint) && allowedIssuer(data.token_endpoint)) return { method: 'oauth' as const, metadata: 'valid' as McpMetadataState };
    if (result.state !== 'absent') state = result.data ? 'invalid' : result.state;
  }
  return { method: 'unknown' as const, metadata: state };
}

export async function probeMcpConnection(config: Config, workspace: string, serverId: string, options?: McpSessionOptions): Promise<McpConnectionProbe> {
  config = resolveMcpSetupConfig(config, serverId);
  const observations: McpObservation[] = []; let cooldown = 0, requests = 0;
  try {
    const tools = await discoverMcpTools(config, workspace, serverId, { ...options, diagnostics: {
      ...options?.diagnostics, probe: true,
      beforeRequest: request => { options?.signal?.throwIfAborted(); if (Date.now() < cooldown || requests >= 16) throw new Error('MCP probe request budget or cooldown reached'); options?.diagnostics?.beforeRequest?.(request); requests++; },
      observe: value => { observations.push(value); if (value.status === 429 || value.status === 503) cooldown = value.retryAt ?? Date.now() + 2000; options?.diagnostics?.observe?.(value); },
    } });
    return { state: 'connected', toolCount: tools.length };
  } catch (error) {
    const server = config.mcp?.servers?.[serverId];
    const failed = observations.filter(o => o.status >= 400 && !(o.method === 'GET' && o.status === 405 && server?.type !== 'sse')).at(-1);
    const last = failed ?? observations.at(-1);
    const observation = last ? (({ challenge: _challenge, ...safe }) => safe)(last) : undefined;
    const category = failed ? classifyMcpConnectionError(`HTTP ${failed.status}`) : classifyMcpConnectionError(error);
    const hasCredentials = Boolean(server?.auth || Object.keys(server?.headers ?? {}).some(n => n.toLowerCase() === 'authorization') || JSON.stringify(server?.headers ?? {}).includes('xopcSecretRef'));
    const denied = error instanceof McpAuthenticationRequiredError || category === 'access_denied';
    if (server?.url && denied) {
      if (hasCredentials) {
        const rejected = failed?.status === 401 || /\b401\b|invalid_token|unauthorized/i.test(String(error)) || /invalid_token/i.test(failed?.challenge ?? '');
        return { state: rejected ? 'token_required' : 'error', errorCode: rejected ? undefined : 'access_denied', observation,
          auth: { method: 'credential', metadata: 'not_checked', credential: rejected ? 'rejected' : 'unknown' }, recovery: { kind: 'enter_secret', reason: rejected ? 'credential_rejected' : 'credential_or_permission_refused' } };
      }
      try {
        const auth = await authentication(config, workspace, serverId, last ? last.challenge ?? '' : undefined, options);
        return { state: auth.method === 'oauth' ? 'oauth_required' : 'auth_unknown', auth: { method: auth.method, metadata: auth.metadata, credential: 'missing' }, observation,
          recovery: { kind: auth.retryAt ? 'wait' : auth.method === 'oauth' ? 'authorize' : 'choose_auth', ...(auth.retryAt ? { retryAt: auth.retryAt } : {}), reason: auth.metadata } };
      } catch { options?.signal?.throwIfAborted(); return { state: 'auth_unknown', auth: { method: 'unknown', metadata: 'unreachable', credential: 'missing' }, observation, recovery: { kind: 'choose_auth', reason: 'metadata_unreachable' } }; }
    }
    if (category === 'rate_limited' || failed?.status === 503) return { state: 'error', errorCode: category === 'rate_limited' ? category : 'network', observation, recovery: { kind: 'wait', retryAt: cooldown || Date.now() + 2000 } };
    const errorCode = /html/i.test(observation?.contentType ?? '') ? 'invalid_response' : category;
    log.warn({ serverId, errorCode }, `MCP connection check failed: ${errorCode}`);
    return { state: 'error', errorCode, observation, recovery: { kind: ['not_found', 'invalid_response'].includes(errorCode) ? 'verify_documented_endpoint' : 'report_blocker', reason: errorCode } };
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
