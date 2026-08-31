import { anthropicOAuthProvider } from './anthropic.js';
import { githubCopilotOAuthProvider } from './github-copilot.js';
import { googleAntigravityOAuthProvider } from './google-antigravity.js';
import { googleGeminiCliOAuthProvider } from './google-gemini-cli.js';
import { kimiCodingOAuthProvider } from './kimi-coding.js';
import { minimaxCnOAuthProvider } from './minimax-cn.js';
import { minimaxOAuthProvider } from './minimax.js';
import { openaiCodexOAuthProvider } from './openai-codex.js';
import { xopcCloudOAuthProvider, xopcTunnelOAuthProvider } from './xopc-cloud.js';
import type { OAuthProviderInterface } from './types.js';

export interface OAuthProviderDefinition {
  displayName: string;
  oauthOnly?: boolean;
  provider: OAuthProviderInterface;
  profileId: string;
  urlPrompt: string;
}

function definition(provider: OAuthProviderInterface, displayName = provider.name): OAuthProviderDefinition {
  return {
    displayName,
    provider,
    profileId: `${provider.id}:default`,
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  };
}

export const OAUTH_PROVIDER_DEFINITIONS: Readonly<Record<string, OAuthProviderDefinition>> = {
  'xopc-cloud': { ...definition(xopcCloudOAuthProvider), oauthOnly: true },
  'xopc-tunnel': { ...definition(xopcTunnelOAuthProvider), oauthOnly: true },
  anthropic: definition(anthropicOAuthProvider, 'Anthropic (Claude)'),
  minimax: definition(minimaxOAuthProvider, 'MiniMax (幂维智能)'),
  'minimax-cn': { ...definition(minimaxCnOAuthProvider, 'MiniMax CN'), urlPrompt: '🌐 请在浏览器中打开以下 URL:\n' },
  'kimi-coding': definition(kimiCodingOAuthProvider, 'Kimi For Coding (月之暗面)'),
  'github-copilot': definition(githubCopilotOAuthProvider),
  'google-gemini-cli': definition(googleGeminiCliOAuthProvider),
  'google-antigravity': definition(googleAntigravityOAuthProvider),
  'openai-codex': definition(openaiCodexOAuthProvider),
};

export function getOAuthProviderDefinition(provider: string): OAuthProviderDefinition | undefined {
  return OAUTH_PROVIDER_DEFINITIONS[provider];
}

export function getOAuthProviderInterfaces(): Record<string, OAuthProviderInterface> {
  return Object.fromEntries(Object.entries(OAUTH_PROVIDER_DEFINITIONS).map(([id, value]) => [id, value.provider]));
}

export function getOAuthProviderIds(): string[] {
  return Object.keys(OAUTH_PROVIDER_DEFINITIONS);
}

export function isOAuthOnlyProvider(provider: string): boolean {
  return OAUTH_PROVIDER_DEFINITIONS[provider]?.oauthOnly === true;
}
