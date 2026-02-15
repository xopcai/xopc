/**
 * Auth Profiles Types
 * 
 * Type definitions for auth profile credentials and storage.
 */

import type { OAuthCredentials } from '@mariozechner/pi-ai';

/** API key credential (static) */
export interface ApiKeyCredential {
	type: 'api_key';
	provider: string;
	key?: string;
	email?: string;
	/** Optional provider-specific metadata */
	metadata?: Record<string, string>;
}

/** Token credential (static bearer-style, non-refreshable) */
export interface TokenCredential {
	type: 'token';
	provider: string;
	token: string;
	/** Optional expiry timestamp (ms since epoch) */
	expires?: number;
	email?: string;
}

/** OAuth credential (refreshable) */
export interface OAuthCredential extends OAuthCredentials {
	type: 'oauth';
	provider: string;
	clientId?: string;
	email?: string;
}

/** Any credential type */
export type AuthProfileCredential = ApiKeyCredential | TokenCredential | OAuthCredential;

/** Failure reason for auth profile */
export type AuthProfileFailureReason = 'auth' | 'format' | 'rate_limit' | 'billing' | 'timeout' | 'unknown';

/** Per-profile usage statistics for round-robin and cooldown tracking */
export interface ProfileUsageStats {
	lastUsed?: number;
	cooldownUntil?: number;
	disabledUntil?: number;
	disabledReason?: AuthProfileFailureReason;
	errorCount?: number;
	failureCounts?: Partial<Record<AuthProfileFailureReason, number>>;
	lastFailureAt?: number;
}

/** Auth profile store */
export interface AuthProfileStore {
	version: number;
	profiles: Record<string, AuthProfileCredential>;
	/** Optional per-agent preferred profile order overrides */
	order?: Record<string, string[]>;
	lastGood?: Record<string, string>;
	/** Usage statistics per profile for round-robin rotation */
	usageStats?: Record<string, ProfileUsageStats>;
}

/** Auth profile entry (for listing) */
export interface AuthProfileEntry {
	profileId: string;
	provider: string;
	type: 'api_key' | 'token' | 'oauth';
	email?: string;
	hasKey: boolean;
	expires?: number;
}
