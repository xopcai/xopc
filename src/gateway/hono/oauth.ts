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
} from '../../auth/oauth/types.js';
import { getOAuthProviderInterfaces } from '../../auth/oauth/registry.js';
import { CredentialResolver } from '../../auth/credentials.js';
import { getProviderAuthState, isProviderConfigured } from '../../providers/index.js';
import { disconnectProvider } from '../../providers/provider-disconnect.js';
import {
  buildOAuthCompletionReadiness,
  refreshModelCatalogAfterOAuth,
} from './oauth-async.js';
import { applyXopcCloudCapabilitySetup } from '../xopc-cloud-capability-setup.js';

// Static OAuth providers map
const OAUTH_PROVIDERS: Record<string, OAuthProviderInterface> = getOAuthProviderInterfaces();

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
      const resolver = new CredentialResolver();
      await resolver.saveOAuthCredentials(provider, credentials);
      const catalog = await refreshModelCatalogAfterOAuth(provider, service);
      let capabilitySetup: Awaited<ReturnType<typeof applyXopcCloudCapabilitySetup>> | undefined;
      if (catalog && provider === 'xopc-cloud') {
        capabilitySetup = await applyXopcCloudCapabilitySetup(service);
      }
      const baseReadiness = catalog
        ? buildOAuthCompletionReadiness(service.currentConfig, catalog)
        : undefined;
      const readiness = baseReadiness && capabilitySetup
        ? {
            ...baseReadiness,
            ...(capabilitySetup.configured === true
              ? { configuration: { applied: true } }
              : {
                  state: 'connected-degraded' as const,
                  configuration: { applied: false, error: capabilitySetup.error },
                }),
          }
        : baseReadiness;
      service.emit('provider.auth.changed', { provider, connected: true });

      return c.json({ 
        ok: true, 
        payload: { 
          success: true,
          provider,
          message: readiness?.state === 'connected-degraded'
            ? 'OAuth login successful, but capability setup is degraded'
            : 'OAuth login successful',
          expires: credentials.expires,
          authUrl: authResult?.url,
          deviceCode: authResult?.deviceCode,
          verificationUri: authResult?.verificationUri,
          instructions: authResult?.instructions,
          usesCallbackServer: oauthProvider.usesCallbackServer ?? false,
          manualCodeRequested,
          catalog,
          readiness,
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
    const authState = await getProviderAuthState(provider);
    const configured = await isProviderConfigured(provider);

    return c.json({ 
      ok: true, 
      payload: { 
        configured,
        authMode: authState.authMode,
        authStatus: authState.authStatus,
        expiresAt: authState.expiresAt,
      } 
    });
  });

  /**
   * DELETE /api/auth/oauth/:provider
   * Revoke OAuth credentials
   */
  oauth.delete('/:provider', async (c) => {
    const provider = c.req.param('provider');
    await disconnectProvider(provider);
    service.emit('provider.auth.changed', { provider, connected: false });
    if (provider === 'xopc-cloud') {
      service.emit('model-catalog.updated', { modelCount: 0 });
    }

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
