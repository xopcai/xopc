/**
 * Gateway Process Manager Types
 */

/**
 * Gateway process status
 */
export interface GatewayStatus {
  running: boolean;
  pid?: number;
  port?: number;
  host?: string;
  uptime?: number;
  health?: 'healthy' | 'unhealthy' | 'unknown';
  lastError?: string;
}

/**
 * Configuration for starting gateway process
 */
export interface GatewayProcessConfig {
  /** Host to bind to */
  host: string;
  /** Port to listen on */
  port: number;
  /** Authentication token (optional, will use config if not provided) */
  token?: string;
  /** Config file path */
  configPath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Run in background (daemon mode) */
  background?: boolean;
  /** Log file path for background mode */
  logFile?: string;
  /** Enable config hot reload */
  enableHotReload?: boolean;
}

/**
 * Result of starting gateway process
 */
export interface StartResult {
  success: boolean;
  pid?: number;
  error?: string;
  portInUse?: boolean;
  alreadyRunning?: boolean;
}

/**
 * Result of stopping gateway process
 */
export interface StopResult {
  success: boolean;
  error?: string;
  timedOut?: boolean;
  wasRunning?: boolean;
}

/**
 * Options for stopping gateway process
 */
export interface StopOptions {
  /** Timeout in milliseconds before force kill */
  timeout?: number;
  /** Force kill immediately */
  force?: boolean;
}
