/**
 * Skill Installer
 * 
 * Handles installation of skill dependencies via various package managers.
 *
 */

import { execFile } from 'child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'util';
import { accessSync, constants, existsSync } from 'fs';
import { access, mkdir, writeFile } from 'fs/promises';
import { delimiter, join } from 'path';
import type { RuntimeToolsConfig } from '../../config/schema.js';
import { prepareSafeToolEnv } from '../sandbox/sanitize-env-vars.js';
import { buildRuntimeEnvironment } from '../../runtime-tools/environment.js';
import { ManagedRuntimeManager } from '../../runtime-tools/manager.js';
import { createLogger } from '../../utils/logger.js';
import type { SkillEntry, SkillInstallResult, SkillInstallSpec } from './types.js';

const execFileAsync = promisify(execFile);

const log = createLogger('SkillInstaller');

export interface InstallContext {
  stateDir: string;
  runtimeConfig: RuntimeToolsConfig;
  skillEntry: SkillEntry;
  installSpec: SkillInstallSpec;
  timeoutMs: number;
}

export function skillEnvironmentId(
  skill: Pick<SkillEntry['skill'], 'name' | 'filePath'>,
  installSpec: SkillInstallSpec,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      skill: skill.name,
      path: skill.filePath,
      installSpec,
    }))
    .digest('hex')
    .slice(0, 24);
}

/**
 * Check if a binary exists
 */
export function hasBinary(name: string): boolean {
  if (!name || name.includes('/') || name.includes('\\')) {
    return false;
  }

  const pathEntries = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];

  for (const dir of pathEntries) {
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        // Continue searching PATH.
      }
    }
  }

  return false;
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
function buildNodeInstallCommand(
  packageName: string,
  environmentDir: string,
): string[] {
  return ['npm', 'install', '--prefix', environmentDir, '--ignore-scripts', '--', packageName];
}

function invalidInstallTarget(value: string | undefined): boolean {
  return !value || value.startsWith('-') || value.includes('\0');
}

/**
 * Build install command from spec
 */
function buildInstallCommand(spec: SkillInstallSpec, environmentDir: string): {
  argv: string[] | null;
  error?: string;
} {
  switch (spec.kind) {
    case 'brew': {
      if (invalidInstallTarget(spec.formula)) {
        return { argv: null, error: 'Missing brew formula' };
      }
      return { argv: ['brew', 'install', '--formula', spec.formula!] };
    }
    
    case 'pnpm':
    case 'npm':
    case 'yarn':
    case 'bun': {
      if (invalidInstallTarget(spec.package)) {
        return { argv: null, error: 'Missing package name' };
      }
      return {
        argv: buildNodeInstallCommand(spec.package!, environmentDir),
      };
    }
    
    case 'go': {
      if (invalidInstallTarget(spec.module)) {
        return { argv: null, error: 'Missing go module' };
      }
      return { argv: ['go', 'install', spec.module!] };
    }
    
    case 'uv': {
      if (invalidInstallTarget(spec.package)) {
        return { argv: null, error: 'Missing uv package' };
      }
      return {
        argv: [
          'uv',
          'tool',
          'install',
          '--tool-dir',
          join(environmentDir, 'tools'),
          '--bin-dir',
          join(environmentDir, 'bin'),
          '--',
          spec.package!,
        ],
      };
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
  if (!cmd) return { code: null, stdout: '', stderr: 'Missing executable' };
  
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
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
  const { installSpec, timeoutMs } = ctx;
  
  log.info({ skill: ctx.skillEntry.skill.name, kind: installSpec.kind }, 'Installing skill dependency');
  
  // Handle download installer separately
  if (installSpec.kind === 'download') {
    return createInstallFailure({
      message: 'Download installer not yet implemented',
    });
  }
  
  if (installSpec.kind === 'go') {
    if (!hasBinary('go')) {
      return createInstallFailure({
        message: 'go not installed — install it explicitly from https://go.dev/doc/install',
      });
    }
  }
  
  const environmentId = skillEnvironmentId(ctx.skillEntry.skill, installSpec);
  const environmentDir = join(
    ctx.stateDir,
    'tools',
    'environments',
    'skills',
    environmentId,
  );
  await mkdir(environmentDir, { recursive: true });
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(installSpec.kind)) {
    await writeFile(
      join(environmentDir, 'package.json'),
      `${JSON.stringify({ private: true, name: `xopc-skill-${environmentId}` }, null, 2)}\n`,
      { flag: 'wx' },
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }

  const command = buildInstallCommand(installSpec, environmentDir);
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
  const runtimeManager = new ManagedRuntimeManager({
    stateDir: ctx.stateDir,
    config: ctx.runtimeConfig,
  });
  if (installSpec.kind === 'uv') {
    const uv = await runtimeManager.resolve({ runtime: 'uv', allowProvision: true });
    argv[0] = uv.executable;
  } else if (['npm', 'pnpm', 'yarn', 'bun'].includes(installSpec.kind)) {
    const node = await runtimeManager.resolve({ runtime: 'node', allowProvision: true });
    if (node.installDir) {
      const npmCli = process.platform === 'win32'
        ? join(node.installDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
        : join(node.installDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
      try {
        await access(npmCli);
      } catch {
        return createInstallFailure({ message: 'Managed Node.js does not include npm-cli.js' });
      }
      argv.splice(0, 1, node.executable, npmCli);
    } else if (process.platform === 'win32') {
      return createInstallFailure({
        message: 'Isolated package installation on Windows requires managed Node.js',
      });
    } else {
      argv[0] = node.executables.npm ?? 'npm';
    }
  }
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
  
  let env: NodeJS.ProcessEnv = (await buildRuntimeEnvironment({
    stateDir: ctx.stateDir,
    config: ctx.runtimeConfig,
    baseEnv: prepareSafeToolEnv(process.env),
    extraBinDirs: [join(environmentDir, 'bin'), join(environmentDir, 'node_modules', '.bin')],
  })).env;
  if (installSpec.kind === 'go') {
    env = { ...env, GOBIN: join(environmentDir, 'bin') };
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
