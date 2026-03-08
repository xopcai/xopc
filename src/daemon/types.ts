/**
 * Daemon Service Types - Type definitions for cross-platform service management
 */

import type { Writable } from 'node:stream';

/**
 * Service runtime environment
 */
export interface GatewayServiceEnv {
  XOPCBOT_CONFIG?: string;
  XOPCBOT_WORKSPACE?: string;
  XOPCBOT_LOG_LEVEL?: string;
  XOPCBOT_GATEWAY_TOKEN?: string;
  [key: string]: string | undefined;
}

/**
 * Service install arguments
 */
export interface GatewayServiceInstallArgs {
  env: GatewayServiceEnv;
  stdout?: Writable;
  stderr?: Writable;
  programArguments: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
}

/**
 * Service control arguments (start/stop/restart)
 */
export interface GatewayServiceControlArgs {
  env: GatewayServiceEnv;
  stdout?: Writable;
  stderr?: Writable;
}

/**
 * Service environment query args
 */
export interface GatewayServiceEnvArgs {
  env: GatewayServiceEnv;
}

/**
 * Service runtime status
 */
export type GatewayServiceStatus = 'running' | 'stopped' | 'unknown';

/**
 * Service runtime information
 */
export interface GatewayServiceRuntime {
  status: GatewayServiceStatus;
  pid?: number;
  lastExitStatus?: number;
}

/**
 * Command configuration
 */
export interface GatewayServiceCommandConfig {
  program: string;
  arguments: string[];
  environment?: Record<string, string>;
  workingDirectory?: string;
}

/**
 * Service definition
 */
export interface GatewayService {
  /** Unique label for the service */
  label: string;

  /** Text when service is loaded */
  loadedText: string;

  /** Text when service is not loaded */
  notLoadedText: string;

  /** Install service */
  install: (args: GatewayServiceInstallArgs) => Promise<void>;

  /** Uninstall service */
  uninstall: (args: GatewayServiceControlArgs) => Promise<void>;

  /** Start service */
  start: (args: GatewayServiceControlArgs) => Promise<void>;

  /** Stop service */
  stop: (args: GatewayServiceControlArgs) => Promise<void>;

  /** Restart service */
  restart: (args: GatewayServiceControlArgs) => Promise<void>;

  /** Check if service is loaded/installed */
  isLoaded: (args: GatewayServiceEnvArgs) => Promise<boolean>;

  /** Get service runtime status */
  getRuntime: (args: GatewayServiceEnvArgs) => Promise<GatewayServiceRuntime>;

  /** Read command configuration (for display) */
  readCommand: (env: GatewayServiceEnv) => Promise<GatewayServiceCommandConfig | null>;
}

/**
 * Daemon install result
 */
export interface DaemonInstallResult {
  success: boolean;
  serviceName?: string;
  error?: string;
}

/**
 * Daemon action result
 */
export interface DaemonActionResult {
  success: boolean;
  detail?: string;
}
