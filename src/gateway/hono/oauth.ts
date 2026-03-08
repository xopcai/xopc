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

// Load OAuth credentials from config into cache
export function loadOAuthCredentialsToCache(_service: GatewayService): void {
  // OAuth credentials are now managed via AuthProfiles, not config
  // This function is kept for compatibility
}

export function createOAuthHandler(service: GatewayService) {
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
      };

      const credentials = await oauthProvider.login(callbacks);
      setOAuthCredentialsToCache(provider, credentials);

      // Get API key from OAuth credentials
      const apiKey = oauthProvider.getApiKey(credentials);

      // Save API key to config
      const config = service.currentConfig;
      if (!config.providers) {
        (config as any).providers = {};
      }
      (config as any).providers[provider] = apiKey;
      
      await service.saveConfig(config);

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
  oauth.get('/:provider', (c) => {
    const provider = c.req.param('provider');
    const credentials = getOAuthCredentialsFromCache(provider);
    const config = service.currentConfig;
    const configured = !!(config.providers?.[provider]);

    return c.json({ 
      ok: true, 
      payload: { 
        configured: configured || !!credentials,
        expires: credentials?.expires 
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

    // Remove from config
    const config = service.currentConfig;
    if ((config as any).providers?.[provider]) {
      delete (config as any).providers[provider];
      await service.saveConfig(config);
    }

    return c.json({ ok: true });
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
