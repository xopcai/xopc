/**
 * OAuth refresh helper used by capability providers (Codex / Anthropic /
 * future Google OAuth). Standalone from `resolveApiKeyForProvider` because
 * refresh is an async network call; the sync hot path never invokes it.
 *
 * Usage pattern:
 *
 * ```typescript
 * const profile = store.get('openai', 'codex');
 * if (profile?.mode === 'oauth' && isOAuthAccessTokenExpired(profile)) {
 *   const fresh = await refreshOAuthProfile(profile, { http: postJsonRequest });
 *   await store.save?.(fresh);
 * }
 * ```
 */

import { createLogger } from '../../utils/logger.js';
import type { AuthProfile } from './types.js';

const log = createLogger('AuthOAuthRefresh');
const pendingProfileRefreshes = new Map<string, Promise<AuthProfile>>();

/** Number of ms before {@link AuthProfile.expiresAt} we treat the token as stale. */
const REFRESH_SKEW_MS = 60_000;

export interface OAuthRefreshOptions {
  /**
   * HTTP transport. Defaults to global `fetch`. Tests inject a mock;
   * production usually uses the SSRF-protected `postJsonRequest` from
   * `src/media-shared/http/`.
   */
  fetcher?: typeof fetch;
  /** Hard timeout for the refresh request (ms). Default 30s. */
  timeoutMs?: number;
}

export function isOAuthAccessTokenExpired(profile: AuthProfile, nowMs?: number): boolean {
  if (profile.mode !== 'oauth') return false;
  if (typeof profile.expiresAt !== 'number' || profile.expiresAt <= 0) {
    // Unknown expiry — treat as fresh; vendor must call refresh on 401.
    return false;
  }
  const now = nowMs ?? Date.now();
  return profile.expiresAt - REFRESH_SKEW_MS <= now;
}

/**
 * Refresh an OAuth access token using the standard refresh-token grant. The
 * vendor must have set `oauthTokenEndpoint` and `oauthRefreshToken` on the
 * profile when it was first persisted.
 *
 * Returns a new {@link AuthProfile} object — does NOT mutate the input. The
 * caller is responsible for `store.save?.(returned)`.
 */
export async function refreshOAuthProfile(
  profile: AuthProfile,
  options: OAuthRefreshOptions = {},
): Promise<AuthProfile> {
  if (profile.mode !== 'oauth') {
    throw new Error(`refreshOAuthProfile: profile mode is "${profile.mode}", expected "oauth"`);
  }
  if (!profile.oauthRefreshToken) {
    throw new Error('refreshOAuthProfile: profile is missing oauthRefreshToken');
  }
  if (!profile.oauthTokenEndpoint) {
    throw new Error('refreshOAuthProfile: profile is missing oauthTokenEndpoint');
  }

  const refreshKey = `${profile.provider}\0${profile.profileId}\0${profile.oauthRefreshToken}`;
  const existing = pendingProfileRefreshes.get(refreshKey);
  if (existing) return existing;

  let pending: Promise<AuthProfile>;
  pending = refreshOAuthProfileOnce(profile, options).finally(() => {
    if (pendingProfileRefreshes.get(refreshKey) === pending) {
      pendingProfileRefreshes.delete(refreshKey);
    }
  });
  pendingProfileRefreshes.set(refreshKey, pending);
  return pending;
}

async function refreshOAuthProfileOnce(
  profile: AuthProfile,
  options: OAuthRefreshOptions,
): Promise<AuthProfile> {
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', profile.oauthRefreshToken);
  if (profile.oauthClientId) body.set('client_id', profile.oauthClientId);

  const fetcher = options.fetcher ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 30_000);

  try {
    const res = await fetcher(profile.oauthTokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await safeReadText(res);
      throw new Error(
        `OAuth refresh failed: ${res.status} ${res.statusText}${text ? ` — ${truncate(text, 240)}` : ''}`,
      );
    }
    const json = (await res.json()) as Record<string, unknown>;
    const accessToken = pickString(json, 'access_token');
    if (!accessToken) {
      throw new Error('OAuth refresh response missing access_token');
    }
    const refreshToken = pickString(json, 'refresh_token') ?? profile.oauthRefreshToken;
    const expiresInSec = pickNumber(json, 'expires_in');
    const expiresAt = expiresInSec ? Date.now() + expiresInSec * 1000 : profile.expiresAt;

    return {
      ...profile,
      oauthAccessToken: accessToken,
      oauthRefreshToken: refreshToken,
      expiresAt,
    };
  } catch (err) {
    log.warn(
      { err, provider: profile.provider, profileId: profile.profileId, phase: 'refresh' },
      `OAuth refresh failed for ${profile.provider}/${profile.profileId}`,
    );
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function pickNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
