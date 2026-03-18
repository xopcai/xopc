/**
 * Google Gemini CLI OAuth Provider
 * 
 * OAuth authentication for Google Gemini CLI (Cloud Code Assist).
 */

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

export const googleGeminiCliOAuthProvider: OAuthProviderInterface = {
	id: 'google-gemini-cli',
	name: 'Google Cloud Code Assist (Gemini CLI)',
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		const { loginGeminiCli } = await import('@mariozechner/pi-ai/oauth');
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
		const { refreshGoogleCloudToken } = await import('@mariozechner/pi-ai/oauth');
		const creds = credentials as OAuthCredentials & { projectId?: string };
		return refreshGoogleCloudToken(creds.refresh, creds.projectId || '');
	},

	getApiKey(credentials: OAuthCredentials): string {
		const creds = credentials as OAuthCredentials & { projectId?: string };
		return JSON.stringify({ token: creds.access, projectId: creds.projectId });
	},
};
