/**
 * {@link AuthProfileStore} implementations.
 *
 * - {@link NoopAuthProfileStore}: returns nothing; used by tests and as a safe
 *   fallback when no agent context is available.
 * - {@link DiskAuthProfileStore}: persists per-agent profiles under
 *   `<stateDir>/agents/<agentId>/auth-profiles.json` with a lazy in-memory
 *   cache and atomic writes. Used by the gateway and CLI to host OAuth
 *   tokens (Codex / Anthropic) without leaking them through env vars.
 *
 * Capability providers stay synchronous: `getApiKeySync` / `hasCredentialSync`
 * read the cached snapshot. Async members (`save`, `refresh`) are only used
 * by vendor-specific code that explicitly opts in to OAuth flows.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createLogger } from '../../utils/logger.js';
import type { AuthProfile, AuthProfileStore } from './types.js';

const log = createLogger('AuthProfileStore');

const STORE_FILENAME = 'auth-profiles.json';

export class NoopAuthProfileStore implements AuthProfileStore {
  getApiKeySync(): string | undefined {
    return undefined;
  }
  hasCredentialSync(): boolean {
    return false;
  }
  list(): AuthProfile[] {
    return [];
  }
  get(): AuthProfile | undefined {
    return undefined;
  }
  async save(): Promise<void> {
    /* no-op */
  }
  async refresh(profile: AuthProfile): Promise<AuthProfile> {
    return profile;
  }
}

type DiskFile = {
  /** Schema version; bumped if we ever change the on-disk shape. */
  version: 1;
  profiles: AuthProfile[];
};

function emptyFile(): DiskFile {
  return { version: 1, profiles: [] };
}

function isDiskFile(v: unknown): v is DiskFile {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return o.version === 1 && Array.isArray(o.profiles);
}

/**
 * Persistent per-agent credential store.
 *
 * File layout (`<stateDir>/agents/<agentId>/auth-profiles.json`):
 *
 * ```json
 * {
 *   "version": 1,
 *   "profiles": [
 *     { "provider": "openai", "profileId": "default", "mode": "api-key", "apiKey": "sk-..." },
 *     { "provider": "openai", "profileId": "codex",   "mode": "oauth",
 *       "oauthAccessToken": "...", "oauthRefreshToken": "...", "expiresAt": 1714000000000 }
 *   ]
 * }
 * ```
 *
 * - Constructor is non-blocking; the first read triggers a sync load.
 * - Writes go through a temp file + `renameSync` so partial writes never
 *   leave the JSON corrupted.
 */
export class DiskAuthProfileStore implements AuthProfileStore {
  private readonly path: string;
  private cache: DiskFile | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.path = filePath;
  }

  /** Absolute path to the backing JSON file. */
  get filePath(): string {
    return this.path;
  }

  // --- Sync read API ------------------------------------------------------

  getApiKeySync(providerId: string, profile?: string): string | undefined {
    const p = this.findProfile(providerId, profile);
    if (!p) return undefined;
    if (typeof p.apiKey === 'string' && p.apiKey.length > 0) return p.apiKey;
    if (typeof p.oauthAccessToken === 'string' && p.oauthAccessToken.length > 0) {
      return p.oauthAccessToken;
    }
    return undefined;
  }

  hasCredentialSync(providerId: string, profile?: string): boolean {
    return Boolean(this.getApiKeySync(providerId, profile));
  }

  list(providerId: string): AuthProfile[] {
    const file = this.ensureLoaded();
    return file.profiles
      .filter((p) => p.provider === providerId)
      .map((p) => ({ ...p }));
  }

  get(providerId: string, profileId?: string): AuthProfile | undefined {
    const p = this.findProfile(providerId, profileId);
    return p ? { ...p } : undefined;
  }

  // --- Async write API ----------------------------------------------------

  /**
   * Persist a profile. Uses a serial write chain so concurrent saves cannot
   * race each other on the JSON document.
   */
  save(profile: AuthProfile): Promise<void> {
    const next = this.writeChain.then(() => {
      const file = this.ensureLoaded();
      const idx = file.profiles.findIndex(
        (p) => p.provider === profile.provider && p.profileId === profile.profileId,
      );
      if (idx >= 0) {
        file.profiles[idx] = { ...profile };
      } else {
        file.profiles.push({ ...profile });
      }
      // Only one default per provider.
      if (profile.default) {
        for (const p of file.profiles) {
          if (
            p.provider === profile.provider &&
            p.profileId !== profile.profileId &&
            p.default
          ) {
            p.default = false;
          }
        }
      }
      this.persist(file);
    });
    // Swallow rejections in the chain so a single bad write doesn't poison
    // every subsequent save attempt.
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  /**
   * Default `refresh()` is a no-op. Vendor-specific OAuth refresh logic
   * (Codex / Anthropic) lives in `src/providers/auth-runtime/oauth.ts` and
   * calls `save()` here once it has a fresh token.
   */
  async refresh(profile: AuthProfile): Promise<AuthProfile> {
    return profile;
  }

  // --- Internals ----------------------------------------------------------

  private ensureLoaded(): DiskFile {
    if (this.cache) return this.cache;
    if (!existsSync(this.path)) {
      this.cache = emptyFile();
      return this.cache;
    }
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (isDiskFile(parsed)) {
        this.cache = { version: 1, profiles: parsed.profiles.filter(isAuthProfileLike) };
      } else {
        log.warn(
          { path: this.path, phase: 'load' },
          'auth-profiles.json has unexpected shape; resetting to empty (file is preserved on disk)',
        );
        this.cache = emptyFile();
      }
    } catch (err) {
      log.warn(
        { err, path: this.path, phase: 'load' },
        `Failed to read auth-profiles.json: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.cache = emptyFile();
    }
    return this.cache;
  }

  private findProfile(providerId: string, profileId?: string): AuthProfile | undefined {
    const file = this.ensureLoaded();
    const matches = file.profiles.filter((p) => p.provider === providerId);
    if (matches.length === 0) return undefined;
    const wanted = profileId?.trim();
    if (wanted) {
      return matches.find((p) => p.profileId === wanted);
    }
    return matches.find((p) => p.default) ?? matches.find((p) => p.profileId === 'default') ?? matches[0];
  }

  private persist(file: DiskFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.path);
    this.cache = file;
  }
}

function isAuthProfileLike(v: unknown): v is AuthProfile {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.provider === 'string' && typeof o.profileId === 'string' && typeof o.mode === 'string';
}

// --- Default store registry ------------------------------------------------

let defaultStore: AuthProfileStore = new NoopAuthProfileStore();
const diskStores = new Map<string, DiskAuthProfileStore>();

export function getDefaultAuthProfileStore(): AuthProfileStore {
  return defaultStore;
}

/**
 * Override the default store. Returns a function that restores the previous
 * store; tests typically call it in `afterEach`.
 */
export function setDefaultAuthProfileStore(store: AuthProfileStore): () => void {
  const prev = defaultStore;
  defaultStore = store;
  return () => {
    defaultStore = prev;
  };
}

/**
 * Get (or create) a {@link DiskAuthProfileStore} for the given agent
 * directory. Same `agentDir` always returns the same store instance so the
 * in-memory cache stays consistent within one process.
 */
export function ensureDiskAuthProfileStore(agentDir: string): DiskAuthProfileStore {
  const key = agentDir;
  let store = diskStores.get(key);
  if (!store) {
    store = new DiskAuthProfileStore(join(agentDir, STORE_FILENAME));
    diskStores.set(key, store);
  }
  return store;
}

/**
 * Convenience: list every profile for a provider via either an explicit
 * store or the default store.
 */
export function listProfilesForProvider(
  store: AuthProfileStore | undefined,
  providerId: string,
): AuthProfile[] {
  const s = store ?? getDefaultAuthProfileStore();
  return s.list(providerId);
}
