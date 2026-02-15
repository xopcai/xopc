/**
 * OpenAI Codex OAuth Provider
 * 
 * OAuth authentication for OpenAI Codex (ChatGPT Plus/Pro Subscription).
 */

import type { OAuthCredentials, OAuthProviderInterface, OAuthLoginCallbacks } from './types.js';

export const openaiCodexOAuthProvider: OAuthProviderInterface = {
	id: 'openai-codex',
	name: 'OpenAI Codex',
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		const { loginOpenAICodex } = await import('@mariozechner/pi-ai');
		const creds = await loginOpenAICodex({
			onAuth: (info: { url: string; instructions?: string }) => callbacks.onAuth(info),
			onPrompt: async (prompt) => callbacks.onPrompt(prompt),
			onProgress: (msg) => callbacks.onProgress?.(msg),
			onManualCodeInput: callbacks.onManualCodeInput,
			originator: 'xopcbot',
		});
		
		return {
			access: creds.access,
			refresh: creds.refresh,
			expires: creds.expires,
		};
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		const { refreshOAuthToken } = await import('@mariozechner/pi-ai');
		return refreshOAuthToken('openai-codex', credentials);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
