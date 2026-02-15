/**
 * Qwen Portal OAuth Provider
 * 
 * OAuth 2.0 authentication for Qwen (DashScope).
 */

import type { OAuthCredentials, OAuthProviderInterface, OAuthLoginCallbacks } from './types.js';

const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai';
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';

export const qwenPortalOAuthProvider: OAuthProviderInterface = {
	id: 'qwen',
	name: 'Qwen (通义千问)',
	usesCallbackServer: false,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		// Qwen uses device code flow
		const deviceCodeUrl = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
		
		const deviceResponse = await fetch(deviceCodeUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify({
				client_id: QWEN_OAUTH_CLIENT_ID,
				scope: 'user:email',
			}),
		});

		if (!deviceResponse.ok) {
			throw new Error(`Qwen device code request failed: ${deviceResponse.statusText}`);
		}

		const deviceData = await deviceResponse.json() as {
			device_code: string;
			user_code: string;
			verification_uri: string;
			expires_in: number;
			interval: number;
		};

		// Show user the verification URL and code
		callbacks.onAuth({
			url: deviceData.verification_uri,
			instructions: `Code: ${deviceData.user_code}`,
		});

		// Poll for token
		const tokenUrl = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
		const expiresAt = Date.now() + deviceData.expires_in * 1000;
		const intervalMs = deviceData.interval * 1000;

		while (Date.now() < expiresAt) {
			await new Promise(r => setTimeout(r, intervalMs));

			const tokenResponse = await fetch(tokenUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json',
				},
				body: new URLSearchParams({
					grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
					device_code: deviceData.device_code,
					client_id: QWEN_OAUTH_CLIENT_ID,
				}),
			});

			if (!tokenResponse.ok) {
				const error = await tokenResponse.json() as { error?: string };
				if (error.error === 'authorization_pending') {
					callbacks.onProgress?.('Waiting for authorization...');
					continue;
				}
				if (error.error === 'slow_down') {
					callbacks.onProgress?.('Slowing down polling...');
					await new Promise(r => setTimeout(r, 2000));
					continue;
				}
				throw new Error(`Token request failed: ${error.error}`);
			}

			const tokenData = await tokenResponse.json() as {
				access_token: string;
				refresh_token: string;
				expires_in: number;
			};

			return {
				access: tokenData.access_token,
				refresh: tokenData.refresh_token,
				expires: Date.now() + tokenData.expires_in * 1000,
			};
		}

		throw new Error('Device code expired. Please try again.');
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		if (!credentials.refresh) {
			throw new Error('Qwen OAuth refresh token missing. Re-authenticate.');
		}

		const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: credentials.refresh,
				client_id: QWEN_OAUTH_CLIENT_ID,
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			if (response.status === 400) {
				throw new Error('Qwen OAuth refresh token expired or invalid. Re-authenticate.');
			}
			throw new Error(`Qwen OAuth refresh failed: ${text || response.statusText}`);
		}

		const payload = await response.json() as {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
		};

		if (!payload.access_token || !payload.expires_in) {
			throw new Error('Qwen OAuth refresh response missing access token.');
		}

		return {
			...credentials,
			access: payload.access_token,
			refresh: payload.refresh_token || credentials.refresh,
			expires: Date.now() + payload.expires_in * 1000,
		};
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
