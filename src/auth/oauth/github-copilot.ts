/**
 * GitHub Copilot OAuth Provider
 *
 * OAuth authentication for GitHub Copilot.
 * Uses device code flow for authentication.
 */

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

// Stub implementation - OAuth functionality not available
export const githubCopilotOAuthProvider: OAuthProviderInterface = {
	id: 'github-copilot',
	name: 'GitHub Copilot',
	usesCallbackServer: false,

	async login(_callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		throw new Error('GitHub Copilot OAuth not implemented');
	},

	async refreshToken(_credentials: OAuthCredentials): Promise<OAuthCredentials> {
		throw new Error('GitHub Copilot tokens do not support refresh. Please re-authenticate.');
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
