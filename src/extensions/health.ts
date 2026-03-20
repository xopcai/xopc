import { existsSync } from 'fs';
import { readFile, readdir, access } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import { resolveExtensionsDir } from '../../config/paths.js';
import { getExtensionLockfileManager } from './lockfile.js';

const log = createLogger('ExtensionHealth');

// ============================================
// Types
// ============================================

export type HealthStatus = 'healthy' | 'warning' | 'error';

export interface ExtensionHealth {
  /** Extension ID */
  extensionId: string;
  /** Overall health status */
  status: HealthStatus;
  /** Installed version */
  version?: string;
  /** Expected version from lockfile */
  expectedVersion?: string;
  /** List of issues */
  issues: string[];
  /** Last check timestamp */
  checkedAt: string;
}

export interface HealthReport {
  /** Overall status */
  status: HealthStatus;
  /** Per-extension health */
  extensions: ExtensionHealth[];
  /** Summary counts */
  summary: {
    total: number;
    healthy: number;
    warning: number;
    error: number;
  };
  /** Check timestamp */
  checkedAt: string;
}

// ============================================
// Extension Health Checker
// ============================================

export class ExtensionHealthChecker {
  private readonly extensionsDir: string;

  constructor(extensionsDir?: string) {
    this.extensionsDir = extensionsDir || resolveExtensionsDir();
  }

  /**
   * Check health of a single extension
   */
  async checkExtension(extensionId: string): Promise<ExtensionHealth> {
    const extDir = join(this.extensionsDir, extensionId);
    const issues: string[] = [];
    let status: HealthStatus = 'healthy';

    // Check if directory exists
    if (!existsSync(extDir)) {
      return {
        extensionId,
        status: 'error',
        issues: ['Extension directory not found'],
        checkedAt: new Date().toISOString(),
      };
    }

    // Check required files
    const requiredFiles = ['package.json', 'xopcbot.extension.json'];
    for (const file of requiredFiles) {
      const filePath = join(extDir, file);
      if (!existsSync(filePath)) {
        issues.push(`Missing required file: ${file}`);
        status = 'error';
      }
    }

    // Check if node_modules exists
    const nodeModulesPath = join(extDir, 'node_modules');
    if (!existsSync(nodeModulesPath)) {
      issues.push('node_modules not found (run npm install)');
      status = status === 'error' ? 'error' : 'warning';
    }

    // Load and validate package.json
    let version: string | undefined;
    try {
      const pkgPath = join(extDir, 'package.json');
      const pkgContent = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      version = pkg.version;

      // Check for required fields
      if (!pkg.name) {
        issues.push('package.json missing name field');
        status = 'error';
      }
      if (!pkg.version) {
        issues.push('package.json missing version field');
        status = 'error';
      }
      if (!pkg.main && !pkg.exports) {
        issues.push('package.json missing main or exports field');
        status = 'warning';
      }
    } catch (error) {
      issues.push('Failed to parse package.json');
      status = 'error';
    }

    // Load and validate xopcbot.extension.json
    try {
      const extConfigPath = join(extDir, 'xopcbot.extension.json');
      if (existsSync(extConfigPath)) {
        const extContent = await readFile(extConfigPath, 'utf-8');
        const extConfig = JSON.parse(extContent);

        if (!extConfig.id) {
          issues.push('xopcbot.extension.json missing id field');
          status = 'error';
        }
        if (!extConfig.name) {
          issues.push('xopcbot.extension.json missing name field');
          status = 'warning';
        }
        if (!extConfig.version) {
          issues.push('xopcbot.extension.json missing version field');
          status = 'warning';
        }
      }
    } catch (error) {
      issues.push('Failed to parse xopcbot.extension.json');
      status = status === 'error' ? 'error' : 'warning';
    }

    // Check against lockfile
    const lockfileManager = getExtensionLockfileManager();
    const lockEntry = await lockfileManager.get(extensionId);

    if (lockEntry) {
      if (version && version !== lockEntry.version) {
        issues.push(
          `Version mismatch: installed ${version}, expected ${lockEntry.version}`
        );
        status = 'warning';
      }
    }

    return {
      extensionId,
      status,
      version,
      expectedVersion: lockEntry?.version,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Check health of all extensions
   */
  async checkAll(): Promise<HealthReport> {
    const extensions: ExtensionHealth[] = [];

    if (!existsSync(this.extensionsDir)) {
      return {
        status: 'healthy',
        extensions: [],
        summary: { total: 0, healthy: 0, warning: 0, error: 0 },
        checkedAt: new Date().toISOString(),
      };
    }

    const entries = await readdir(this.extensionsDir, { withFileTypes: true });
    const extensionDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));

    for (const dir of extensionDirs) {
      const health = await this.checkExtension(dir.name);
      extensions.push(health);
    }

    // Calculate summary
    const summary = {
      total: extensions.length,
      healthy: extensions.filter((e) => e.status === 'healthy').length,
      warning: extensions.filter((e) => e.status === 'warning').length,
      error: extensions.filter((e) => e.status === 'error').length,
    };

    // Determine overall status
    let status: HealthStatus = 'healthy';
    if (summary.error > 0) {
      status = 'error';
    } else if (summary.warning > 0) {
      status = 'warning';
    }

    return {
      status,
      extensions,
      summary,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Fix common issues automatically
   */
  async fixIssues(extensionId: string): Promise<{ fixed: string[]; failed: string[] }> {
    const fixed: string[] = [];
    const failed: string[] = [];

    const health = await this.checkExtension(extensionId);
    const extDir = join(this.extensionsDir, extensionId);

    for (const issue of health.issues) {
      // Try to fix missing node_modules
      if (issue.includes('node_modules not found')) {
        try {
          const { spawn } = await import('child_process');
          const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

          await new Promise<void>((resolve, reject) => {
            const proc = spawn(npm, ['install'], {
              cwd: extDir,
              stdio: 'pipe',
            });

            proc.on('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error(`npm install exited with code ${code}`));
            });

            proc.on('error', reject);
          });

          fixed.push('Installed node_modules');
        } catch (error) {
          failed.push('Failed to install node_modules');
        }
      }

      // Other auto-fixes can be added here
    }

    return { fixed, failed };
  }

  /**
   * Check for orphaned extensions (not in lockfile)
   */
  async findOrphaned(): Promise<string[]> {
    if (!existsSync(this.extensionsDir)) {
      return [];
    }

    const entries = await readdir(this.extensionsDir, { withFileTypes: true });
    const extensionDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));

    const lockfileManager = getExtensionLockfileManager();
    const orphaned: string[] = [];

    for (const dir of extensionDirs) {
      const isLocked = await lockfileManager.has(dir.name);
      if (!isLocked) {
        orphaned.push(dir.name);
      }
    }

    return orphaned;
  }

  /**
   * Generate health report as string
   */
  formatReport(report: HealthReport): string {
    const lines: string[] = [];

    lines.push('Extension Health Report');
    lines.push('='.repeat(50));
    lines.push('');

    lines.push(`Status: ${report.status.toUpperCase()}`);
    lines.push(`Checked: ${new Date(report.checkedAt).toLocaleString()}`);
    lines.push('');

    lines.push('Summary:');
    lines.push(`  Total:     ${report.summary.total}`);
    lines.push(`  Healthy:   ${report.summary.healthy} ✓`);
    lines.push(`  Warning:   ${report.summary.warning} ⚠`);
    lines.push(`  Error:     ${report.summary.error} ✗`);
    lines.push('');

    if (report.extensions.length > 0) {
      lines.push('Details:');
      for (const ext of report.extensions) {
        const icon =
          ext.status === 'healthy' ? '✓' : ext.status === 'warning' ? '⚠' : '✗';
        lines.push(`  ${icon} ${ext.extensionId}`);

        if (ext.version) {
          lines.push(`     Version: ${ext.version}`);
        }

        for (const issue of ext.issues) {
          lines.push(`     - ${issue}`);
        }
      }
    }

    return lines.join('\n');
  }
}

// ============================================
// Global Instance
// ============================================

let globalChecker: ExtensionHealthChecker | undefined;

export function getExtensionHealthChecker(
  extensionsDir?: string
): ExtensionHealthChecker {
  if (!globalChecker) {
    globalChecker = new ExtensionHealthChecker(extensionsDir);
  }
  return globalChecker;
}

export function resetExtensionHealthChecker(): void {
  globalChecker = undefined;
}

// ============================================
// Convenience Functions
// ============================================

export async function checkExtensionHealth(
  extensionId: string
): Promise<ExtensionHealth> {
  const checker = getExtensionHealthChecker();
  return checker.checkExtension(extensionId);
}

export async function checkAllExtensionsHealth(): Promise<HealthReport> {
  const checker = getExtensionHealthChecker();
  return checker.checkAll();
}
