/**
 * Auth Profiles - Profile Management
 * 
 * CRUD operations for auth profiles.
 */

import type { ApiKeyCredential, OAuthCredential, TokenCredential, AuthProfileCredential, AuthProfileEntry } from './types.js';
import { ensureAuthProfileStore, loadAuthProfileStore, saveAuthProfileStore, resolveAuthStorePath } from './store.js';

function hasKey(cred: AuthProfileCredential): boolean {
	if (cred.type === 'api_key') {
		return !!cred.key;
	}
	if (cred.type === 'token') {
		return !!cred.token;
	}
	if (cred.type === 'oauth') {
		return !!cred.access;
	}
	return false;
}

function getExpires(cred: AuthProfileCredential): number | undefined {
	if (cred.type === 'token') {
		return cred.expires;
	}
	if (cred.type === 'oauth') {
		return cred.expires;
	}
	return undefined;
}

/** Get all profiles for a provider */
export function listProfilesForProvider(provider: string, dataDir?: string): AuthProfileEntry[] {
	const store = loadAuthProfileStore(dataDir);
	const profiles: AuthProfileEntry[] = [];

	for (const [profileId, cred] of Object.entries(store.profiles)) {
		if (cred.provider === provider) {
			profiles.push({
				profileId,
				provider: cred.provider,
				type: cred.type,
				email: cred.email,
				hasKey: hasKey(cred),
				expires: getExpires(cred),
			});
		}
	}

	return profiles;
}

/** Get all auth profiles */
export function listAllProfiles(dataDir?: string): AuthProfileEntry[] {
	const store = loadAuthProfileStore(dataDir);
	const profiles: AuthProfileEntry[] = [];

	for (const [profileId, cred] of Object.entries(store.profiles)) {
		profiles.push({
			profileId,
			provider: cred.provider,
			type: cred.type,
			email: cred.email,
			hasKey: hasKey(cred),
			expires: getExpires(cred),
		});
	}

	return profiles;
}

/** Get profile by ID */
export function getProfile(profileId: string, dataDir?: string): AuthProfileCredential | undefined {
	const store = loadAuthProfileStore(dataDir);
	return store.profiles[profileId];
}

/** Upsert (insert or update) an auth profile */
export function upsertAuthProfile(
	profile: {
		profileId: string;
		credential: AuthProfileCredential;
	},
	dataDir?: string
): void {
	const store = ensureAuthProfileStore(dataDir);
	store.profiles[profile.profileId] = profile.credential;
	saveAuthProfileStore(store, dataDir);
}

/** Remove an auth profile */
export function removeAuthProfile(profileId: string, dataDir?: string): boolean {
	const store = loadAuthProfileStore(dataDir);
	if (store.profiles[profileId]) {
		delete store.profiles[profileId];
		saveAuthProfileStore(store, dataDir);
		return true;
	}
	return false;
}

/** Set profile order for a provider */
export function setAuthProfileOrder(provider: string, profileIds: string[], dataDir?: string): void {
	const store = ensureAuthProfileStore(dataDir);
	if (!store.order) {
		store.order = {};
	}
	store.order[provider] = profileIds;
	saveAuthProfileStore(store, dataDir);
}

/** Get profile order for a provider */
export function getAuthProfileOrder(provider: string, dataDir?: string): string[] | undefined {
	const store = loadAuthProfileStore(dataDir);
	return store.order?.[provider];
}

/** Get all providers with profiles */
export function getProvidersWithProfiles(dataDir?: string): string[] {
	const store = loadAuthProfileStore(dataDir);
	const providers = new Set<string>();
	for (const cred of Object.values(store.profiles)) {
		providers.add(cred.provider);
	}
	return Array.from(providers);
}

/** Get auth path for display */
export function getAuthStorePath(dataDir?: string): string {
	return resolveAuthStorePath(dataDir);
}
