/**
 * Skill Test Framework
 * 
 * Comprehensive testing framework for skills.
 * Validates SKILL.md format, dependencies, security, and examples.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { createLogger } from '../../utils/logger.js';
import { parseFrontmatter } from '../../utils/frontmatter.js';
import { scanSkillDirectory } from './scanner.js';
import { hasBinary } from './installer.js';
import type { SkillMetadata, SkillInstallSpec } from './types.js';

const log = createLogger('SkillTestFramework');

// ============================================================================
// Test Result Types
// ============================================================================

export type TestStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface TestResult {
  name: string;
  status: TestStatus;
  message?: string;
  details?: string[];
  duration?: number;
}

export interface SkillTestReport {
  skillName: string;
  skillPath: string;
  timestamp: number;
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
  passed: boolean;
}

export interface TestOptions {
  /** Skip security tests */
  skipSecurity?: boolean;
  /** Skip dependency tests */
  skipDeps?: boolean;
  /** Skip example tests */
  skipExamples?: boolean;
  /** Strict mode - fail on warnings */
  strict?: boolean;
  /** Timeout for example tests (ms) */
  exampleTimeout?: number;
  /** Working directory for example tests */
  cwd?: string;
}

// ============================================================================
// Test Framework Core
// ============================================================================

export class SkillTestFramework {
  private options: TestOptions;

  constructor(options: TestOptions = {}) {
    this.options = {
      skipSecurity: false,
      skipDeps: false,
      skipExamples: false,
      strict: false,
      exampleTimeout: 10000,
      cwd: process.cwd(),
      ...options,
    };
  }

  /**
   * Run all tests for a skill
   */
  async testSkill(skillDir: string): Promise<SkillTestReport> {
    const results: TestResult[] = [];

    log.info({ skillDir }, 'Testing skill');

    // Validate skill directory
    if (!existsSync(skillDir)) {
      return this.createFailureReport(skillDir, 'Skill directory not found');
    }

    const skillMdPath = join(skillDir, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
      return this.createFailureReport(skillDir, 'SKILL.md not found');
    }

    // Parse SKILL.md
    const parseResult = this.testSkillMdFormat(skillMdPath);
    results.push(parseResult);

    if (parseResult.status === 'fail') {
      return this.createReport(skillDir, results);
    }

    const { frontmatter } = parseFrontmatter(readFileSync(skillMdPath, 'utf-8'));
    const metadata = this.extractMetadata(frontmatter);

    // Run dependency tests
    if (!this.options.skipDeps) {
      const depsResult = await this.testDependencies(metadata);
      results.push(depsResult);
    }

    // Run security tests
    if (!this.options.skipSecurity) {
      const securityResult = await this.testSecurity(skillDir);
      results.push(securityResult);
    }

    // Run metadata tests
    const metadataResult = this.testMetadata(metadata, skillDir);
    results.push(metadataResult);

    // Run example tests
    if (!this.options.skipExamples) {
      const content = readFileSync(skillMdPath, 'utf-8');
      const examplesResult = await this.testExamples(content, skillDir);
      results.push(examplesResult);
    }

    return this.createReport(skillDir, results);
  }

  /**
   * Test SKILL.md format
   */
  testSkillMdFormat(filePath: string): TestResult {
    const startTime = Date.now();
    const details: string[] = [];

    try {
      const content = readFileSync(filePath, 'utf-8');

      // Check for frontmatter
      if (!content.startsWith('---')) {
        return {
          name: 'SKILL.md format',
          status: 'fail',
          message: 'Missing YAML frontmatter',
          duration: Date.now() - startTime,
        };
      }

      const { frontmatter } = parseFrontmatter(content);

      // Required fields
      const requiredFields = ['name', 'description'];
      for (const field of requiredFields) {
        if (!frontmatter[field]) {
          details.push(`Missing required field: ${field}`);
        }
      }

      if (details.length > 0) {
        return {
          name: 'SKILL.md format',
          status: 'fail',
          message: 'Missing required frontmatter fields',
          details,
          duration: Date.now() - startTime,
        };
      }

      // Validate field types
      if (typeof frontmatter.name !== 'string') {
        return {
          name: 'SKILL.md format',
          status: 'fail',
          message: 'Field "name" must be a string',
          duration: Date.now() - startTime,
        };
      }

      if (typeof frontmatter.description !== 'string') {
        return {
          name: 'SKILL.md format',
          status: 'fail',
          message: 'Field "description" must be a string',
          duration: Date.now() - startTime,
        };
      }

      // Check for content after frontmatter
      const { content: bodyContent } = parseFrontmatter(content);
      if (!bodyContent || bodyContent.length < 10) {
        return {
          name: 'SKILL.md format',
          status: 'warn',
          message: 'SKILL.md body is too short',
          details: ['Consider adding more detailed documentation'],
          duration: Date.now() - startTime,
        };
      }

      return {
        name: 'SKILL.md format',
        status: 'pass',
        message: 'Valid SKILL.md format',
        duration: Date.now() - startTime,
      };
    } catch (err) {
      return {
        name: 'SKILL.md format',
        status: 'fail',
        message: err instanceof Error ? err.message : 'Failed to parse SKILL.md',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Test dependencies
   */
  async testDependencies(metadata: SkillMetadata): Promise<TestResult> {
    const startTime = Date.now();
    const details: string[] = [];
    let hasWarnings = false;
    let hasFailures = false;

    const requires = metadata.requires || metadata.openclaw?.requires;

    if (!requires) {
      return {
        name: 'Dependencies',
        status: 'skip',
        message: 'No dependencies declared',
        duration: Date.now() - startTime,
      };
    }

    // Check required binaries
    if (requires.bins) {
      for (const bin of requires.bins) {
        const available = hasBinary(bin);
        if (!available) {
          details.push(`Missing required binary: ${bin}`);
          hasFailures = true;
        } else {
          details.push(`Found binary: ${bin}`);
        }
      }
    }

    // Check anyBins (OR condition)
    if (requires.anyBins) {
      const hasAny = requires.anyBins.some(bin => hasBinary(bin));
      if (!hasAny) {
        details.push(`Missing binaries (need one of): ${requires.anyBins.join(', ')}`);
        hasFailures = true;
      } else {
        details.push(`Found at least one binary from: ${requires.anyBins.join(', ')}`);
      }
    }

    // Check install specs
    const installSpecs = metadata.install || metadata.openclaw?.install;
    if (installSpecs && installSpecs.length > 0) {
      details.push(`Available installers: ${installSpecs.map(s => s.kind).join(', ')}`);
      
      // Validate install specs
      for (const spec of installSpecs) {
        const installCheck = this.validateInstallSpec(spec);
        if (installCheck.status === 'fail') {
          details.push(installCheck.message);
          hasWarnings = true;
        }
      }
    }

    return {
      name: 'Dependencies',
      status: hasFailures ? 'fail' : hasWarnings ? 'warn' : 'pass',
      message: hasFailures ? 'Missing dependencies' : hasWarnings ? 'Dependency warnings' : 'All dependencies satisfied',
      details,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Test security
   */
  async testSecurity(skillDir: string): Promise<TestResult> {
    const startTime = Date.now();

    try {
      const summary = await scanSkillDirectory(skillDir);

      const details: string[] = [
        `Critical: ${summary.critical}`,
        `Warnings: ${summary.warn}`,
        `Info: ${summary.info}`,
      ];

      if (summary.critical > 0) {
        return {
          name: 'Security',
          status: 'fail',
          message: 'Critical security issues found',
          details: [
            ...details,
            ...summary.findings
              .filter(f => f.severity === 'critical')
              .map(f => `${f.message} at ${relative(skillDir, f.file)}:${f.line}`),
          ],
          duration: Date.now() - startTime,
        };
      }

      if (summary.warn > 0) {
        return {
          name: 'Security',
          status: 'warn',
          message: 'Security warnings found',
          details: [
            ...details,
            ...summary.findings
              .filter(f => f.severity === 'warning')
              .map(f => `${f.message} at ${relative(skillDir, f.file)}:${f.line}`),
          ],
          duration: Date.now() - startTime,
        };
      }

      return {
        name: 'Security',
        status: 'pass',
        message: 'No security issues',
        details,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      return {
        name: 'Security',
        status: 'fail',
        message: err instanceof Error ? err.message : 'Security scan failed',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Test metadata
   */
  testMetadata(metadata: SkillMetadata, _skillDir: string): TestResult {
    const startTime = Date.now();
    const details: string[] = [];
    let hasWarnings = false;

    // Check for emoji
    const emoji = metadata.emoji || metadata.openclaw?.emoji;
    if (emoji) {
      details.push(`Emoji: ${emoji}`);
    } else {
      details.push('No emoji defined (recommended)');
      hasWarnings = true;
    }

    // Check for homepage
    if (metadata.homepage) {
      details.push(`Homepage: ${metadata.homepage}`);
    } else {
      details.push('No homepage defined (recommended)');
      hasWarnings = true;
    }

    // Check for OS restrictions
    if (metadata.os || metadata.openclaw?.os) {
      const os = metadata.os || metadata.openclaw?.os;
      details.push(`Supported OS: ${os?.join(', ')}`);
    }

    // Check for install specs
    const installSpecs = metadata.install || metadata.openclaw?.install;
    if (installSpecs && installSpecs.length > 0) {
      details.push(`Installers: ${installSpecs.length} defined`);
    }

    return {
      name: 'Metadata',
      status: hasWarnings ? 'warn' : 'pass',
      message: hasWarnings ? 'Metadata could be improved' : 'Complete metadata',
      details,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Test code examples
   */
  async testExamples(content: string, _skillDir: string): Promise<TestResult> {
    const startTime = Date.now();
    const details: string[] = [];
    let hasFailures = false;

    // Extract code blocks
    const codeBlocks = this.extractCodeBlocks(content);
    
    if (codeBlocks.length === 0) {
      return {
        name: 'Examples',
        status: 'warn',
        message: 'No code examples found',
        details: ['Consider adding usage examples'],
        duration: Date.now() - startTime,
      };
    }

    details.push(`Found ${codeBlocks.length} code block(s)`);

    // Test shell command examples (basic validation)
    const shellCommands = codeBlocks.filter(block => {
      const lang = block.language?.toLowerCase();
      return lang === 'bash' || lang === 'sh' || lang === 'shell';
    });

    if (shellCommands.length > 0) {
      details.push(`Shell examples: ${shellCommands.length}`);
      
      // Validate command syntax (basic check)
      for (const cmd of shellCommands) {
        const syntaxCheck = this.validateShellSyntax(cmd.code);
        if (!syntaxCheck.valid) {
          details.push(`Invalid syntax: ${syntaxCheck.error}`);
          hasFailures = true;
        }
      }
    }

    return {
      name: 'Examples',
      status: hasFailures ? 'fail' : 'pass',
      message: hasFailures ? 'Invalid examples found' : 'Examples validated',
      details,
      duration: Date.now() - startTime,
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private extractMetadata(frontmatter: Record<string, unknown>): SkillMetadata {
    const metadata: SkillMetadata = {
      name: frontmatter.name as string || '',
      description: frontmatter.description as string || '',
      emoji: frontmatter.emoji as string || undefined,
      homepage: frontmatter.homepage as string || undefined,
      os: frontmatter.os as Array<'darwin' | 'linux' | 'win32'> || undefined,
      requires: frontmatter.requires as SkillMetadata['requires'] || undefined,
      install: frontmatter.install as SkillInstallSpec[] || undefined,
    };

    // Support openclaw-compatible nested metadata
    const openclawMeta = frontmatter.metadata as Record<string, unknown> | undefined;
    if (openclawMeta?.openclaw) {
      const oc = openclawMeta.openclaw as Record<string, unknown>;
      metadata.openclaw = {
        emoji: oc.emoji as string || undefined,
        requires: oc.requires as SkillMetadata['requires'] || undefined,
        install: oc.install as SkillInstallSpec[] || undefined,
        os: oc.os as Array<'darwin' | 'linux' | 'win32'> || undefined,
      };
    }

    return metadata;
  }

  private validateInstallSpec(spec: SkillInstallSpec): TestResult {
    switch (spec.kind) {
      case 'brew':
        if (!spec.formula) {
          return {
            name: 'Install spec',
            status: 'fail',
            message: 'Brew installer missing "formula" field',
          };
        }
        break;
      case 'pnpm':
      case 'npm':
      case 'yarn':
      case 'bun':
        if (!spec.package) {
          return {
            name: 'Install spec',
            status: 'fail',
            message: 'Node installer missing "package" field',
          };
        }
        break;
      case 'go':
        if (!spec.module) {
          return {
            name: 'Install spec',
            status: 'fail',
            message: 'Go installer missing "module" field',
          };
        }
        break;
      case 'uv':
        if (!spec.package) {
          return {
            name: 'Install spec',
            status: 'fail',
            message: 'UV installer missing "package" field',
          };
        }
        break;
    }
    return { name: 'Install spec', status: 'pass' };
  }

  private extractCodeBlocks(content: string): Array<{ language: string; code: string }> {
    const blocks: Array<{ language: string; code: string }> = [];
    const regex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      blocks.push({
        language: match[1] || 'text',
        code: match[2].trim(),
      });
    }

    return blocks;
  }

  private validateShellSyntax(code: string): { valid: boolean; error?: string } {
    // Basic validation - check for common syntax errors
    const lines = code.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
    
    for (const line of lines) {
      // Check for unclosed quotes
      const singleQuotes = (line.match(/'/g) || []).length;
      const doubleQuotes = (line.match(/"/g) || []).length;
      
      if (singleQuotes % 2 !== 0) {
        return { valid: false, error: 'Unclosed single quote' };
      }
      if (doubleQuotes % 2 !== 0) {
        return { valid: false, error: 'Unclosed double quote' };
      }
      
      // Check for unclosed parentheses/brackets
      const openParens = (line.match(/\(/g) || []).length;
      const closeParens = (line.match(/\)/g) || []).length;
      if (openParens !== closeParens) {
        return { valid: false, error: 'Mismatched parentheses' };
      }
    }

    return { valid: true };
  }

  private createReport(skillDir: string, results: TestResult[]): SkillTestReport {
    const summary = {
      total: results.length,
      passed: results.filter(r => r.status === 'pass').length,
      failed: results.filter(r => r.status === 'fail').length,
      warnings: results.filter(r => r.status === 'warn').length,
      skipped: results.filter(r => r.status === 'skip').length,
    };

    const passed = summary.failed === 0 && (this.options.strict ? summary.warnings === 0 : true);

    return {
      skillName: join(skillDir).split('/').pop() || skillDir,
      skillPath: skillDir,
      timestamp: Date.now(),
      results,
      summary,
      passed,
    };
  }

  private createFailureReport(skillDir: string, message: string): SkillTestReport {
    return {
      skillName: join(skillDir).split('/').pop() || skillDir,
      skillPath: skillDir,
      timestamp: Date.now(),
      results: [{
        name: 'Validation',
        status: 'fail',
        message,
      }],
      summary: {
        total: 1,
        passed: 0,
        failed: 1,
        warnings: 0,
        skipped: 0,
      },
      passed: false,
    };
  }
}

// ============================================================================
// Test Runner
// ============================================================================

export interface TestRunnerOptions extends TestOptions {
  /** Skills directory to test */
  skillsDir: string;
  /** Output format */
  format?: 'text' | 'json' | 'tap';
  /** Verbose output */
  verbose?: boolean;
}

export class SkillTestRunner {
  private options: TestRunnerOptions;
  private framework: SkillTestFramework;

  constructor(options: TestRunnerOptions) {
    this.options = options;
    this.framework = new SkillTestFramework(options);
  }

  async run(): Promise<{ reports: SkillTestReport[]; passed: boolean }> {
    const reports: SkillTestReport[] = [];
    const skillsDir = this.options.skillsDir;

    log.info({ skillsDir }, 'Running skill tests');

    // Find all skill directories
    const skillDirs = this.findSkillDirectories(skillsDir);

    for (const skillDir of skillDirs) {
      const report = await this.framework.testSkill(skillDir);
      reports.push(report);
    }

    const allPassed = reports.every(r => r.passed);

    return { reports, passed: allPassed };
  }

  private findSkillDirectories(skillsDir: string): string[] {
    const dirs: string[] = [];

    try {
      const entries = readdirSync(skillsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const skillDir = join(skillsDir, entry.name);
          const skillMdPath = join(skillDir, 'SKILL.md');
          
          if (existsSync(skillMdPath)) {
            dirs.push(skillDir);
          }
        }
      }
    } catch (err) {
      log.warn({ error: err }, 'Failed to scan skills directory');
    }

    return dirs;
  }
}

/**
 * Format test results as text
 */
export function formatTestResults(reports: SkillTestReport[], verbose = false): string {
  const lines: string[] = [];
  
  for (const report of reports) {
    const icon = report.passed ? '✅' : '❌';
    lines.push(`\n${icon} ${report.skillName}`);
    lines.push('─'.repeat(50));

    for (const result of report.results) {
      const statusIcon = result.status === 'pass' ? '✓' : result.status === 'fail' ? '✗' : result.status === 'warn' ? '⚠' : '○';
      lines.push(`  ${statusIcon} ${result.name}: ${result.message || ''}`);
      
      if (verbose && result.details) {
        for (const detail of result.details) {
          lines.push(`     ${detail}`);
        }
      }
    }

    lines.push(`  Summary: ${report.summary.passed}/${report.summary.total} passed`);
    if (report.summary.failed > 0) {
      lines.push(`  Failed: ${report.summary.failed}`);
    }
    if (report.summary.warnings > 0) {
      lines.push(`  Warnings: ${report.summary.warnings}`);
    }
  }

  const totalTests = reports.reduce((sum, r) => sum + r.summary.total, 0);
  const totalPassed = reports.reduce((sum, r) => sum + r.summary.passed, 0);
  const totalFailed = reports.reduce((sum, r) => sum + r.summary.failed, 0);
  const totalWarnings = reports.reduce((sum, r) => sum + r.summary.warnings, 0);

  lines.push('\n' + '='.repeat(50));
  lines.push(`Total: ${totalTests} tests, ${totalPassed} passed, ${totalFailed} failed, ${totalWarnings} warnings`);
  
  const allPassed = reports.every(r => r.passed);
  lines.push(`Result: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);

  return lines.join('\n');
}

/**
 * Format test results as JSON
 */
export function formatTestResultsJson(reports: SkillTestReport[]): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    totalSkills: reports.length,
    passedSkills: reports.filter(r => r.passed).length,
    reports,
  }, null, 2);
}

/**
 * Format test results as TAP (Test Anything Protocol)
 */
export function formatTestResultsTap(reports: SkillTestReport[]): string {
  const lines: string[] = [];
  let testNum = 1;

  lines.push(`TAP version 13`);
  lines.push(`1..${reports.reduce((sum, r) => sum + r.results.length, 0)}`);

  for (const report of reports) {
    for (const result of report.results) {
      const status = result.status === 'pass' ? 'ok' : 'not ok';
      const testId = testNum++;
      lines.push(`${status} ${testId} - ${report.skillName}: ${result.name}`);
      
      if (result.status === 'fail' && result.message) {
        lines.push(`  ---`);
        lines.push(`  message: ${result.message}`);
        lines.push(`  ...`);
      }
    }
  }

  return lines.join('\n');
}
