/**
 * OAuth HTTP Handler
 * 
 * Provides HTTP endpoints for OAuth login flow.
 */

import { Hono } from 'hono';
import type { GatewayService } from '../service.js';
import type { Config } from '../../config/schema.js';
import { 
  AuthStorage, 
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
  'kimi-coding': kimiOAuthProvider,  // Alias for frontend compatibility
  'qwen': qwenPortalOAuthProvider,
  'qwen-portal': qwenPortalOAuthProvider,  // Alias
  'minimax': minimaxOAuthProvider,
  'minimax-cn': minimaxCnOAuthProvider,
  'anthropic': anthropicOAuthProvider,
  'github-copilot': githubCopilotOAuthProvider,
  'google-gemini-cli': googleGeminiCliOAuthProvider,
  'google-antigravity': googleAntigravityOAuthProvider,
  'openai-codex': openaiCodexOAuthProvider,
};

// Simple in-memory cache for OAuth credentials (for fast access)
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
export function loadOAuthCredentialsToCache(service: GatewayService): void {
  const config = service.currentConfig;
  const providers = config.models?.providers || {};
  
  for (const [providerId, providerConfig] of Object.entries(providers)) {
    if (providerConfig.oauth) {
      oauthCredentialsCache.set(providerId, {
        access: providerConfig.oauth.access,
        refresh: providerConfig.oauth.refresh || '',
        expires: providerConfig.oauth.expires,
      });
    }
  }
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
      // For Device Code Flow, we need callbacks with onPrompt
      let authResult: any = null;
      
      const callbacks: OAuthLoginCallbacks = {
        onAuth: (auth: { url: string; instructions?: string }) => {
          authResult = { url: auth.url, instructions: auth.instructions };
        },
        // For Device Code Flow: return the device code user needs to enter
        onPrompt: async (prompt: { message: string; deviceCode?: string; verificationUri?: string }) => {
          authResult = { 
            message: prompt.message, 
            deviceCode: prompt.deviceCode,
            verificationUri: prompt.verificationUri,
          };
          // Return empty string - we'll handle this differently via the response
          return prompt.deviceCode || '';
        },
        onProgress: (message: string) => {
          console.log('OAuth progress:', message);
        },
      };

      // Start OAuth login
      const credentials = await oauthProvider.login(callbacks);

      // Store the credentials in cache
      setOAuthCredentialsToCache(provider, credentials);

      // Save OAuth credentials to config file for persistence
      const config = service.currentConfig as Config;
      if (!config.models) {
        config.models = { mode: 'merge', providers: {} };
      }
      if (!config.models.providers) {
        config.models.providers = {};
      }
      if (!config.models.providers[provider]) {
        config.models.providers[provider] = { 
          baseUrl: '', 
          models: [],
          auth: 'oauth',
        };
      }
      config.models.providers[provider].oauth = {
        access: credentials.access,
        refresh: credentials.refresh,
        expires: credentials.expires,
      };
      
      // Also set the API key from OAuth credentials
      config.models.providers[provider].apiKey = oauthProvider.getApiKey(credentials);

      // Save to file
      await service.saveConfig(config);

      // Return auth info to frontend for display
      return c.json({ 
        ok: true, 
        payload: { 
          success: true,
          provider,
          message: 'OAuth login successful',
          expires: credentials.expires,
          authUrl: authResult?.url,
          deviceCode: authResult?.deviceCode,
          instructions: authResult?.instructions,
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

    return c.json({ 
      ok: true, 
      payload: { 
        configured: !!credentials,
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
    
    // Remove from cache
    deleteOAuthCredentialsFromCache(provider);

    // Remove from config
    const config = service.currentConfig as Config;
    if (config.models?.providers?.[provider]) {
      delete config.models.providers[provider].oauth;
      delete config.models.providers[provider].apiKey;
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
