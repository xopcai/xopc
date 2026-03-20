import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { createLogger } from '../../utils/logger.js';
import { resolveExtensionsLockPath, resolveExtensionsDir } from '../../config/paths.js';

const log = createLogger('ExtensionLockfile');

// ============================================
// Types
// ============================================

export type ExtensionSource = 'npm' | 'local' | 'git';

export interface ExtensionLockEntry {
  /** Extension ID */
  name: string;
  /** Installed version */
  version: string;
  /** Resolved URL or path */
  resolved: string;
  /** Integrity hash (for verification) */
  integrity?: string;
  /** Installation timestamp */
  installedAt: string;
  /** Source type */
  source: ExtensionSource;
  /** Local path (for local extensions) */
  localPath?: string;
  /** Git reference (for git extensions) */
  gitRef?: string;
  /** Dependencies */
  dependencies?: Record<string, string>;
}

export interface ExtensionsLockfile {
  version: number;
  lockfileVersion: number;
  /** Installed extensions */
  extensions: Record<string, ExtensionLockEntry>;
  /** Last updated timestamp */
  lastUpdated?: string;
}

// ============================================
// Extension Lockfile Manager
// ============================================

export class ExtensionLockfileManager {
  private readonly lockfilePath: string;

  constructor(lockfilePath?: string) {
    this.lockfilePath = lockfilePath || resolveExtensionsLockPath();
  }

  /**
   * Load the lockfile
   */
  async load(): Promise<ExtensionsLockfile> {
    if (!existsSync(this.lockfilePath)) {
      return { version: 1, lockfileVersion: 1, extensions: {} };
    }

    try {
      const content = await readFile(this.lockfilePath, 'utf-8');
      const data = JSON.parse(content);
      return {
        version: data.version || 1,
        lockfileVersion: data.lockfileVersion || 1,
        extensions: data.extensions || {},
        lastUpdated: data.lastUpdated,
      };
    } catch (error) {
      log.warn({ error }, 'Failed to load lockfile, starting fresh');
      return { version: 1, lockfileVersion: 1, extensions: {} };
    }
  }

  /**
   * Save the lockfile
   */
  async save(data: ExtensionsLockfile): Promise<void> {
    data.lastUpdated = new Date().toISOString();

    await mkdir(dirname(this.lockfilePath), { recursive: true });
    await writeFile(
      this.lockfilePath,
      JSON.stringify(data, null, 2),
      'utf-8'
    );

    log.debug('Lockfile saved');
  }

  /**
   * Add or update an extension entry
   */
  async upsert(
    extensionId: string,
    entry: Omit<ExtensionLockEntry, 'installedAt'>
  ): Promise<void> {
    const data = await this.load();

    data.extensions[extensionId] = {
      ...entry,
      installedAt: new Date().toISOString(),
    };

    await this.save(data);
    log.info({ extensionId, version: entry.version }, 'Extension locked');
  }

  /**
   * Remove an extension entry
   */
  async remove(extensionId: string): Promise<void> {
    const data = await this.load();

    if (data.extensions[extensionId]) {
      delete data.extensions[extensionId];
      await this.save(data);
      log.info({ extensionId }, 'Extension removed from lockfile');
    }
  }

  /**
   * Get a specific extension entry
   */
  async get(extensionId: string): Promise<ExtensionLockEntry | null> {
    const data = await this.load();
    return data.extensions[extensionId] || null;
  }

  /**
   * Check if an extension is locked
   */
  async has(extensionId: string): Promise<boolean> {
    const data = await this.load();
    return extensionId in data.extensions;
  }

  /**
   * List all locked extensions
   */
  async list(): Promise<ExtensionLockEntry[]> {
    const data = await this.load();
    return Object.values(data.extensions);
  }

  /**
   * Verify extension integrity
   */
  async verify(extensionId: string): Promise<{ valid: boolean; reason?: string }> {
    const entry = await this.get(extensionId);

    if (!entry) {
      return { valid: false, reason: 'Extension not in lockfile' };
    }

    const extDir = join(resolveExtensionsDir(), extensionId);

    if (!existsSync(extDir)) {
      return { valid: false, reason: 'Extension directory not found' };
    }

    // TODO: Verify integrity hash if available
    // This would require reading and hashing the extension files

    return { valid: true };
  }

  /**
   * Verify all locked extensions
   */
  async verifyAll(): Promise<
    Array<{ extensionId: string; valid: boolean; reason?: string }>
  > {
    const data = await this.load();
    const results: Array<{ extensionId: string; valid: boolean; reason?: string }> = [];

    for (const extensionId of Object.keys(data.extensions)) {
      results.push({
        extensionId,
        ...(await this.verify(extensionId)),
      });
    }

    return results;
  }

  /**
   * Freeze current state (save with validation)
   */
  async freeze(): Promise<ExtensionsLockfile> {
    const data = await this.load();

    // Validate all extensions exist
    for (const [extensionId, entry] of Object.entries(data.extensions)) {
      const extDir = join(resolveExtensionsDir(), extensionId);

      if (!existsSync(extDir)) {
        log.warn({ extensionId }, 'Extension in lockfile but not installed');
      }
    }

    data.lastUpdated = new Date().toISOString();
    await this.save(data);

    log.info('Lockfile frozen');
    return data;
  }

  /**
   * Generate integrity hash for a file
   */
  static async generateIntegrity(filePath: string): Promise<string> {
    const { readFile } = await import('fs/promises');
    const content = await readFile(filePath);
    return 'sha512-' + createHash('sha512').update(content).digest('base64');
  }
}

// ============================================
// Global Instance
// ============================================

let globalManager: ExtensionLockfileManager | undefined;

export function getExtensionLockfileManager(
  lockfilePath?: string
): ExtensionLockfileManager {
  if (!globalManager) {
    globalManager = new ExtensionLockfileManager(lockfilePath);
  }
  return globalManager;
}

export function resetExtensionLockfileManager(): void {
  globalManager = undefined;
}

// ============================================
// Convenience Functions
// ============================================

export async function loadExtensionLockfile(
  lockfilePath?: string
): Promise<ExtensionsLockfile> {
  const manager = getExtensionLockfileManager(lockfilePath);
  return manager.load();
}

export async function saveExtensionLockfile(
  data: ExtensionsLockfile,
  lockfilePath?: string
): Promise<void> {
  const manager = getExtensionLockfileManager(lockfilePath);
  return manager.save(data);
}
