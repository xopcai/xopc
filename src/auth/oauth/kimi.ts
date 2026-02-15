/**
 * Kimi (Moonshot AI) OAuth Provider
 * 
 * OAuth 2.0 authentication for Kimi Platform.
 * https://platform.moonshot.cn/
 */

import type { OAuthCredentials, OAuthProviderInterface, OAuthLoginCallbacks } from './types.js';

const KIMI_OAUTH_BASE_URL = 'https://platform.moonshot.cn';
const KIMI_OAUTH_AUTHORIZE_URL = `${KIMI_OAUTH_BASE_URL}/oauth/authorize`;
const KIMI_OAUTH_TOKEN_URL = `${KIMI_OAUTH_BASE_URL}/oauth/token`;
const KIMI_OAUTH_CLIENT_ID = 'your_client_id'; // Users need to register their own app

export const kimiOAuthProvider: OAuthProviderInterface = {
	id: 'kimi',
	name: 'Kimi (月之暗面)',
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		// Kimi uses authorization code flow with PKCE
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = await generateCodeChallenge(codeVerifier);
		
		const authUrl = new URL(KIMI_OAUTH_AUTHORIZE_URL);
		authUrl.searchParams.set('client_id', KIMI_OAUTH_CLIENT_ID);
		authUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
		authUrl.searchParams.set('response_type', 'code');
		authUrl.searchParams.set('scope', 'api');
		authUrl.searchParams.set('code_challenge', codeChallenge);
		authUrl.searchParams.set('code_challenge_method', 'S256');

		callbacks.onAuth({
			url: authUrl.toString(),
			instructions: 'Please authorize the application and enter the code shown.',
		});

		const code = await callbacks.onPrompt({
			message: 'Enter the authorization code:',
		});

		const tokenResponse = await fetch(KIMI_OAUTH_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: KIMI_OAUTH_CLIENT_ID,
				code,
				redirect_uri: 'http://localhost:3000/callback',
				code_verifier: codeVerifier,
			}),
		});

		if (!tokenResponse.ok) {
			const error = await tokenResponse.text();
			throw new Error(`Token exchange failed: ${error}`);
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

function generateCodeVerifier(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(buffer: Uint8Array): string {
	let str = '';
	buffer.forEach(b => str += String.fromCharCode(b));
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
