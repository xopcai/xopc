/**
 * OpenAI Codex OAuth Provider
 * 
 * OAuth authentication for OpenAI Codex (ChatGPT Plus/Pro Subscription).
 */

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

export const openaiCodexOAuthProvider: OAuthProviderInterface = {
	id: 'openai-codex',
	name: 'OpenAI Codex',
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		const { loginOpenAICodex } = await import('@mariozechner/pi-ai/oauth');
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
		const { refreshOpenAICodexToken } = await import('@mariozechner/pi-ai/oauth');
		return refreshOpenAICodexToken(credentials.refresh);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
