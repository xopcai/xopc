/**
 * Qwen Portal OAuth Provider
 *
 * OAuth 2.0 authentication for Qwen (DashScope).
 *
 * NOTE: Qwen now uses browser-based OAuth. Users need to:
 * 1. Install Qwen Client: pip install qwen-cli
 * 2. Run 'qwen' to authenticate in browser
 * 3. Credentials are stored at ~/.qwen/oauth_creds.json
 */

import type { OAuthCredentials, OAuthProviderInterface, OAuthLoginCallbacks } from './types.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const QWEN_CREDENTIALS_PATH = join(homedir(), '.qwen', 'oauth_creds.json');

export const qwenPortalOAuthProvider: OAuthProviderInterface = {
	id: 'qwen',
	name: 'Qwen (通义千问)',
	usesCallbackServer: false,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		// Qwen now uses browser-based OAuth
		// User needs to install qwen-cli and run 'qwen' to authenticate
		callbacks.onAuth({
			url: 'https://qwen.ai/',
			instructions: `Please install Qwen CLI and authenticate:

1. Install: pip install qwen-cli (or brew install qwen)
2. Run: qwen
3. Follow the browser login flow

Credentials will be saved to: ${QWEN_CREDENTIALS_PATH}`,
		});

		// Wait and check for credentials file
		const maxAttempts = 30;
		const interval = 2000;

		for (let i = 0; i < maxAttempts; i++) {
			await new Promise(r => setTimeout(r, interval));

			if (existsSync(QWEN_CREDENTIALS_PATH)) {
				try {
					const credsData = JSON.parse(readFileSync(QWEN_CREDENTIALS_PATH, 'utf-8'));

					// Qwen stores: access_token, refresh_token, expires_at, scope, token_type
					return {
						access: credsData.access_token,
						refresh: credsData.refresh_token,
						expires: credsData.expires_at * 1000, // Unix timestamp to ms
					};
				} catch (e) {
					throw new Error(`Failed to read Qwen credentials: ${e}`);
				}
			}

			callbacks.onProgress?.(`Waiting for authentication... (${i + 1}/${maxAttempts})`);
		}

		throw new Error('Authentication timeout. Please run "qwen" and complete the login flow.');
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		if (!credentials.refresh) {
			throw new Error('Qwen OAuth refresh token missing. Re-authenticate.');
		}

		// Qwen tokens are stored in file, so we need to read the latest
		if (!existsSync(QWEN_CREDENTIALS_PATH)) {
			throw new Error('Qwen credentials file not found. Re-authenticate with "qwen" command.');
		}

		try {
			const credsData = JSON.parse(readFileSync(QWEN_CREDENTIALS_PATH, 'utf-8'));

			// Check if token is still valid
			if (credsData.expires_at * 1000 > Date.now()) {
				return {
					access: credsData.access_token,
					refresh: credsData.refresh_token,
					expires: credsData.expires_at * 1000,
				};
			}

			// Token expired, need re-auth
			throw new Error('Qwen OAuth token expired. Please run "qwen" to re-authenticate.');
		} catch (e) {
			throw new Error(`Failed to refresh Qwen credentials: ${e}`);
		}
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
