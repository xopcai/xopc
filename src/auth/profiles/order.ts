/**
 * Auth Profiles - Profile Order Resolution
 * 
 * Resolves the order of auth profiles for a provider (round-robin, etc).
 */

import type { AuthProfileStore } from './types.js';
import { loadAuthProfileStore } from './store.js';

/**
 * Resolve auth profile order for a provider.
 * Uses stored order if available, otherwise returns default order.
 */
export function resolveAuthProfileOrder(provider: string): string[] {
	const store = loadAuthProfileStore();

	// Use stored order if available
	if (store.order && store.order[provider]) {
		return store.order[provider];
	}

	// Return default: {provider}:default
	return [`${provider}:default`];
}

/**
 * Get next profile in rotation for a provider.
 * Considers last good profile and round-robin.
 */
export function getNextProfileInRotation(
	provider: string,
	availableProfiles: string[]
): string | undefined {
	if (availableProfiles.length === 0) {
		return undefined;
	}

	if (availableProfiles.length === 1) {
		return availableProfiles[0];
	}

	const store = loadAuthProfileStore();
	const lastGood = store.lastGood?.[provider];

	// Find next profile after last good one
	if (lastGood) {
		const currentIndex = availableProfiles.indexOf(lastGood);
		if (currentIndex >= 0) {
			const nextIndex = (currentIndex + 1) % availableProfiles.length;
			return availableProfiles[nextIndex];
		}
	}

	// Default to first available
	return availableProfiles[0];
}

/**
 * Mark a profile as "good" (working)
 */
export function markProfileGood(provider: string, profileId: string): void {
	const store = loadAuthProfileStore();
	if (!store.lastGood) {
		store.lastGood = {};
	}
	store.lastGood[provider] = profileId;

	// Clear any cooldown for this profile
	if (store.usageStats?.[profileId]) {
		delete store.usageStats[profileId].cooldownUntil;
		delete store.usageStats[profileId].disabledUntil;
		delete store.usageStats[profileId].disabledReason;
	}

	import('./store.js').then(({ saveAuthProfileStore }) => {
		saveAuthProfileStore(store);
	});
}
