/**
 * OpenAI Codex OAuth Provider
 *
 * OAuth authentication for OpenAI Codex (ChatGPT Plus/Pro Subscription).
 */

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

// Stub implementation - OAuth functionality not available
export const openaiCodexOAuthProvider: OAuthProviderInterface = {
	id: 'openai-codex',
	name: 'OpenAI Codex',
	usesCallbackServer: true,

	async login(_callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		throw new Error('OpenAI Codex OAuth not implemented');
	},

	async refreshToken(_credentials: OAuthCredentials): Promise<OAuthCredentials> {
		throw new Error('OpenAI Codex OAuth refresh not implemented');
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
