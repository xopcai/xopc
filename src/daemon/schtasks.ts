/**
 * Scheduled Task Service - Windows service management via schtasks
 */

import { spawnSync, execFile } from 'node:child_process';
import { createLogger } from '../utils/logger.js';
import {
  GatewayService,
  GatewayServiceInstallArgs,
  GatewayServiceControlArgs,
  GatewayServiceEnvArgs,
  GatewayServiceRuntime,
  GatewayServiceCommandConfig,
} from './types.js';

const log = createLogger('SchtasksService');

const TASK_NAME = 'xopcbot_gateway';

/**
 * Execute schtasks command
 */
async function schtasks(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFile('schtasks', args, { shell: true });
    if (stderr) {
      const errStr = stderr.toString();
      if (errStr) {
        log.debug({ stderr: errStr }, 'schtasks stderr');
      }
    }
    return stdout ? stdout.toString() : '';
  } catch (err) {
    const e = err as { message?: string; stderr?: string };
    throw new Error(`schtasks failed: ${e.message || String(err)}`);
  }
}

/**
 * Check if schtasks is available
 */
export function isSchtasksAvailable(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const result = spawnSync('schtasks', ['/query', '/?'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Scheduled Task service implementation (Windows)
 */
export const schtasksService: GatewayService = {
  label: TASK_NAME,
  loadedText: TASK_NAME,
  notLoadedText: TASK_NAME,

  async install(args: GatewayServiceInstallArgs): Promise<void> {
    // Build command line
    const program = args.programArguments[0];
    const programArgs = args.programArguments.slice(1).join(' ');

    // Delete existing task first (ignore errors)
    try {
      await schtasks(['/delete', '/tn', TASK_NAME, '/f']);
    } catch {
      // Ignore
    }

    // Create task with /sc ONLOGON - runs when user logs on
    // Use /RL LIMITED for least privilege
    const createArgs = [
      '/create',
      '/tn', TASK_NAME,
      '/tr', `"${program}" ${programArgs}`,
      '/sc', 'ONLOGON',
      '/rl', 'LIMITED',
      '/f', // Force overwrite
    ];

    await schtasks(createArgs);

    // Note: Windows scheduled tasks don't support stdout/stderr redirection
    // the same way as Unix. Output goes to Task Scheduler logs.
    args.stdout?.write(`Created scheduled task: ${TASK_NAME}\n`);
    args.stdout?.write(`  Runs on: User logon\n`);
    args.stdout?.write(`  Program: ${program}\n`);
    args.stdout?.write(`  Args: ${programArgs}\n`);

    log.info('Scheduled task installed');
  },

  async uninstall(args: GatewayServiceControlArgs): Promise<void> {
    try {
      await schtasks(['/delete', '/tn', TASK_NAME, '/f']);
      args.stdout?.write(`Deleted scheduled task: ${TASK_NAME}\n`);
    } catch (err) {
      // Task might not exist
      log.debug({ err }, 'Uninstall task not found (may be ok)');
    }
    log.info('Scheduled task uninstalled');
  },

  async start(_args: GatewayServiceControlArgs): Promise<void> {
    // Run task now (one-time)
    await schtasks(['/run', '/tn', TASK_NAME]);
    log.info('Scheduled task started');
  },

  async stop(_args: GatewayServiceControlArgs): Promise<void> {
    // End task
    try {
      await schtasks(['/end', '/tn', TASK_NAME]);
    } catch (err) {
      // Task might not be running
      log.debug({ err }, 'Task not running');
    }
    log.info('Scheduled task stopped');
  },

  async restart(args: GatewayServiceControlArgs): Promise<void> {
    await this.stop(args);
    await this.start(args);
    log.info('Scheduled task restarted');
  },

  async isLoaded(_args: GatewayServiceEnvArgs): Promise<boolean> {
    try {
      await schtasks(['/query', '/tn', TASK_NAME]);
      return true;
    } catch {
      return false;
    }
  },

  async getRuntime(_args: GatewayServiceEnvArgs): Promise<GatewayServiceRuntime> {
    try {
      const output = await schtasks(['/query', '/tn', TASK_NAME, '/fo', 'list', '/v']);
      
      let status: 'running' | 'stopped' | 'unknown' = 'unknown';
      let pid: number | undefined;
      
      // Parse status
      const statusMatch = output.match(/Status:\s*(\w+)/);
      if (statusMatch) {
        const statusStr = statusMatch[1].toLowerCase();
        if (statusStr === 'running') {
          status = 'running';
        } else if (statusStr === 'ready' || statusStr === 'disabled') {
          status = 'stopped';
        }
      }
      
      // Note: Windows tasks don't have PID in standard output
      // Would need WMI query for PID
      
      return { status, pid };
    } catch {
      return { status: 'unknown' };
    }
  },

  async readCommand(_env: NodeJS.ProcessEnv): Promise<GatewayServiceCommandConfig | null> {
    try {
      const output = await schtasks(['/query', '/tn', TASK_NAME, '/fo', 'list', '/v']);
      
      const taskRunMatch = output.match(/Task To Run:\s*(.+)/);
      const workDirMatch = output.match(/Working Directory:\s*(.+)/);
      
      if (!taskRunMatch) return null;
      
      const taskRun = taskRunMatch[1].trim().replace(/^"(.*)"$/, '$1');
      const parts = taskRun.split(' ');
      const program = parts[0];
      const arguments_ = parts.slice(1);
      
      return {
        program,
        arguments: arguments_,
        workingDirectory: workDirMatch?.[1]?.trim(),
      };
    } catch {
      return null;
    }
  },
};
