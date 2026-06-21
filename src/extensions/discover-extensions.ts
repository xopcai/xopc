/**
 * Filesystem-only extension discovery (manifest parse, no module load).
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { resolveDefaultAgentId } from '../agent/agent-scope.js';
import type { Config } from '../config/schema.js';
import {
  resolveBundledExtensionsDir,
  resolveExtensionsDir,
  resolveWorkspaceExtensionsDir,
} from '../config/paths.js';
import { createLogger } from '../utils/logger.js';
import { normalizeExtensionManifest } from './normalize-manifest.js';
import type { ExtensionManifest } from './types/manifest.js';
import type { DiscoveredExtension } from './types/loader.js';

/** App config slice used for discovery (any loaded config shape). */
export type DiscoverConfig = Record<string, unknown>;

function asSchemaConfig(config: DiscoverConfig): Config {
  return config as Config;
}

const EXTENSION_MANIFEST_FILE = 'xopc.extension.json';

const log = createLogger('ExtensionDiscover');

export type ExtensionSourceOrigin = 'workspace' | 'global' | 'bundled' | 'config';

export interface ExtensionLoaderOptions {
  workspaceDir?: string;
  extensionsDir?: string;
  workspaceExtensionsDir?: string;
  bundledExtensions?: string[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function loadManifest(extensionPath: string): ExtensionManifest | null {
  const manifestPath = join(extensionPath, EXTENSION_MANIFEST_FILE);

  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        log.error({ manifestPath }, 'Manifest root must be a JSON object');
        return null;
      }
      return normalizeExtensionManifest(raw as Record<string, unknown>);
    } catch (error) {
      log.error({ err: error, manifestPath }, 'Failed to parse manifest');
      return null;
    }
  }

  const packagePath = join(extensionPath, 'package.json');
  if (existsSync(packagePath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));

      if (packageJson.xopc?.extension) {
        const xopcConfig = packageJson.xopc;
        return normalizeExtensionManifest({
          id: xopcConfig.id || packageJson.name,
          name: xopcConfig.name || packageJson.name,
          description: xopcConfig.description || packageJson.description,
          version: xopcConfig.version || packageJson.version || '1.0.0',
          kind: xopcConfig.kind || 'utility',
          main: xopcConfig.main || packageJson.main || 'index.js',
          configSchema: xopcConfig.configSchema,
        });
      }

      if (packageJson.name?.startsWith('xopc-extension-')) {
        const id = packageJson.name.replace('xopc-extension-', '');
        return normalizeExtensionManifest({
          id,
          name: packageJson.name,
          description: packageJson.description,
          version: packageJson.version || '1.0.0',
          kind: 'utility',
          main: packageJson.main || 'index.js',
        });
      }
    } catch (error) {
      log.error({ err: error, packagePath }, 'Failed to parse package.json');
    }
  }

  return null;
}

function discoverInDirectory(
  dir: string,
  source: ExtensionSourceOrigin,
  discovered: Map<string, DiscoveredExtension>,
): void {
  if (!existsSync(dir)) {
    return;
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const extensionPath = join(dir, entry);

    try {
      if (!existsSync(extensionPath)) continue;
    } catch {
      continue;
    }

    const manifest = loadManifest(extensionPath);
    if (!manifest) continue;

    const extensionId = manifest.id || entry;

    const existing = discovered.get(extensionId);
    if (existing) {
      const priority = { workspace: 3, global: 2, bundled: 1, config: 0 };
      if (priority[source] <= priority[existing.source]) {
        log.debug(
          { extensionId, from: source, existing: existing.source },
          'Skipping lower priority extension',
        );
        continue;
      }
      log.info(
        { extensionId, from: source, overriding: existing.source },
        'Extension override by higher priority source',
      );
    }

    discovered.set(extensionId, {
      id: extensionId,
      path: extensionPath,
      source,
      manifest,
    });
  }
}

function resolveDiscoveryPaths(
  options: ExtensionLoaderOptions,
  config?: DiscoverConfig,
): {
  bundledDir: string | null;
  globalDir: string;
  workspaceExtensionsDir: string | null;
} {
  const cfg = config ? asSchemaConfig(config) : null;
  const aid = cfg ? resolveDefaultAgentId(cfg) : null;

  return {
    bundledDir: resolveBundledExtensionsDir(),
    globalDir: options.extensionsDir ?? resolveExtensionsDir(),
    workspaceExtensionsDir:
      options.workspaceExtensionsDir ??
      (cfg && aid ? resolveWorkspaceExtensionsDir(cfg, aid) : null),
  };
}

/**
 * Discover extensions from workspace, global, and bundled tiers without loading code.
 */
export function discoverExtensionsFromDisk(
  options: ExtensionLoaderOptions = {},
  config?: DiscoverConfig,
): DiscoveredExtension[] {
  const discovered = new Map<string, DiscoveredExtension>();
  const paths = resolveDiscoveryPaths(options, config);

  if (paths.bundledDir) {
    discoverInDirectory(paths.bundledDir, 'bundled', discovered);
  }

  // Electron ships self-contained extension bundles. Do not let stale user/global source
  // extensions override those packaged manifests.
  if (process.env.XOPC_BUNDLED_EXTENSIONS_ROOT || paths.bundledDir?.includes(`${join('dist', 'electron', 'extensions')}`)) {
    return Array.from(discovered.values());
  }

  discoverInDirectory(paths.globalDir, 'global', discovered);
  if (paths.workspaceExtensionsDir) {
    discoverInDirectory(paths.workspaceExtensionsDir, 'workspace', discovered);
  }

  return Array.from(discovered.values());
}

/** True when extension discovery/load should be skipped entirely. */
export function areExtensionsGloballyDisabled(config?: DiscoverConfig): boolean {
  if (
    process.env.XOPC_SKIP_EXTENSIONS === '1' ||
    process.env.XOPC_SKIP_EXTENSIONS === 'true'
  ) {
    return true;
  }

  const ext =
    config && isRecord(config) && isRecord((config as Record<string, unknown>).extensions)
      ? ((config as Record<string, unknown>).extensions as Record<string, unknown>)
      : undefined;

  return ext?.enabled === false;
}
