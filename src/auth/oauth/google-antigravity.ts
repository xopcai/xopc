/**
 * Google Antigravity OAuth Provider
 *
 * OAuth authentication for Google Antigravity (Gemini 3, Claude, GPT-OSS).
 */

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

// Stub implementation - OAuth functionality not available
export const googleAntigravityOAuthProvider: OAuthProviderInterface = {
	id: 'google-antigravity',
	name: 'Google Antigravity',
	usesCallbackServer: true,

	async login(_callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		throw new Error('Google Antigravity OAuth not implemented');
	},

	async refreshToken(_credentials: OAuthCredentials): Promise<OAuthCredentials> {
		throw new Error('Google Antigravity OAuth refresh not implemented');
	},

	getApiKey(credentials: OAuthCredentials): string {
		const creds = credentials as OAuthCredentials & { projectId?: string };
		return JSON.stringify({ token: creds.access, projectId: creds.projectId });
	},
};
