/**
 * Extension Installation Module
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
  getGlobalExtensionsDir,
  getWorkspaceExtensionsDir,
  getBundledExtensionsDir,
} from '../config/paths.js';

export interface InstallOptions {
  source: 'npm' | 'local';
  targetDir: string;
  timeoutMs?: number;
  global?: boolean;
}

export interface InstallResult {
  ok: boolean;
  extensionId?: string;
  targetDir?: string;
  origin?: 'workspace' | 'global';
  error?: string;
}

export interface ListedExtension {
  id: string;
  name?: string;
  version?: string;
  kind?: string;
  path: string;
  origin: 'workspace' | 'global' | 'bundled';
}

interface ExtensionManifest {
  id: string;
  name?: string;
  version?: string;
  main?: string;
}

/**
 * Resolve target extensions directory based on options
 */
export function resolveExtensionsDir(
  workspaceDir: string,
  global = false,
): string {
  if (global) {
    const globalDir = getGlobalExtensionsDir();
    mkdirSync(globalDir, { recursive: true });
    return globalDir;
  }
  return getWorkspaceExtensionsDir(workspaceDir);
}

/**
 * Install extension from npm package
 */
export async function installFromNpm(
  packageSpec: string,
  extensionsDir: string,
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
    return await installFromDirectory(extractDir, extensionsDir);
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
 * Install extension from local directory
 */
export async function installFromLocal(
  localPath: string,
  extensionsDir: string,
): Promise<InstallResult> {
  // Resolve to absolute path
  const sourceDir = isAbsolute(localPath) ? localPath : resolve(process.cwd(), localPath);

  if (!existsSync(sourceDir)) {
    return { ok: false, error: `Directory not found: ${sourceDir}` };
  }

  console.log(`📂 Installing from local directory: ${sourceDir}...`);

  return await installFromDirectory(sourceDir, extensionsDir);
}

/**
 * Install extension from extracted directory
 */
async function installFromDirectory(
  sourceDir: string,
  extensionsDir: string,
): Promise<InstallResult> {
  // Validate manifest
  const manifestPath = join(sourceDir, 'xopcbot.extension.json');
  const packagePath = join(sourceDir, 'package.json');

  let manifest: ExtensionManifest | null = null;
  let packageJson: { name?: string; version?: string; dependencies?: Record<string, string> } | null =
    null;

  // Try to load xopcbot.extension.json first
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
    } catch {
      return { ok: false, error: 'Invalid xopcbot.extension.json manifest file' };
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

  // Determine extension ID
  const extensionId = manifest?.id || packageJson?.name;
  if (!extensionId) {
    return {
      ok: false,
      error: 'Extension must have an id in xopcbot.extension.json or name in package.json',
    };
  }

  // Validate extension ID (no path separators)
  if (extensionId.includes('/') || extensionId.includes('\\')) {
    return { ok: false, error: 'Extension ID cannot contain path separators' };
  }

  // Check if already exists
  const targetDir = join(extensionsDir, extensionId);
  if (existsSync(targetDir)) {
    return { ok: false, error: `Extension already exists at ${targetDir}. Use update instead.` };
  }

  // Validate main entry exists
  const mainFile = manifest?.main || 'index.js';
  const mainPath = join(sourceDir, mainFile);
  if (!existsSync(mainPath)) {
    return { ok: false, error: `Main entry not found: ${mainFile}` };
  }

  console.log(`📋 Extension: ${manifest?.name || extensionId} (${extensionId})`);
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

  const origin = extensionsDir.includes('.xopcbot/extensions') ? 'global' : 'workspace';

  console.log(`✅ Extension ${extensionId} installed successfully!`);
  console.log(`\nTo enable the extension, add to your config:`);
  console.log(`  extensions:`);
  console.log(`    enabled: [${extensionId}]`);
  console.log(`    ${extensionId}:`);
  console.log(`      # your extension options here\n`);

  return { ok: true, extensionId, targetDir, origin };
}

/**
 * Remove installed extension from all tiers
 */
export function removeExtension(
  extensionId: string,
  workspaceDir: string,
): { ok: boolean; removedFrom?: string; error?: string } {
  // Try workspace first
  const workspaceDir_ = getWorkspaceExtensionsDir(workspaceDir);
  const workspaceExtension = join(workspaceDir_, extensionId);

  if (existsSync(workspaceExtension)) {
    try {
      rmSync(workspaceExtension, { recursive: true, force: true });
      return { ok: true, removedFrom: 'workspace' };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to remove from workspace: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Try global
  const globalDir = getGlobalExtensionsDir();
  const globalExtension = join(globalDir, extensionId);

  if (existsSync(globalExtension)) {
    try {
      rmSync(globalExtension, { recursive: true, force: true });
      return { ok: true, removedFrom: 'global' };
    } catch (error) {
      return {
        ok: false,
        error: `Failed to remove from global: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { ok: false, error: `Extension not found: ${extensionId}` };
}

/**
 * List installed extensions from all tiers
 */
export function listAllExtensions(workspaceDir: string): ListedExtension[] {
  const extensions: ListedExtension[] = [];
  const seen = new Set<string>();

  // Priority 1: Workspace (highest)
  const workspaceExtensionsDir = getWorkspaceExtensionsDir(workspaceDir);
  if (existsSync(workspaceExtensionsDir)) {
    for (const entry of readdirSync(workspaceExtensionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const extensionDir = join(workspaceExtensionsDir, entry.name);
      const manifest = readManifest(extensionDir);

      if (manifest) {
        seen.add(entry.name);
        extensions.push({
          id: entry.name,
          name: manifest.name,
          version: manifest.version,
          path: extensionDir,
          origin: 'workspace',
        });
      }
    }
  }

  // Priority 2: Global
  const globalDir = getGlobalExtensionsDir();
  if (existsSync(globalDir)) {
    for (const entry of readdirSync(globalDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue; // Skip if already in workspace

      const extensionDir = join(globalDir, entry.name);
      const manifest = readManifest(extensionDir);

      if (manifest) {
        seen.add(entry.name);
        extensions.push({
          id: entry.name,
          name: manifest.name,
          version: manifest.version,
          path: extensionDir,
          origin: 'global',
        });
      }
    }
  }

  // Priority 3: Bundled (lowest)
  const bundledDir = getBundledExtensionsDir();
  if (bundledDir && existsSync(bundledDir)) {
    for (const entry of readdirSync(bundledDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (seen.has(entry.name)) continue;

      const extensionDir = join(bundledDir, entry.name);
      const manifest = readManifest(extensionDir);

      if (manifest) {
        extensions.push({
          id: entry.name,
          name: manifest.name,
          version: manifest.version,
          path: extensionDir,
          origin: 'bundled',
        });
      }
    }
  }

  return extensions;
}

function readManifest(extensionDir: string): ExtensionManifest | null {
  const manifestPath = join(extensionDir, 'xopcbot.extension.json');

  if (!existsSync(manifestPath)) {
    // Try package.json
    const packagePath = join(extensionDir, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
        return {
          id: pkg.name,
          name: pkg.xopcbot?.extension?.name || pkg.name,
          version: pkg.version,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
  } catch {
    return null;
  }
}

/**
 * Legacy: List extensions from single directory (for backward compatibility)
 */
export function listExtensions(
  extensionsDir: string,
): Array<{ id: string; name?: string; version?: string; path: string }> {
  if (!existsSync(extensionsDir)) {
    return [];
  }

  const extensions: Array<{ id: string; name?: string; version?: string; path: string }> = [];

  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const extensionDir = join(extensionsDir, entry.name);
    const manifest = readManifest(extensionDir);

    extensions.push({
      id: entry.name,
      name: manifest?.name,
      version: manifest?.version,
      path: extensionDir,
    });
  }

  return extensions;
}
