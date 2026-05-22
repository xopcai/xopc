/**
 * Systemd Service - Linux user service management
 *
 * Aligned with OpenClaw systemd implementation:
 * - Restart=always with RestartPreventExitStatus=78
 * - StartLimitBurst/StartLimitIntervalSec for rate limiting
 * - KillMode=control-group
 * - network-online.target dependency
 */

import { writeFile, mkdir, readFile, rm, access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../utils/logger.js';
import {
  resolveGatewaySystemdServiceName,
  resolveSystemdUnitPath as resolveUnitPathFromConstants,
  SYSTEMD_RESTART_SEC,
  SYSTEMD_START_LIMIT_BURST,
  SYSTEMD_START_LIMIT_INTERVAL_SEC,
} from './constants.js';
import type {
  GatewayService,
  GatewayServiceInstallArgs,
  GatewayServiceControlArgs,
  GatewayServiceEnvArgs,
  GatewayServiceRuntime,
  GatewayServiceCommandConfig,
  GatewayServiceEnv,
  GatewayServiceRestartResult,
} from './types.js';

const log = createLogger('SystemdService');

// ─── Path Resolution ───

function resolveProfileFromEnv(env?: GatewayServiceEnv): string | undefined {
  return env?.XOPC_PROFILE?.trim() || undefined;
}

function resolveServiceName(env?: GatewayServiceEnv): string {
  return resolveGatewaySystemdServiceName(resolveProfileFromEnv(env));
}

export function resolveSystemdUserUnitPath(env?: GatewayServiceEnv): string {
  return resolveUnitPathFromConstants(resolveProfileFromEnv(env));
}

// ─── Unit File Generation ───

function buildSystemdUnit(params: {
  description: string;
  programArguments: string[];
  workingDirectory?: string;
  environment: Record<string, string>;
}): string {
  const envLines = Object.entries(params.environment)
    .map(([k, v]) => `Environment="${k}=${v}"`)
    .join('\n');

  const execStart = params.programArguments.join(' ');

  let unit = `[Unit]
Description=${params.description}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
`;

  if (params.workingDirectory) {
    unit += `WorkingDirectory=${params.workingDirectory}\n`;
  }

  if (envLines) {
    unit += `${envLines}\n`;
  }

  unit += `Restart=always
RestartSec=${SYSTEMD_RESTART_SEC}
RestartPreventExitStatus=78
KillMode=control-group
StartLimitBurst=${SYSTEMD_START_LIMIT_BURST}
StartLimitIntervalSec=${SYSTEMD_START_LIMIT_INTERVAL_SEC}

[Install]
WantedBy=default.target
`;

  return unit;
}

// ─── systemctl Execution ───

interface SystemctlResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function systemctl(args: string[]): Promise<SystemctlResult> {
  return new Promise<SystemctlResult>((resolve, reject) => {
    const child = spawn('systemctl', ['--user', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
    child.on('error', (err) => {
      reject(new Error(`systemctl spawn failed: ${err.message}`));
    });
  });
}

async function systemctlExec(args: string[]): Promise<void> {
  const result = await systemctl(args);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`systemctl ${args.join(' ')} failed (exit ${result.exitCode}): ${detail}`);
  }
}

// ─── Availability Check ───

export function isSystemdAvailable(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const result = spawnSync('systemctl', ['--user', '--version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ─── Linger Management ───

function getUsername(): string {
  return os.userInfo().username;
}

async function isLingerEnabled(): Promise<boolean> {
  try {
    const lingerPath = `/var/lib/systemd/linger/${getUsername()}`;
    await access(lingerPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function enableLinger(): Promise<void> {
  if (!isSystemdAvailable()) {
    throw new Error('systemd is not available');
  }

  const alreadyEnabled = await isLingerEnabled();
  if (alreadyEnabled) {
    log.info('User lingering already enabled');
    return;
  }

  const result = spawnSync('loginctl', ['enable-linger', getUsername()], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  });

  if (result.status !== 0) {
    log.warn(
      { command: `loginctl enable-linger ${getUsername()}` },
      'Failed to enable systemd user linger; gateway may not survive logout',
    );
    throw new Error(
      `Failed to enable user lingering. Run: sudo loginctl enable-linger ${getUsername()}`,
    );
  }

  log.info('Enabled user lingering');
}

// ─── Unit File Parsing ───

function parseUnitEnvironment(content: string): Record<string, string> {
  const environment: Record<string, string> = {};
  const matches = content.matchAll(/^Environment="([^=]+)=(.*)"/gm);
  for (const match of matches) {
    environment[match[1]] = match[2];
  }
  return environment;
}

// ─── Service Implementation ───

export const systemdService: GatewayService = {
  label: resolveGatewaySystemdServiceName(),
  loadedText: 'systemd (enabled)',
  notLoadedText: 'systemd (not installed)',

  async install(args: GatewayServiceInstallArgs): Promise<void> {
    const serviceName = resolveServiceName(args.env);
    const unitPath = resolveSystemdUserUnitPath(args.env);

    // Ensure directory exists
    await mkdir(path.dirname(unitPath), { recursive: true });

    // Build environment
    const environment: Record<string, string> = {};
    if (args.environment) {
      Object.assign(environment, args.environment);
    }

    // Build unit content
    const description = args.description || 'xopc Gateway Service';
    const unit = buildSystemdUnit({
      description,
      programArguments: args.programArguments,
      workingDirectory: args.workingDirectory,
      environment,
    });

    // Write unit file
    await writeFile(unitPath, unit, 'utf8');
    args.stdout?.write(`Written: ${unitPath}\n`);

    // Reload systemd daemon
    await systemctlExec(['daemon-reload']);

    // Enable service
    await systemctlExec(['enable', serviceName]);

    log.info({ serviceName, unitPath }, 'Systemd service installed and enabled');
  },

  async uninstall(args: GatewayServiceControlArgs): Promise<void> {
    const serviceName = resolveServiceName(args.env);
    const unitPath = resolveSystemdUserUnitPath(args.env);

    // Stop if running
    try {
      await systemctlExec(['stop', serviceName]);
    } catch {
      // Ignore
    }

    // Disable service
    try {
      await systemctlExec(['disable', serviceName]);
    } catch {
      // Ignore
    }

    // Remove unit file
    if (existsSync(unitPath)) {
      await rm(unitPath);
      args.stdout?.write(`Removed: ${unitPath}\n`);
    }

    // Reload daemon
    await systemctlExec(['daemon-reload']);

    log.info({ serviceName, unitPath }, 'Systemd service uninstalled');
  },

  async stop(args: GatewayServiceControlArgs): Promise<void> {
    const serviceName = resolveServiceName(args.env);

    if (args.disable) {
      // Stop + disable: prevents restart
      await systemctlExec(['stop', serviceName]);
      await systemctlExec(['disable', serviceName]);
      log.info('Systemd service stopped and disabled');
    } else {
      await systemctlExec(['stop', serviceName]);
      log.info('Systemd service stopped');
    }
  },

  async restart(args: GatewayServiceControlArgs): Promise<GatewayServiceRestartResult> {
    const serviceName = resolveServiceName(args.env);
    await systemctlExec(['restart', serviceName]);
    log.info('Systemd service restarted');
    return { outcome: 'restarted' };
  },

  async isLoaded(args: GatewayServiceEnvArgs): Promise<boolean> {
    const serviceName = resolveServiceName(args.env);
    const result = await systemctl(['is-enabled', serviceName]);
    return result.exitCode === 0;
  },

  async readRuntime(env?: GatewayServiceEnv): Promise<GatewayServiceRuntime> {
    const serviceName = resolveServiceName(env);

    try {
      const result = await systemctl([
        'show', serviceName,
        '--property=ActiveState,MainPID,ExecMainStatus',
      ]);

      if (result.exitCode !== 0) {
        return { status: 'unknown' };
      }

      const lines = result.stdout.trim().split('\n');
      let status: 'running' | 'stopped' | 'unknown' = 'unknown';
      let pid: number | undefined;
      let lastExitStatus: number | undefined;

      for (const line of lines) {
        const eqIdx = line.indexOf('=');
        if (eqIdx < 0) continue;
        const key = line.slice(0, eqIdx);
        const value = line.slice(eqIdx + 1);

        if (key === 'ActiveState') {
          status = value === 'active' ? 'running' : value === 'inactive' ? 'stopped' : 'unknown';
        } else if (key === 'MainPID') {
          const parsed = parseInt(value, 10);
          if (parsed > 0) pid = parsed;
        } else if (key === 'ExecMainStatus') {
          lastExitStatus = parseInt(value, 10);
        }
      }

      return { status, pid, lastExitStatus };
    } catch {
      return { status: 'unknown' };
    }
  },

  async readCommand(env?: GatewayServiceEnv): Promise<GatewayServiceCommandConfig | null> {
    const unitPath = resolveSystemdUserUnitPath(env);
    if (!existsSync(unitPath)) return null;

    const content = await readFile(unitPath, 'utf8');
    const execStartMatch = content.match(/^ExecStart=(.+)$/m);
    const workDirMatch = content.match(/^WorkingDirectory=(.+)$/m);

    if (!execStartMatch) return null;

    const execStart = execStartMatch[1].trim();
    const programArguments = execStart.split(/\s+/);
    const environment = parseUnitEnvironment(content);

    return {
      programArguments,
      workingDirectory: workDirMatch?.[1],
      environment,
      sourcePath: unitPath,
    };
  },
};
