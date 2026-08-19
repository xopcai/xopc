/**
 * Post-update extension sync — refresh lockfile-managed npm / store extensions.
 */

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';

import {
  downloadExtensionStoreZipBuffer,
  resolveExtensionZipDownloadUrl,
  resolveExtensionsStoreBaseUrl,
  verifyStoreArtifactSha256,
} from '../agent/skills/marketplace/adapters/store/store-api-client.js';
import type { Config } from '../config/schema.js';
import { resolveBundledExtensionsDir, resolveExtensionsDir } from '../config/paths.js';
import { loadConfig } from '../config/loader.js';
import type { UpdateChannel } from '../infra/update-channels.js';
import { createLogger } from '../utils/logger.js';
import {
  installExtensionFromStoreZip,
  installFromNpm,
  type InstallResult,
} from './install.js';
import {
  getExtensionLockfileManager,
  type ExtensionLockEntry,
} from './lockfile.js';
import * as marketplace from './marketplace.js';

const log = createLogger('ExtensionUpdate');

const MANIFEST = 'xopc.extension.json';

export type ExtensionUpdateLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type ExtensionUpdateStatus = 'updated' | 'unchanged' | 'skipped' | 'error';

export type ExtensionUpdateTask = {
  extensionId: string;
  status: ExtensionUpdateStatus;
  message: string;
  currentVersion?: string;
  nextVersion?: string;
};

export type ExtensionChannelSyncSummary = {
  skippedBundled: string[];
  warnings: string[];
};

export type ExtensionPostUpdateResult = {
  status: 'ok' | 'error' | 'skipped';
  tasks: ExtensionUpdateTask[];
  channelSync?: ExtensionChannelSyncSummary;
};

function readInstalledExtensionVersion(targetDir: string, extensionId: string): string | undefined {
  const manifestPath = join(targetDir, extensionId, MANIFEST);
  if (!existsSync(manifestPath)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { version?: string };
    const version = typeof raw.version === 'string' ? semver.valid(raw.version) : null;
    return version ?? undefined;
  } catch {
    return undefined;
  }
}

async function resolveNpmPackageForId(extensionId: string): Promise<string | undefined> {
  const found = await marketplace.findExtension(extensionId);
  return found?.npmPackage;
}

async function upsertNpmExtensionLock(
  lock: ReturnType<typeof getExtensionLockfileManager>,
  targetDir: string,
  result: InstallResult,
  spec: string,
): Promise<void> {
  if (!result.extensionId) return;
  const reg = await marketplace.findExtension(result.extensionId);
  const resolved = reg?.npmPackage ?? spec;
  let ver = reg?.version ?? '0.0.0';
  try {
    const raw = readFileSync(join(targetDir, result.extensionId, MANIFEST), 'utf-8');
    const m = JSON.parse(raw) as { version?: string };
    const mv = typeof m.version === 'string' ? semver.valid(m.version) : null;
    if (mv) ver = mv;
  } catch {
    // keep registry / fallback version
  }
  await lock.upsert(result.extensionId, {
    name: result.extensionId,
    version: ver,
    resolved,
    source: 'npm',
  });
}

async function installExtensionFromStoreWithLock(params: {
  storeBase: string;
  packageName: string;
  version?: string;
  targetDir: string;
  lock: ReturnType<typeof getExtensionLockfileManager>;
}): Promise<{ ok: true; extensionId: string; version: string } | { ok: false; error: string }> {
  try {
    const { downloadUrl, version, sha256 } = await resolveExtensionZipDownloadUrl(
      params.storeBase,
      params.packageName,
      params.version,
    );
    const buf = await downloadExtensionStoreZipBuffer(params.storeBase, downloadUrl);
    verifyStoreArtifactSha256(buf, sha256);
    const result = await installExtensionFromStoreZip(buf, params.targetDir);
    if (!result.ok || !result.extensionId) {
      return { ok: false, error: result.error ?? 'install failed' };
    }
    await params.lock.upsert(result.extensionId, {
      name: result.extensionId,
      version,
      resolved: params.packageName,
      source: 'store',
    });
    return { ok: true, extensionId: result.extensionId, version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function listBundledExtensionIds(): Set<string> {
  const ids = new Set<string>();
  const bundledDir = resolveBundledExtensionsDir();
  if (!bundledDir || !existsSync(bundledDir)) {
    return ids;
  }
  for (const entry of readdirSync(bundledDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      ids.add(entry.name);
    }
  }
  return ids;
}

export async function syncExtensionsForUpdateChannel(params: {
  channel: UpdateChannel;
  config?: Config;
  logger?: ExtensionUpdateLogger;
}): Promise<{ skipIds: Set<string>; summary: ExtensionChannelSyncSummary }> {
  const logger = params.logger ?? {};
  const summary: ExtensionChannelSyncSummary = {
    skippedBundled: [],
    warnings: [],
  };
  const skipIds = new Set<string>();

  if (params.channel !== 'dev') {
    return { skipIds, summary };
  }

  const lock = getExtensionLockfileManager();
  const data = await lock.load();
  const bundledIds = listBundledExtensionIds();

  for (const extensionId of Object.keys(data.extensions)) {
    if (!bundledIds.has(extensionId)) {
      continue;
    }
    skipIds.add(extensionId);
    summary.skippedBundled.push(extensionId);
    logger.info?.(`Skipping "${extensionId}" on dev channel (bundled copy preferred).`);
  }

  return { skipIds, summary };
}

async function updateSingleExtension(params: {
  extensionId: string;
  entry: ExtensionLockEntry;
  targetDir: string;
  storeBase: string;
  lock: ReturnType<typeof getExtensionLockfileManager>;
  timeoutMs?: number;
  logger?: ExtensionUpdateLogger;
}): Promise<ExtensionUpdateTask> {
  const { extensionId, entry, targetDir, storeBase, lock, timeoutMs, logger } = params;
  const currentVersion = readInstalledExtensionVersion(targetDir, extensionId);

  if (entry.source === 'store') {
    const pkgName = entry.resolved?.trim() || extensionId;
    if (existsSync(join(targetDir, extensionId))) {
      rmSync(join(targetDir, extensionId), { recursive: true, force: true });
    }
    const result = await installExtensionFromStoreWithLock({
      storeBase,
      packageName: pkgName,
      targetDir,
      lock,
    });
    if (result.ok === false) {
      logger.error?.(`Failed to update ${extensionId}: ${result.error}`);
      return {
        extensionId,
        status: 'error',
        message: result.error,
        currentVersion,
      };
    }
    const nextVersion = result.version;
    const status =
      currentVersion && nextVersion && currentVersion === nextVersion ? 'unchanged' : 'updated';
    return {
      extensionId,
      status,
      currentVersion,
      nextVersion,
      message:
        status === 'unchanged'
          ? `${extensionId} is up to date (${currentVersion}).`
          : `Updated ${extensionId}: ${currentVersion ?? 'unknown'} -> ${nextVersion}.`,
    };
  }

  if (entry.source !== 'npm') {
    return {
      extensionId,
      status: 'skipped',
      message: `Skipping "${extensionId}" (source: ${entry.source}).`,
    };
  }

  const spec = entry.resolved?.trim() || (await resolveNpmPackageForId(extensionId));
  if (!spec) {
    return {
      extensionId,
      status: 'skipped',
      message: `Skipping "${extensionId}" (could not resolve npm package).`,
    };
  }

  if (existsSync(join(targetDir, extensionId))) {
    rmSync(join(targetDir, extensionId), { recursive: true, force: true });
  }

  const installResult = await installFromNpm(spec, targetDir, timeoutMs);
  if (!installResult.ok) {
    const message = installResult.error ?? 'npm install failed';
    logger.error?.(`Failed to update ${extensionId}: ${message}`);
    return {
      extensionId,
      status: 'error',
      message,
      currentVersion,
    };
  }

  await upsertNpmExtensionLock(lock, targetDir, installResult, spec);
  const nextVersion =
    (installResult.extensionId
      ? readInstalledExtensionVersion(targetDir, installResult.extensionId)
      : undefined) ?? entry.version;
  const resolvedId = installResult.extensionId ?? extensionId;
  const status =
    currentVersion && nextVersion && currentVersion === nextVersion ? 'unchanged' : 'updated';
  return {
    extensionId: resolvedId,
    status,
    currentVersion,
    nextVersion,
    message:
      status === 'unchanged'
        ? `${resolvedId} is up to date (${currentVersion}).`
        : `Updated ${resolvedId}: ${currentVersion ?? 'unknown'} -> ${nextVersion}.`,
  };
}

export async function updateNpmInstalledExtensions(params: {
  extensionIds?: string[];
  skipIds?: Set<string>;
  config?: Config;
  timeoutMs?: number;
  logger?: ExtensionUpdateLogger;
}): Promise<{ tasks: ExtensionUpdateTask[]; status: 'ok' | 'error' | 'skipped' }> {
  const logger = params.logger ?? {};
  const config = params.config ?? loadConfig();
  const targetDir = resolveExtensionsDir();
  const storeBase = resolveExtensionsStoreBaseUrl(config);
  const lock = getExtensionLockfileManager();
  const data = await lock.load();

  const ids = params.extensionIds?.length
    ? params.extensionIds
    : Object.keys(data.extensions);

  if (ids.length === 0) {
    return { tasks: [], status: 'skipped' };
  }

  const tasks: ExtensionUpdateTask[] = [];
  let hasError = false;

  for (const extensionId of ids) {
    if (params.skipIds?.has(extensionId)) {
      tasks.push({
        extensionId,
        status: 'skipped',
        message: `Skipping "${extensionId}" (channel sync).`,
      });
      continue;
    }

    const entry = data.extensions[extensionId];
    if (!entry) {
      tasks.push({
        extensionId,
        status: 'skipped',
        message: `No lockfile entry for "${extensionId}".`,
      });
      continue;
    }

    const task = await updateSingleExtension({
      extensionId,
      entry,
      targetDir,
      storeBase,
      lock,
      timeoutMs: params.timeoutMs,
      logger,
    });
    tasks.push(task);
    if (task.status === 'error') {
      hasError = true;
    } else if (task.status === 'updated') {
      log.info(
        { extensionId: task.extensionId, nextVersion: task.nextVersion },
        task.message,
      );
    }
  }

  return { tasks, status: hasError ? 'error' : 'ok' };
}

export async function runPostUpdateExtensionSync(params: {
  channel: UpdateChannel;
  config?: Config;
  timeoutMs?: number;
  logger?: ExtensionUpdateLogger;
}): Promise<ExtensionPostUpdateResult> {
  const logger = params.logger ?? {
    info: (message) => log.info(message),
    warn: (message) => log.warn(message),
    error: (message) => log.error(message),
  };

  const channelSyncResult = await syncExtensionsForUpdateChannel({
    channel: params.channel,
    config: params.config,
    logger,
  });

  const updateResult = await updateNpmInstalledExtensions({
    skipIds: channelSyncResult.skipIds,
    config: params.config,
    timeoutMs: params.timeoutMs,
    logger,
  });

  return {
    status: updateResult.status,
    tasks: updateResult.tasks,
    channelSync: channelSyncResult.summary,
  };
}
