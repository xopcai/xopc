import { loadConfig } from '../../../config/index.js';
import { resolveConfigPath } from '../../../config/paths.js';
import {
  resolveGatewayLaunchAgentLabel,
  resolveGatewaySystemdServiceName,
  resolveGatewayWindowsTaskName,
} from '../../../daemon/constants.js';

export function parsePortFromArgs(programArguments: string[] | undefined): number | null {
  if (!programArguments?.length) {
    return null;
  }
  for (let i = 0; i < programArguments.length; i += 1) {
    const arg = programArguments[i];
    if (arg === '--port') {
      const next = programArguments[i + 1];
      const parsed = parseInt(String(next), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    if (arg?.startsWith('--port=')) {
      const parsed = parseInt(arg.split('=', 2)[1] ?? '', 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return null;
}

export function resolveGatewayPortFromConfig(configPath?: string): number {
  const config = loadConfig(configPath ?? resolveConfigPath());
  return typeof config.gateway?.port === 'number' ? config.gateway.port : 18790;
}

export function renderGatewayServiceStartHints(env: NodeJS.ProcessEnv = process.env): string[] {
  const profile = env.XOPC_PROFILE;
  const systemdName = resolveGatewaySystemdServiceName(profile);
  const launchAgent = resolveGatewayLaunchAgentLabel(profile);
  const windowsTask = resolveGatewayWindowsTaskName(profile);

  switch (process.platform) {
    case 'darwin':
      return [
        'xopc gateway service install',
        'xopc gateway',
        `LaunchAgent: ~/Library/LaunchAgents/${launchAgent}.plist`,
      ];
    case 'linux':
      return [
        'xopc gateway service install',
        'xopc gateway',
        `systemd user service: ${systemdName}.service`,
      ];
    case 'win32':
      return [
        'xopc gateway service install',
        'xopc gateway',
        `Scheduled task: ${windowsTask}`,
      ];
    default:
      return ['xopc gateway service install', 'xopc gateway'];
  }
}
