/**
 * Skill Security Scanner
 * 
 * Scans skill directories for potentially dangerous code patterns.
 * Inspired by openclaw's skill-scanner.ts
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('SkillScanner');

export type Severity = 'critical' | 'warning' | 'info';

export interface SecurityFinding {
  severity: Severity;
  message: string;
  file: string;
  line: number;
  pattern?: string;
}

export interface ScanSummary {
  critical: number;
  warn: number;
  info: number;
  findings: SecurityFinding[];
}

/**
 * Patterns that indicate potentially dangerous code
 */
const CRITICAL_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\bexec\s*\(/g,
    message: 'Direct command execution (exec)',
  },
  {
    pattern: /\bchild_process\.exec/g,
    message: 'child_process.exec usage',
  },
  {
    pattern: /\beval\s*\(/g,
    message: 'Dynamic code evaluation (eval)',
  },
  {
    pattern: /\bFunction\s*\(/g,
    message: 'Dynamic function creation',
  },
  {
    pattern: /require\s*\(['"]child_process['"]\)/g,
    message: 'child_process module import',
  },
  {
    pattern: /require\s*\(['"]fs['"]\)/g,
    message: 'fs module import (file system access)',
  },
  {
    pattern: /\bfs\.writeFile/g,
    message: 'File write operation',
  },
  {
    pattern: /\bfs\.unlink/g,
    message: 'File deletion operation',
  },
  {
    pattern: /\bfs\.rm/g,
    message: 'File/directory removal operation',
  },
  {
    pattern: /net\.createServer/g,
    message: 'Network server creation',
  },
  {
    pattern: /http\.createServer/g,
    message: 'HTTP server creation',
  },
  {
    pattern: /\bfetch\s*\(/g,
    message: 'Network request (fetch)',
  },
  {
    pattern: /axios\./g,
    message: 'Network request (axios)',
  },
];

const WARNING_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /process\.env/g,
    message: 'Environment variable access',
  },
  {
    pattern: /process\.cwd/g,
    message: 'Current working directory access',
  },
  {
    pattern: /process\.argv/g,
    message: 'Command line argument access',
  },
  {
    pattern: /\bconsole\./g,
    message: 'Console output',
  },
  {
    pattern: /setTimeout\s*\(/g,
    message: 'Timer usage (setTimeout)',
  },
  {
    pattern: /setInterval\s*\(/g,
    message: 'Interval usage (setInterval)',
  },
  {
    pattern: /__dirname/g,
    message: 'Directory name reference',
  },
  {
    pattern: /__filename/g,
    message: 'Filename reference',
  },
];

/**
 * File extensions to scan
 */
const SCAN_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx'];

/**
 * Directories to skip
 */
const SKIP_DIRECTORIES = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt'];

/**
 * Scan a single file for security patterns
 */
async function scanFile(filePath: string, _rootDir: string): Promise<SecurityFinding[]> {
  const findings: SecurityFinding[] = [];
  
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Scan for critical patterns
    for (const { pattern, message } of CRITICAL_PATTERNS) {
      pattern.lastIndex = 0; // Reset regex state
      
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const match = pattern.exec(line);
        
        if (match) {
          findings.push({
            severity: 'critical',
            message,
            file: filePath,
            line: lineNum + 1,
            pattern: match[0],
          });
        }
      }
    }

    // Scan for warning patterns
    for (const { pattern, message } of WARNING_PATTERNS) {
      pattern.lastIndex = 0;
      
      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        const match = pattern.exec(line);
        
        if (match) {
          findings.push({
            severity: 'warning',
            message,
            file: filePath,
            line: lineNum + 1,
            pattern: match[0],
          });
        }
      }
    }
  } catch (err) {
    log.warn({ file: filePath, error: err }, 'Failed to scan file');
  }

  return findings;
}

/**
 * Recursively scan a directory
 */
async function scanDirectoryRecursive(
  dir: string,
  rootDir: string,
  findings: SecurityFinding[]
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith('.')) {
        continue;
      }

      // Skip common build directories
      if (entry.isDirectory() && SKIP_DIRECTORIES.includes(entry.name)) {
        continue;
      }

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await scanDirectoryRecursive(fullPath, rootDir, findings);
      } else if (entry.isFile()) {
        // Check if file has a scannable extension
        const ext = entry.name.slice(entry.name.lastIndexOf('.'));
        if (SCAN_EXTENSIONS.includes(ext)) {
          const fileFindings = await scanFile(fullPath, rootDir);
          findings.push(...fileFindings);
        }
      }
    }
  } catch (err) {
    log.warn({ dir, error: err }, 'Failed to scan directory');
  }
}

/**
 * Scan a skill directory for security issues
 */
export async function scanSkillDirectory(skillDir: string): Promise<ScanSummary> {
  log.info({ skillDir }, 'Scanning skill for security issues');

  const findings: SecurityFinding[] = [];
  await scanDirectoryRecursive(skillDir, skillDir, findings);

  const summary: ScanSummary = {
    critical: findings.filter(f => f.severity === 'critical').length,
    warn: findings.filter(f => f.severity === 'warning').length,
    info: findings.filter(f => f.severity === 'info').length,
    findings,
  };

  if (summary.critical > 0) {
    log.warn({ skillDir, critical: summary.critical }, 'Skill has critical security findings');
  } else if (summary.warn > 0) {
    log.info({ skillDir, warnings: summary.warn }, 'Skill has security warnings');
  } else {
    log.info({ skillDir }, 'Skill passed security scan');
  }

  return summary;
}

/**
 * Format security findings for display
 */
export function formatScanSummary(summary: ScanSummary, skillName: string): string {
  const lines: string[] = [];

  lines.push(`Security scan results for "${skillName}":`);
  lines.push(`  Critical: ${summary.critical}`);
  lines.push(`  Warnings: ${summary.warn}`);
  lines.push(`  Info: ${summary.info}`);

  if (summary.findings.length > 0) {
    lines.push('');
    lines.push('Findings:');

    // Show critical findings first
    const criticalFindings = summary.findings.filter(f => f.severity === 'critical');
    for (const finding of criticalFindings) {
      lines.push(`  ❌ ${finding.message} at line ${finding.line}`);
    }

    // Show warnings
    const warningFindings = summary.findings.filter(f => f.severity === 'warning');
    for (const finding of warningFindings) {
      lines.push(`  ⚠️  ${finding.message} at line ${finding.line}`);
    }
  }

  return lines.join('\n');
}

/**
 * Collect security warnings for a skill installation
 */
export async function collectSkillInstallWarnings(skillDir: string, skillName: string): Promise<string[]> {
  const warnings: string[] = [];

  try {
    const summary = await scanSkillDirectory(skillDir);

    if (summary.critical > 0) {
      const criticalDetails = summary.findings
        .filter(f => f.severity === 'critical')
        .map(f => `${f.message} (line ${f.line})`)
        .join('; ');

      warnings.push(
        `WARNING: Skill "${skillName}" contains dangerous code patterns: ${criticalDetails}`
      );
    } else if (summary.warn > 0) {
      warnings.push(
        `Skill "${skillName}" has ${summary.warn} suspicious code pattern(s). ` +
        `Run "xopcbot security audit --deep" for details.`
      );
    }
  } catch (err) {
    warnings.push(
      `Skill "${skillName}" code safety scan failed (${String(err)}). ` +
      `Installation continues; run "xopcbot security audit --deep" after install.`
    );
  }

  return warnings;
}
