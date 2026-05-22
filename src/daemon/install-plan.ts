/**
 * Install Plan Builder - Build gateway installation configuration
 *
 * Aligned with OpenClaw: adds XOPC_SERVICE_VERSION, StandardOut/ErrorPath,
 * supports binary runtime detection, and --foreground arg passing.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createLogger } from '../utils/logger.js';
import { SERVICE_VERSION_ENV_KEY, formatGatewayServiceDescription } from './constants.js';
import { PACKAGE_VERSION } from '../package-version.js';
import type { GatewayServiceInstallArgs, GatewayServiceEnv } from './types.js';

const log = createLogger('InstallPlan');

export interface InstallPlan {
  programArguments: string[];
  workingDirectory: string;
  environment: Record<string, string>;
  description: string;
}

// ─── Path Resolution ───

function resolveDefaultConfigPath(): string {
  const envConfig = process.env.XOPC_CONFIG || process.env.XOPC_CONFIG_PATH;
  if (envConfig) return envConfig;
  return path.join(homedir(), '.xopc', 'xopc.json');
}

function resolveDefaultWorkspace(): string {
  const envWorkspace = process.env.XOPC_WORKSPACE;
  if (envWorkspace) return envWorkspace;
  return path.join(homedir(), '.xopc', 'workspace');
}

function resolveLogDir(): string {
  return path.join(homedir(), '.xopc', 'logs');
}

// ─── Binary Detection ───

function isSEABinary(): boolean {
  // Node.js SEA (Single Executable Application) detection
  return !!(process as NodeJS.Process & { pkg?: unknown }).pkg ||
    process.execPath.endsWith('xopc') ||
    process.execPath.endsWith('xopc.exe');
}

function resolveEntryPoint(): string {
  if (isSEABinary()) {
    return process.execPath;
  }
  // Resolve relative to this file's location → ../cli/index.js (built output)
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  return path.join(thisDir, '..', 'cli', 'index.js');
}

// ─── Plan Builder ───

export function buildGatewayInstallPlan(params: {
  port: number;
  host?: string;
  token?: string;
  env?: GatewayServiceEnv;
  runtime?: 'node' | 'binary';
  version?: string;
}): InstallPlan {
  const configPath = resolveDefaultConfigPath();
  const workspace = resolveDefaultWorkspace();
  const version = params.version || PACKAGE_VERSION;

  // Determine program + arguments
  let programArguments: string[];

  if (params.runtime === 'binary' || isSEABinary()) {
    // SEA binary: direct execution
    const binaryPath = process.execPath;
    programArguments = [binaryPath, 'gateway', '--foreground', '--port', params.port.toString()];
  } else {
    // Node.js runtime
    const nodeArgs = process.execArgv.filter(
      (arg) => !arg.startsWith('--inspect') && !arg.startsWith('--debug'),
    );
    const entryPoint = resolveEntryPoint();
    programArguments = [
      process.execPath,
      ...nodeArgs,
      entryPoint,
      'gateway',
      '--foreground',
      '--port', params.port.toString(),
    ];
  }

  if (params.host && params.host !== '0.0.0.0') {
    programArguments.push('--host', params.host);
  }

  // Build environment
  const environment: Record<string, string> = {
    XOPC_CONFIG: configPath,
    XOPC_WORKSPACE: workspace,
    XOPC_LOG_LEVEL: process.env.XOPC_LOG_LEVEL || 'info',
    XOPC_LOG_FILE: 'true',
    XOPC_LOG_CONSOLE: 'false',
    XOPC_LOG_DIR: resolveLogDir(),
    [SERVICE_VERSION_ENV_KEY]: version,
  };

  if (params.token) {
    environment.XOPC_GATEWAY_TOKEN = params.token;
  }

  // Copy relevant API key env vars
  const relevantEnvVars = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'BRAVE_API_KEY',
    'DASHSCOPE_API_KEY',
    'XOPC_LOG_RETENTION_DAYS',
  ];

  for (const key of relevantEnvVars) {
    if (process.env[key]) {
      environment[key] = process.env[key]!;
    }
  }

  // Add custom env from params (non-XOPC keys only; XOPC keys already handled)
  if (params.env) {
    for (const [key, value] of Object.entries(params.env)) {
      if (value !== undefined && !key.startsWith('XOPC_')) {
        environment[key] = value;
      }
    }
  }

  // Service description
  const profile = params.env?.XOPC_PROFILE?.trim() || undefined;
  const description = formatGatewayServiceDescription({ profile, version });

  log.info({
    programArguments: programArguments.slice(0, 3),
    envKeys: Object.keys(environment),
    version,
  }, 'Built gateway install plan');

  return {
    programArguments,
    workingDirectory: path.dirname(configPath),
    environment,
    description,
  };
}

// ─── Install Args Builder ───

export function buildGatewayInstallArgs(params: {
  port: number;
  host?: string;
  token?: string;
  env?: GatewayServiceEnv;
  runtime?: 'node' | 'binary';
  version?: string;
}): GatewayServiceInstallArgs {
  const plan = buildGatewayInstallPlan(params);

  return {
    env: params.env || process.env,
    programArguments: plan.programArguments,
    workingDirectory: plan.workingDirectory,
    environment: plan.environment,
    description: plan.description,
  };
}

// ─── Validation ───

/** Check if the program in an install plan still exists on disk */
export function validateInstallPlanProgram(programArguments: string[]): boolean {
  if (programArguments.length === 0) return false;
  const program = programArguments[0];
  return existsSync(program);
}
