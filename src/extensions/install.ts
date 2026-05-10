/**
 * Extension Installation Module
 * Supports installing from npm packages, local directories, and xopc-store zips
 * Supports three-tier storage: workspace, global, bundled
 */

import { execSync } from 'child_process';
import AdmZip from 'adm-zip';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  cpSync,
  rmSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
} from 'fs';
import { dirname, join, isAbsolute, resolve, sep } from 'path';
import { tmpdir } from 'os';
import {
  resolveExtensionsDir as resolveGlobalExtensionsDir,
  resolveBundledExtensionsDir,
} from '../config/paths.js';
import { MAX_EXTENSION_STORE_ZIP_BYTES } from './store-zip-limits.js';

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

function isSafeZipPath(name: string): boolean {
  if (!name) return false;
  const normalized = name.replace(/\\/g, '/');
  if (normalized.includes('..')) return false;
  if (normalized.startsWith('/') || /^\w:/.test(normalized)) return false;
  for (const p of normalized.split('/')) {
    if (p === '..') return false;
  }
  return true;
}

function isIgnorableZipEntry(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('__MACOSX/')) return true;
  const segments = n.split('/').filter(Boolean);
  for (const s of segments) {
    if (s === '.DS_Store' || s === 'Thumbs.db' || s === 'desktop.ini') return true;
    if (s.startsWith('._')) return true;
  }
  return false;
}

function inferExtensionStripPrefix(primaryManifestPath: string): string {
  const norm = primaryManifestPath.replace(/\\/g, '/');
  const lower = norm.toLowerCase();
  const suff = 'xopc.extension.json';
  if (lower === suff) return '';
  if (!lower.endsWith(suff)) return '';
  return norm.slice(0, norm.length - suff.length);
}

/** Read `id` from the shallowest xopc.extension.json in a store zip (for --force / preflight). */
export function peekExtensionIdFromStoreZip(buffer: Buffer): string | undefined {
  if (buffer.length > MAX_EXTENSION_STORE_ZIP_BYTES) return undefined;
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return undefined;
  }
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName && !isIgnorableZipEntry(e.entryName));
  const safeEntries = entries.filter((e) => isSafeZipPath(e.entryName));
  const names = safeEntries.map((e) => e.entryName.replace(/\\/g, '/'));
  const manifestPaths = names.filter((n) => /(^|\/)xopc\.extension\.json$/i.test(n));
  const shallow = manifestPaths.filter((n) => n.split('/').filter(Boolean).length <= 2);
  if (shallow.length === 0) return undefined;
  shallow.sort((a, b) => a.length - b.length);
  const path = shallow[0];
  const entry = safeEntries.find((e) => e.entryName.replace(/\\/g, '/') === path);
  if (!entry) return undefined;
  try {
    const raw = entry.getData().toString('utf8');
    const m = JSON.parse(raw) as { id?: string };
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    if (!id || id.includes('/') || id.includes('\\')) return undefined;
    return id;
  } catch {
    return undefined;
  }
}

/**
 * Install an extension from an xopc-store zip buffer (layout: manifest at archive root
 * or under a single top-level folder).
 */
export async function installExtensionFromStoreZip(
  buffer: Buffer,
  extensionsDir: string,
): Promise<InstallResult> {
  if (buffer.length > MAX_EXTENSION_STORE_ZIP_BYTES) {
    return {
      ok: false,
      error: `Extension zip exceeds maximum size (${MAX_EXTENSION_STORE_ZIP_BYTES} bytes)`,
    };
  }

  const zip = new AdmZip(buffer);
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName && !isIgnorableZipEntry(e.entryName));
  const safeEntries = entries.filter((e) => isSafeZipPath(e.entryName));
  if (safeEntries.length === 0) {
    return { ok: false, error: 'Zip is empty or invalid' };
  }

  const names = safeEntries.map((e) => e.entryName.replace(/\\/g, '/'));
  const manifestPaths = names.filter((n) => /(^|\/)xopc\.extension\.json$/i.test(n));
  if (manifestPaths.length === 0) {
    return { ok: false, error: 'Zip must contain xopc.extension.json' };
  }
  const shallow = manifestPaths.filter((n) => n.split('/').filter(Boolean).length <= 2);
  if (shallow.length === 0) {
    return {
      ok: false,
      error:
        'xopc.extension.json is nested too deeply; use a zip with manifest at archive root or one folder (e.g. my-ext/xopc.extension.json)',
    };
  }
  shallow.sort((a, b) => a.length - b.length);
  const stripPrefix = inferExtensionStripPrefix(shallow[0]);
  if (stripPrefix) {
    const prefixNorm = stripPrefix.replace(/\\/g, '/');
    const outside = names.filter((n) => !n.startsWith(prefixNorm) && !isIgnorableZipEntry(n));
    if (outside.length > 0) {
      return {
        ok: false,
        error: `Invalid zip: expected all files under "${prefixNorm.replace(/\/$/, '')}/", but found "${outside[0]}".`,
      };
    }
  }

  const tmpRoot = mkdtempSync(join(tmpdir(), 'xopc-ext-zip-'));
  const destResolved = resolve(tmpRoot);
  try {
    for (const e of safeEntries) {
      const norm = e.entryName.replace(/\\/g, '/');
      let rel: string;
      if (stripPrefix) {
        const prefixNorm = stripPrefix.replace(/\\/g, '/');
        if (!norm.startsWith(prefixNorm)) {
          return {
            ok: false,
            error: `Zip entry outside extension prefix "${prefixNorm.replace(/\/$/, '')}": ${norm}`,
          };
        }
        rel = norm.slice(prefixNorm.length).replace(/^\//, '');
      } else {
        rel = norm;
      }
      if (!rel || rel.includes('..')) {
        return { ok: false, error: `Refusing unsafe zip entry path: ${e.entryName}` };
      }
      const targetPath = join(tmpRoot, rel);
      const resolvedTarget = resolve(targetPath);
      if (!resolvedTarget.startsWith(destResolved + sep) && resolvedTarget !== destResolved) {
        return {
          ok: false,
          error: `Refusing unsafe zip path (possible traversal): ${e.entryName}`,
        };
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, e.getData());
    }

    if (!existsSync(join(tmpRoot, 'xopc.extension.json'))) {
      return { ok: false, error: 'Extracted content is missing xopc.extension.json' };
    }

    return await installFromDirectory(tmpRoot, extensionsDir);
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * Resolve target extensions directory based on options
 */
export function resolveExtensionsDir(
  workspaceDir: string,
  global = false,
): string {
  if (global) {
    const globalDir = resolveGlobalExtensionsDir();
    mkdirSync(globalDir, { recursive: true });
    return globalDir;
  }
  return join(workspaceDir, '.extensions');
}

/**
 * Install extension from npm package
 */
export async function installFromNpm(
  packageSpec: string,
  extensionsDir: string,
  timeoutMs = 120000,
): Promise<InstallResult> {
  const tmpDir = join(tmpdir(), `xopc-install-${Date.now()}`);

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
  const manifestPath = join(sourceDir, 'xopc.extension.json');
  const packagePath = join(sourceDir, 'package.json');

  let manifest: ExtensionManifest | null = null;
  let packageJson: { name?: string; version?: string; dependencies?: Record<string, string> } | null =
    null;

  // Try to load xopc.extension.json first
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ExtensionManifest;
    } catch {
      return { ok: false, error: 'Invalid xopc.extension.json manifest file' };
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
      error: 'Extension must have an id in xopc.extension.json or name in package.json',
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

  const origin = extensionsDir.includes('.xopc/extensions') ? 'global' : 'workspace';

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
  const workspaceDir_ = join(workspaceDir, '.extensions');
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
  const globalDir = resolveGlobalExtensionsDir();
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
  const workspaceExtensionsDir = join(workspaceDir, '.extensions');
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
  const globalDir = resolveGlobalExtensionsDir();
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
  const bundledDir = resolveBundledExtensionsDir();
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
  const manifestPath = join(extensionDir, 'xopc.extension.json');

  if (!existsSync(manifestPath)) {
    // Try package.json
    const packagePath = join(extensionDir, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
        return {
          id: pkg.name,
          name: pkg.xopc?.extension?.name || pkg.name,
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
