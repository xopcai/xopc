/**
 * Async OAuth Handler
 * 
 * Provides non-blocking OAuth flow with session-based state management.
 * This allows OAuth flows that require user interaction (browser login) 
 * without blocking the HTTP request.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { GatewayService } from '../service.js';
import type { Config } from '../../config/schema.js';
import { 
  type OAuthProviderInterface, 
  type OAuthLoginCallbacks,
  type OAuthCredentials 
} from '../../auth/oauth/types.js';
import { getOAuthProviderInterfaces } from '../../auth/oauth/registry.js';
import { CredentialResolver } from '../../auth/credentials.js';
import { isLoopbackHost } from '../host.js';
import { resolveReverseProxyPublicUrl } from '../public-url.js';
import { createLogger } from '../../utils/logger.js';
import { buildCapabilityPlansForConfig, type CapabilityId } from '../../capabilities/readiness/index.js';
import type { CatalogReadiness } from '../../providers/xopc-cloud-catalog-coordinator.js';
import { applyXopcCloudCapabilitySetup } from '../xopc-cloud-capability-setup.js';

const log = createLogger('OAuthAsync');

export interface OAuthCompletionReadiness {
  authorized: true;
  state: 'connected' | 'connected-degraded';
  catalog: CatalogReadiness;
  capabilities: Record<CapabilityId, 'ready' | 'unavailable' | 'disabled'>;
  configuration?: { applied: boolean; error?: string };
}

export function buildOAuthCompletionReadiness(
  config: Config,
  catalog: CatalogReadiness,
): OAuthCompletionReadiness {
  const plans = buildCapabilityPlansForConfig(config);
  const capabilities = Object.fromEntries(Object.entries(plans).map(([capability, plan]) => [
    capability,
    plan.status === 'disabled' ? 'disabled' : plan.status === 'unavailable' ? 'unavailable' : 'ready',
  ])) as OAuthCompletionReadiness['capabilities'];
  const degraded = Boolean(catalog.error)
    || Object.values(capabilities).some((status) => status === 'unavailable');
  return {
    authorized: true,
    state: degraded ? 'connected-degraded' : 'connected',
    catalog,
    capabilities,
  };
}

export async function refreshModelCatalogAfterOAuth(
  provider: string,
  service: Pick<GatewayService, 'getModelCatalogSync'>,
): Promise<CatalogReadiness | undefined> {
  if (provider !== 'xopc-cloud') return undefined;
  try {
    return await service.getModelCatalogSync().refreshNow();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.warn(
      { err, provider, errorMessage },
      `OAuth completed, but the model catalog could not be refreshed: ${errorMessage}`,
    );
    return {
      state: 'unavailable',
      source: 'none',
      modelCount: 0,
      error: { code: 'refresh_failed', message: errorMessage, retryable: true },
    };
  }
}

/** User-facing message when undici/fetch fails (often DNS, firewall, or wrong machine for localhost callback). */
function formatOAuthAsyncError(err: unknown): string {
	const base = err instanceof Error ? err.message : 'OAuth login failed';
	const cause =
		err instanceof Error && err.cause instanceof Error
			? err.cause.message
			: err instanceof Error && typeof err.cause === 'string'
				? err.cause
				: '';
	const detail = cause ? ` (${cause})` : '';
	if (/^fetch failed$/i.test(base) || base.includes('fetch failed')) {
		return (
			`Network request failed${detail}. If the browser opened on another device, the redirect goes to that device's localhost — ` +
			`copy the full URL from the browser address bar after sign-in (starts with http://127.0.0.1 or http://localhost) and paste it below. ` +
			`Otherwise check VPN/proxy/DNS/firewall access to Google OAuth.`
		);
	}
	return base;
}

// Static OAuth providers map
const OAUTH_PROVIDERS: Record<string, OAuthProviderInterface> = getOAuthProviderInterfaces();

// OAuth session state
interface OAuthSession {
  id: string;
  provider: string;
  returnToAppUrl?: string;
  preferredLoginMethod?: string;
  status: 'pending' | 'waiting_auth' | 'waiting_code' | 'completed' | 'failed' | 'cancelled';
  authUrl?: string;
  instructions?: string;
  deviceCode?: string;
  verificationUri?: string;
  message?: string;
  error?: string;
  credentials?: OAuthCredentials;
  createdAt: number;
  expiresAt: number;
  abortController?: AbortController;
  manualCodeResolve?: (code: string) => void;
  manualCodeReject?: (error: Error) => void;
  readiness?: OAuthCompletionReadiness;
}

// In-memory session store (could be moved to Redis for production)
const oauthSessions = new Map<string, OAuthSession>();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_EXPIRY_GRACE_MS = 30_000;

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of oauthSessions.entries()) {
    if (now > session.expiresAt) {
      cancelOAuthSession(session, 'OAuth flow expired');
      oauthSessions.delete(id);
      log.debug({ sessionId: id }, 'Cleaned up expired OAuth session');
    }
  }
}, 60 * 1000);

function generateSessionId(): string {
  return `oauth_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

export function normalizeDesktopOAuthReturnPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path = value.trim();
  if (
    path.length === 0 ||
    path.length > 2_048 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return undefined;
  }
  return path;
}

function desktopOAuthReturnUrl(sessionId: string, returnPath: unknown): string {
  const params = new URLSearchParams({ request_id: sessionId });
  const normalizedReturnPath = normalizeDesktopOAuthReturnPath(returnPath);
  if (normalizedReturnPath) params.set('return_path', normalizedReturnPath);
  return `xopc://cloud/model-connected?${params.toString()}`;
}

function cancelOAuthSession(session: OAuthSession, message = 'OAuth flow cancelled'): void {
  if (session.abortController) {
    session.abortController.abort();
  }

  if (session.manualCodeResolve) {
    session.manualCodeResolve('');
  }

  session.manualCodeResolve = undefined;
  session.manualCodeReject = undefined;
  session.status = 'cancelled';
  session.message = message;
}

function hostWithoutPort(value: string | undefined): string | undefined {
  const raw = value?.split(',')[0]?.trim();
  if (!raw) return undefined;

  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname.replace(/^\[/, '').replace(/\]$/, '');
  } catch {
    const unbracketed = raw.replace(/^\[/, '').replace(/\]$/, '');
    return unbracketed.includes(':') && !unbracketed.includes('.') ? unbracketed : unbracketed.split(':')[0];
  }
}

function requestLooksRemote(c: Context): boolean {
  const originHost = hostWithoutPort(c.req.header('origin'));
  const forwardedHost = hostWithoutPort(c.req.header('x-forwarded-host'));
  const host = hostWithoutPort(c.req.header('host'));

  return [originHost, forwardedHost, host].some((candidate) => candidate && !isLoopbackHost(candidate));
}

export function resolveOAuthLoginMethodPreference(params: {
  requestedMethod?: unknown;
  supportedMethods?: readonly string[];
  remote: boolean;
}): string | undefined {
  if (typeof params.requestedMethod === 'string' && params.requestedMethod.trim()) {
    const requested = params.requestedMethod.trim();
    return !params.supportedMethods || params.supportedMethods.includes(requested) ? requested : undefined;
  }
  if (
    params.remote &&
    params.supportedMethods?.includes('browser') &&
    params.supportedMethods.includes('device_code')
  ) {
    return 'device_code';
  }
  return undefined;
}

function preferredOAuthLoginMethod(params: {
  provider: string;
  requestedMethod?: unknown;
  c: Context;
  service: GatewayService;
}): string | undefined {
  const publicUrl = resolveReverseProxyPublicUrl(params.service.currentConfig);
  const publicHost = hostWithoutPort(publicUrl ?? undefined);
  const remote = Boolean((publicHost && !isLoopbackHost(publicHost)) || requestLooksRemote(params.c));
  return resolveOAuthLoginMethodPreference({
    requestedMethod: params.requestedMethod,
    supportedMethods: OAUTH_PROVIDERS[params.provider]?.loginMethods,
    remote,
  });
}

export function createOAuthAsyncHandler(service: GatewayService) {
  const oauth = new Hono();

  /**
   * POST /api/auth/oauth-async/start
   * Start async OAuth flow - returns immediately with session ID
   */
  oauth.post('/start', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { provider } = body;
    
    if (!provider) {
      return c.json({ error: 'Provider is required' }, 400);
    }

    const oauthProvider = OAUTH_PROVIDERS[provider];
    if (!oauthProvider) {
      return c.json({ error: `Unknown OAuth provider: ${provider}` }, 400);
    }

    const sessionId = generateSessionId();
    const session: OAuthSession = {
      id: sessionId,
      provider,
      ...(body.client === 'desktop' && provider === 'xopc-cloud'
        ? { returnToAppUrl: desktopOAuthReturnUrl(sessionId, body.returnPath) }
        : {}),
      preferredLoginMethod: preferredOAuthLoginMethod({
        provider,
        requestedMethod: body.loginMethod,
        c,
        service,
      }),
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };

    oauthSessions.set(sessionId, session);

    // Start OAuth flow in background
    runOAuthFlow(session, oauthProvider, service).catch(err => {
      log.error({ err, sessionId, provider }, 'Background OAuth flow failed');
      session.status = 'failed';
      session.error = err instanceof Error ? err.message : 'OAuth flow failed';
    });

    return c.json({ 
      ok: true, 
      payload: { 
        sessionId,
        provider,
        status: session.status,
      } 
    });
  });

  /**
   * GET /api/auth/oauth-async/:sessionId/status
   * Check OAuth session status
   */
  oauth.get('/:sessionId/status', (c) => {
    const sessionId = c.req.param('sessionId');
    const session = oauthSessions.get(sessionId);

    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json({ 
      ok: true, 
      payload: { 
        sessionId: session.id,
        provider: session.provider,
        status: session.status,
        authUrl: session.authUrl,
        instructions: session.instructions,
        deviceCode: session.deviceCode,
        verificationUri: session.verificationUri,
        message: session.message,
        error: session.error,
        readiness: session.readiness,
        expiresAt: session.expiresAt,
      } 
    });
  });

  /**
   * POST /api/auth/oauth-async/:sessionId/code
   * Submit manual authorization code
   */
  oauth.post('/:sessionId/code', async (c) => {
    const sessionId = c.req.param('sessionId');
    const { code } = await c.req.json().catch(() => ({}));
    
    if (!code) {
      return c.json({ error: 'Code is required' }, 400);
    }

    const session = oauthSessions.get(sessionId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    if (session.status !== 'waiting_code' || !session.manualCodeResolve) {
      return c.json({ error: 'Session is not waiting for code' }, 400);
    }

    // Resolve the manual code promise
    session.manualCodeResolve(code);
    session.manualCodeResolve = undefined;
    session.manualCodeReject = undefined;

    return c.json({ 
      ok: true, 
      payload: { 
        message: 'Code submitted, processing...',
      } 
    });
  });

  /**
   * POST /api/auth/oauth-async/:sessionId/cancel
   * Cancel OAuth flow
   */
  oauth.post('/:sessionId/cancel', async (c) => {
    const sessionId = c.req.param('sessionId');
    const session = oauthSessions.get(sessionId);

    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    cancelOAuthSession(session);

    return c.json({ 
      ok: true, 
      payload: { 
        message: 'OAuth flow cancelled',
      } 
    });
  });

  /**
   * DELETE /api/auth/oauth-async/:sessionId
   * Clean up OAuth session
   */
  oauth.delete('/:sessionId', (c) => {
    const sessionId = c.req.param('sessionId');
    
    if (oauthSessions.has(sessionId)) {
      const session = oauthSessions.get(sessionId)!;
      cancelOAuthSession(session);
      oauthSessions.delete(sessionId);
    }

    return c.json({ ok: true });
  });

  return oauth;
}

/**
 * Run OAuth flow in background
 */
async function runOAuthFlow(
  session: OAuthSession,
  oauthProvider: OAuthProviderInterface,
  service: GatewayService
): Promise<void> {
  const abortController = new AbortController();
  session.abortController = abortController;

  let manualCodePromise: Promise<string> | null = null;
  let manualCodeResolve: ((code: string) => void) | undefined;
  let manualCodeReject: ((error: Error) => void) | undefined;

  const callbacks: OAuthLoginCallbacks = {
    onAuth: (auth: { url: string; instructions?: string }) => {
      session.authUrl = auth.url;
      session.instructions = auth.instructions;
      
      if (oauthProvider.usesCallbackServer) {
        // For callback server providers, prepare for manual code input
        session.status = 'waiting_code';
        session.message = 'Complete authorization in browser, or paste the redirect URL below';
        manualCodePromise = new Promise((resolve, reject) => {
          manualCodeResolve = resolve;
          manualCodeReject = reject;
        });
        session.manualCodeResolve = manualCodeResolve;
        session.manualCodeReject = manualCodeReject;
      } else {
        session.status = 'waiting_auth';
        session.message = 'Complete authorization in browser';
      }
    },
    onDeviceCode: (info) => {
      session.status = 'waiting_auth';
      session.authUrl = info.verificationUri;
      session.deviceCode = info.userCode;
      session.verificationUri = info.verificationUri;
      session.instructions = `Enter code ${info.userCode}`;
      session.message = `Open ${info.verificationUri} and enter code ${info.userCode}`;
      if (info.expiresInSeconds) {
        session.expiresAt = Math.max(
          session.expiresAt,
          Date.now() + info.expiresInSeconds * 1_000 + SESSION_EXPIRY_GRACE_MS,
        );
      }
    },
    onPrompt: async (prompt: { message: string; deviceCode?: string; verificationUri?: string }) => {
      session.status = 'waiting_code';
      session.deviceCode = prompt.deviceCode;
      session.verificationUri = prompt.verificationUri;
      session.message = prompt.message;
      
      // For device code flow, wait for manual input
      manualCodePromise = new Promise((resolve, reject) => {
        manualCodeResolve = resolve;
        manualCodeReject = reject;
      });
      session.manualCodeResolve = manualCodeResolve;
      session.manualCodeReject = manualCodeReject;
      
      // Return empty for now, will be resolved by manual code submission
      return '';
    },
    onProgress: (message: string) => {
      log.debug({ sessionId: session.id, message }, 'OAuth progress');
      session.message = message;
    },
    onManualCodeInput: async () => {
      // Return the manual code promise for callback server providers
      if (manualCodePromise) {
        return manualCodePromise;
      }
      return '';
    },
    onSelect: async (prompt) => {
      const preferredOption = session.preferredLoginMethod
        ? prompt.options.find((option) => option.id === session.preferredLoginMethod)
        : undefined;
      const browserOption = prompt.options.find((option) => option.id === 'browser');
      const firstOption = prompt.options[0];
      const selectedOption = preferredOption ?? browserOption ?? firstOption;
      if (!selectedOption) {
        throw new Error('OAuth login did not provide any selectable auth method');
      }
      log.debug(
        { sessionId: session.id, provider: session.provider, selected: selectedOption.id },
        'Selected OAuth auth method',
      );
      return selectedOption.id;
    },
    returnToAppUrl: session.returnToAppUrl,
    signal: abortController.signal,
  };

  try {
    const credentials = await oauthProvider.login(callbacks);
    
    const resolver = new CredentialResolver();
    await resolver.saveOAuthCredentials(session.provider, credentials);

    session.message = session.provider === 'xopc-cloud'
      ? 'OAuth login successful. Syncing available models...'
      : 'OAuth login successful';
    const catalog = await refreshModelCatalogAfterOAuth(session.provider, service);
    if (catalog && session.provider === 'xopc-cloud') {
      const setup = await applyXopcCloudCapabilitySetup(service);
      const readiness = buildOAuthCompletionReadiness(service.currentConfig, catalog);
      if (setup.configured === true) {
        session.readiness = { ...readiness, configuration: { applied: true } };
      } else {
        log.warn(
          { provider: session.provider, errorMessage: setup.error, missing: setup.missing },
          `OAuth completed, but XOPC Cloud capabilities could not be configured: ${setup.error}`,
        );
        session.readiness = {
          ...readiness,
          state: 'connected-degraded',
          configuration: { applied: false, error: setup.error },
        };
      }
    }

    session.status = 'completed';
    session.credentials = credentials;
    session.message = session.readiness?.state === 'connected-degraded'
      ? `OAuth login successful, but capability setup is degraded${catalog?.error ? `: ${catalog.error.message}` : ''}`
      : 'OAuth login successful';
    
    log.info({ sessionId: session.id, provider: session.provider }, 'OAuth login completed');
  } catch (err) {
    if (abortController.signal.aborted || session.status === 'cancelled') {
      session.status = 'cancelled';
      session.message ??= 'OAuth flow cancelled by user';
    } else {
      session.status = 'failed';
      session.error = formatOAuthAsyncError(err);
      log.error({ err, sessionId: session.id, provider: session.provider }, 'OAuth login failed');
    }
  } finally {
    session.abortController = undefined;
    session.manualCodeResolve = undefined;
    session.manualCodeReject = undefined;
  }
}
