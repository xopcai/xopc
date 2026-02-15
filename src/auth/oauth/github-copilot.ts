/**
 * GitHub Copilot OAuth Provider
 * 
 * OAuth authentication for GitHub Copilot.
 * Uses device code flow for authentication.
 */

import type { OAuthCredentials, OAuthProviderInterface, OAuthLoginCallbacks } from './types.js';

export const githubCopilotOAuthProvider: OAuthProviderInterface = {
	id: 'github-copilot',
	name: 'GitHub Copilot',
	usesCallbackServer: false,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		const { loginGitHubCopilot } = await import('@mariozechner/pi-ai');
		const creds = await loginGitHubCopilot({
			onAuth: (url: string, instructions?: string) => {
				callbacks.onAuth({ url, instructions });
			},
			onPrompt: async (prompt) => callbacks.onPrompt(prompt),
			onProgress: (msg) => callbacks.onProgress?.(msg),
			signal: callbacks.signal,
		});
		
		return {
			access: creds.access,
			refresh: creds.refresh,
			expires: creds.expires,
		};
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		// GitHub Copilot tokens don't support refresh
		throw new Error('GitHub Copilot tokens do not support refresh. Please re-authenticate.');
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
