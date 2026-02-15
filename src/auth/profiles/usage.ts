/**
 * Auth Profiles - Usage Tracking
 * 
 * Track profile usage for round-robin rotation and cooldown management.
 */

import type { AuthProfileFailureReason, ProfileUsageStats } from './types.js';
import { loadAuthProfileStore, saveAuthProfileStore } from './store.js';

const DEFAULT_COOLDOWN_HOURS = 5;
const MAX_COOLDOWN_HOURS = 24;
const _FAILURE_WINDOW_HOURS = 24;

/** Mark a profile as used */
export function markProfileUsed(profileId: string): void {
	const store = loadAuthProfileStore();

	if (!store.usageStats) {
		store.usageStats = {};
	}

	const stats = store.usageStats[profileId] ?? {};
	stats.lastUsed = Date.now();

	store.usageStats[profileId] = stats;
	saveAuthProfileStore(store);
}

/** Mark a profile failure */
export function markProfileFailure(profileId: string, reason: AuthProfileFailureReason): void {
	const store = loadAuthProfileStore();

	if (!store.usageStats) {
		store.usageStats = {};
	}

	const stats = store.usageStats[profileId] ?? {};
	stats.lastFailureAt = Date.now();
	stats.errorCount = (stats.errorCount ?? 0) + 1;
	stats.failureCounts = {
		...stats.failureCounts,
		[reason]: (stats.failureCounts?.[reason] ?? 0) + 1,
	};

	// Apply cooldown based on failure count
	const failures = stats.errorCount ?? 1;
	const cooldownHours = Math.min(
		defaultCooldownHours() * Math.pow(2, failures - 1),
		MAX_COOLDOWN_HOURS
	);

	stats.cooldownUntil = Date.now() + cooldownHours * 60 * 60 * 1000;
	stats.disabledReason = reason;

	store.usageStats[profileId] = stats;
	saveAuthProfileStore(store);
}

function defaultCooldownHours(): number {
	// Could be made configurable
	return DEFAULT_COOLDOWN_HOURS;
}

/** Check if profile is in cooldown */
export function isProfileInCooldown(profileId: string): boolean {
	const store = loadAuthProfileStore();
	const stats = store.usageStats?.[profileId];

	if (!stats) {
		return false;
	}

	const cooldownUntil = stats.cooldownUntil ?? 0;
	return Date.now() < cooldownUntil;
}

/** Get cooldown status for display */
export function getCooldownStatus(profileId: string): { inCooldown: boolean; until?: number; reason?: string } {
	const store = loadAuthProfileStore();
	const stats = store.usageStats?.[profileId];

	if (!stats || !stats.cooldownUntil) {
		return { inCooldown: false };
	}

	const now = Date.now();
	if (now >= stats.cooldownUntil) {
		return { inCooldown: false };
	}

	return {
		inCooldown: true,
		until: stats.cooldownUntil,
		reason: stats.disabledReason,
	};
}

/** Clear cooldown for a profile */
export function clearProfileCooldown(profileId: string): void {
	const store = loadAuthProfileStore();

	if (store.usageStats?.[profileId]) {
		delete store.usageStats[profileId].cooldownUntil;
		delete store.usageStats[profileId].disabledUntil;
		delete store.usageStats[profileId].disabledReason;
		saveAuthProfileStore(store);
	}
}

/** Get profile usage stats */
export function getProfileUsageStats(profileId: string): ProfileUsageStats | undefined {
	const store = loadAuthProfileStore();
	return store.usageStats?.[profileId];
}

/** Calculate cooldown ms for a profile */
export function calculateProfileCooldownMs(profileId: string): number {
	const store = loadAuthProfileStore();
	const stats = store.usageStats?.[profileId];

	if (!stats?.errorCount) {
		return 0;
	}

	const failures = stats.errorCount;
	const cooldownHours = Math.min(
		defaultCooldownHours() * Math.pow(2, failures - 1),
		MAX_COOLDOWN_HOURS
	);

	return cooldownHours * 60 * 60 * 1000;
}
