/**
 * Google Antigravity OAuth Provider
 * 
 * OAuth authentication for Google Antigravity (Gemini 3, Claude, GPT-OSS).
 */

import type { OAuthCredentials, OAuthProviderInterface, OAuthLoginCallbacks } from './types.js';

export const googleAntigravityOAuthProvider: OAuthProviderInterface = {
	id: 'google-antigravity',
	name: 'Google Antigravity',
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		const { loginAntigravity } = await import('@mariozechner/pi-ai');
		const creds = await loginAntigravity(
			(info: { url: string; instructions?: string }) => callbacks.onAuth(info),
			(msg: string) => callbacks.onProgress?.(msg),
			callbacks.onManualCodeInput
		);
		
		return {
			access: creds.access,
			refresh: creds.refresh,
			expires: creds.expires,
		};
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		const { refreshOAuthToken } = await import('@mariozechner/pi-ai');
		return refreshOAuthToken('google-antigravity', credentials);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
