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
  purpose: 'models' | 'tunnel';
  provider: OAuthProviderInterface;
  profileId: string;
  urlPrompt: string;
}

function definition(
  provider: OAuthProviderInterface,
  purpose: OAuthProviderDefinition['purpose'],
  displayName = provider.name,
): OAuthProviderDefinition {
  return {
    displayName,
    purpose,
    provider,
    profileId: `${provider.id}:default`,
    urlPrompt: '🌐 Please open this URL in your browser:\n',
  };
}

export const OAUTH_PROVIDER_DEFINITIONS: Readonly<Record<string, OAuthProviderDefinition>> = {
  'xopc-cloud': { ...definition(xopcCloudOAuthProvider, 'models'), oauthOnly: true },
  'xopc-tunnel': { ...definition(xopcTunnelOAuthProvider, 'tunnel'), oauthOnly: true },
  anthropic: definition(anthropicOAuthProvider, 'models', 'Anthropic (Claude)'),
  minimax: definition(minimaxOAuthProvider, 'models', 'MiniMax (幂维智能)'),
  'minimax-cn': {
    ...definition(minimaxCnOAuthProvider, 'models', 'MiniMax CN'),
    urlPrompt: '🌐 请在浏览器中打开以下 URL:\n',
  },
  'kimi-coding': definition(kimiCodingOAuthProvider, 'models', 'Kimi For Coding (月之暗面)'),
  'github-copilot': definition(githubCopilotOAuthProvider, 'models'),
  'google-gemini-cli': definition(googleGeminiCliOAuthProvider, 'models'),
  'google-antigravity': definition(googleAntigravityOAuthProvider, 'models'),
  'openai-codex': definition(openaiCodexOAuthProvider, 'models'),
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

export function getModelOAuthProviderIds(): string[] {
  return Object.entries(OAUTH_PROVIDER_DEFINITIONS)
    .filter(([, definition]) => definition.purpose === 'models')
    .map(([id]) => id);
}

export function isOAuthOnlyProvider(provider: string): boolean {
  return OAUTH_PROVIDER_DEFINITIONS[provider]?.oauthOnly === true;
}
