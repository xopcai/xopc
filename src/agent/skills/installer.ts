/**
 * Skill Installer
 * 
 * Handles installation of skill dependencies via various package managers.
 * Inspired by openclaw's skills-install.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../utils/logger.js';
import type { SkillEntry, SkillInstallResult, SkillInstallSpec } from './types.js';

const execAsync = promisify(exec);

const log = createLogger('SkillInstaller');

export interface InstallerPreferences {
  preferBrew: boolean;
  nodeManager: 'pnpm' | 'npm' | 'yarn' | 'bun';
}

export interface InstallContext {
  workspaceDir: string;
  skillEntry: SkillEntry;
  installSpec: SkillInstallSpec;
  timeoutMs: number;
  preferences: InstallerPreferences;
}

/**
 * Check if a binary exists
 */
export function hasBinary(name: string): boolean {
  try {
    const { which } = require('which');
    return !!which.sync(name, { nothrow: true });
  } catch {
    // Fallback: try to execute the command
    try {
      const { execSync } = require('child_process');
      execSync(`which ${name}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Resolve brew executable path
 */
export function resolveBrewExecutable(): string | undefined {
  const candidates = [
    '/opt/homebrew/bin/brew',
    '/usr/local/bin/brew',
  ];
  
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  
  return undefined;
}

/**
 * Build install command for Node.js packages
 */
function buildNodeInstallCommand(packageName: string, manager: InstallerPreferences['nodeManager']): string[] {
  switch (manager) {
    case 'pnpm':
      return ['pnpm', 'add', '-g', '--ignore-scripts', packageName];
    case 'yarn':
      return ['yarn', 'global', 'add', '--ignore-scripts', packageName];
    case 'bun':
      return ['bun', 'add', '-g', '--ignore-scripts', packageName];
    default:
      return ['npm', 'install', '-g', '--ignore-scripts', packageName];
  }
}

/**
 * Build install command from spec
 */
function buildInstallCommand(spec: SkillInstallSpec, prefs: InstallerPreferences): {
  argv: string[] | null;
  error?: string;
} {
  switch (spec.kind) {
    case 'brew': {
      if (!spec.formula) {
        return { argv: null, error: 'Missing brew formula' };
      }
      return { argv: ['brew', 'install', spec.formula] };
    }
    
    case 'pnpm':
    case 'npm':
    case 'yarn':
    case 'bun': {
      if (!spec.package) {
        return { argv: null, error: 'Missing package name' };
      }
      return {
        argv: buildNodeInstallCommand(spec.package, prefs.nodeManager),
      };
    }
    
    case 'go': {
      if (!spec.module) {
        return { argv: null, error: 'Missing go module' };
      }
      return { argv: ['go', 'install', spec.module] };
    }
    
    case 'uv': {
      if (!spec.package) {
        return { argv: null, error: 'Missing uv package' };
      }
      return { argv: ['uv', 'tool', 'install', spec.package] };
    }
    
    case 'download': {
      return { argv: null, error: 'Download install handled separately' };
    }
    
    default: {
      const _exhaustive: never = spec.kind;
      return { argv: null, error: `Unsupported installer: ${spec.kind}` };
    }
  }
}

/**
 * Run command with timeout
 */
async function runCommandWithTimeout(
  argv: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const [cmd, ...args] = argv;
  
  try {
    const { stdout, stderr } = await execAsync(`${cmd} ${args.join(' ')}`, {
      timeout: timeoutMs,
      env,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    
    return {
      code: 0,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      const execError = err as Error & { code?: number; stdout?: string; stderr?: string };
      return {
        code: execError.code ?? null,
        stdout: execError.stdout?.toString() ?? '',
        stderr: execError.stderr?.toString() ?? '',
      };
    }
    
    return {
      code: null,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ensure uv is installed
 */
async function ensureUvInstalled(timeoutMs: number): Promise<SkillInstallResult | undefined> {
  if (hasBinary('uv')) {
    return undefined;
  }
  
  // Try to install via brew
  const brewExe = resolveBrewExecutable();
  if (!brewExe) {
    return {
      ok: false,
      message: 'uv not installed — install manually: https://docs.astral.sh/uv/getting-started/installation/',
      stdout: '',
      stderr: '',
      code: null,
    };
  }
  
  const result = await runCommandWithTimeout([brewExe, 'install', 'uv'], timeoutMs);
  if (result.code === 0) {
    return undefined;
  }
  
  return {
    ok: false,
    message: 'Failed to install uv (brew)',
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
  };
}

/**
 * Ensure Go is installed
 */
async function ensureGoInstalled(timeoutMs: number): Promise<SkillInstallResult | undefined> {
  if (hasBinary('go')) {
    return undefined;
  }
  
  const brewExe = resolveBrewExecutable();
  if (brewExe) {
    const result = await runCommandWithTimeout([brewExe, 'install', 'go'], timeoutMs);
    if (result.code === 0) {
      return undefined;
    }
    
    return {
      ok: false,
      message: 'Failed to install go (brew)',
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    };
  }
  
  // Try apt-get on Linux
  if (hasBinary('apt-get')) {
    const isRoot = process.getuid?.() === 0;
    const aptCmd = isRoot 
      ? ['apt-get', 'install', '-y', 'golang-go']
      : ['sudo', 'apt-get', 'install', '-y', 'golang-go'];
    
    // Update package index first
    if (!isRoot) {
      await runCommandWithTimeout(['sudo', 'apt-get', 'update', '-qq'], Math.min(timeoutMs, 30000));
    }
    
    const result = await runCommandWithTimeout(aptCmd, timeoutMs);
    if (result.code === 0) {
      return undefined;
    }
    
    return {
      ok: false,
      message: 'go not installed — automatic install via apt failed. Install manually: https://go.dev/doc/install',
      stdout: result.stdout,
      stderr: result.stderr,
      code: result.code,
    };
  }
  
  return {
    ok: false,
    message: 'go not installed — install manually: https://go.dev/doc/install',
    stdout: '',
    stderr: '',
    code: null,
  };
}

/**
 * Create install failure result
 */
function createInstallFailure(params: {
  message: string;
  stdout?: string;
  stderr?: string;
  code?: number | null;
}): SkillInstallResult {
  return {
    ok: false,
    message: params.message,
    stdout: params.stdout?.trim() ?? '',
    stderr: params.stderr?.trim() ?? '',
    code: params.code ?? null,
  };
}

/**
 * Create install success result
 */
function createInstallSuccess(result: { code: number | null; stdout: string; stderr: string }): SkillInstallResult {
  return {
    ok: true,
    message: 'Installed',
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    code: result.code,
  };
}

/**
 * Find install spec by ID
 */
export function findInstallSpec(entry: SkillEntry, installId: string): SkillInstallSpec | undefined {
  const specs = entry.metadata.install ?? [];
  
  for (const [index, spec] of specs.entries()) {
    const id = spec.id ?? `${spec.kind}-${index}`;
    if (id === installId) {
      return spec;
    }
  }
  
  return undefined;
}

/**
 * Install a skill dependency
 */
export async function installSkill(ctx: InstallContext): Promise<SkillInstallResult> {
  const { installSpec, timeoutMs, preferences } = ctx;
  
  log.info({ skill: ctx.skillEntry.skill.name, kind: installSpec.kind }, 'Installing skill dependency');
  
  // Handle download installer separately
  if (installSpec.kind === 'download') {
    return createInstallFailure({
      message: 'Download installer not yet implemented',
    });
  }
  
  // Check and install prerequisites
  if (installSpec.kind === 'uv') {
    const uvFailure = await ensureUvInstalled(timeoutMs);
    if (uvFailure) {
      return uvFailure;
    }
  }
  
  if (installSpec.kind === 'go') {
    const goFailure = await ensureGoInstalled(timeoutMs);
    if (goFailure) {
      return goFailure;
    }
  }
  
  // Build install command
  const command = buildInstallCommand(installSpec, preferences);
  if (command.error) {
    return createInstallFailure({
      message: command.error,
    });
  }
  
  if (!command.argv) {
    return createInstallFailure({
      message: 'Invalid install command',
    });
  }
  
  // Resolve brew executable
  let argv = [...command.argv];
  if (installSpec.kind === 'brew') {
    const brewExe = resolveBrewExecutable();
    if (!brewExe) {
      const hint = process.platform === 'linux'
        ? 'Homebrew is not installed. Install it from https://brew.sh or use your system package manager.'
        : 'Homebrew is not installed. Install it from https://brew.sh';
      
      return createInstallFailure({
        message: `brew not installed — ${hint}`,
      });
    }
    argv[0] = brewExe;
  }
  
  // Set up environment for go installations
  let env: NodeJS.ProcessEnv | undefined;
  if (installSpec.kind === 'go') {
    const brewExe = resolveBrewExecutable();
    if (brewExe) {
      try {
        const { stdout } = await execAsync(`${brewExe} --prefix`);
        const prefix = stdout.trim();
        if (prefix) {
          env = { ...process.env, GOBIN: join(prefix, 'bin') };
        }
      } catch {
        // Use default GOBIN
      }
    }
  }
  
  // Execute install command
  const result = await runCommandWithTimeout(argv, timeoutMs, env);
  
  if (result.code === 0) {
    log.info({ skill: ctx.skillEntry.skill.name }, 'Skill dependency installed successfully');
    return createInstallSuccess(result);
  }
  
  log.warn({ 
    skill: ctx.skillEntry.skill.name, 
    stderr: result.stderr 
  }, 'Skill dependency installation failed');
  
  return createInstallFailure({
    message: result.stderr || `Installation failed with exit code ${result.code}`,
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
  });
}

/**
 * Get default installer preferences from config
 */
export function getDefaultInstallerPreferences(): InstallerPreferences {
  return {
    preferBrew: true,
    nodeManager: 'pnpm', // Default to pnpm as per project guidelines
  };
}
