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

function resolveTaskDaemonDir(): string {
  return path.join(os.homedir(), '.xopc', 'daemon');
}

function resolveTaskEnvSidecarPath(taskName: string): string {
  return path.join(resolveTaskDaemonDir(), `${taskName}.env.json`);
}

function resolveTaskCommandSidecarPath(taskName: string): string {
  return path.join(resolveTaskDaemonDir(), `${taskName}.command.json`);
}

function resolveTaskWrapperPath(taskName: string): string {
  return path.join(resolveTaskDaemonDir(), `${taskName}.cmd`);
}

function resolveTaskXmlPath(taskName: string): string {
  return path.join(resolveTaskDaemonDir(), `${taskName}.xml`);
}

function escapeCmdSetValue(value: string): string {
  return value
    .replace(/\^/g, '^^')
    .replace(/%/g, '%%')
    .replace(/"/g, '^"')
    .replace(/&/g, '^&')
    .replace(/</g, '^<')
    .replace(/>/g, '^>')
    .replace(/\|/g, '^|');
}

function quoteCmdArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function escapeXmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildTaskWrapperContent(params: {
  programArguments: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
}): string {
  const lines = ['@echo off'];
  for (const [key, value] of Object.entries(params.environment ?? {})) {
    lines.push(`set "${key}=${escapeCmdSetValue(value)}"`);
  }
  if (params.workingDirectory) {
    lines.push(`cd /d ${quoteCmdArg(params.workingDirectory)}`);
  }
  lines.push(params.programArguments.map(quoteCmdArg).join(' '));
  return `${lines.join('\r\n')}\r\n`;
}

function buildTaskXml(params: {
  description: string;
  wrapperPath: string;
  workingDirectory?: string;
}): string {
  const escapedDescription = escapeXmlValue(params.description);
  const escapedWrapperPath = escapeXmlValue(params.wrapperPath);
  const escapedWorkingDirectory = params.workingDirectory ? escapeXmlValue(params.workingDirectory) : '';
  const workingDirectoryXml = escapedWorkingDirectory
    ? `\n      <WorkingDirectory>${escapedWorkingDirectory}</WorkingDirectory>`
    : '';

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${escapedDescription}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapedWrapperPath}</Command>${workingDirectoryXml}
    </Exec>
  </Actions>
</Task>
`;
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

function writeTaskCommandSidecar(taskName: string, args: GatewayServiceInstallArgs): void {
  const sidecarPath = resolveTaskCommandSidecarPath(taskName);
  try {
    writeFileSync(sidecarPath, JSON.stringify({
      programArguments: args.programArguments,
      workingDirectory: args.workingDirectory,
    }, null, 2), 'utf8');
  } catch (err) {
    log.warn({ err, sidecarPath }, 'Failed to write task command sidecar');
  }
}

function readTaskCommandSidecar(taskName: string): Pick<GatewayServiceCommandConfig, 'programArguments' | 'workingDirectory'> | null {
  const sidecarPath = resolveTaskCommandSidecarPath(taskName);
  try {
    const raw = readFileSync(sidecarPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed
      && typeof parsed === 'object'
      && Array.isArray(parsed.programArguments)
      && parsed.programArguments.every((arg: unknown) => typeof arg === 'string')
    ) {
      return {
        programArguments: parsed.programArguments,
        workingDirectory: typeof parsed.workingDirectory === 'string' ? parsed.workingDirectory : undefined,
      };
    }
  } catch {
    // Sidecar missing or corrupt — not fatal
  }
  return null;
}

function writeTaskSupportFiles(taskName: string, args: GatewayServiceInstallArgs): {
  wrapperPath: string;
  xmlPath: string;
} {
  const wrapperPath = resolveTaskWrapperPath(taskName);
  const xmlPath = resolveTaskXmlPath(taskName);
  mkdirSync(resolveTaskDaemonDir(), { recursive: true });
  writeFileSync(wrapperPath, buildTaskWrapperContent({
    programArguments: args.programArguments,
    workingDirectory: args.workingDirectory,
    environment: args.environment,
  }), 'utf8');
  writeFileSync(xmlPath, buildTaskXml({
    description: args.description || 'xopc Gateway Service',
    wrapperPath,
    workingDirectory: args.workingDirectory,
  }), 'utf16le');
  writeTaskEnvSidecar(taskName, args.environment ?? {});
  writeTaskCommandSidecar(taskName, args);
  return { wrapperPath, xmlPath };
}

function removeTaskSupportFiles(taskName: string): void {
  for (const filePath of [
    resolveTaskEnvSidecarPath(taskName),
    resolveTaskCommandSidecarPath(taskName),
    resolveTaskWrapperPath(taskName),
    resolveTaskXmlPath(taskName),
  ]) {
    try {
      rmSync(filePath, { force: true });
    } catch {
      // Best-effort
    }
  }
}

export const schtasksTestInternals = {
  buildTaskWrapperContent,
  buildTaskXml,
  escapeCmdSetValue,
  quoteCmdArg,
  resolveTaskCommandSidecarPath,
  resolveTaskWrapperPath,
  resolveTaskXmlPath,
};

// ─── Availability Check ───

export function isSchtasksAvailable(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const result = spawnSync('schtasks', ['/query', '/?'], {
      stdio: ['ignore', 'ignore', 'ignore'],
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

    // Delete existing task first (ignore errors)
    try {
      await schtasks(['/delete', '/tn', taskName, '/f']);
    } catch {
      // Ignore
    }

    const { wrapperPath, xmlPath } = writeTaskSupportFiles(taskName, args);
    await schtasksExec(['/create', '/tn', taskName, '/xml', xmlPath, '/f']);

    args.stdout?.write(`Created scheduled task: ${taskName}\n`);
    args.stdout?.write(`  Wrapper: ${wrapperPath}\n`);
    args.stdout?.write(`  Command: ${args.programArguments.join(' ')}\n`);

    log.info({ taskName, wrapperPath }, 'Scheduled task installed');
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

    // Clean up support files
    removeTaskSupportFiles(taskName);

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
    return { task: 'restarted' };
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

      const commandSidecar = readTaskCommandSidecar(taskName);
      if (!commandSidecar) return null;

      return {
        programArguments: commandSidecar.programArguments,
        workingDirectory: commandSidecar.workingDirectory,
        environment: readTaskEnvSidecar(taskName),
      };
    } catch {
      return null;
    }
  },
};
