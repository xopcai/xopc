/**
 * Google Gemini CLI OAuth Provider
 *
 * OAuth authentication for Google Gemini CLI (Cloud Code Assist).
 */

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

// Stub implementation - OAuth functionality not available
export const googleGeminiCliOAuthProvider: OAuthProviderInterface = {
	id: 'google-gemini-cli',
	name: 'Google Cloud Code Assist (Gemini CLI)',
	usesCallbackServer: true,

	async login(_callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		throw new Error('Google Gemini CLI OAuth not implemented');
	},

	async refreshToken(_credentials: OAuthCredentials): Promise<OAuthCredentials> {
		throw new Error('Google Gemini CLI OAuth refresh not implemented');
	},

	getApiKey(credentials: OAuthCredentials): string {
		const creds = credentials as OAuthCredentials & { projectId?: string };
		return JSON.stringify({ token: creds.access, projectId: creds.projectId });
	},
};
