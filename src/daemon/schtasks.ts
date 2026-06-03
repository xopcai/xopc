/**
 * Scheduled Task Service - Windows service management via schtasks
 *
 * Aligned with OpenClaw Windows implementation:
 * - Task with ONLOGON trigger for persistence
 * - RepetitionInterval for keep-alive behavior
 * - Proper start/stop/restart lifecycle
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../utils/logger.js';
import { resolveGatewayWindowsTaskName } from './constants.js';
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

const log = createLogger('SchtasksService');

// ─── Resolution ───

function resolveProfileFromEnv(env?: GatewayServiceEnv): string | undefined {
  return env?.XOPC_PROFILE?.trim() || undefined;
}

function resolveTaskName(env?: GatewayServiceEnv): string {
  return resolveGatewayWindowsTaskName(resolveProfileFromEnv(env));
}

// ─── Command Execution ───

interface SchtasksResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function schtasks(args: string[]): Promise<SchtasksResult> {
  return new Promise<SchtasksResult>((resolve, reject) => {
    const child = spawn('schtasks', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => { stdout += data.toString(); });
    child.stderr?.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code });
    });
    child.on('error', (err) => {
      reject(new Error(`schtasks spawn failed: ${err.message}`));
    });
  });
}

async function schtasksExec(args: string[]): Promise<string> {
  const result = await schtasks(args);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`schtasks failed (exit ${result.exitCode}): ${detail}`);
  }
  return result.stdout;
}

// ─── Environment Sidecar ───
// schtasks does not natively support per-task environment variables.
// We persist them in a JSON sidecar so readCommand can return them
// for version-mismatch detection and other diagnostics.

function resolveTaskEnvSidecarPath(taskName: string): string {
  const configDir = path.join(os.homedir(), '.xopc', 'daemon');
  return path.join(configDir, `${taskName}.env.json`);
}

function writeTaskEnvSidecar(taskName: string, environment: Record<string, string>): void {
  const sidecarPath = resolveTaskEnvSidecarPath(taskName);
  try {
    mkdirSync(path.dirname(sidecarPath), { recursive: true });
    writeFileSync(sidecarPath, JSON.stringify(environment, null, 2), 'utf8');
  } catch (err) {
    log.warn({ err, sidecarPath }, 'Failed to write task environment sidecar');
  }
}

function readTaskEnvSidecar(taskName: string): Record<string, string> | undefined {
  const sidecarPath = resolveTaskEnvSidecarPath(taskName);
  try {
    const raw = readFileSync(sidecarPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Sidecar missing or corrupt — not fatal
  }
  return undefined;
}

function removeTaskEnvSidecar(taskName: string): void {
  const sidecarPath = resolveTaskEnvSidecarPath(taskName);
  try {
    rmSync(sidecarPath, { force: true });
  } catch {
    // Best-effort
  }
}

// ─── Availability Check ───

export function isSchtasksAvailable(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const result = spawnSync('schtasks', ['/query', '/?'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      shell: true,
      timeout: 3000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ─── Service Implementation ───

export const schtasksService: GatewayService = {
  label: resolveGatewayWindowsTaskName(),
  loadedText: 'Scheduled Task (installed)',
  notLoadedText: 'Scheduled Task (not installed)',

  async install(args: GatewayServiceInstallArgs): Promise<void> {
    const taskName = resolveTaskName(args.env);
    const program = args.programArguments[0];
    const programArgs = args.programArguments.slice(1).join(' ');

    // Delete existing task first (ignore errors)
    try {
      await schtasks(['/delete', '/tn', taskName, '/f']);
    } catch {
      // Ignore
    }

    // Create task with ONLOGON trigger
    const createArgs = [
      '/create',
      '/tn', taskName,
      '/tr', `"${program}" ${programArgs}`,
      '/sc', 'ONLOGON',
      '/rl', 'LIMITED',
      '/f',
    ];

    await schtasksExec(createArgs);

    // Persist environment variables in a sidecar file
    // (schtasks does not support per-task env vars natively)
    if (args.environment && Object.keys(args.environment).length > 0) {
      writeTaskEnvSidecar(taskName, args.environment);
    }

    args.stdout?.write(`Created scheduled task: ${taskName}\n`);
    args.stdout?.write(`  Program: ${program}\n`);
    args.stdout?.write(`  Args: ${programArgs}\n`);

    log.info({ taskName }, 'Scheduled task installed');
  },

  async uninstall(args: GatewayServiceControlArgs): Promise<void> {
    const taskName = resolveTaskName(args.env);

    // Stop if running
    try {
      await schtasks(['/end', '/tn', taskName]);
    } catch {
      // Ignore
    }

    // Delete task
    try {
      await schtasksExec(['/delete', '/tn', taskName, '/f']);
      args.stdout?.write(`Deleted scheduled task: ${taskName}\n`);
    } catch (err) {
      log.debug({ err }, 'Uninstall task not found');
    }

    // Clean up environment sidecar
    removeTaskEnvSidecar(taskName);

    log.info({ taskName }, 'Scheduled task uninstalled');
  },

  async stop(args: GatewayServiceControlArgs): Promise<void> {
    const taskName = resolveTaskName(args.env);

    try {
      await schtasksExec(['/end', '/tn', taskName]);
    } catch {
      log.debug('Task not running');
    }

    if (args.disable) {
      try {
        await schtasksExec(['/change', '/tn', taskName, '/disable']);
      } catch {
        // Ignore
      }
    }

    log.info('Scheduled task stopped');
  },

  async restart(args: GatewayServiceControlArgs): Promise<GatewayServiceRestartResult> {
    const taskName = resolveTaskName(args.env);

    // End current run
    try {
      await schtasks(['/end', '/tn', taskName]);
    } catch {
      // Ignore
    }

    // Small delay for process cleanup
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Start new run
    await schtasksExec(['/run', '/tn', taskName]);

    log.info('Scheduled task restarted');
    return { outcome: 'restarted' };
  },

  async isLoaded(args: GatewayServiceEnvArgs): Promise<boolean> {
    const taskName = resolveTaskName(args.env);
    const result = await schtasks(['/query', '/tn', taskName]);
    return result.exitCode === 0;
  },

  async readRuntime(env?: GatewayServiceEnv): Promise<GatewayServiceRuntime> {
    const taskName = resolveTaskName(env);

    try {
      const result = await schtasks(['/query', '/tn', taskName, '/fo', 'list', '/v']);
      if (result.exitCode !== 0) {
        return { status: 'unknown' };
      }

      const output = result.stdout;
      let status: 'running' | 'stopped' | 'unknown' = 'unknown';

      const statusMatch = output.match(/Status:\s*(\w+)/i);
      if (statusMatch) {
        const statusStr = statusMatch[1].toLowerCase();
        if (statusStr === 'running') {
          status = 'running';
        } else if (statusStr === 'ready' || statusStr === 'disabled') {
          status = 'stopped';
        }
      }

      // Parse last result code
      let lastExitStatus: number | undefined;
      const resultMatch = output.match(/Last Result:\s*(\d+)/i);
      if (resultMatch) {
        lastExitStatus = parseInt(resultMatch[1], 10);
      }

      return { status, lastExitStatus };
    } catch {
      return { status: 'unknown' };
    }
  },

  async readCommand(env?: GatewayServiceEnv): Promise<GatewayServiceCommandConfig | null> {
    const taskName = resolveTaskName(env);

    try {
      const result = await schtasks(['/query', '/tn', taskName, '/fo', 'list', '/v']);
      if (result.exitCode !== 0) return null;

      const output = result.stdout;
      const taskRunMatch = output.match(/Task To Run:\s*(.+)/i);
      const workDirMatch = output.match(/Start In:\s*(.+)/i);

      if (!taskRunMatch) return null;

      const taskRun = taskRunMatch[1].trim();
      // Handle quoted program path
      let programArguments: string[];
      if (taskRun.startsWith('"')) {
        const closeQuote = taskRun.indexOf('"', 1);
        if (closeQuote > 0) {
          const program = taskRun.slice(1, closeQuote);
          const rest = taskRun.slice(closeQuote + 1).trim();
          programArguments = [program, ...rest.split(/\s+/).filter(Boolean)];
        } else {
          programArguments = taskRun.split(/\s+/);
        }
      } else {
        programArguments = taskRun.split(/\s+/);
      }

      // Read environment from sidecar file (schtasks has no native env support)
      const environment = readTaskEnvSidecar(taskName);

      return {
        programArguments,
        workingDirectory: workDirMatch?.[1]?.trim() || undefined,
        environment,
      };
    } catch {
      return null;
    }
  },
};
