/**
 * Daemon Service Types - Type definitions for cross-platform service management
 */

import type { Writable } from 'node:stream';

// ─── Service Environment ───

export type GatewayServiceEnv = Record<string, string | undefined>;

// ─── Service Install Arguments ───

export interface GatewayServiceInstallArgs {
  env: GatewayServiceEnv;
  stdout?: Writable;
  stderr?: Writable;
  programArguments: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  description?: string;
}

// ─── Service Control Arguments ───

export interface GatewayServiceControlArgs {
  env: GatewayServiceEnv;
  stdout?: Writable;
  stderr?: Writable;
  disable?: boolean;
}

// ─── Service Environment Query ───

export interface GatewayServiceEnvArgs {
  env?: GatewayServiceEnv;
}

// ─── Service Runtime ───

export type GatewayServiceStatus = 'running' | 'stopped' | 'unknown';

export interface GatewayServiceRuntime {
  status: GatewayServiceStatus;
  pid?: number;
  lastExitStatus?: number;
}

// ─── Command Configuration ───

export interface GatewayServiceCommandConfig {
  programArguments: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  sourcePath?: string;
}

// ─── Service State ───

export interface GatewayServiceState {
  installed: boolean;
  loaded: boolean;
  running: boolean;
  env: GatewayServiceEnv;
  command: GatewayServiceCommandConfig | null;
  runtime?: GatewayServiceRuntime;
}

// ─── Restart ───

export type GatewayServiceRestartOutcome = 'restarted' | 'scheduled';

export interface GatewayServiceRestartResult {
  outcome: GatewayServiceRestartOutcome;
}

export interface GatewayRestartIntent {
  force?: boolean;
  waitMs?: number;
}

// ─── Start Repair ───

export type StartRepairIssueCode =
  | 'version-mismatch'
  | 'temporary-program'
  | 'missing-program';

export interface GatewayServiceStartRepairIssue {
  code: StartRepairIssueCode;
  message: string;
}

export type GatewayServiceStartOutcome =
  | 'started'
  | 'scheduled'
  | 'missing-install'
  | 'repair-required';

export interface GatewayServiceStartResult {
  outcome: GatewayServiceStartOutcome;
  state: GatewayServiceState;
  issues?: GatewayServiceStartRepairIssue[];
}

// ─── CLI Action Types ───

export type DaemonAction = 'install' | 'uninstall' | 'start' | 'stop' | 'restart';

export interface DaemonActionResponse {
  ok: boolean;
  action: DaemonAction;
  result?: string;
  message?: string;
  error?: string;
  hints?: string[];
  warnings?: string[];
  service?: { label: string; loaded: boolean; loadedText: string; notLoadedText: string };
}

export interface DaemonLifecycleOptions {
  json?: boolean;
  force?: boolean;
  safe?: boolean;
  wait?: string;
  disable?: boolean;
}

export interface DaemonInstallOptions {
  port?: string | number;
  runtime?: string;
  token?: string;
  force?: boolean;
  json?: boolean;
}

// ─── Service Definition ───

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

  /** Stop service */
  stop: (args: GatewayServiceControlArgs) => Promise<void>;

  /** Restart service (returns outcome for restart health checks) */
  restart: (args: GatewayServiceControlArgs) => Promise<GatewayServiceRestartResult>;

  /** Check if service is loaded/installed */
  isLoaded: (args: GatewayServiceEnvArgs) => Promise<boolean>;

  /** Read service runtime status */
  readRuntime: (env?: GatewayServiceEnv) => Promise<GatewayServiceRuntime>;

  /** Read command configuration */
  readCommand: (env?: GatewayServiceEnv) => Promise<GatewayServiceCommandConfig | null>;
}

// ─── Legacy Compat ───

export interface DaemonInstallResult {
  success: boolean;
  serviceName?: string;
  error?: string;
}

export interface DaemonActionResult {
  success: boolean;
  detail?: string;
}
