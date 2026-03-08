/**
 * OAuth HTTP Handler
 * 
 * Provides HTTP endpoints for OAuth login flow.
 */

import { Hono } from 'hono';
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

// Simple in-memory storage for OAuth credentials
const oauthCredentials: Map<string, OAuthCredentials> = new Map();

function getOAuthCredentials(provider: string): OAuthCredentials | undefined {
  return oauthCredentials.get(provider);
}

function setOAuthCredentials(provider: string, creds: OAuthCredentials): void {
  oauthCredentials.set(provider, creds);
}

function deleteOAuthCredentials(provider: string): void {
  oauthCredentials.delete(provider);
}

export function createOAuthHandler() {
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
      // For Device Code Flow, we need callbacks
      let authResult: any = null;
      
      const callbacks: OAuthLoginCallbacks = {
        onAuth: (auth: { url: string; instructions?: string }) => {
          authResult = { url: auth.url, instructions: auth.instructions };
        },
        onSuccess: (creds: any) => {
          authResult = { success: true, credentials: creds };
        },
        onError: (error: Error) => {
          authResult = { error: error.message };
        },
      };

      // Start OAuth login
      const credentials = await oauthProvider.login(callbacks);

      // Store the credentials
      setOAuthCredentials(provider, credentials);

      return c.json({ 
        ok: true, 
        payload: { 
          success: true,
          provider,
          message: 'OAuth login successful',
          expires: credentials.expires,
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
    const credentials = getOAuthCredentials(provider);

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
  oauth.delete('/:provider', (c) => {
    const provider = c.req.param('provider');
    deleteOAuthCredentials(provider);

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
