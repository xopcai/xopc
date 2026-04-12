/**
 * Install Plan Builder - Build gateway installation configuration
 */

import path from 'node:path';
import { homedir } from 'os';
import { createLogger } from '../utils/logger.js';
import type { GatewayServiceInstallArgs, GatewayServiceEnv } from './types.js';

const log = createLogger('InstallPlan');

export interface InstallPlan {
  programArguments: string[];
  workingDirectory: string;
  environment: Record<string, string>;
}

/**
 * Resolve default config path
 */
function resolveDefaultConfigPath(): string {
  const envConfig = process.env.XOPC_CONFIG;
  if (envConfig) return envConfig;
  return path.join(homedir(), '.xopc', 'config.json');
}

/**
 * Resolve default workspace
 */
function resolveDefaultWorkspace(): string {
  const envWorkspace = process.env.XOPC_WORKSPACE;
  if (envWorkspace) return envWorkspace;
  return path.join(homedir(), '.xopc', 'workspace');
}

/**
 * Build gateway install plan
 */
export function buildGatewayInstallPlan(params: {
  port: number;
  host?: string;
  token?: string;
  env?: GatewayServiceEnv;
  runtime?: 'node' | 'binary';
}): InstallPlan {
  const configPath = resolveDefaultConfigPath();
  const workspace = resolveDefaultWorkspace();

  // Determine executable
  let program: string;
  if (params.runtime === 'binary') {
    // Try to find bundled binary
    const possiblePaths = [
      path.join(process.execPath, '..', 'xopc'),
      path.join(process.execPath, '..', 'xopc.exe'),
      process.execPath, // Fallback to current node
    ];

    program = possiblePaths.find((p) => {
      try {
        require('fs').existsSync(p);
        return true;
      } catch {
        return false;
      }
    }) || process.execPath;
  } else {
    // Use node executable
    program = process.execPath;
  }

  // Build arguments
  const args = [
    ...process.execArgv.filter((arg) => !arg.startsWith('--inspect')),
    // Entry point - use the built index.js or source
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'cli', 'index.js'),
    'gateway',
    '--foreground',
    '--port', params.port.toString(),
  ];

  if (params.host && params.host !== '0.0.0.0') {
    args.push('--host', params.host);
  }

  // Build environment
  const env: Record<string, string> = {
    XOPC_CONFIG: configPath,
    XOPC_WORKSPACE: workspace,
    XOPC_LOG_LEVEL: process.env.XOPC_LOG_LEVEL || 'info',
    XOPC_LOG_FILE: 'true',
    XOPC_LOG_CONSOLE: 'false',
  };

  if (params.token) {
    env.XOPC_GATEWAY_TOKEN = params.token;
  }

  // Copy over other relevant env vars
  const relevantEnvVars = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'BRAVE_API_KEY',
    'XOPC_LOG_RETENTION_DAYS',
  ];

  for (const key of relevantEnvVars) {
    if (process.env[key]) {
      env[key] = process.env[key]!;
    }
  }

  // Add custom env from params
  if (params.env) {
    for (const [key, value] of Object.entries(params.env)) {
      if (value !== undefined && !key.startsWith('XOPC_')) {
        env[key] = value;
      }
    }
  }

  log.info({
    program,
    args,
    env: Object.keys(env),
  }, 'Built gateway install plan');

  return {
    programArguments: [program, ...args],
    workingDirectory: path.dirname(configPath),
    environment: env,
  };
}

/**
 * Build install args from plan
 */
export function buildGatewayInstallArgs(params: {
  port: number;
  host?: string;
  token?: string;
  env?: GatewayServiceEnv;
  runtime?: 'node' | 'binary';
}): GatewayServiceInstallArgs {
  const plan = buildGatewayInstallPlan(params);

  return {
    env: params.env || process.env,
    programArguments: plan.programArguments,
    workingDirectory: plan.workingDirectory,
    environment: plan.environment,
  };
}
