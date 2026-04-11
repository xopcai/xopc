/**
 * Qwen Portal OAuth (device code + PKCE), aligned with QwenLM/qwen-code.
 * @see https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/qwen/qwenOAuth2.ts
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from './types.js';

const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai';
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const QWEN_OAUTH_SCOPE = 'openid profile email model.completion';
const QWEN_DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

const QWEN_CREDENTIALS_PATH = join(homedir(), '.qwen', 'oauth_creds.json');

function generateCodeVerifier(): string {
	return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
	return createHash('sha256').update(verifier).digest('base64url');
}

function formEncode(data: Record<string, string>): string {
	return Object.entries(data)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
}

interface DeviceAuthSuccess {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	expires_in: number;
	interval?: number;
}

interface OAuthErrorBody {
	error?: string;
	error_description?: string;
}

function isOAuthError(data: unknown): data is OAuthErrorBody {
	return typeof data === 'object' && data !== null && 'error' in data && !('device_code' in data);
}

async function writeQwenCredentialsFile(params: {
	access_token: string;
	refresh_token?: string | null;
	expires_in: number | null;
}): Promise<void> {
	const expiresMs =
		params.expires_in != null && params.expires_in > 0
			? Date.now() + params.expires_in * 1000
			: Date.now() + 3600_000;
	const payload = {
		access_token: params.access_token,
		refresh_token: params.refresh_token ?? undefined,
		expires_at: Math.floor(expiresMs / 1000),
		expiry_date: expiresMs,
		token_type: 'Bearer',
	};
	await mkdir(dirname(QWEN_CREDENTIALS_PATH), { recursive: true });
	await writeFile(QWEN_CREDENTIALS_PATH, JSON.stringify(payload, null, 2), 'utf-8');
}

function readExpiresMsFromFile(data: Record<string, unknown>): number {
	if (typeof data.expiry_date === 'number') return data.expiry_date;
	if (typeof data.expires_at === 'number') return data.expires_at * 1000;
	return 0;
}

export const qwenPortalOAuthProvider: OAuthProviderInterface = {
	id: 'qwen',
	name: 'Qwen (通义千问)',
	usesCallbackServer: false,

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = generateCodeChallenge(codeVerifier);

		const deviceRes = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
				'x-request-id': randomUUID(),
			},
			body: formEncode({
				client_id: QWEN_OAUTH_CLIENT_ID,
				scope: QWEN_OAUTH_SCOPE,
				code_challenge: codeChallenge,
				code_challenge_method: 'S256',
			}),
		});

		const deviceJson: unknown = await deviceRes.json();
		if (!deviceRes.ok || isOAuthError(deviceJson)) {
			const err = isOAuthError(deviceJson) ? deviceJson : {};
			throw new Error(
				`Qwen device authorization failed: ${deviceRes.status} ${err.error ?? ''} ${err.error_description ?? JSON.stringify(deviceJson)}`,
			);
		}

		const device = deviceJson as DeviceAuthSuccess;
		const openUrl = device.verification_uri_complete || device.verification_uri;
		callbacks.onAuth({
			url: openUrl,
			instructions: `Open the link and sign in. If needed, enter code: ${device.user_code}`,
		});

		let pollMs = (device.interval ?? 2) * 1000;
		const deadline = Date.now() + device.expires_in * 1000;

		while (Date.now() < deadline) {
			if (callbacks.signal?.aborted) {
				throw new Error('Qwen OAuth cancelled');
			}

			await new Promise((r) => setTimeout(r, pollMs));

			const tokenRes = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json',
				},
				body: formEncode({
					grant_type: QWEN_DEVICE_GRANT,
					client_id: QWEN_OAUTH_CLIENT_ID,
					device_code: device.device_code,
					code_verifier: codeVerifier,
				}),
			});

			const rawText = await tokenRes.text();
			let tokenJson: unknown;
			try {
				tokenJson = JSON.parse(rawText) as unknown;
			} catch {
				throw new Error(`Qwen token response not JSON: ${rawText.slice(0, 200)}`);
			}

			if (tokenRes.ok && tokenJson && typeof tokenJson === 'object' && 'access_token' in tokenJson) {
				const t = tokenJson as {
					access_token: string;
					refresh_token?: string | null;
					expires_in?: number | null;
				};
				await writeQwenCredentialsFile({
					access_token: t.access_token,
					refresh_token: t.refresh_token,
					expires_in: t.expires_in ?? null,
				});
				const expiresMs =
					t.expires_in != null && t.expires_in > 0 ? Date.now() + t.expires_in * 1000 : Date.now() + 3600_000;
				return {
					access: t.access_token,
					refresh: t.refresh_token ?? '',
					expires: expiresMs,
				};
			}

			if (!isOAuthError(tokenJson)) {
				throw new Error(`Unexpected Qwen token response: ${rawText.slice(0, 200)}`);
			}

			const err = tokenJson.error;
			if (err === 'authorization_pending' || err === 'slow_down') {
				if (err === 'slow_down') {
					pollMs = Math.min(Math.floor(pollMs * 1.5), 10_000);
				}
				callbacks.onProgress?.('Waiting for you to complete sign-in in the browser…');
				continue;
			}

			throw new Error(
				`Qwen OAuth failed: ${err ?? tokenRes.status} ${(tokenJson as OAuthErrorBody).error_description ?? rawText.slice(0, 200)}`,
			);
		}

		throw new Error('Qwen device authorization expired. Click OAuth again to retry.');
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		if (credentials.refresh) {
			const body = formEncode({
				grant_type: 'refresh_token',
				refresh_token: credentials.refresh,
				client_id: QWEN_OAUTH_CLIENT_ID,
			});
			const res = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Accept: 'application/json',
				},
				body,
			});
			const data: unknown = await res.json();
			if (
				res.ok &&
				data &&
				typeof data === 'object' &&
				'access_token' in data &&
				typeof (data as { access_token: unknown }).access_token === 'string'
			) {
				const t = data as { access_token: string; refresh_token?: string; expires_in?: number };
				await writeQwenCredentialsFile({
					access_token: t.access_token,
					refresh_token: t.refresh_token ?? credentials.refresh,
					expires_in: t.expires_in ?? null,
				});
				const expiresMs =
					t.expires_in != null && t.expires_in > 0 ? Date.now() + t.expires_in * 1000 : credentials.expires;
				return {
					access: t.access_token,
					refresh: t.refresh_token ?? credentials.refresh,
					expires: expiresMs,
				};
			}
		}

		if (!existsSync(QWEN_CREDENTIALS_PATH)) {
			throw new Error('Qwen credentials file not found. Sign in again from Settings.');
		}

		const credsData = JSON.parse(await readFile(QWEN_CREDENTIALS_PATH, 'utf-8')) as Record<string, unknown>;
		const access = credsData.access_token;
		const refresh = credsData.refresh_token;
		if (typeof access !== 'string') {
			throw new Error('Invalid Qwen credentials file. Sign in again from Settings.');
		}
		const exp = readExpiresMsFromFile(credsData);
		if (exp > Date.now()) {
			return {
				access,
				refresh: typeof refresh === 'string' ? refresh : credentials.refresh,
				expires: exp,
			};
		}
		throw new Error('Qwen OAuth token expired. Sign in again from Settings.');
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
