/**
 * Auth Profile Store
 * 
 * Persistent storage for auth profiles.
 * Handles loading, saving, and migration of auth credentials.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'os';
import type { AuthProfileCredential, AuthProfileStore, ProfileUsageStats } from './types.js';

const AUTH_STORE_VERSION = 1;
const AUTH_STORE_FILENAME = 'auth-profiles.json';

/** Get the auth profiles file path */
export function resolveAuthStorePath(dataDir?: string): string {
	const dir = dataDir ?? path.join(homedir(), '.xopcbot');
	return path.join(dir, AUTH_STORE_FILENAME);
}

/** Ensure auth store file exists */
export function ensureAuthStoreFile(authPath: string): void {
	const dir = path.dirname(authPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	if (!existsSync(authPath)) {
		writeFileSync(authPath, JSON.stringify({ version: AUTH_STORE_VERSION, profiles: {} }, null, 2));
		chmodSync(authPath, 0o600);
	}
}

function loadJsonFile(filePath: string): unknown {
	if (!existsSync(filePath)) {
		return null;
	}
	try {
		const content = readFileSync(filePath, 'utf-8');
		return JSON.parse(content);
	} catch {
		return null;
	}
}

function saveJsonFile(filePath: string, data: unknown): void {
	const dir = path.dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	writeFileSync(filePath, JSON.stringify(data, null, 2));
	chmodSync(filePath, 0o600);
}

function coerceAuthStore(raw: unknown): AuthProfileStore | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const record = raw as Record<string, unknown>;
	if (!record.profiles || typeof record.profiles !== 'object') {
		return null;
	}
	const profiles = record.profiles as Record<string, unknown>;
	const normalized: Record<string, AuthProfileCredential> = {};
	for (const [key, value] of Object.entries(profiles)) {
		if (!value || typeof value !== 'object') {
			continue;
		}
		const typed = value as Partial<AuthProfileCredential>;
		if (typed.type !== 'api_key' && typed.type !== 'oauth' && typed.type !== 'token') {
			continue;
		}
		if (!typed.provider) {
			continue;
		}
		normalized[key] = typed as AuthProfileCredential;
	}
	const order =
		record.order && typeof record.order === 'object'
			? Object.entries(record.order as Record<string, unknown>).reduce(
				(acc, [provider, value]) => {
					if (!Array.isArray(value)) {
						return acc;
					}
					const list = value
						.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
						.filter(Boolean);
					if (list.length === 0) {
						return acc;
					}
					acc[provider] = list;
					return acc;
				},
				{} as Record<string, string[]>,
			)
			: undefined;
	return {
		version: Number(record.version ?? AUTH_STORE_VERSION),
		profiles: normalized,
		order,
		lastGood:
			record.lastGood && typeof record.lastGood === 'object'
				? (record.lastGood as Record<string, string>)
				: undefined,
		usageStats:
			record.usageStats && typeof record.usageStats === 'object'
				? (record.usageStats as Record<string, ProfileUsageStats>)
				: undefined,
	};
}

type LegacyAuthStore = Record<string, AuthProfileCredential>;

/** Handle legacy auth.json format */
function coerceLegacyStore(raw: unknown): LegacyAuthStore | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const record = raw as Record<string, unknown>;
	if ('profiles' in record) {
		return null;
	}
	const entries: LegacyAuthStore = {};
	for (const [key, value] of Object.entries(record)) {
		if (!value || typeof value !== 'object') {
			continue;
		}
		const typed = value as Partial<AuthProfileCredential>;
		if (typed.type !== 'api_key' && typed.type !== 'oauth' && typed.type !== 'token') {
			continue;
		}
		entries[key] = {
			...typed,
			provider: String(typed.provider ?? key),
		} as AuthProfileCredential;
	}
	return Object.keys(entries).length > 0 ? entries : null;
}

function applyLegacyStore(store: AuthProfileStore, legacy: LegacyAuthStore): void {
	for (const [provider, cred] of Object.entries(legacy)) {
		const profileId = `${provider}:default`;
		if (cred.type === 'api_key') {
			store.profiles[profileId] = {
				type: 'api_key',
				provider: String(cred.provider ?? provider),
				key: cred.key,
				...(cred.email ? { email: cred.email } : {}),
			};
			continue;
		}
		if (cred.type === 'token') {
			store.profiles[profileId] = {
				type: 'token',
				provider: String(cred.provider ?? provider),
				token: cred.token,
				...(typeof cred.expires === 'number' ? { expires: cred.expires } : {}),
				...(cred.email ? { email: cred.email } : {}),
			};
			continue;
		}
		store.profiles[profileId] = {
			type: 'oauth',
			provider: String(cred.provider ?? provider),
			access: cred.access,
			refresh: cred.refresh,
			expires: cred.expires,
			...(cred as any).enterpriseUrl ? { enterpriseUrl: (cred as any).enterpriseUrl } : {},
			...(cred as any).projectId ? { projectId: (cred as any).projectId } : {},
			...(cred as any).accountId ? { accountId: (cred as any).accountId } : {},
			...(cred.email ? { email: cred.email } : {}),
		};
	}
}

function mergeRecord<T>(
	base?: Record<string, T>,
	override?: Record<string, T>,
): Record<string, T> | undefined {
	if (!base && !override) {
		return undefined;
	}
	if (!base) {
		return { ...override };
	}
	if (!override) {
		return { ...base };
	}
	return { ...base, ...override };
}

function _mergeAuthProfileStores(
	base: AuthProfileStore,
	override: AuthProfileStore,
): AuthProfileStore {
	if (
		Object.keys(override.profiles).length === 0 &&
		!override.order &&
		!override.lastGood &&
		!override.usageStats
	) {
		return base;
	}
	return {
		version: Math.max(base.version, override.version ?? base.version),
		profiles: { ...base.profiles, ...override.profiles },
		order: mergeRecord(base.order, override.order),
		lastGood: mergeRecord(base.lastGood, override.lastGood),
		usageStats: mergeRecord(base.usageStats, override.usageStats),
	};
}

/** Load auth profile store from disk */
export function loadAuthProfileStore(dataDir?: string): AuthProfileStore {
	const authPath = resolveAuthStorePath(dataDir);
	const raw = loadJsonFile(authPath);
	const asStore = coerceAuthStore(raw);
	if (asStore) {
		return asStore;
	}

	// Check for legacy auth.json
	const legacyPath = path.join(path.dirname(authPath), 'auth.json');
	const legacyRaw = loadJsonFile(legacyPath);
	const legacy = coerceLegacyStore(legacyRaw);
	if (legacy) {
		const store: AuthProfileStore = {
			version: AUTH_STORE_VERSION,
			profiles: {},
		};
		applyLegacyStore(store, legacy);
		// Migrate to new format
		saveAuthProfileStore(store, dataDir);
		// Remove legacy file
		try {
			unlinkSync(legacyPath);
		} catch {
			// Ignore
		}
		return store;
	}

	return { version: AUTH_STORE_VERSION, profiles: {} };
}

/** Ensure auth profile store exists */
export function ensureAuthProfileStore(dataDir?: string): AuthProfileStore {
	const authPath = resolveAuthStorePath(dataDir);
	ensureAuthStoreFile(authPath);
	return loadAuthProfileStore(dataDir);
}

/** Save auth profile store to disk */
export function saveAuthProfileStore(store: AuthProfileStore, dataDir?: string): void {
	const authPath = resolveAuthStorePath(dataDir);
	const payload = {
		version: AUTH_STORE_VERSION,
		profiles: store.profiles,
		order: store.order ?? undefined,
		lastGood: store.lastGood ?? undefined,
		usageStats: store.usageStats ?? undefined,
	} satisfies AuthProfileStore;
	saveJsonFile(authPath, payload);
}
