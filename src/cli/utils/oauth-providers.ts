import {
  OAUTH_PROVIDER_DEFINITIONS,
  getOAuthProviderDefinition,
  type OAuthProviderDefinition,
} from '../../auth/oauth/registry.js';

export type OAuthProviderConfig = OAuthProviderDefinition;
export const OAUTH_PROVIDERS = OAUTH_PROVIDER_DEFINITIONS;

export function getSupportedOAuthProviders(): string[] {
  return Object.keys(OAUTH_PROVIDER_DEFINITIONS);
}

export function supportsOAuth(provider: string): boolean {
  return Boolean(getOAuthProviderDefinition(provider));
}

export function getOAuthProvider(provider: string): OAuthProviderConfig | undefined {
  return getOAuthProviderDefinition(provider);
}
