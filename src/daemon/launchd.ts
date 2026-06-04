/**
 * LaunchAgent Service - macOS user service management
 *
 * Aligned with OpenClaw launchd implementation:
 * - KeepAlive with SuccessfulExit=false
 * - ThrottleInterval for restart throttling
 * - ExitTimeOut for graceful shutdown
 * - launchctl bootstrap/bootout for modern service management
 * - launchctl kickstart -k for restart
 */

import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from '../utils/logger.js';
import {
  resolveGatewayLaunchAgentLabel,
  resolveLaunchAgentPlistPath as resolvePlistPathFromConstants,
  LAUNCH_AGENT_THROTTLE_INTERVAL_SECONDS,
  LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS,
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

const log = createLogger('LaunchdService');

// ─── Domain / Path Resolution ───

function resolveGuiDomain(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  return `gui/${uid}`;
}

function resolveProfileFromEnv(env?: GatewayServiceEnv): string | undefined {
  return env?.XOPC_PROFILE?.trim() || undefined;
}

export function resolveLaunchAgentPlistPath(env?: GatewayServiceEnv): string {
  return resolvePlistPathFromConstants(resolveProfileFromEnv(env));
}

function resolveLabelFromEnv(env?: GatewayServiceEnv): string {
  return resolveGatewayLaunchAgentLabel(resolveProfileFromEnv(env));
}

function resolveServiceTarget(env?: GatewayServiceEnv): string {
  return `${resolveGuiDomain()}/${resolveLabelFromEnv(env)}`;
}

function resolveLogDir(): string {
  return path.join(os.homedir(), '.xopc', 'logs');
}

// ─── Plist Generation ───

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildLaunchAgentPlist(params: {
  label: string;
  programArguments: string[];
  workingDirectory?: string;
  environment: Record<string, string>;
  stdoutPath?: string;
  stderrPath?: string;
}): string {
  const envDict = Object.entries(params.environment)
    .map(([k, v]) => `        <key>${k}</key>\n        <string>${escapeXml(v)}</string>`)
    .join('\n');

  const programArgs = params.programArguments
    .map((arg) => `        <string>${escapeXml(arg)}</string>`)
    .join('\n');

  let plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(params.label)}</string>
    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>
`;

  if (params.workingDirectory) {
    plist += `    <key>WorkingDirectory</key>
    <string>${escapeXml(params.workingDirectory)}</string>
`;
  }

  if (Object.keys(params.environment).length > 0) {
    plist += `    <key>EnvironmentVariables</key>
    <dict>
${envDict}
    </dict>
`;
  }

  if (params.stdoutPath) {
    plist += `    <key>StandardOutPath</key>
    <string>${escapeXml(params.stdoutPath)}</string>
`;
  }

  if (params.stderrPath) {
    plist += `    <key>StandardErrorPath</key>
    <string>${escapeXml(params.stderrPath)}</string>
`;
  }

  plist += `    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>${LAUNCH_AGENT_THROTTLE_INTERVAL_SECONDS}</integer>
    <key>ExitTimeOut</key>
    <integer>${LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS}</integer>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>`;

  return plist;
}

// ─── launchctl Execution ───

interface LaunchctlResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function launchctl(args: string[]): Promise<LaunchctlResult> {
  return new Promise<LaunchctlResult>((resolve, reject) => {
    const child = spawn('launchctl', args, {
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
      reject(new Error(`launchctl spawn failed: ${err.message}`));
    });
  });
}

async function launchctlExec(args: string[]): Promise<string> {
  const result = await launchctl(args);
  if (result.stderr.trim()) {
    log.debug({ stderr: result.stderr.trim(), args }, 'launchctl stderr');
  }
  return result.stdout;
}

// ─── Availability Check ───

export function isLaunchdAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    const result = spawnSync('launchctl', ['version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ─── Plist Parsing ───

function parsePlistProgramArguments(content: string): string[] {
  const argsMatch = content.match(
    /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/,
  );
  if (!argsMatch) return [];

  const programArgs: string[] = [];
  const stringMatches = argsMatch[1].matchAll(/<string>([\s\S]*?)<\/string>/g);
  for (const m of stringMatches) {
    programArgs.push(unescapeXml(m[1]));
  }
  return programArgs;
}

function parsePlistEnvironment(content: string): Record<string, string> {
  const envMatch = content.match(
    /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/,
  );
  if (!envMatch) return {};

  const environment: Record<string, string> = {};
  const pairs = envMatch[1].matchAll(
    /<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g,
  );
  for (const pair of pairs) {
    environment[unescapeXml(pair[1])] = unescapeXml(pair[2]);
  }
  return environment;
}

function parsePlistStringValue(content: string, key: string): string | undefined {
  const regex = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`);
  const match = content.match(regex);
  return match ? unescapeXml(match[1]) : undefined;
}

function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ─── Service Implementation ───

export const launchdService: GatewayService = {
  label: resolveGatewayLaunchAgentLabel(),
  loadedText: 'LaunchAgent (loaded)',
  notLoadedText: 'LaunchAgent (not loaded)',

  async install(args: GatewayServiceInstallArgs): Promise<void> {
    const label = resolveLabelFromEnv(args.env);
    const plistPath = resolveLaunchAgentPlistPath(args.env);
    const logDir = resolveLogDir();

    // Ensure directories exist
    await mkdir(path.dirname(plistPath), { recursive: true });
    await mkdir(logDir, { recursive: true });

    // Build environment
    const environment: Record<string, string> = {};
    if (args.environment) {
      Object.assign(environment, args.environment);
    }

    // Build plist
    const plist = buildLaunchAgentPlist({
      label,
      programArguments: args.programArguments,
      workingDirectory: args.workingDirectory,
      environment,
      stdoutPath: path.join(logDir, 'gateway.log'),
      stderrPath: path.join(logDir, 'gateway.err.log'),
    });

    // Write plist file
    await writeFile(plistPath, plist, 'utf8');
    args.stdout?.write(`Written: ${plistPath}\n`);

    // Bootstrap the service
    const domain = resolveGuiDomain();
    const result = await launchctl(['bootstrap', domain, plistPath]);
    if (result.exitCode !== 0 && result.exitCode !== 37) {
      // exit 37 = already loaded, acceptable
      const detail = result.stderr.trim() || result.stdout.trim();
      if (detail) {
        log.warn({ detail, exitCode: result.exitCode }, 'launchctl bootstrap warning');
      }
    }

    log.info({ label, plistPath }, 'LaunchAgent installed and bootstrapped');
  },

  async uninstall(args: GatewayServiceControlArgs): Promise<void> {
    const serviceTarget = resolveServiceTarget(args.env);
    const plistPath = resolveLaunchAgentPlistPath(args.env);

    // Bootout the service (stops + unloads)
    try {
      await launchctlExec(['bootout', serviceTarget]);
    } catch {
      // Ignore if not loaded
    }

    // Remove plist file
    if (existsSync(plistPath)) {
      await rm(plistPath);
      args.stdout?.write(`Removed: ${plistPath}\n`);
    }

    log.info({ plistPath }, 'LaunchAgent uninstalled');
  },

  async stop(args: GatewayServiceControlArgs): Promise<void> {
    const serviceTarget = resolveServiceTarget(args.env);

    if (args.disable) {
      // Disable + bootout: service won't respawn
      const plistPath = resolveLaunchAgentPlistPath(args.env);
      try {
        await launchctlExec(['bootout', serviceTarget]);
      } catch {
        // Ignore
      }
      if (existsSync(plistPath)) {
        await rm(plistPath);
      }
      log.info('LaunchAgent stopped and disabled (plist removed)');
    } else {
      try {
        await launchctlExec(['bootout', serviceTarget]);
      } catch {
        // Service might not be running or loaded.
        log.debug('LaunchAgent bootout failed (may not be loaded)');
      }
      log.info('LaunchAgent stopped and unloaded');
    }
  },

  async restart(args: GatewayServiceControlArgs): Promise<GatewayServiceRestartResult> {
    const serviceTarget = resolveServiceTarget(args.env);

    // Use kickstart -k for reliable restart (kills current + starts new)
    const result = await launchctl(['kickstart', '-k', serviceTarget]);

    if (result.exitCode === 0) {
      log.info('LaunchAgent restarted via kickstart');
      return { outcome: 'restarted' };
    }

    // Fallback: bootout + bootstrap
    const plistPath = resolveLaunchAgentPlistPath(args.env);
    const domain = resolveGuiDomain();

    try {
      await launchctlExec(['bootout', serviceTarget]);
    } catch {
      // Ignore
    }

    const bootstrapResult = await launchctl(['bootstrap', domain, plistPath]);
    if (bootstrapResult.exitCode === 0 || bootstrapResult.exitCode === 37) {
      log.info('LaunchAgent restarted via bootout+bootstrap');
      return { outcome: 'restarted' };
    }

    throw new Error(
      `Failed to restart LaunchAgent: ${bootstrapResult.stderr.trim() || 'unknown error'}`,
    );
  },

  async isLoaded(args: GatewayServiceEnvArgs): Promise<boolean> {
    const serviceTarget = resolveServiceTarget(args.env);
    const result = await launchctl(['print', serviceTarget]);
    return result.exitCode === 0;
  },

  async readRuntime(env?: GatewayServiceEnv): Promise<GatewayServiceRuntime> {
    const serviceTarget = resolveServiceTarget(env);

    try {
      const result = await launchctl(['print', serviceTarget]);
      if (result.exitCode !== 0) {
        return { status: 'stopped' };
      }

      const output = result.stdout;

      // Parse PID
      let pid: number | undefined;
      const pidMatch = output.match(/pid\s*=\s*(\d+)/);
      if (pidMatch) {
        const parsed = parseInt(pidMatch[1], 10);
        if (parsed > 0) pid = parsed;
      }

      // Parse last exit status
      let lastExitStatus: number | undefined;
      const exitMatch = output.match(/last exit code\s*=\s*(\d+)/i);
      if (exitMatch) {
        lastExitStatus = parseInt(exitMatch[1], 10);
      }

      // Determine status from PID presence
      const status = pid ? 'running' : 'stopped';

      return { status, pid, lastExitStatus };
    } catch {
      return { status: 'unknown' };
    }
  },

  async readCommand(env?: GatewayServiceEnv): Promise<GatewayServiceCommandConfig | null> {
    const plistPath = resolveLaunchAgentPlistPath(env);
    if (!existsSync(plistPath)) return null;

    const content = await readFile(plistPath, 'utf8');

    const programArguments = parsePlistProgramArguments(content);
    if (programArguments.length === 0) return null;

    const environment = parsePlistEnvironment(content);
    const workingDirectory = parsePlistStringValue(content, 'WorkingDirectory');

    return {
      programArguments,
      workingDirectory,
      environment,
      sourcePath: plistPath,
    };
  },
};
