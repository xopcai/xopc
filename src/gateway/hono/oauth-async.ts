/**
 * Async OAuth Handler
 * 
 * Provides non-blocking OAuth flow with session-based state management.
 * This allows OAuth flows that require user interaction (browser login) 
 * without blocking the HTTP request.
 */

import { Hono } from 'hono';
import type { GatewayService } from '../service.js';
import { 
  type OAuthProviderInterface, 
  type OAuthLoginCallbacks,
  type OAuthCredentials 
} from '../../auth/index.js';
import { 
  kimiOAuthProvider, 
  qwenPortalOAuthProvider, 
  minimaxOAuthProvider,
  minimaxCnOAuthProvider,
  anthropicOAuthProvider,
  githubCopilotOAuthProvider,
  googleGeminiCliOAuthProvider,
  googleAntigravityOAuthProvider,
  openaiCodexOAuthProvider,
} from '../../auth/oauth/index.js';
import { createLogger } from '../../utils/logger.js';
import { CredentialResolver } from '../../auth/credentials.js';

const log = createLogger('OAuthAsync');

// Static OAuth providers map
const OAUTH_PROVIDERS: Record<string, OAuthProviderInterface> = {
  'kimi': kimiOAuthProvider,
  'kimi-coding': kimiOAuthProvider,
  'qwen': qwenPortalOAuthProvider,
  'qwen-portal': qwenPortalOAuthProvider,
  'minimax': minimaxOAuthProvider,
  'minimax-cn': minimaxCnOAuthProvider,
  'anthropic': anthropicOAuthProvider,
  'github-copilot': githubCopilotOAuthProvider,
  'google-gemini-cli': googleGeminiCliOAuthProvider,
  'google-antigravity': googleAntigravityOAuthProvider,
  'openai-codex': openaiCodexOAuthProvider,
};

// OAuth session state
interface OAuthSession {
  id: string;
  provider: string;
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
}

// In-memory session store (could be moved to Redis for production)
const oauthSessions = new Map<string, OAuthSession>();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of oauthSessions.entries()) {
    if (now > session.expiresAt) {
      if (session.abortController) {
        session.abortController.abort();
      }
      oauthSessions.delete(id);
      log.debug({ sessionId: id }, 'Cleaned up expired OAuth session');
    }
  }
}, 60 * 1000);

function generateSessionId(): string {
  return `oauth_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

export function createOAuthAsyncHandler(service: GatewayService) {
  const oauth = new Hono();

  /**
   * POST /api/auth/oauth-async/start
   * Start async OAuth flow - returns immediately with session ID
   */
  oauth.post('/start', async (c) => {
    const { provider } = await c.req.json().catch(() => ({}));
    
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
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };

    oauthSessions.set(sessionId, session);

    // Start OAuth flow in background
    runOAuthFlow(session, oauthProvider, service).catch(err => {
      log.error({ sessionId, provider, error: err }, 'Background OAuth flow failed');
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

    if (session.abortController) {
      session.abortController.abort();
    }

    if (session.manualCodeReject) {
      session.manualCodeReject(new Error('OAuth cancelled by user'));
      session.manualCodeReject = undefined;
      session.manualCodeResolve = undefined;
    }

    session.status = 'cancelled';
    session.message = 'OAuth flow cancelled';

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
      if (session.abortController) {
        session.abortController.abort();
      }
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
    signal: abortController.signal,
  };

  try {
    const credentials = await oauthProvider.login(callbacks);
    
    // Save credentials to cache
    setOAuthCredentialsToCache(session.provider, credentials);

    // Get API key from OAuth credentials
    const apiKey = oauthProvider.getApiKey(credentials);

    // Save API key to credential system
    const resolver = new CredentialResolver();
    await resolver.saveApiKey(session.provider, apiKey, { profileName: 'default' });

    session.status = 'completed';
    session.credentials = credentials;
    session.message = 'OAuth login successful';
    
    log.info({ sessionId: session.id, provider: session.provider }, 'OAuth login completed');
  } catch (err) {
    if (abortController.signal.aborted) {
      session.status = 'cancelled';
      session.message = 'OAuth flow cancelled by user';
    } else {
      session.status = 'failed';
      session.error = err instanceof Error ? err.message : 'OAuth login failed';
      log.error({ sessionId: session.id, provider: session.provider, error: err }, 'OAuth login failed');
    }
  } finally {
    session.abortController = undefined;
    session.manualCodeResolve = undefined;
    session.manualCodeReject = undefined;
  }
}

// Simple in-memory cache for OAuth credentials
const oauthCredentialsCache: Map<string, OAuthCredentials> = new Map();

export function getOAuthCredentialsFromCache(provider: string): OAuthCredentials | undefined {
  return oauthCredentialsCache.get(provider);
}

export function setOAuthCredentialsToCache(provider: string, creds: OAuthCredentials): void {
  oauthCredentialsCache.set(provider, creds);
}

export function deleteOAuthCredentialsFromCache(provider: string): void {
  oauthCredentialsCache.delete(provider);
}
