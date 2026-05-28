import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Where user-facing browser caches (CloakBrowser binaries, CDP launcher
 * profiles, etc.) are allowed to live.
 *
 * Restricting the writable set to the user's home directory makes it safe to
 * expose `cacheDir` / `userDataDir` over the gateway HTTP API: an attacker who
 * already controls the gateway session cannot trick the install/launch flow
 * into seeding files under `/etc`, `/usr/local`, etc.
 *
 * Leading `~` and `~/` are expanded against the current process owner's home.
 */

export interface CacheDirCheckOk {
  ok: true;
  resolved: string;
}

export interface CacheDirCheckErr {
  ok: false;
  message: string;
  resolved: string;
}

export type CacheDirCheck = CacheDirCheckOk | CacheDirCheckErr;

export function expandHome(input: string): string {
  if (input === '~') return homedir();
  if (input.startsWith('~/') || input.startsWith(`~${sep}`)) {
    return resolve(homedir(), input.slice(2));
  }
  return input;
}

/**
 * Returns `{ ok: true, resolved }` when `input` is an absolute (or `~`-rooted)
 * path that resolves inside the user's home directory. Empty / missing input
 * is allowed (callers fall back to their own default).
 */
export function checkCacheDir(input: string | undefined | null): CacheDirCheck {
  if (input === undefined || input === null) {
    return { ok: true, resolved: '' };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, resolved: '' };
  }
  const expanded = expandHome(trimmed);
  if (!isAbsolute(expanded)) {
    return {
      ok: false,
      resolved: expanded,
      message: 'cacheDir must be an absolute path (or start with ~/)',
    };
  }
  const resolved = resolve(expanded);
  const home = resolve(homedir());
  const rel = relative(home, resolved);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return { ok: true, resolved };
  }
  return {
    ok: false,
    resolved,
    message: `cacheDir must live under your home directory (${home}); got ${resolved}`,
  };
}

/** Throws when the path violates the policy. */
export function assertCacheDir(input: string | undefined | null): string {
  const r = checkCacheDir(input);
  if (r.ok === false) {
    throw new Error(r.message);
  }
  return r.resolved;
}
