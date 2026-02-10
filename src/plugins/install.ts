/**
 * Plugin Installation Module
 * Supports installing from npm packages and local directories
 * Supports three-tier storage: workspace, global, bundled
 */

import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  cpSync,
  rmSync,
  readdirSync,
} from 'fs';
import { join, isAbsolute, resolve } from 'path';
import { tmpdir } from 'os';
import {
  getGlobalPluginsDir,
  getWorkspacePluginsDir,
  getBundledPluginsDir,
} from '../config/paths.js';

export interface InstallOptions {
  source: 'npm' | 'local';
  targetDir: string;
  timeoutMs?: number;
  global?: boolean;
}

export interface InstallResult {
  ok: boolean;
  pluginId?: string;
  targetDir?: string;
  origin?: 'workspace' | 'global';
  error?: string;
}

export interface ListedPlugin {
  id: string;
  name?: string;
  version?: string;
  kind?: string;
  path: string;
  origin: 'workspace' | 'global' | 'bundled';
}

interface PluginManifest {
  id: string;
  name?: string;
  version?: string;
  main?: string;
}

/**
 * Resolve target plugins directory based on options
 */
export function resolvePluginsDir(
  workspaceDir: string,
  global = false,
): string {
  if (global) {
    const globalDir = getGlobalPluginsDir();
    mkdirSync(globalDir, { recursive: true });
    return globalDir;
  }
  return getWorkspacePluginsDir(workspaceDir);
}

/**
 * Install plugin from npm package
 */
export async function installFromNpm(
  packageSpec: string,
  pluginsDir: string,
  timeoutMs = 120000,
): Promise<InstallResult> {
  const tmpDir = join(tmpdir(), `xopcbot-install-${Date.now()}`);

  try {
    console.log(`📦 Downloading ${packageSpec} from npm...`);

    // Create temp directory
    mkdirSync(tmpDir, { recursive: true });

    // Use npm pack to download package
    const result = execSync(`npm pack ${packageSpec} --pack-destination ${tmpDir}`, {
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const packedFile = result.trim().split('\n').pop()?.trim();
    if (!packedFile) {
      return { ok: false, error: 'Failed to download package from npm' };
    }

    const archivePath = join(tmpDir, packedFile);

    // Extract tarball
    console.log(`📂 Extracting ${packedFile}...`);
    execSync(`tar -xzf ${archivePath} -C ${tmpDir}`, {
      timeout: 30000,
      stdio: 'pipe',
    });

    // npm pack extracts to 'package' directory
    const extractDir = join(tmpDir, 'package');

    // Validate and install
    return await installFromDirectory(extractDir, pluginsDir);
  } catch (error) {
    return {
      ok: false,
      error: `Failed to install from npm: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    // Cleanup temp directory
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Install plugin from local directory
 */
export async function installFromLocal(
  localPath: string,
  pluginsDir: string,
): Promise<InstallResult> {
  // Resolve to absolute path
  const sourceDir = isAbsolute(localPath) ? localPath : resolve(process.cwd(), localPath);

  if (!existsSync(sourceDir)) {
    return { ok: false, error: `Directory not found: ${sourceDir}` };
  }

  console.log(`📂 Installing from local directory: ${sourceDir}...`);

  return await installFromDirectory(sourceDir, pluginsDir);
}

/**
 * Install plugin from extracted directory
 */
async function installFromDirectory(
  sourceDir: string,
  pluginsDir: string,
): Promise<InstallResult> {
  // Validate manifest
  const manifestPath = join(sourceDir, 'xopcbot.plugin.json');
  const packagePath = join(sourceDir, 'package.json');

  let manifest: PluginManifest | null = null;
  let packageJson: { name?: string; version?: string; dependencies?: Record<string, string> } | null =
    null;

  // Try to load xopcbot.plugin.json first
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest;
    } catch {
      return { ok: false, error: 'Invalid xopcbot.plugin.json manifest file' };
    }
  }

  // Also try package.json for metadata
  if (existsSync(packagePath)) {
    try {
      packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as typeof packageJson;
    } catch {
      // Ignore package.json parse errors
    }
  }

  // Determine plugin ID
  const pluginId = manifest?.id || packageJson?.name;
  if (!pluginId) {
    return {
      ok: false,
      error: 'Plugin must have an id in xopcbot.plugin.json or name in package.json',
    };
  }

  // Validate plugin ID (no path separators)
  if (pluginId.includes('/') || pluginId.includes('\\')) {
    return { ok: false, error: 'Plugin ID cannot contain path separators' };
  }

  // Check if already exists
  const targetDir = join(pluginsDir, pluginId);
  if (existsSync(targetDir)) {
    return { ok: false, error: `Plugin already exists at ${targetDir}. Use update instead.` };
  }

  // Validate main entry exists
  const mainFile = manifest?.main || 'index.js';
  const mainPath = join(sourceDir, mainFile);
  if (!existsSync(mainPath)) {
    return { ok: false, error: `Main entry not found: ${mainFile}` };
  }

  console.log(`📋 Plugin: ${manifest?.name || pluginId} (${pluginId})`);
  if (manifest?.version || packageJson?.version) {
    console.log(`🔖 Version: ${manifest?.version || packageJson?.version}`);
  }

  // Create target directory
  mkdirSync(targetDir, { recursive: true });

  // Copy files
  console.log(`📂 Copying files to ${targetDir}...`);
  cpSync(sourceDir, targetDir, { recursive: true, force: true });

  // Install dependencies if package.json exists and has dependencies
  if (packageJson?.dependencies && Object.keys(packageJson.dependencies).length > 0) {
    console.log(`📦 Installing dependencies...`);
    try {
      execSync('npm install --omit=dev --silent', {
        cwd: targetDir,
        timeout: 120000,
        stdio: 'inherit',
      });
    } catch (error) {
      // Clean up on failure
      rmSync(targetDir, { recursive: true, force: true });
      return {
        ok: false,
        error: `Failed to install dependencies: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const origin = pluginsDir.includes('.xopcbot/plugins') ? 'global' : 'workspace';

  console.log(`✅ Plugin ${pluginId} installed successfully!`);
  console.log(`\nTo enable the plugin, add to your config:`);
  console.log(`  plugins:`);
  console.log(`    enabled: [${pluginId}]`);
  console.log(`    ${pluginId}:`);
  console.log(`      # your plugin options here\n`);

  return { ok: true, pluginId, targetDir, origin };
}

/**
 * Remove installed plugin from all tiers
 */
export function removePlugin(
  pluginId: string,
  workspaceDir: string,
): { ok: boolean; removedFrom?: string; error?: string } {
  // Try workspace first
  const workspaceDir_ = getWorkspacePluginsDir(workspaceDir);
  const workspacePlugin = join(workspaceDir_, pluginId);

  if (existsSync(workspacePlugin)) {
    try {
      rmSync(workspacePlugin, { recursive: true, force: true });
      return { ok: true, removedFrom: 'workspace' };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to remove from workspace: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Try global
  const globalDir = getGlobalPluginsDir();
  const globalPlugin = join(globalDir, pluginId);

  if (existsSync(globalPlugin)) {
    try {
      rmSync(globalPlugin, { recursive: true, force: true });
      return { ok: true, removedFrom: 'global' };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to remove from global: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { ok: false, error: `Plugin not found: ${pluginId}` };
}

/**
 * List installed plugins from all tiers
 */
export function listAllPlugins(workspaceDir: string): ListedPlugin[] {
  const plugins: ListedPlugin[] = [];
  const seen = new Set<string>();

  // Priority 1: Workspace (highest)
  const workspacePluginsDir = getWorkspacePluginsDir(workspaceDir);
  if (existsSync(workspacePluginsDir)) {
    for (const entry of readdirSync(workspacePluginsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const pluginDir = join(workspacePluginsDir, entry.name);
      const manifest = readManifest(pluginDir);

      if (manifest) {
        seen.add(entry.name);
        plugins.push({
          id: entry.name,
          name: manifest.name,
          version: manifest.version,
          path: pluginDir,
          origin: 'workspace',
        });
      }
    }
  }

  // Priority 2: Global
  const globalDir = getGlobalPluginsDir();
  if (existsSync(globalDir)) {
    for (const entry of readdirSync(globalDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue; // Skip if already in workspace

      const pluginDir = join(globalDir, entry.name);
      const manifest = readManifest(pluginDir);

      if (manifest) {
        seen.add(entry.name);
        plugins.push({
          id: entry.name,
          name: manifest.name,
          version: manifest.version,
          path: pluginDir,
          origin: 'global',
        });
      }
    }
  }

  // Priority 3: Bundled (lowest)
  const bundledDir = getBundledPluginsDir();
  if (bundledDir && existsSync(bundledDir)) {
    for (const entry of readdirSync(bundledDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue;

      const pluginDir = join(bundledDir, entry.name);
      const manifest = readManifest(pluginDir);

      if (manifest) {
        plugins.push({
          id: entry.name,
          name: manifest.name,
          version: manifest.version,
          path: pluginDir,
          origin: 'bundled',
        });
      }
    }
  }

  return plugins;
}

function readManifest(pluginDir: string): PluginManifest | null {
  const manifestPath = join(pluginDir, 'xopcbot.plugin.json');

  if (!existsSync(manifestPath)) {
    // Try package.json
    const packagePath = join(pluginDir, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
        return {
          id: pkg.name,
          name: pkg.xopcbot?.plugin?.name || pkg.name,
          version: pkg.version,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest;
  } catch {
    return null;
  }
}

/**
 * Legacy: List plugins from single directory (for backward compatibility)
 */
export function listPlugins(
  pluginsDir: string,
): Array<{ id: string; name?: string; version?: string; path: string }> {
  if (!existsSync(pluginsDir)) {
    return [];
  }

  const plugins: Array<{ id: string; name?: string; version?: string; path: string }> = [];

  for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pluginDir = join(pluginsDir, entry.name);
    const manifest = readManifest(pluginDir);

    plugins.push({
      id: entry.name,
      name: manifest?.name,
      version: manifest?.version,
      path: pluginDir,
    });
  }

  return plugins;
}
