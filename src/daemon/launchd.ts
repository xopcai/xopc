/**
 * LaunchAgent Service - macOS user service management
 */

import { writeFile, mkdir, readFile, rm, access, constants } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
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
  GatewayServiceEnv,
} from './types.js';

const log = createLogger('LaunchdService');

/**
 * Get GUI domain (for user launchd)
 */
function resolveGuiDomain(): string {
  // For user agents, use "gui/" domain
  return `gui/${os.userInfo().uid}`;
}

/**
 * Resolve plist path
 */
function resolveLaunchAgentPlistPath(env: GatewayServiceEnv): string {
  const home = os.homedir();
  const libraryPath = path.join(home, 'Library', 'LaunchAgents');
  const label = env.XOPCBOT_PROFILE ? `ai.xopcbot.gateway.${env.XOPCBOT_PROFILE}` : 'ai.xopcbot.gateway';
  return path.join(libraryPath, `${label}.plist`);
}

/**
 * Resolve log directory
 */
function resolveLogDir(): string {
  return path.join(os.homedir(), '.xopcbot', 'logs');
}

/**
 * Build plist content
 */
function buildLaunchAgentPlist(params: {
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
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>`;

  return plist;
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Execute launchctl command
 */
async function launchctl(args: string[], _options?: { stdin?: string }): Promise<string> {
  try {
    const child = spawn('launchctl', args, {
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
    
    return await new Promise<string>((resolve, reject) => {
      child.on('close', () => {
        if (err) {
          const errStr = err.trim();
          if (errStr) {
            log.debug({ stderr: errStr }, 'launchctl stderr');
          }
        }
        resolve(out);
      });
      child.on('error', reject);
    });
  } catch (err) {
    const e = err as { message?: string };
    throw new Error(`launchctl failed: ${e.message || String(err)}`);
  }
}

/**
 * Check if launchd is available
 */
export function isLaunchdAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    const result = spawnSync('launchctl', ['print', 'gui/'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * LaunchAgent service implementation
 */
export const launchdService: GatewayService = {
  label: 'ai.xopcbot.gateway',
  loadedText: 'ai.xopcbot.gateway',
  notLoadedText: 'ai.xopcbot.gateway',

  async install(args: GatewayServiceInstallArgs): Promise<void> {
    const plistPath = resolveLaunchAgentPlistPath(args.env);
    const logDir = resolveLogDir();
    const label = args.env.XOPCBOT_PROFILE
      ? `ai.xopcbot.gateway.${args.env.XOPCBOT_PROFILE}`
      : 'ai.xopcbot.gateway';

    // Ensure directories exist
    await mkdir(path.dirname(plistPath), { recursive: true });
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

    // Build plist
    const plist = buildLaunchAgentPlist({
      label,
      programArguments: args.programArguments,
      workingDirectory: args.workingDirectory,
      environment,
      stdoutPath: path.join(logDir, 'gateway.log'),
      stderrPath: path.join(logDir, 'gateway.err.log'),
    });

    // Write plist
    await writeFile(plistPath, plist, 'utf8');
    args.stdout?.write(`Written: ${plistPath}\n`);

    // Bootstrap the agent
    const domain = resolveGuiDomain();
    await launchctl(['bootstrap', domain, plistPath]);

    log.info('LaunchAgent installed');
  },

  async uninstall(args: GatewayServiceControlArgs): Promise<void> {
    const plistPath = resolveLaunchAgentPlistPath(args.env);

    // Bootout (stop and unload)
    const domain = resolveGuiDomain();
    try {
      await launchctl(['bootout', domain, plistPath]);
    } catch {
      // Ignore if not loaded
    }

    // Remove plist
    if (existsSync(plistPath)) {
      await rm(plistPath);
      args.stdout?.write(`Removed: ${plistPath}\n`);
    }

    log.info('LaunchAgent uninstalled');
  },

  async start(args: GatewayServiceControlArgs): Promise<void> {
    const plistPath = resolveLaunchAgentPlistPath(args.env);
    const domain = resolveGuiDomain();
    await launchctl(['bootstrap', domain, plistPath]);
    log.info('LaunchAgent started');
  },

  async stop(args: GatewayServiceControlArgs): Promise<void> {
    const plistPath = resolveLaunchAgentPlistPath(args.env);
    const domain = resolveGuiDomain();
    try {
      await launchctl(['bootout', domain, plistPath]);
    } catch {
      // Ignore if not running
    }
    log.info('LaunchAgent stopped');
  },

  async restart(args: GatewayServiceControlArgs): Promise<void> {
    await this.stop(args);
    await this.start(args);
    log.info('LaunchAgent restarted');
  },

  async isLoaded(args: GatewayServiceEnvArgs): Promise<boolean> {
    const plistPath = resolveLaunchAgentPlistPath(args.env);
    try {
      await access(plistPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  },

  async getRuntime(args: GatewayServiceEnvArgs): Promise<GatewayServiceRuntime> {
    const plistPath = resolveLaunchAgentPlistPath(args.env);
    const domain = resolveGuiDomain();

    try {
      const output = await launchctl(['print', `${domain}/${path.basename(plistPath, '.plist')}`]);
      
      // Parse output for PID and state
      const pidMatch = output.match(/pid\s*=\s*(\d+)/);
      const stateMatch = output.match(/"initial"\s*=\s*"([^"]+)"/);
      
      let status: 'running' | 'stopped' | 'unknown' = 'unknown';
      let pid: number | undefined;
      
      if (stateMatch) {
        status = stateMatch[1] === 'running' ? 'running' : 'stopped';
      }
      if (pidMatch) {
        pid = parseInt(pidMatch[1], 10);
      }
      
      return { status, pid };
    } catch {
      return { status: 'unknown' };
    }
  },

  async readCommand(env: GatewayServiceEnv): Promise<GatewayServiceCommandConfig | null> {
    const plistPath = resolveLaunchAgentPlistPath(env);
    if (!existsSync(plistPath)) return null;

    const content = await readFile(plistPath, 'utf8');
    
    // Parse plist (simple regex approach)
    const argsMatch = content.match(/<array>[\s\S]*?<\/array>/);
    const programArgs: string[] = [];
    
    if (argsMatch) {
      const stringMatches = argsMatch[0].match(/<string>([^<]+)<\/string>/g);
      if (stringMatches) {
        for (const m of stringMatches) {
          programArgs.push(m.replace(/<\/?string>/g, ''));
        }
      }
    }

    const workDirMatch = content.match(/<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/);

    return {
      program: programArgs[0] || '',
      arguments: programArgs.slice(1),
      workingDirectory: workDirMatch?.[1],
    };
  },
};
