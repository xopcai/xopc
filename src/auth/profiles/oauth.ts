/**
 * Auth Profiles - OAuth Support
 * 
 * OAuth credential resolution and refresh.
 */

import type { OAuthCredentials } from '@mariozechner/pi-ai';
import { loadAuthProfileStore, saveAuthProfileStore } from './store.js';

/** Resolve API key for a profile (handles OAuth refresh) */
export async function resolveApiKeyForProfile(
	profileId: string,
	refreshFn?: (credentials: OAuthCredentials) => Promise<OAuthCredentials>
): Promise<string | undefined> {
	const store = loadAuthProfileStore();
	const cred = store.profiles[profileId];

	if (!cred) {
		return undefined;
	}

	// Handle API key
	if (cred.type === 'api_key') {
		return cred.key;
	}

	// Handle token
	if (cred.type === 'token') {
		// Check if expired
		if (cred.expires && Date.now() >= cred.expires) {
			return undefined;
		}
		return cred.token;
	}

	// Handle OAuth
	if (cred.type === 'oauth') {
		// Check if token is valid
		const expires = cred.expires ?? 0;
		const now = Date.now();

		if (now >= expires) {
			// Token expired, try to refresh
			if (cred.refresh && refreshFn) {
				try {
					const newCreds: OAuthCredentials = {
						refresh: cred.refresh,
						access: cred.access || '',
						expires: cred.expires || 0,
					};
					const refreshed = await refreshFn(newCreds);

					// Update stored credentials
					store.profiles[profileId] = {
						...cred,
						access: refreshed.access,
						refresh: refreshed.refresh,
						expires: refreshed.expires,
					};
					saveAuthProfileStore(store);

					return refreshed.access;
				} catch {
					return undefined;
				}
			}
			return undefined;
		}

		return cred.access;
	}

	return undefined;
}

/** Check if a profile has valid credentials */
export function profileHasAuth(profileId: string): boolean {
	const store = loadAuthProfileStore();
	const cred = store.profiles[profileId];

	if (!cred) {
		return false;
	}

	if (cred.type === 'api_key') {
		return !!cred.key;
	}

	if (cred.type === 'token') {
		// Check if expired
		if (cred.expires && Date.now() >= cred.expires) {
			return false;
		}
		return !!cred.token;
	}

	if (cred.type === 'oauth') {
		// Check if valid (not expired)
		const expires = cred.expires ?? 0;
		return !!cred.access && Date.now() < expires;
	}

	return false;
}

/** Resolve profile for a provider (finds first available profile) */
export function resolveProfileForProvider(
	provider: string,
	order?: string[]
): string | undefined {
	const store = loadAuthProfileStore();

	// Use provided order or fall back to stored order
	const profileIds = order ?? store.order?.[provider];

	if (profileIds && profileIds.length > 0) {
		for (const profileId of profileIds) {
			const cred = store.profiles[profileId];
			if (cred?.provider === provider && profileHasAuth(profileId)) {
				return profileId;
			}
		}
	}

	// Fall back to any profile for this provider
	for (const [profileId, cred] of Object.entries(store.profiles)) {
		if (cred.provider === provider && profileHasAuth(profileId)) {
			return profileId;
		}
	}

	return undefined;
}
