/**
 * Daemon Service Abstraction - Cross-platform service management
 */

import { createLogger } from '../utils/logger.js';
import type { GatewayService } from './types.js';

const log = createLogger('DaemonService');

// Cache for platform check
let _isDaemonAvailable: boolean | null = null;

/**
 * Resolve the appropriate service implementation for current platform
 */
export async function resolveGatewayService(): Promise<GatewayService> {
  const platform = process.platform;

  if (platform === 'linux') {
    const { systemdService } = await import('./systemd.js');
    return systemdService;
  }

  if (platform === 'darwin') {
    const { launchdService } = await import('./launchd.js');
    return launchdService;
  }

  if (platform === 'win32') {
    const { schtasksService } = await import('./schtasks.js');
    return schtasksService;
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Synchronous version (throws if service not available)
 */
export function getGatewayServiceSync(): GatewayService {
  const platform = process.platform;

  if (platform === 'linux') {
     
    return require('./systemd.js').systemdService;
  }

  if (platform === 'darwin') {
     
    return require('./launchd.js').launchdService;
  }

  if (platform === 'win32') {
     
    return require('./schtasks.js').schtasksService;
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Check if daemon service is available on current platform
 */
export async function isDaemonAvailableAsync(): Promise<boolean> {
  if (_isDaemonAvailable !== null) {
    return _isDaemonAvailable;
  }

  const platform = process.platform;

  try {
    if (platform === 'linux') {
      const { isSystemdAvailable } = await import('./systemd.js');
      _isDaemonAvailable = isSystemdAvailable();
    } else if (platform === 'darwin') {
      const { isLaunchdAvailable } = await import('./launchd.js');
      _isDaemonAvailable = isLaunchdAvailable();
    } else if (platform === 'win32') {
      const { isSchtasksAvailable } = await import('./schtasks.js');
      _isDaemonAvailable = isSchtasksAvailable();
    } else {
      _isDaemonAvailable = false;
    }
  } catch (e) {
    log.error({ err: e }, 'Failed to check daemon availability');
    _isDaemonAvailable = false;
  }

  return _isDaemonAvailable!;
}

/**
 * Synchronous check (for compatibility, may be inaccurate in some cases)
 */
export function isDaemonAvailable(): boolean {
  // For synchronous check, we can only verify platform
  // The actual availability check should use isDaemonAvailableAsync
  const platform = process.platform;
  
  if (platform === 'linux' || platform === 'darwin' || platform === 'win32') {
    return true; // Assume available, actual check done async
  }
  
  return false;
}

/**
 * Get platform display name
 */
export function getPlatformName(): string {
  switch (process.platform) {
    case 'linux':
      return 'Linux (systemd)';
    case 'darwin':
      return 'macOS (launchd)';
    case 'win32':
      return 'Windows (Task Scheduler)';
    default:
      return process.platform;
  }
}

/**
 * Get service label for display
 */
export function getServiceLabel(): string {
  return 'xopcbot-gateway';
}
