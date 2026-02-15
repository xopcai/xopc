/**
 * Google Gemini CLI OAuth Provider
 * 
 * OAuth authentication for Google Gemini CLI (Cloud Code Assist).
 */

import type { OAuthCredentials, OAuthProviderInterface, OAuthLoginCallbacks } from './types.js';

// Use dynamic import to avoid type issues
export const googleGeminiCliOAuthProvider: OAuthProviderInterface = {
	id: 'google-gemini-cli',
	name: 'Google Gemini CLI',
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		const { loginGeminiCli } = await import('@mariozechner/pi-ai');
		const creds = await loginGeminiCli(
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
		return refreshOAuthToken('google-gemini-cli', credentials);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
