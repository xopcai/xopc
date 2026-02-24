/**
 * Kimi (Moonshot AI) OAuth Provider
 *
 * OAuth 2.0 authentication for Kimi Platform.
 * Uses Device Code Flow per Kimi's official implementation.
 * https://auth.kimi.com for OAuth endpoints.
 */

import type { OAuthCredentials, OAuthProviderInterface, OAuthLoginCallbacks } from './types.js';

const KIMI_OAUTH_BASE_URL = 'https://auth.kimi.com';
const KIMI_OAUTH_DEVICE_URL = `${KIMI_OAUTH_BASE_URL}/api/oauth/device_authorization`;
const KIMI_OAUTH_TOKEN_URL = `${KIMI_OAUTH_BASE_URL}/api/oauth/token`;
const KIMI_OAUTH_CLIENT_ID = 'your_client_id'; // Users need to register their own app

export const kimiOAuthProvider: OAuthProviderInterface = {
	id: 'kimi',
	name: 'Kimi (月之暗面)',
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		// Kimi uses Device Code Flow (not Authorization Code)
		// First, request device code
		const deviceResponse = await fetch(KIMI_OAUTH_DEVICE_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				client_id: KIMI_OAUTH_CLIENT_ID,
				scope: 'api',
			}),
		});

		if (!deviceResponse.ok) {
			const error = await deviceResponse.text();
			throw new Error(`Device code request failed: ${error}`);
		}

		const deviceData = await deviceResponse.json() as {
			device_code: string;
			user_code: string;
			verification_uri: string;
			verification_uri_complete: string;
			interval: number;
			expires_in: number;
		};

		// Prompt user to auth
		callbacks.onAuth({
			url: deviceData.verification_uri_complete || deviceData.verification_uri,
			instructions: `Please visit ${deviceData.verification_uri} and enter code: ${deviceData.user_code}`,
		});

		// Poll for token
		const expiresAt = Date.now() + deviceData.expires_in * 1000;
		const pollInterval = (deviceData.interval || 5) * 1000;

		while (Date.now() < expiresAt) {
			await new Promise(resolve => setTimeout(resolve, pollInterval));

			const tokenResponse = await fetch(KIMI_OAUTH_TOKEN_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: new URLSearchParams({
					grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
					client_id: KIMI_OAUTH_CLIENT_ID,
					device_code: deviceData.device_code,
				}),
			});

			if (tokenResponse.ok) {
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

			const errorData = await tokenResponse.json() as { error?: string };
			if (errorData.error === 'expired_token') {
				throw new Error('Device code expired. Please try again.');
			}
			// authorization_pending - continue polling
		}

		throw new Error('Device code expired. Please try again.');
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		if (!credentials.refresh) {
			throw new Error('Kimi OAuth refresh token missing. Re-authenticate.');
		}

		const response = await fetch(KIMI_OAUTH_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				client_id: KIMI_OAUTH_CLIENT_ID,
				refresh_token: credentials.refresh,
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Kimi OAuth refresh failed: ${text}`);
		}

		const payload = await response.json() as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};

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

function base64UrlEncode(buffer: Uint8Array): string {
	let str = '';
	buffer.forEach(b => str += String.fromCharCode(b));
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
