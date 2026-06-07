/**
 * OAuth HTTP Handler
 * 
 * Provides HTTP endpoints for OAuth login flow.
 */

import { Hono } from 'hono';
import type { GatewayService } from '../service.js';
import { 
  type OAuthProviderInterface, 
  type OAuthLoginCallbacks,
  type OAuthCredentials 
} from '../../auth/oauth/types.js';
import {
  kimiCodingOAuthProvider,
  minimaxOAuthProvider,
  minimaxCnOAuthProvider,
  anthropicOAuthProvider,
  githubCopilotOAuthProvider,
  googleGeminiCliOAuthProvider,
  googleAntigravityOAuthProvider,
  openaiCodexOAuthProvider,
} from '../../auth/oauth/index.js';
import { CredentialResolver } from '../../auth/credentials.js';
import { getProviderAuthState, isProviderConfigured } from '../../providers/index.js';

// Static OAuth providers map
const OAUTH_PROVIDERS: Record<string, OAuthProviderInterface> = {
  'kimi-coding': kimiCodingOAuthProvider,
  'minimax': minimaxOAuthProvider,
  'minimax-cn': minimaxCnOAuthProvider,
  'anthropic': anthropicOAuthProvider,
  'github-copilot': githubCopilotOAuthProvider,
  'google-gemini-cli': googleGeminiCliOAuthProvider,
  'google-antigravity': googleAntigravityOAuthProvider,
  'openai-codex': openaiCodexOAuthProvider,
};

// Simple in-memory cache for OAuth credentials
const oauthCredentialsCache: Map<string, OAuthCredentials> = new Map();

function getOAuthCredentialsFromCache(provider: string): OAuthCredentials | undefined {
  return oauthCredentialsCache.get(provider);
}

function setOAuthCredentialsToCache(provider: string, creds: OAuthCredentials): void {
  oauthCredentialsCache.set(provider, creds);
}

function deleteOAuthCredentialsFromCache(provider: string): void {
  oauthCredentialsCache.delete(provider);
}

/** No-op: OAuth tokens live on disk under auth paths; cache is populated during login. */
export function loadOAuthCredentialsToCache(_service: GatewayService): void {}

export function createOAuthHandler(_service: GatewayService) {
  const oauth = new Hono();

  /**
   * POST /api/auth/oauth/start
   * Start OAuth flow for a provider
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

    try {
      let authResult: any = null;
      let manualCodeRequested = false;
      
      const callbacks: OAuthLoginCallbacks = {
        onAuth: (auth: { url: string; instructions?: string }) => {
          authResult = { url: auth.url, instructions: auth.instructions };
        },
        onDeviceCode: (info) => {
          authResult = {
            url: info.verificationUri,
            instructions: `Enter code ${info.userCode}`,
            message: `Open ${info.verificationUri} and enter code ${info.userCode}`,
            deviceCode: info.userCode,
            verificationUri: info.verificationUri,
          };
        },
        onPrompt: async (prompt: { message: string; deviceCode?: string; verificationUri?: string }) => {
          authResult = { 
            message: prompt.message, 
            deviceCode: prompt.deviceCode,
            verificationUri: prompt.verificationUri,
          };
          return prompt.deviceCode || '';
        },
        onProgress: (message: string) => {
          console.log('OAuth progress:', message);
        },
        onManualCodeInput: async () => {
          // For callback server providers, signal that manual code input is needed
          manualCodeRequested = true;
          // Return empty - frontend will handle manual input
          return '';
        },
        onSelect: async (prompt) => {
          const browserOption = prompt.options.find((option) => option.id === 'browser');
          return browserOption?.id ?? prompt.options[0]?.id;
        },
      };

      const credentials = await oauthProvider.login(callbacks);
      setOAuthCredentialsToCache(provider, credentials);

      const resolver = new CredentialResolver();
      await resolver.saveOAuthToken(provider, {
        access: oauthProvider.getApiKey(credentials),
        refresh: credentials.refresh,
        expiresAt: credentials.expires,
        scope: Array.isArray(credentials.scope) ? credentials.scope.filter((value): value is string => typeof value === 'string') : undefined,
        createdAt: new Date().toISOString(),
      });

      return c.json({ 
        ok: true, 
        payload: { 
          success: true,
          provider,
          message: 'OAuth login successful',
          expires: credentials.expires,
          authUrl: authResult?.url,
          deviceCode: authResult?.deviceCode,
          verificationUri: authResult?.verificationUri,
          instructions: authResult?.instructions,
          usesCallbackServer: oauthProvider.usesCallbackServer ?? false,
          manualCodeRequested,
        } 
      });
    } catch (err) {
      console.error('OAuth login error:', err);
      return c.json({ 
        error: err instanceof Error ? err.message : 'OAuth login failed' 
      }, 500);
    }
  });

  /**
   * GET /api/auth/oauth/:provider
   * Check OAuth status for a provider
   */
  oauth.get('/:provider', async (c) => {
    const provider = c.req.param('provider');
    const credentials = getOAuthCredentialsFromCache(provider);
    const authState = await getProviderAuthState(provider);
    const configured = await isProviderConfigured(provider);

    return c.json({ 
      ok: true, 
      payload: { 
        configured: configured || !!credentials,
        authMode: authState.authMode,
        authStatus: authState.authStatus,
        expiresAt: authState.expiresAt ?? credentials?.expires,
      } 
    });
  });

  /**
   * DELETE /api/auth/oauth/:provider
   * Revoke OAuth credentials
   */
  oauth.delete('/:provider', async (c) => {
    const provider = c.req.param('provider');
    
    deleteOAuthCredentialsFromCache(provider);
    const resolver = new CredentialResolver();
    await resolver.deleteProviderCredential(provider);

    return c.json({ ok: true, payload: { disconnected: provider } });
  });

  /**
   * GET /api/auth/oauth
   * List available OAuth providers
   */
  oauth.get('/', (c) => {
    const result = Object.entries(OAUTH_PROVIDERS).map(([id, p]) => ({
      id,
      name: p.name,
    }));

    return c.json({ ok: true, payload: { providers: result } });
  });

  return oauth;
}
