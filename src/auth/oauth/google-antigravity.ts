/**
 * Google Antigravity OAuth Provider
 * 
 * OAuth authentication for Google Antigravity (Gemini 3, Claude, GPT-OSS).
 */

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

export const googleAntigravityOAuthProvider: OAuthProviderInterface = {
	id: 'google-antigravity',
	name: 'Google Antigravity',
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		const { loginAntigravity } = await import('@mariozechner/pi-ai/oauth');
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
		const { refreshAntigravityToken } = await import('@mariozechner/pi-ai/oauth');
		const creds = credentials as OAuthCredentials & { projectId?: string };
		return refreshAntigravityToken(creds.refresh, creds.projectId || '');
	},

	getApiKey(credentials: OAuthCredentials): string {
		const creds = credentials as OAuthCredentials & { projectId?: string };
		return JSON.stringify({ token: creds.access, projectId: creds.projectId });
	},
};
