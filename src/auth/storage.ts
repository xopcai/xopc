/**
 * Auth Storage
 * 
 * Simple auth storage for API keys and tokens.
 * Supports environment variables and file-based storage.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { resolveConfigValue } from '../providers/registry.js';

export interface AuthEntry {
	provider: string;
	type: 'api_key' | 'token';
	key: string;
	metadata?: Record<string, string>;
	createdAt?: string;
	updatedAt?: string;
}

export interface AuthStorageOptions {
	/** Directory for auth file (default: ./data) */
	dataDir?: string;
	/** Auth filename (default: auth.json) */
	filename?: string;
}

export class AuthStorage {
	private filePath: string;
	private cache: Map<string, AuthEntry> = new Map();
	private dataDir: string;

	constructor(options?: AuthStorageOptions) {
		this.dataDir = options?.dataDir ?? './data';
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
			mkdirSync(dir, { recursive: true });
		}

		const entries = Array.from(this.cache.values());
		writeFileSync(this.filePath, JSON.stringify(entries, null, 2));
	}

	/** Get API key for a provider */
	getApiKey(provider: string): string | undefined {
		const entry = this.cache.get(provider);
		if (entry) {
			return entry.key;
		}

		// Check environment variable
		const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`;
		return process.env[envKey];
	}

	/** Get token for a provider */
	getToken(provider: string): string | undefined {
		const entry = this.cache.get(provider);
		if (entry && entry.type === 'token') {
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

	/** Check if provider has auth configured */
	hasAuth(provider: string): boolean {
		if (this.cache.has(provider)) {
			return true;
		}

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

	/** Export auth data (safe for debugging) */
	export(): Record<string, { type: string; hasKey: boolean }> {
		const result: Record<string, { type: string; hasKey: boolean }> = {};
		for (const [provider, entry] of this.cache) {
			result[provider] = {
				type: entry.type,
				hasKey: !!entry.key,
			};
		}
		return result;
	}
}
