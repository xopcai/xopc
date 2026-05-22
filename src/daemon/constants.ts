/**
 * Daemon Constants - Service labels, paths, and configuration values
 */

import os from 'node:os';
import path from 'node:path';

const SERVICE_BASE_LABEL = 'ai.xopc.gateway';

export function resolveGatewayLaunchAgentLabel(profile?: string): string {
  const normalized = normalizeProfile(profile);
  return normalized ? `${SERVICE_BASE_LABEL}.${normalized}` : SERVICE_BASE_LABEL;
}

export function resolveGatewaySystemdServiceName(profile?: string): string {
  const normalized = normalizeProfile(profile);
  return normalized ? `xopc-gateway-${normalized}` : 'xopc-gateway';
}

export function resolveGatewayWindowsTaskName(profile?: string): string {
  const normalized = normalizeProfile(profile);
  return normalized ? `xopc-gateway-${normalized}` : 'xopc-gateway';
}

export function resolveLaunchAgentPlistPath(profile?: string): string {
  const label = resolveGatewayLaunchAgentLabel(profile);
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

export function resolveSystemdUnitPath(profile?: string): string {
  const name = resolveGatewaySystemdServiceName(profile);
  return path.join(os.homedir(), '.config', 'systemd', 'user', `${name}.service`);
}

export function formatGatewayServiceDescription(params?: {
  profile?: string;
  version?: string;
}): string {
  const profile = normalizeProfile(params?.profile);
  const version = params?.version?.trim();
  const parts: string[] = [];
  if (profile) parts.push(`profile: ${profile}`);
  if (version) parts.push(`v${version}`);
  if (parts.length === 0) return 'xopc Gateway';
  return `xopc Gateway (${parts.join(', ')})`;
}

function normalizeProfile(profile?: string): string | null {
  const trimmed = profile?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'default') return null;
  return trimmed;
}

// ─── Numeric Constants ───

export const DEFAULT_GATEWAY_PORT = 18790;
export const LAUNCH_AGENT_THROTTLE_INTERVAL_SECONDS = 10;
export const LAUNCH_AGENT_EXIT_TIMEOUT_SECONDS = 20;
export const SYSTEMD_RESTART_SEC = 5;
export const SYSTEMD_START_LIMIT_BURST = 5;
export const SYSTEMD_START_LIMIT_INTERVAL_SEC = 60;
export const SERVICE_VERSION_ENV_KEY = 'XOPC_SERVICE_VERSION';
