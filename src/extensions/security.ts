/**
 * Extension Security Module
 * 
 *  Plugin security and sandboxing.
 * Provides path safety checks, permission validation, and allowlist management.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Extension:Security');

// ============================================================================
// Types
// ============================================================================

export type ExtensionSourceOrigin = 'workspace' | 'global' | 'bundled' | 'config';

export interface SafetyCheckResult {
  safe: boolean;
  reason?: 'world_writable' | 'ownership_mismatch' | 'symlink_escape' | 'hardlink' | 'stat_failed';
  detail?: string;
}

export interface SecurityConfig {
  /** Enable security checks */
  checkPermissions: boolean;
  /** Allow loading untrusted extensions (not in allowlist) */
  allowUntrusted: boolean;
  /** List of allowed extension IDs */
  allow: string[];
  /** Enable provenance tracking */
  trackProvenance: boolean;
  /** Allow extensions to inject content into system prompts */
  allowPromptInjection: boolean;
}

// ============================================================================
// Default Security Config
// ============================================================================

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  checkPermissions: true,
  allowUntrusted: false,
  allow: [],
  trackProvenance: true,
  allowPromptInjection: false,
};

// ============================================================================
// Path Safety Checks
// ============================================================================

/**
 * Check if a path is safe for extension loading.
 * - Rejects world-writable directories (mode & 0o002)
 * - Verifies file ownership (UID match)
 * - Detects symlink escape (realpath outside root)
 * - Rejects hardlinks to non-bundled files
 */
export function checkExtensionPathSafety(
  sourcePath: string,
  rootDir: string,
  origin: ExtensionSourceOrigin,
): SafetyCheckResult {
  try {
    // 1. Symlink escape check
    const realSource = fs.realpathSync(sourcePath);
    const realRoot = fs.realpathSync(rootDir);
    
    if (!realSource.startsWith(realRoot + path.sep) && realSource !== realRoot) {
      return {
        safe: false,
        reason: 'symlink_escape',
        detail: `Real path ${realSource} escapes root directory ${realRoot}`,
      };
    }

    // 2. Skip platform-specific checks on Windows
    if (process.platform === 'win32') {
      return { safe: true };
    }

    // 3. World-writable check (only for non-bundled extensions)
    const stat = fs.statSync(sourcePath);
    
    if (origin !== 'bundled' && (stat.mode & 0o002) !== 0) {
      return {
        safe: false,
        reason: 'world_writable',
        detail: `Path ${sourcePath} is world-writable`,
      };
    }

    // 4. Ownership check (only for non-bundled extensions)
    if (origin !== 'bundled' && process.getuid) {
      const currentUid = process.getuid();
      // Allow root (uid 0) or same owner
      if (stat.uid !== currentUid && stat.uid !== 0) {
        return {
          safe: false,
          reason: 'ownership_mismatch',
          detail: `Path owned by UID ${stat.uid}, current process is UID ${currentUid}`,
        };
      }
    }

    // 5. Hardlink check (only for non-bundled extensions and regular files)
    // Skip for directories - APFS creates spurious hardlink counts due to
    // Time Machine snapshots and APFS clones, causing false positives
    if (origin !== 'bundled') {
      const sourceStat = fs.statSync(sourcePath);
      // Only check regular files, not directories
      if (sourceStat.isFile() && sourceStat.nlink > 1) {
        return {
          safe: false,
          reason: 'hardlink',
          detail: `Path ${sourcePath} is a hardlink (nlink: ${sourceStat.nlink})`,
        };
      }
    }

    return { safe: true };
  } catch (error) {
    return {
      safe: false,
      reason: 'stat_failed',
      detail: `Failed to stat path: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check all files in an extension directory recursively
 */
export function checkExtensionDirSafety(
  extensionDir: string,
  rootDir: string,
  origin: ExtensionSourceOrigin,
): { safe: boolean; issues: SafetyCheckResult[] } {
  const issues: SafetyCheckResult[] = [];
  
  if (!fs.existsSync(extensionDir)) {
    return { safe: false, issues: [{ safe: false, reason: 'stat_failed', detail: 'Directory does not exist' }] };
  }

  const walkDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isSymbolicLink()) {
        const result = checkExtensionPathSafety(fullPath, rootDir, origin);
        if (!result.safe) {
          issues.push(result);
        }
      } else if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const result = checkExtensionPathSafety(fullPath, rootDir, origin);
        if (!result.safe) {
          issues.push(result);
        }
      }
    }
  };

  walkDir(extensionDir);
  
  return {
    safe: issues.length === 0,
    issues,
  };
}

// ============================================================================
// Allowlist Management
// ============================================================================

/**
 * Check if an extension is allowed by the allowlist
 */
export function isExtensionAllowed(
  extensionId: string,
  config: SecurityConfig,
): boolean {
  // If allowlist is empty and allowUntrusted is false, only bundled extensions are allowed
  if (config.allow.length === 0 && !config.allowUntrusted) {
    return false;
  }
  
  // Check if in allowlist
  if (config.allow.includes(extensionId)) {
    return true;
  }
  
  // If allowUntrusted is true, allow anything
  return config.allowUntrusted;
}

// ============================================================================
// Provenance Tracking
// ============================================================================

export interface ProvenanceInfo {
  extensionId: string;
  source: ExtensionSourceOrigin;
  installMethod?: 'manual' | 'npm' | 'git' | 'download' | 'unknown';
  installDate?: Date;
  checksum?: string;
}

/**
 * Simple provenance tracking (in-memory for now)
 */
class ProvenanceTracker {
  private provenance = new Map<string, ProvenanceInfo>();
  
  track(extensionId: string, source: ExtensionSourceOrigin, method?: string): void {
    this.provenance.set(extensionId, {
      extensionId,
      source,
      installMethod: method as ProvenanceInfo['installMethod'],
      installDate: new Date(),
    });
  }
  
  get(extensionId: string): ProvenanceInfo | undefined {
    return this.provenance.get(extensionId);
  }
  
  getAll(): ProvenanceInfo[] {
    return Array.from(this.provenance.values());
  }
}

export const provenanceTracker = new ProvenanceTracker();

// ============================================================================
// Security Logger
// ============================================================================

export function logSecurityIssue(
  extensionId: string,
  result: SafetyCheckResult,
): void {
  if (result.reason === 'world_writable') {
    log.warn(`[Security] Extension "${extensionId}" is in world-writable directory: ${result.detail}`);
  } else if (result.reason === 'ownership_mismatch') {
    log.warn(`[Security] Extension "${extensionId}" ownership mismatch: ${result.detail}`);
  } else if (result.reason === 'symlink_escape') {
    log.error(`[Security] Extension "${extensionId}" symlink escape attempt: ${result.detail}`);
  } else if (result.reason === 'hardlink') {
    log.warn(`[Security] Extension "${extensionId}" hardlink detected: ${result.detail}`);
  }
}
