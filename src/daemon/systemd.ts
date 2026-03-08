/**
 * Systemd Service - Linux user service management
 */

import { writeFile, mkdir, readFile, rm, access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../utils/logger.js';
import type {
  GatewayService,
  GatewayServiceInstallArgs,
  GatewayServiceControlArgs,
  GatewayServiceEnvArgs,
  GatewayServiceRuntime,
  GatewayServiceCommandConfig,
} from './types.js';
import type { Writable } from 'node:stream';

const log = createLogger('SystemdService');

/**
 * Get username
 */
function getUsername(): string {
  return os.userInfo().username;
}

/**
 * Resolve systemd unit path
 */
function resolveSystemdUnitPath(_env: NodeJS.ProcessEnv): string {
  const home = os.homedir();
  const xopcbotDir = path.join(home, '.config', 'systemd', 'user');
  return path.join(xopcbotDir, 'xopcbot-gateway.service');
}

/**
 * Resolve log directory
 */
function resolveLogDir(): string {
  return path.join(os.homedir(), '.xopcbot', 'logs');
}

/**
 * Build systemd unit content
 */
function buildSystemdUnit(params: {
  description: string;
  execStart: string;
  workingDirectory?: string;
  environment: Record<string, string>;
  restart?: string;
  restartSec?: string;
}): string {
  const envVars = Object.entries(params.environment)
    .map(([k, v]) => `Environment="${k}=${v}"`)
    .join('\n');

  return `[Unit]
Description=${params.description}
After=network.target

[Service]
${params.workingDirectory ? `WorkingDirectory=${params.workingDirectory}` : ''}
ExecStart=${params.execStart}
${envVars}
Restart=${params.restart || 'on-failure'}
RestartSec=${params.restartSec || '5'}

[Install]
WantedBy=default.target
`.trim();
}

/**
 * Execute systemctl command
 */
async function systemctl(args: string[], stdout?: Writable, stderr?: Writable): Promise<void> {
  try {
    const child = spawn('systemctl', ['--user', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    
    let out = '';
    let err = '';
    
    if (child.stdout) {
      child.stdout.on('data', (data) => { out += data.toString(); });
    }
    if (child.stderr) {
      child.stderr.on('data', (data) => { err += data.toString(); });
    }
    
    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) {
          if (stdout && out) stdout.write(out);
          if (stderr && err) stderr.write(err);
          resolve();
        } else {
          reject(new Error(`systemctl exited with code ${code}`));
        }
      });
      child.on('error', reject);
    });
  } catch (err) {
    const e = err as { message?: string };
    throw new Error(`systemctl failed: ${e.message || String(err)}`);
  }
}

import { spawnSync } from 'node:child_process';

/**
 * Check if systemd is available
 */
export function isSystemdAvailable(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    // Use spawnSync to avoid require in ESM
    const result = spawnSync('systemctl', ['--user', '--version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check if user lingering is enabled
 */
async function isLingerEnabled(): Promise<boolean> {
  try {
    const lingerPath = `/var/lib/systemd/linger/${getUsername()}`;
    await access(lingerPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enable user lingering (so service runs after logout)
 */
export async function enableLinger(): Promise<void> {
  if (!isSystemdAvailable()) {
    throw new Error('systemd is not available');
  }

  const alreadyEnabled = await isLingerEnabled();
  if (alreadyEnabled) {
    log.info('User lingering already enabled');
    return;
  }

  try {
    // Try to enable linger (requires root)
    execSync('sudo loginctl enable-linger ' + getUsername(), { stdio: 'inherit' });
    log.info('Enabled user lingering');
  } catch {
    // If sudo fails, try without sudo (may work on some systems)
    log.warn('Failed to enable linger with sudo, service may not start after logout');
    throw new Error(
      'Failed to enable user lingering. Run: sudo loginctl enable-linger ' + getUsername()
    );
  }
}

/**
 * Systemd service implementation
 */
export const systemdService: GatewayService = {
  label: 'xopcbot-gateway',
  loadedText: 'xopcbot-gateway.service',
  notLoadedText: 'xopcbot-gateway.service',

  async install(args: GatewayServiceInstallArgs): Promise<void> {
    const unitPath = resolveSystemdUnitPath(args.env);
    const logDir = resolveLogDir();

    // Ensure directories exist
    await mkdir(path.dirname(unitPath), { recursive: true });
    await mkdir(logDir, { recursive: true });

    // Build environment
    const environment: Record<string, string> = {
      ...args.environment,
      XOPCBOT_CONFIG: args.env.XOPCBOT_CONFIG || '',
      XOPCBOT_WORKSPACE: args.env.XOPCBOT_WORKSPACE || '',
      XOPCBOT_LOG_LEVEL: args.env.XOPCBOT_LOG_LEVEL || 'info',
      XOPCBOT_LOG_FILE: 'true',
    };

    if (args.env.XOPCBOT_GATEWAY_TOKEN) {
      environment.XOPCBOT_GATEWAY_TOKEN = args.env.XOPCBOT_GATEWAY_TOKEN;
    }

    // Build unit content
    const unit = buildSystemdUnit({
      description: 'xopcbot Gateway Server',
      execStart: args.programArguments.join(' '),
      workingDirectory: args.workingDirectory,
      environment,
      restart: 'on-failure',
      restartSec: '5',
    });

    // Write unit file
    await writeFile(unitPath, unit, 'utf8');
    args.stdout?.write(`Written: ${unitPath}\n`);

    // Reload systemd
    await systemctl(['daemon-reload'], args.stdout, args.stderr);

    // Enable service
    await systemctl(['enable', 'xopcbot-gateway'], args.stdout, args.stderr);
    log.info('Systemd service installed');
  },

  async uninstall(args: GatewayServiceControlArgs): Promise<void> {
    const unitPath = resolveSystemdUnitPath(args.env);

    // Stop if running
    try {
      await this.stop(args);
    } catch {
      // Ignore errors
    }

    // Disable service
    try {
      await systemctl(['disable', 'xopcbot-gateway'], args.stdout, args.stderr);
    } catch {
      // Ignore errors
    }

    // Remove unit file
    if (existsSync(unitPath)) {
      await rm(unitPath);
      args.stdout?.write(`Removed: ${unitPath}\n`);
    }

    // Reload systemd
    await systemctl(['daemon-reload'], args.stdout, args.stderr);
    log.info('Systemd service uninstalled');
  },

  async start(args: GatewayServiceControlArgs): Promise<void> {
    await systemctl(['start', 'xopcbot-gateway'], args.stdout, args.stderr);
    log.info('Systemd service started');
  },

  async stop(args: GatewayServiceControlArgs): Promise<void> {
    await systemctl(['stop', 'xopcbot-gateway'], args.stdout, args.stderr);
    log.info('Systemd service stopped');
  },

  async restart(args: GatewayServiceControlArgs): Promise<void> {
    await systemctl(['restart', 'xopcbot-gateway'], args.stdout, args.stderr);
    log.info('Systemd service restarted');
  },

  async isLoaded(_args: GatewayServiceEnvArgs): Promise<boolean> {
    try {
      execSync('systemctl --user is-enabled xopcbot-gateway', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },

  async getRuntime(_args: GatewayServiceEnvArgs): Promise<GatewayServiceRuntime> {
    try {
      const stdout = execSync('systemctl --user show xopcbot-gateway --property=ActiveState,MainPID,ExecMainStatus', { encoding: 'utf-8' });
      const lines = stdout.trim().split('\n');
      let status: 'running' | 'stopped' | 'unknown' = 'unknown';
      let pid: number | undefined;
      let lastExitStatus: number | undefined;

      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'ActiveState') {
          status = value === 'active' ? 'running' : value === 'inactive' ? 'stopped' : 'unknown';
        } else if (key === 'MainPID') {
          pid = parseInt(value, 10);
          if (pid === 0) pid = undefined;
        } else if (key === 'ExecMainStatus') {
          lastExitStatus = parseInt(value, 10);
        }
      }

      return { status, pid, lastExitStatus };
    } catch {
      return { status: 'unknown' };
    }
  },

  async readCommand(env: NodeJS.ProcessEnv): Promise<GatewayServiceCommandConfig | null> {
    const unitPath = resolveSystemdUnitPath(env);
    if (!existsSync(unitPath)) return null;

    const content = await readFile(unitPath, 'utf8');
    const execStartMatch = content.match(/^ExecStart=(.+)$/m);
    const workDirMatch = content.match(/^WorkingDirectory=(.+)$/m);

    if (!execStartMatch) return null;

    const execStart = execStartMatch[1].trim();
    const args = execStart.split(/\s+/);

    const environment: Record<string, string> = {};
    const envMatches = content.matchAll(/^Environment="([^"]+)"/gm);
    for (const match of envMatches) {
      const [key, value] = match[1].split('=');
      environment[key] = value;
    }

    return {
      program: args[0],
      arguments: args.slice(1),
      environment,
      workingDirectory: workDirMatch?.[1],
    };
  },
};
