import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DiskAuthProfileStore, ensureDiskAuthProfileStore, listProfilesForProvider } from '../auth-profile-store.js';
import type { AuthProfile } from '../types.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'xopc-auth-store-'));
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function makeStore(): { store: DiskAuthProfileStore; path: string } {
  const path = join(tmpRoot, 'auth-profiles.json');
  return { store: new DiskAuthProfileStore(path), path };
}

const apiKeyProfile: AuthProfile = {
  provider: 'openai',
  profileId: 'default',
  mode: 'api-key',
  apiKey: 'sk-static',
  default: true,
};

const oauthProfile: AuthProfile = {
  provider: 'openai',
  profileId: 'codex',
  mode: 'oauth',
  oauthAccessToken: 'oauth-token',
  oauthRefreshToken: 'r-1',
  oauthTokenEndpoint: 'https://example.com/token',
  expiresAt: Date.now() + 60_000,
};

describe('DiskAuthProfileStore', () => {
  it('returns undefined when the file does not exist', () => {
    const { store } = makeStore();
    expect(store.getApiKeySync('openai')).toBeUndefined();
    expect(store.hasCredentialSync('openai')).toBe(false);
    expect(store.list('openai')).toEqual([]);
    expect(store.get('openai')).toBeUndefined();
  });

  it('persists profiles atomically and reads them back', async () => {
    const { store, path } = makeStore();
    await store.save(apiKeyProfile);

    // File should exist + parse to a valid wrapper.
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { version: number; profiles: AuthProfile[] };
    expect(parsed.version).toBe(1);
    expect(parsed.profiles).toHaveLength(1);
    expect(parsed.profiles[0].apiKey).toBe('sk-static');

    // Sync read paths.
    expect(store.getApiKeySync('openai')).toBe('sk-static');
    expect(store.hasCredentialSync('openai')).toBe(true);
    expect(store.get('openai')?.profileId).toBe('default');
  });

  it('honours profileId selection and falls back to default flag', async () => {
    const { store } = makeStore();
    await store.save(apiKeyProfile);
    await store.save(oauthProfile);

    // Explicit profileId.
    expect(store.getApiKeySync('openai', 'codex')).toBe('oauth-token');
    expect(store.getApiKeySync('openai', 'default')).toBe('sk-static');

    // Implicit -> picks `default: true` first.
    expect(store.get('openai')?.profileId).toBe('default');
    expect(store.list('openai').map((p) => p.profileId).sort()).toEqual(['codex', 'default']);
  });

  it('promoting a new default demotes the previous one', async () => {
    const { store } = makeStore();
    await store.save(apiKeyProfile);
    await store.save({ ...oauthProfile, default: true });

    const profiles = store.list('openai');
    const defaults = profiles.filter((p) => p.default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].profileId).toBe('codex');
  });

  it('writes file with restrictive permissions (0o600 on POSIX)', async () => {
    if (process.platform === 'win32') return;
    const { store, path } = makeStore();
    await store.save(apiKeyProfile);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('treats malformed JSON as empty (does not throw)', () => {
    const path = join(tmpRoot, 'auth-profiles.json');
    writeFileSync(path, '{not valid json', 'utf8');
    const store = new DiskAuthProfileStore(path);
    expect(store.list('openai')).toEqual([]);
    expect(store.getApiKeySync('openai')).toBeUndefined();
  });

  it('treats wrong-shape JSON (missing version) as empty', () => {
    const path = join(tmpRoot, 'auth-profiles.json');
    writeFileSync(path, JSON.stringify({ foo: 'bar' }), 'utf8');
    const store = new DiskAuthProfileStore(path);
    expect(store.list('openai')).toEqual([]);
  });

  it('serialises concurrent saves so the file never corrupts', async () => {
    const { store, path } = makeStore();
    const profiles = Array.from({ length: 20 }, (_, i) => ({
      ...apiKeyProfile,
      profileId: `p-${i}`,
      apiKey: `sk-${i}`,
      default: false,
    }));
    await Promise.all(profiles.map((p) => store.save(p)));
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      profiles: AuthProfile[];
    };
    expect(parsed.profiles).toHaveLength(20);
    const ids = new Set(parsed.profiles.map((p) => p.profileId));
    expect(ids.size).toBe(20);
  });
});

describe('ensureDiskAuthProfileStore', () => {
  it('returns the same instance for the same agentDir', () => {
    const dir = join(tmpRoot, 'agent-x');
    const a = ensureDiskAuthProfileStore(dir);
    const b = ensureDiskAuthProfileStore(dir);
    expect(a).toBe(b);
  });
});

describe('listProfilesForProvider', () => {
  it('returns [] for noop / undefined stores', () => {
    expect(listProfilesForProvider(undefined, 'openai')).toEqual([]);
  });

  it('passes through to a real DiskAuthProfileStore', async () => {
    const { store } = makeStore();
    await store.save(apiKeyProfile);
    expect(listProfilesForProvider(store, 'openai').map((p) => p.profileId)).toEqual(['default']);
  });
});
