/**
 * OAuth Provider Configuration
 * 
 * Centralized OAuth provider definitions for CLI commands.
 * Used by both auth.ts and onboard.ts to avoid duplication.
 */

import {
  anthropicOAuthProvider,
  minimaxOAuthProvider,
  minimaxCnOAuthProvider,
  kimiOAuthProvider,
  githubCopilotOAuthProvider,
  googleGeminiCliOAuthProvider,
  googleAntigravityOAuthProvider,
  openaiCodexOAuthProvider,
  type OAuthProvider,
} from '../../auth/index.js';

export interface OAuthProviderConfig {
  displayName: string;
  provider: OAuthProvider;
  profileId: string;
  urlPrompt: string;
}

/**
 * Map of provider IDs to their OAuth configuration.
 */
export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  anthropic: {
    displayName: 'Anthropic (Claude)',
    provider: anthropicOAuthProvider,
    profileId: 'anthropic:default',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  minimax: {
    displayName: 'MiniMax (幂维智能)',
    provider: minimaxOAuthProvider,
    profileId: 'minimax:default',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  'minimax-cn': {
    displayName: 'MiniMax CN',
    provider: minimaxCnOAuthProvider,
    profileId: 'minimax-cn:default',
    urlPrompt: '🌐 请在浏览器中打开以下 URL:\n',
  },
  kimi: {
    displayName: 'Kimi (月之暗面)',
    provider: kimiOAuthProvider,
    profileId: 'kimi:default',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  'github-copilot': {
    displayName: 'GitHub Copilot',
    provider: githubCopilotOAuthProvider,
    profileId: 'github-copilot:default',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  'google-gemini-cli': {
    displayName: 'Google Gemini CLI',
    provider: googleGeminiCliOAuthProvider,
    profileId: 'google-gemini-cli:default',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  'google-antigravity': {
    displayName: 'Google Antigravity',
    provider: googleAntigravityOAuthProvider,
    profileId: 'google-antigravity:default',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
  'openai-codex': {
    displayName: 'OpenAI Codex',
    provider: openaiCodexOAuthProvider,
    profileId: 'openai-codex:default',
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  },
} as const;

/**
 * Get supported OAuth provider IDs.
 */
export function getSupportedOAuthProviders(): string[] {
  return Object.keys(OAUTH_PROVIDERS);
}

/**
 * Check if a provider supports OAuth.
 */
export function supportsOAuth(provider: string): boolean {
  return provider in OAUTH_PROVIDERS;
}

/**
 * Get OAuth provider config by ID.
 */
export function getOAuthProvider(provider: string): OAuthProviderConfig | undefined {
  return OAUTH_PROVIDERS[provider as keyof typeof OAUTH_PROVIDERS];
}
