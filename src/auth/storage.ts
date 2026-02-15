/**
 * Auth Storage
 * 
 * Credential storage for API keys and OAuth tokens.
 * Supports environment variables, file-based storage, and OAuth with token refresh.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { resolveConfigValue } from '../providers/registry.js';
import type { OAuthCredentials, OAuthProviderInterface, OAuthLoginCallbacks } from './oauth/types.js';

export interface AuthEntry {
	provider: string;
	type: 'api_key' | 'token' | 'oauth';
	key?: string;
	metadata?: Record<string, string>;
	createdAt?: string;
	updatedAt?: string;
	// OAuth specific fields
	refresh?: string;
	access?: string;
	expires?: number;
}

export interface AuthStorageOptions {
	/** Directory for auth file (default: ~/.xopcbot) */
	dataDir?: string;
	/** Auth filename (default: auth.json) */
	filename?: string;
}

export class AuthStorage {
	private filePath: string;
	private cache: Map<string, AuthEntry> = new Map();
	private dataDir: string;
	private runtimeOverrides: Map<string, string> = new Map();
	private oauthProviders: Map<string, OAuthProviderInterface> = new Map();

	constructor(options?: AuthStorageOptions) {
		// Default to ~/.xopcbot
		const homedir = process.env.HOME || process.env.USERPROFILE || '.';
		this.dataDir = options?.dataDir ?? join(homedir, '.xopcbot');
		this.filePath = join(this.dataDir, options?.filename ?? 'auth.json');
		this.load();
	}

	private load(): void {
		if (!existsSync(this.filePath)) {
			return;
		}

		try {
			const content = readFileSync(this.filePath, 'utf-8');
			const entries: AuthEntry[] = JSON.parse(content);

			for (const entry of entries) {
				this.cache.set(entry.provider, entry);
			}
		} catch (error) {
			console.warn('Failed to load auth file:', error);
		}
	}

	private save(): void {
		const dir = dirname(this.filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}

		const entries = Array.from(this.cache.values());
		writeFileSync(this.filePath, JSON.stringify(entries, null, 2));
		chmodSync(this.filePath, 0o600);
	}

	/**
	 * Register an OAuth provider for login support.
	 */
	registerOAuthProvider(provider: OAuthProviderInterface): void {
		this.oauthProviders.set(provider.id, provider);
	}

	/**
	 * Set a runtime API key override (not persisted to disk).
	 * Used for CLI --api-key flag.
	 */
	setRuntimeApiKey(provider: string, apiKey: string): void {
		this.runtimeOverrides.set(provider, apiKey);
	}

	/**
	 * Remove a runtime API key override.
	 */
	removeRuntimeApiKey(provider: string): void {
		this.runtimeOverrides.delete(provider);
	}

	/** Get API key for a provider (async for OAuth) */
	async getApiKey(provider: string): Promise<string | undefined> {
		// Runtime override takes highest priority
		const runtimeKey = this.runtimeOverrides.get(provider);
		if (runtimeKey) {
			return runtimeKey;
		}

		const entry = this.cache.get(provider);
		
		if (!entry) {
			// Check environment variable
			const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
			return process.env[envKey];
		}

		if (entry.type === 'oauth') {
			// Handle OAuth credentials
			return this.getOAuthApiKey(provider);
		}

		if (entry.key) {
			return entry.key;
		}

		// Check environment variable
		const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
		return process.env[envKey];
	}

	/**
	 * Get API key for OAuth provider, with automatic token refresh if needed.
	 */
	private async getOAuthApiKey(providerId: string): Promise<string | undefined> {
		const entry = this.cache.get(providerId);
		if (!entry || entry.type !== 'oauth') {
			return undefined;
		}

		const oauthProvider = this.oauthProviders.get(providerId);
		if (!oauthProvider) {
			// No OAuth provider registered, return stored access token if available
			return entry.access;
		}

		// Check if token needs refresh
		const expires = entry.expires ?? 0;
		if (Date.now() >= expires) {
			// Token expired, try to refresh
			if (entry.refresh) {
				try {
					const credentials: OAuthCredentials = {
						refresh: entry.refresh,
						access: entry.access || '',
						expires: entry.expires || 0,
					};
					const newCredentials = await oauthProvider.refreshToken(credentials);
					
					// Update stored credentials
					this.cache.set(providerId, {
						...entry,
						access: newCredentials.access,
						refresh: newCredentials.refresh,
						expires: newCredentials.expires,
						updatedAt: new Date().toISOString(),
					});
					this.save();
					
					return newCredentials.access;
				} catch (error) {
					console.error(`Failed to refresh OAuth token for ${providerId}:`, error);
					return undefined;
				}
			}
			return undefined;
		}

		// Token still valid
		return oauthProvider.getApiKey({
			refresh: entry.refresh || '',
			access: entry.access || '',
			expires: entry.expires || 0,
		});
	}

	/** Get token for a provider */
	getToken(provider: string): string | undefined {
		const entry = this.cache.get(provider);
		if (entry && entry.type === 'token' && entry.key) {
			return entry.key;
		}

		// Check environment variable
		const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_TOKEN`;
		return process.env[envKey];
	}

	/** Set API key for a provider */
	setApiKey(provider: string, key: string, metadata?: Record<string, string>): void {
		// Resolve environment variable syntax
		const resolvedKey = resolveConfigValue(key);

		this.cache.set(provider, {
			provider,
			type: 'api_key',
			key: resolvedKey,
			metadata,
			updatedAt: new Date().toISOString(),
		});
		this.save();
	}

	/** Set token for a provider */
	setToken(provider: string, token: string, metadata?: Record<string, string>): void {
		const resolvedToken = resolveConfigValue(token);

		this.cache.set(provider, {
			provider,
			type: 'token',
			key: resolvedToken,
			metadata,
			updatedAt: new Date().toISOString(),
		});
		this.save();
	}

	/**
	 * Set OAuth credentials for a provider.
	 */
	setOAuthCredentials(provider: string, credentials: OAuthCredentials): void {
		this.cache.set(provider, {
			provider,
			type: 'oauth',
			access: credentials.access,
			refresh: credentials.refresh,
			expires: credentials.expires,
			updatedAt: new Date().toISOString(),
		});
		this.save();
	}

	/**
	 * Get OAuth credentials for a provider.
	 */
	getOAuthCredentials(provider: string): OAuthCredentials | undefined {
		const entry = this.cache.get(provider);
		if (entry && entry.type === 'oauth') {
			return {
				refresh: entry.refresh || '',
				access: entry.access || '',
				expires: entry.expires || 0,
			};
		}
		return undefined;
	}

	/**
	 * Check if provider has OAuth credentials.
	 */
	hasOAuthCredentials(provider: string): boolean {
		const entry = this.cache.get(provider);
		return entry?.type === 'oauth';
	}

	/**
	 * Login to an OAuth provider.
	 */
	async login(providerId: string, callbacks: OAuthLoginCallbacks): Promise<void> {
		const oauthProvider = this.oauthProviders.get(providerId);
		if (!oauthProvider) {
			throw new Error(`Unknown OAuth provider: ${providerId}`);
		}

		const credentials = await oauthProvider.login(callbacks);
		this.setOAuthCredentials(providerId, credentials);
	}

	/**
	 * Logout from a provider (removes credentials).
	 */
	logout(provider: string): void {
		this.remove(provider);
	}

	/** Check if provider has auth configured */
	hasAuth(provider: string): boolean {
		if (this.runtimeOverrides.has(provider)) return true;
		if (this.cache.has(provider)) return true;

		// Check environment variable
		const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
		const tokenKey = `${provider.toUpperCase().replace(/-/g, '_')}_TOKEN`;
		return !!(process.env[envKey] || process.env[tokenKey]);
	}

	/** Get all configured providers */
	getConfiguredProviders(): string[] {
		const providers = new Set<string>();

		// From cache
		for (const [provider] of this.cache) {
			providers.add(provider);
		}

		// Check common environment variables
		const commonProviders = [
			'openai',
			'anthropic',
			'google',
			'minimax',
			'minimax-cn',
			'moonshot',
			'qwen',
			'deepseek',
			'groq',
			'openrouter',
			'xai',
			'cerebras',
			'mistral',
			'ollama',
			// OAuth providers
			'anthropic',
			'openai-codex',
			'google-gemini-cli',
		];

		for (const provider of commonProviders) {
			const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
			const tokenKey = `${provider.toUpperCase().replace(/-/g, '_')}_TOKEN`;
			if (process.env[envKey] || process.env[tokenKey]) {
				providers.add(provider);
			}
		}

		return Array.from(providers);
	}

	/** Get credential type for a provider */
	getCredentialType(provider: string): string | undefined {
		const entry = this.cache.get(provider);
		return entry?.type;
	}

	/** Remove auth for a provider */
	remove(provider: string): boolean {
		const deleted = this.cache.delete(provider);
		if (deleted) {
			this.save();
		}
		return deleted;
	}

	/** Clear all auth */
	clear(): void {
		this.cache.clear();
		this.save();
	}

	/** Reload credentials from disk */
	reload(): void {
		this.cache.clear();
		this.load();
	}

	/** Export auth data (safe for debugging) */
	export(): Record<string, { type: string; hasKey: boolean; hasOAuth?: boolean }> {
		const result: Record<string, { type: string; hasKey: boolean; hasOAuth?: boolean }> = {};
		for (const [provider, entry] of this.cache) {
			result[provider] = {
				type: entry.type,
				hasKey: !!entry.key || !!entry.access,
				hasOAuth: entry.type === 'oauth',
			};
		}
		return result;
	}

	/** Get the auth file path */
	getAuthPath(): string {
		return this.filePath;
	}
}
