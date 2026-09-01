import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { McpAuthorizationRequiredError } from './mcp-oauth-errors.js';
import { McpOAuthStore } from './mcp-oauth-store.js';

export type McpOAuthInteraction = {
  redirectUrl: URL;
  state: string;
  onRedirect: (authorizationUrl: URL) => void | Promise<void>;
};

export type McpOAuthClientProviderOptions = {
  serverUrl: URL;
  clientId?: string;
  interaction?: McpOAuthInteraction;
  store?: McpOAuthStore;
};

export class XopcMcpOAuthClientProvider implements OAuthClientProvider {
  private readonly store: McpOAuthStore;
  private codeVerifierValue?: string;

  constructor(private readonly options: McpOAuthClientProviderOptions) {
    this.store = options.store ?? new McpOAuthStore();
  }

  get redirectUrl(): URL {
    return this.options.interaction?.redirectUrl ?? new URL('http://127.0.0.1/oauth/callback');
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'XOPC',
      client_uri: 'https://xopc.ai',
      redirect_uris: [this.redirectUrl.toString()],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state(): string | undefined {
    return this.options.interaction?.state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.options.clientId) return { client_id: this.options.clientId };
    return (await this.store.load(this.options.serverUrl))?.clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.store.update(this.options.serverUrl, (current) => ({
      ...current,
      version: 1,
      serverUrl: this.options.serverUrl.toString(),
      clientInformation,
      updatedAt: current?.updatedAt ?? new Date().toISOString(),
    }));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.load(this.options.serverUrl))?.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.store.update(this.options.serverUrl, (current) => ({
      ...current,
      version: 1,
      serverUrl: this.options.serverUrl.toString(),
      tokens,
      tokensSavedAt: Date.now(),
      updatedAt: current?.updatedAt ?? new Date().toISOString(),
    }));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.options.interaction) throw new McpAuthorizationRequiredError();
    await this.options.interaction.onRedirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.codeVerifierValue = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.codeVerifierValue) throw new Error('MCP OAuth code verifier is unavailable');
    return this.codeVerifierValue;
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    await this.store.update(this.options.serverUrl, (current) => {
      const authorizationServerChanged = Boolean(
        current?.discoveryState?.authorizationServerUrl
        && current.discoveryState.authorizationServerUrl !== discoveryState.authorizationServerUrl,
      );
      return {
        ...current,
        version: 1,
        serverUrl: this.options.serverUrl.toString(),
        discoveryState,
        clientInformation: authorizationServerChanged ? undefined : current?.clientInformation,
        tokens: authorizationServerChanged ? undefined : current?.tokens,
        tokensSavedAt: authorizationServerChanged ? undefined : current?.tokensSavedAt,
        updatedAt: current?.updatedAt ?? new Date().toISOString(),
      };
    });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.store.load(this.options.serverUrl))?.discoveryState;
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'verifier') {
      this.codeVerifierValue = undefined;
      return;
    }
    await this.store.update(this.options.serverUrl, (current) => {
      if (!current) return undefined;
      if (scope === 'all') return undefined;
      return {
        ...current,
        ...(scope === 'client' ? { clientInformation: undefined } : {}),
        ...(scope === 'tokens' ? { tokens: undefined, tokensSavedAt: undefined } : {}),
        ...(scope === 'discovery' ? { discoveryState: undefined } : {}),
      };
    });
  }
}
