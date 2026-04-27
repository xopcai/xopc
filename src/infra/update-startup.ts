// src/infra/update-startup.ts

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Config } from '../config/schema.js';
import { resolveUpdateCheckStatePath } from '../config/paths-state.js';
import { acquireUpdateLock } from './update-lock.js';
import { PACKAGE_VERSION } from '../package-version.js';
import { createLogger } from '../utils/logger.js';

import { normalizeUpdateChannel, DEFAULT_PACKAGE_CHANNEL } from './update-channels.js';
import {
  compareSemver,
  resolveNpmChannelTag,
  detectInstallKind,
  resolvePackageRoot,
  type InstallKind,
  type UpdateAvailable,
} from './update-check.js';

const log = createLogger('UpdateCheck');

// --- State persistence ---

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ONE_HOUR_MS = 60 * 60 * 1000;

type UpdateCheckState = {
  /** `package.json` version at the last successful registry check (used to bypass 24h throttle when you bump the local version). */
  lastCheckPackageVersion?: string;
  lastCheckedAt?: string;
  lastAvailableVersion?: string;
  lastAvailableTag?: string;
  lastNotifiedVersion?: string;
  lastNotifiedTag?: string;
  autoInstallId?: string;
  autoFirstSeenVersion?: string;
  autoFirstSeenTag?: string;
  autoFirstSeenAt?: string;
  autoLastAttemptVersion?: string;
  autoLastAttemptAt?: string;
  autoLastSuccessVersion?: string;
  autoLastSuccessAt?: string;
};

// --- In-memory cache ---

let updateAvailableCache: UpdateAvailable | null = null;

/** Get the cached update-available state (populated after startup check). */
export function getUpdateAvailable(): UpdateAvailable | null {
  return updateAvailableCache;
}

// --- Core logic ---

async function readState(statePath: string): Promise<UpdateCheckState> {
  try {
    const raw = await readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as UpdateCheckState;
    if (!parsed || typeof parsed !== 'object') {
      log.warn({ statePath }, 'Update check state file contains non-object; resetting');
      return {};
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn({ err, statePath }, 'Failed to read update check state; resetting');
    }
    return {};
  }
}

async function writeState(statePath: string, state: UpdateCheckState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    await rename(tmpPath, statePath);
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

function resolveCheckIntervalMs(config: Config): number {
  const auto = config.update?.auto;
  if (!auto?.enabled) return CHECK_INTERVAL_MS;

  const channel = normalizeUpdateChannel(config.update?.channel) ?? DEFAULT_PACKAGE_CHANNEL;
  if (channel === 'beta') {
    const hours = auto.betaCheckIntervalHours ?? 1;
    return Math.max(ONE_HOUR_MS / 4, Math.floor(hours * ONE_HOUR_MS));
  }
  return ONE_HOUR_MS;
}

/**
 * Compute a deterministic delay for stable auto-update rollout,
 * based on a per-installation hash to spread updates over time.
 */
function resolveStableJitterMs(
  installId: string,
  version: string,
  tag: string,
  jitterWindowMs: number,
): number {
  if (jitterWindowMs <= 0) return 0;
  const hash = createHash('sha256').update(`${installId}:${version}:${tag}`).digest();
  const bucket = hash.readUInt32BE(0);
  return bucket % (Math.floor(jitterWindowMs) + 1);
}

/**
 * Main startup update check. Called once when the gateway starts (or on demand).
 */
export async function runGatewayUpdateCheck(params: {
  config: Config;
  onUpdateAvailableChange?: (update: UpdateAvailable | null) => void;
  /** When true, bypass checkOnStart/auto-disabled early exit and throttle (for POST /api/update/check). */
  force?: boolean;
}): Promise<void> {
  const { config, force } = params;

  const autoEnabled = config.update?.auto?.enabled ?? false;
  const shouldCheckHints = config.update?.checkOnStart !== false;
  if (!force && !shouldCheckHints && !autoEnabled) return;

  const statePath = resolveUpdateCheckStatePath();
  const state = await readState(statePath);
  const now = Date.now();

  // Hydrate from persisted state if within throttle window
  const lastCheckedAt = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : null;
  if (state.lastAvailableVersion && (shouldCheckHints || force)) {
    const comparison = compareSemver(PACKAGE_VERSION, state.lastAvailableVersion);
    if (comparison !== null && comparison < 0) {
      const cached: UpdateAvailable = {
        currentVersion: PACKAGE_VERSION,
        latestVersion: state.lastAvailableVersion,
        channel: state.lastAvailableTag ?? 'latest',
      };
      updateAvailableCache = cached;
      params.onUpdateAvailableChange?.(cached);
    }
  }

  const checkIntervalMs = resolveCheckIntervalMs(config);
  // Re-check npm when the local package version changed (e.g. after editing package.json) even within 24h.
  const shouldBypassThrottleForVersion =
    state.lastCheckPackageVersion === undefined || state.lastCheckPackageVersion !== PACKAGE_VERSION;
  if (
    !force &&
    !shouldBypassThrottleForVersion &&
    lastCheckedAt &&
    Number.isFinite(lastCheckedAt) &&
    now - lastCheckedAt < checkIntervalMs
  ) {
    return; // Within throttle window
  }

  // Install kind: auto-install only for npm global installs, but we still query npm in git
  // so the Web UI / CLI can show "newer on registry" and the top reminder bar.
  const root = await resolvePackageRoot();
  let installKind: InstallKind = 'unknown';
  if (root) {
    installKind = await detectInstallKind(root);
    if (installKind === 'git') {
      log.info('Update check: git checkout (hint-only; use git pull to update, no auto npm install)');
    }
  }

  // Query npm registry
  const channel = normalizeUpdateChannel(config.update?.channel) ?? DEFAULT_PACKAGE_CHANNEL;
  const resolved = await resolveNpmChannelTag({ channel, timeoutMs: 2500 });

  const nextState: UpdateCheckState = {
    ...state,
    lastCheckedAt: new Date(now).toISOString(),
  };

  if (!resolved.version) {
    nextState.lastCheckPackageVersion = PACKAGE_VERSION;
    await writeState(statePath, nextState);
    return;
  }

  const comparison = compareSemver(PACKAGE_VERSION, resolved.version);
  if (comparison !== null && comparison < 0) {
    // Update available
    const updateInfo: UpdateAvailable = {
      currentVersion: PACKAGE_VERSION,
      latestVersion: resolved.version,
      channel: resolved.tag,
    };

    if (shouldCheckHints || force) {
      updateAvailableCache = updateInfo;
      params.onUpdateAvailableChange?.(updateInfo);
    }

    nextState.lastAvailableVersion = resolved.version;
    nextState.lastAvailableTag = resolved.tag;

    // Log notification (once per version)
    const shouldNotify =
      state.lastNotifiedVersion !== resolved.version || state.lastNotifiedTag !== resolved.tag;
    if ((shouldCheckHints || force) && shouldNotify) {
      log.info(
        { currentVersion: PACKAGE_VERSION, latestVersion: resolved.version, tag: resolved.tag },
        `Update available (${resolved.tag}): v${resolved.version} (current v${PACKAGE_VERSION}). Run: xopc update`,
      );
      nextState.lastNotifiedVersion = resolved.version;
      nextState.lastNotifiedTag = resolved.tag;
    }

    // Auto-update logic (never from a git worktree)
    if (
      autoEnabled &&
      (channel === 'stable' || channel === 'beta') &&
      installKind !== 'git'
    ) {
      await handleAutoUpdate({
        channel,
        version: resolved.version,
        tag: resolved.tag,
        state,
        nextState,
        now,
        root,
        config,
      });
    }
  } else {
    // Current version is up to date or newer
    delete nextState.lastAvailableVersion;
    delete nextState.lastAvailableTag;
    updateAvailableCache = null;
    params.onUpdateAvailableChange?.(null);
  }

  nextState.lastCheckPackageVersion = PACKAGE_VERSION;
  await writeState(statePath, nextState);
}

async function handleAutoUpdate(params: {
  channel: 'stable' | 'beta';
  version: string;
  tag: string;
  state: UpdateCheckState;
  nextState: UpdateCheckState;
  now: number;
  root: string | null;
  config: Config;
}): Promise<void> {
  const { channel, version, tag, state, nextState, now, root, config } = params;
  const auto = config.update?.auto;
  if (!auto) return;

  const stableDelayHours = auto.stableDelayHours ?? 6;
  const stableJitterHours = auto.stableJitterHours ?? 12;
  const betaCheckIntervalHours = auto.betaCheckIntervalHours ?? 1;

  // Rate limit: don't re-attempt same version within interval
  const attemptIntervalMs =
    channel === 'beta'
      ? Math.max(ONE_HOUR_MS / 4, Math.floor(betaCheckIntervalHours * ONE_HOUR_MS))
      : ONE_HOUR_MS;
  const lastAttemptAt = state.autoLastAttemptAt ? Date.parse(state.autoLastAttemptAt) : null;
  const recentAttempt =
    state.autoLastAttemptVersion === version &&
    lastAttemptAt !== null &&
    Number.isFinite(lastAttemptAt) &&
    now - lastAttemptAt < attemptIntervalMs;

  if (recentAttempt) {
    log.info({ version, tag }, 'Auto-update deferred: recent attempt exists');
    return;
  }

  // Stable rollout delay + jitter
  if (channel === 'stable') {
    if (!nextState.autoInstallId) {
      nextState.autoInstallId = state.autoInstallId?.trim() || randomUUID();
    }
    // Track first-seen time for this version
    if (state.autoFirstSeenVersion !== version || state.autoFirstSeenTag !== tag) {
      nextState.autoFirstSeenVersion = version;
      nextState.autoFirstSeenTag = tag;
      nextState.autoFirstSeenAt = new Date(now).toISOString();
    } else {
      nextState.autoFirstSeenAt = state.autoFirstSeenAt;
    }

    const firstSeenMs = nextState.autoFirstSeenAt ? Date.parse(nextState.autoFirstSeenAt) : now;
    const baseDelayMs = Math.max(0, stableDelayHours) * ONE_HOUR_MS;
    const jitterWindowMs = Math.max(0, stableJitterHours) * ONE_HOUR_MS;
    const jitterMs = resolveStableJitterMs(nextState.autoInstallId, version, tag, jitterWindowMs);
    const applyAfterMs = firstSeenMs + baseDelayMs + jitterMs;

    if (now < applyAfterMs) {
      log.info(
        { version, tag, applyAfter: new Date(applyAfterMs).toISOString() },
        'Auto-update deferred: stable rollout window not yet due',
      );
      return;
    }
  }

  // Execute auto-update
  nextState.autoLastAttemptVersion = version;
  nextState.autoLastAttemptAt = new Date(now).toISOString();

  log.info({ channel, version, tag }, 'Starting auto-update');

  const lock = await acquireUpdateLock('auto');
  if (!lock) {
    log.info({ version, tag }, 'Auto-update skipped: another update is in progress');
    return;
  }
  try {
    const { runAutoUpdateCommand } = await import('./update-runner.js');
    const result = await runAutoUpdateCommand({ channel, root });
    if (result.ok) {
      nextState.autoLastSuccessVersion = version;
      nextState.autoLastSuccessAt = new Date(now).toISOString();
      log.info({ channel, version, tag }, 'Auto-update applied successfully');
    } else {
      log.warn(
        { channel, version, tag, exitCode: result.exitCode, reason: result.reason },
        `Auto-update attempt failed: ${result.reason ?? `exit ${result.exitCode}`}`,
      );
    }
  } catch (err) {
    log.error({ err, channel, version }, 'Auto-update command threw');
  } finally {
    await lock.release();
  }
}

/**
 * Schedule periodic update checks. Returns a cleanup function to stop the timer.
 */
export function scheduleGatewayUpdateCheck(params: {
  config: Config;
  onUpdateAvailableChange?: (update: UpdateAvailable | null) => void;
}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await runGatewayUpdateCheck(params);
    } catch (err) {
      log.warn({ err }, 'Periodic update check failed');
    }
    if (!stopped) {
      const intervalMs = resolveCheckIntervalMs(params.config);
      timer = setTimeout(() => void tick(), intervalMs);
    }
  };

  // Initial check after a short delay (don't block startup)
  timer = setTimeout(() => void tick(), 5000);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
