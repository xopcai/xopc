/**
 * Daemon Service Abstraction - Cross-platform service management
 *
 * Provides:
 * - Platform-specific service resolution (launchd / systemd / schtasks)
 * - Availability detection
 * - Unified start logic with repair detection
 */

import { existsSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';
import { PACKAGE_VERSION } from '../package-version.js';
import { SERVICE_VERSION_ENV_KEY } from './constants.js';
import type {
  GatewayService,
  GatewayServiceEnv,
  GatewayServiceState,
  GatewayServiceStartResult,
  GatewayServiceStartRepairIssue,
} from './types.js';

const log = createLogger('DaemonService');

let _isDaemonAvailable: boolean | null = null;

// ─── Service Resolution ───

export async function resolveGatewayService(): Promise<GatewayService> {
  const platform = process.platform;

  if (platform === 'darwin') {
    const { launchdService } = await import('./launchd.js');
    return launchdService;
  }

  if (platform === 'linux') {
    const { systemdService } = await import('./systemd.js');
    return systemdService;
  }

  if (platform === 'win32') {
    const { schtasksService } = await import('./schtasks.js');
    return schtasksService;
  }

  throw new Error(`Unsupported platform for daemon services: ${platform}`);
}

// ─── Availability ───

export async function isDaemonAvailableAsync(): Promise<boolean> {
  if (_isDaemonAvailable !== null) {
    return _isDaemonAvailable;
  }

  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      const { isLaunchdAvailable } = await import('./launchd.js');
      _isDaemonAvailable = isLaunchdAvailable();
    } else if (platform === 'linux') {
      const { isSystemdAvailable } = await import('./systemd.js');
      _isDaemonAvailable = isSystemdAvailable();
    } else if (platform === 'win32') {
      const { isSchtasksAvailable } = await import('./schtasks.js');
      _isDaemonAvailable = isSchtasksAvailable();
    } else {
      _isDaemonAvailable = false;
    }
  } catch (err) {
    log.error({ err }, 'Failed to check daemon availability');
    _isDaemonAvailable = false;
  }

  return _isDaemonAvailable!;
}

export function isDaemonAvailable(): boolean {
  const platform = process.platform;
  return platform === 'linux' || platform === 'darwin' || platform === 'win32';
}

// ─── Start with Repair Detection ───

export async function startGatewayService(params: {
  service: GatewayService;
  env?: GatewayServiceEnv;
}): Promise<GatewayServiceStartResult> {
  const { service, env } = params;
  const serviceEnv = env || process.env;

  const initialState = await gatherServiceState(service, serviceEnv);
  if (!initialState.installed) {
    return { task: 'missing-install', state: initialState };
  }

  // Read command to check for repair issues. On macOS, a stopped LaunchAgent can
  // be installed on disk but not loaded into launchd yet.
  const issues = detectStartRepairIssues(initialState.command);

  if (issues.length > 0) {
    return { task: 'repair-required', state: initialState, issues };
  }

  // Start via restart (which handles both cold-start and running scenarios)
  const restartResult = await service.restart({ env: serviceEnv });
  const state = await gatherServiceState(service, serviceEnv);

  return {
    task: restartResult.task === 'restarted' ? 'started' : 'scheduled',
    state,
  };
}

function detectStartRepairIssues(
  command: { programArguments: string[]; environment?: Record<string, string> } | null,
): GatewayServiceStartRepairIssue[] {
  const issues: GatewayServiceStartRepairIssue[] = [];

  if (!command || command.programArguments.length === 0) {
    issues.push({ code: 'missing-program', message: 'Service command configuration is missing' });
    return issues;
  }

  const program = command.programArguments[0];

  // Check if program exists on disk
  if (!existsSync(program)) {
    issues.push({
      code: 'missing-program',
      message: `Service program not found: ${program}`,
    });
    return issues;
  }

  // Check version mismatch
  const serviceVersion = command.environment?.[SERVICE_VERSION_ENV_KEY];
  if (serviceVersion && serviceVersion !== PACKAGE_VERSION) {
    issues.push({
      code: 'version-mismatch',
      message: `Service version ${serviceVersion} does not match current ${PACKAGE_VERSION}`,
    });
  }

  return issues;
}

// ─── State Gathering ───

async function gatherServiceState(
  service: GatewayService,
  env: GatewayServiceEnv,
): Promise<GatewayServiceState> {
  const [loaded, runtime, command] = await Promise.all([
    service.isLoaded({ env }),
    service.readRuntime(env),
    service.readCommand(env),
  ]);

  return {
    installed: loaded || command !== null,
    loaded,
    running: runtime.status === 'running',
    env,
    command,
    runtime,
  };
}

// ─── Display Helpers ───

export function getPlatformName(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macOS (launchd)';
    case 'linux':
      return 'Linux (systemd)';
    case 'win32':
      return 'Windows (Task Scheduler)';
    default:
      return process.platform;
  }
}

export function getServiceLabel(): string {
  return 'xopc-gateway';
}

/** Describe what a restart operation will do on the current platform */
export function describeGatewayServiceRestart(): string {
  switch (process.platform) {
    case 'darwin':
      return 'launchctl kickstart -k (LaunchAgent restart)';
    case 'linux':
      return 'systemctl --user restart (systemd restart)';
    case 'win32':
      return 'schtasks /end + /run (Scheduled Task restart)';
    default:
      return 'platform restart';
  }
}
