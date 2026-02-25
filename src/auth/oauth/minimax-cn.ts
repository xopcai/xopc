/**
 * MiniMax CN (国内版) OAuth Provider
 * 
 * OAuth 2.0 authentication for MiniMax 国内版 Platform.
 * https://platform.minimax.chat/ (国内版)
 * 
 * 注意：国内版和国际版的 OAuth 端点不同
 * - 国际版: platform.minimaxi.com
 * - 国内版: platform.minimax.chat
 */

import type { OAuthCredentials, OAuthProviderInterface, OAuthLoginCallbacks } from './types.js';

const MINIMAX_CN_OAUTH_BASE_URL = 'https://platform.minimax.chat';
const MINIMAX_CN_OAUTH_AUTHORIZE_URL = `${MINIMAX_CN_OAUTH_BASE_URL}/oauth/authorize`;
const MINIMAX_CN_OAUTH_TOKEN_URL = `${MINIMAX_CN_OAUTH_BASE_URL}/oauth/token`;
const MINIMAX_CN_OAUTH_CLIENT_ID = 'your_client_id'; // Users need to register their own app

export const minimaxCnOAuthProvider: OAuthProviderInterface = {
	id: 'minimax-cn',
	name: 'MiniMax 国内版',
	usesCallbackServer: true,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		// MiniMax CN uses authorization code flow
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = await generateCodeChallenge(codeVerifier);
		
		const authUrl = new URL(MINIMAX_CN_OAUTH_AUTHORIZE_URL);
		authUrl.searchParams.set('client_id', MINIMAX_CN_OAUTH_CLIENT_ID);
		authUrl.searchParams.set('redirect_uri', 'http://localhost:3000/callback');
		authUrl.searchParams.set('response_type', 'code');
		authUrl.searchParams.set('scope', 'api');
		authUrl.searchParams.set('code_challenge', codeChallenge);
		authUrl.searchParams.set('code_challenge_method', 'S256');

		// Show user the auth URL
		callbacks.onAuth({
			url: authUrl.toString(),
			instructions: '请在浏览器中授权应用，然后输入返回的授权码。',
		});

		// Prompt for the authorization code
		const code = await callbacks.onPrompt({
			message: '请输入授权码：',
		});

		// Exchange code for token
		const tokenResponse = await fetch(MINIMAX_CN_OAUTH_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: MINIMAX_CN_OAUTH_CLIENT_ID,
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
			throw new Error('MiniMax CN OAuth refresh token missing. Re-authenticate.');
		}

		const response = await fetch(MINIMAX_CN_OAUTH_TOKEN_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				client_id: MINIMAX_CN_OAUTH_CLIENT_ID,
				refresh_token: credentials.refresh,
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`MiniMax CN OAuth refresh failed: ${text}`);
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
