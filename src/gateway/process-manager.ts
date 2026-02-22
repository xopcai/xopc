/**
 * Gateway Process Manager
 * 
 * Manages the lifecycle of the gateway server process.
 * Supports starting, stopping, and restarting the gateway in background mode.
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import type {
  GatewayStatus,
  GatewayProcessConfig,
  StartResult,
  StopResult,
  StopOptions,
} from './process-manager.types.js';
import {
  writePidFile,
  readPidFile,
  removePidFile,
  processExists,
  cleanupStalePidFile,
} from './pid-file.js';
import { checkPortAvailable, getProcessUsingPort, formatPortConflictError } from './port-checker.js';

const log = createLogger('GatewayProcessManager');

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root (go up from src/gateway to project root)
const PROJECT_ROOT = join(__dirname, '..', '..');

// Default log file location
const DEFAULT_LOG_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', '.xopcbot', 'logs');
const DEFAULT_LOG_FILE = join(DEFAULT_LOG_DIR, 'gateway.log');

/**
 * Gateway Process Manager class
 */
export class GatewayProcessManager {
  private childProcess: ChildProcess | null = null;
  private config: GatewayProcessConfig | null = null;
  private startTime: number | null = null;

  /**
   * Check if gateway is currently running
   */
  isRunning(): boolean {
    // First check PID file
    const pid = readPidFile();
    if (pid === null) {
      // No PID file, check if we have an active child process
      return this.childProcess !== null && !this.childProcess.killed;
    }

    // Check if process exists
    if (!processExists(pid)) {
      // Process doesn't exist, clean up stale PID file
      cleanupStalePidFile();
      return false;
    }

    return true;
  }

  /**
   * Get current gateway status
   */
  getStatus(): GatewayStatus {
    const pid = readPidFile();
    
    if (!this.isRunning()) {
      return {
        running: false,
      };
    }

    const uptime = this.startTime ? Date.now() - this.startTime : 0;

    return {
      running: true,
      pid: pid || undefined,
      port: this.config?.port,
      host: this.config?.host,
      uptime,
      health: 'unknown', // Would need health check endpoint to determine
    };
  }

  /**
   * Start gateway process
   */
  async start(config: GatewayProcessConfig): Promise<StartResult> {
    log.info({ host: config.host, port: config.port, background: config.background }, 'Starting gateway process');

    // Check if already running
    if (this.isRunning()) {
      log.warn('Gateway is already running');
      return {
        success: false,
        alreadyRunning: true,
        error: 'Gateway is already running. Use "xopcbot gateway restart" to restart.',
      };
    }

    // Clean up any stale PID file
    cleanupStalePidFile();

    // Check if port is available
    const portAvailable = await checkPortAvailable(config.port, config.host);
    if (!portAvailable) {
      const pid = await getProcessUsingPort(config.port);
      const errorMessage = formatPortConflictError(config.port, config.host, pid);
      log.error({ port: config.port, host: config.host, pid }, 'Port is in use');
      
      return {
        success: false,
        portInUse: true,
        error: errorMessage,
      };
    }

    // Build command arguments
    const args = ['gateway'];
    
    if (config.host && config.host !== '0.0.0.0') {
      args.push('--host', config.host);
    }
    
    if (config.port) {
      args.push('--port', String(config.port));
    }
    
    if (config.token) {
      args.push('--token', config.token);
    }
    
    if (config.configPath) {
      args.push('--config', config.configPath);
    }
    
    if (config.verbose) {
      args.push('--verbose');
    }
    
    if (config.enableHotReload === false) {
      args.push('--no-hot-reload');
    }

    try {
      if (config.background) {
        // Background mode: spawn detached process
        await this.startBackground(config, args);
      } else {
        // Foreground mode: spawn attached process
        await this.startForeground(config, args);
      }

      this.config = config;
      this.startTime = Date.now();

      log.info({ pid: this.childProcess?.pid }, 'Gateway process started');

      return {
        success: true,
        pid: this.childProcess?.pid,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Failed to start gateway process');
      
      return {
        success: false,
        error,
      };
    }
  }

  /**
   * Start gateway in background mode (detached process)
   */
  private async startBackground(config: GatewayProcessConfig, args: string[]): Promise<void> {
    const logFile = config.logFile || DEFAULT_LOG_FILE;
    
    // Ensure log directory exists
    const logDir = dirname(logFile);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    // Always use compiled JS for background mode to avoid tsx complexity
    // This ensures clean process detachment
    // __dirname is dist/gateway, so we need to go up one level to dist
    const cliPath = join(__dirname, '..', 'cli', 'index.js');
    
    // Check if compiled code exists
    if (!existsSync(cliPath)) {
      throw new Error(
        'Compiled code not found. Please run "pnpm run build" before using background mode, ' +
        'or use foreground mode (without --background) for development.'
      );
    }
    
    // Use node with compiled JS
    this.childProcess = spawn('node', [cliPath, ...args], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
      shell: false,
    });

    // Write PID file after process is spawned
    if (this.childProcess.pid) {
      writePidFile(this.childProcess.pid);
      log.info({ pid: this.childProcess.pid, logFile }, 'Gateway running in background');
    }

    // Don't attach any event listeners - they would prevent unref from working
    // The child process is now fully detached and will run independently
    
    // Allow parent process to exit immediately
    this.childProcess.unref();
  }

  /**
   * Start gateway in foreground mode (attached process)
   */
  private async startForeground(config: GatewayProcessConfig, args: string[]): Promise<void> {
    const cliPath = join(__dirname, 'cli', 'index.js');
    const isDevelopment = !existsSync(cliPath);
    
    const command = isDevelopment ? 'tsx' : 'node';
    const commandArgs = isDevelopment 
      ? [join(PROJECT_ROOT, 'src', 'cli', 'index.ts'), ...args]
      : [cliPath, ...args];
    
    this.childProcess = spawn(command, commandArgs, {
      stdio: 'inherit', // Inherit stdin/stdout/stderr from parent
      env: { ...process.env },
      shell: false,
      cwd: isDevelopment ? PROJECT_ROOT : undefined,
    });

    // Handle process exit
    this.childProcess.on('exit', (code, signal) => {
      log.info({ code, signal }, 'Gateway process exited');
      this.childProcess = null;
      this.startTime = null;
      removePidFile();
    });

    // Write PID file
    if (this.childProcess.pid) {
      writePidFile(this.childProcess.pid);
    }

    // Don't detach - keep attached to parent process
  }

  /**
   * Append data to log file
   */
  private appendToLogFile(logFile: string, data: Buffer | string): void {
    try {
      const timestamp = new Date().toISOString();
      const content = `[${timestamp}] ${data.toString()}`;
      appendFileSync(logFile, content, 'utf-8');
    } catch (err) {
      log.error({ err }, 'Failed to write to log file');
    }
  }

  /**
   * Stop gateway process gracefully
   */
  async stop(options: StopOptions = {}): Promise<StopResult> {
    const { timeout = 5000, force = false } = options;
    
    log.info({ timeout, force }, 'Stopping gateway process');

    // Check if running
    const wasRunning = this.isRunning();
    if (!wasRunning) {
      log.info('Gateway is not running');
      return {
        success: true,
        wasRunning: false,
      };
    }

    const pid = readPidFile() || this.childProcess?.pid;
    if (!pid) {
      return {
        success: false,
        error: 'Could not determine gateway PID',
      };
    }

    try {
      if (force) {
        // Force kill immediately
        process.kill(pid, 'SIGKILL');
        log.info({ pid }, 'Gateway process force killed');
      } else {
        // Graceful shutdown with timeout
        await this.gracefulShutdown(pid, timeout);
      }

      // Clean up PID file
      removePidFile();
      
      this.childProcess = null;
      this.startTime = null;
      this.config = null;

      return {
        success: true,
        wasRunning: true,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log.error({ err, pid }, 'Failed to stop gateway process');
      
      return {
        success: false,
        error,
        wasRunning: true,
      };
    }
  }

  /**
   * Perform graceful shutdown with timeout
   */
  private async gracefulShutdown(pid: number, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let completed = false;

      // Send SIGTERM for graceful shutdown
      try {
        process.kill(pid, 'SIGTERM');
      } catch (err) {
        reject(err);
        return;
      }

      // Set timeout for force kill
      const timeoutId = setTimeout(() => {
        if (completed) return;
        
        log.warn({ pid }, 'Graceful shutdown timed out, force killing');
        try {
          process.kill(pid, 'SIGKILL');
          completed = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      }, timeout);

      // Poll for process exit
      const checkInterval = setInterval(() => {
        if (!processExists(pid)) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          completed = true;
          log.info({ pid }, 'Gateway process stopped gracefully');
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Restart gateway process
   */
  async restart(config?: GatewayProcessConfig): Promise<void> {
    log.info('Restarting gateway process');
    
    // Stop current process
    await this.stop({ timeout: 5000 });
    
    // Wait a bit for port to be released
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Start with new or existing config
    const startConfig = config || this.config;
    if (!startConfig) {
      throw new Error('No configuration available for restart');
    }
    
    const result = await this.start(startConfig);
    if (!result.success) {
      throw new Error(result.error || 'Failed to restart gateway');
    }
  }

  /**
   * Get gateway log file path
   */
  getLogFile(): string {
    return this.config?.logFile || DEFAULT_LOG_FILE;
  }

  /**
   * Get recent logs (tail)
   */
  async getLogs(options: { lines?: number } = {}): Promise<string> {
    const { lines = 100 } = options;
    const logFile = this.getLogFile();
    
    if (!existsSync(logFile)) {
      return '';
    }

    try {
      const { exec } = await import('child_process');
      return new Promise((resolve) => {
        const cmd = process.platform === 'win32'
          ? `powershell -Command "Get-Content '${logFile}' -Tail ${lines}"`
          : `tail -n ${lines} "${logFile}"`;
        
        exec(cmd, (error, stdout) => {
          if (error) {
            resolve('');
          } else {
            resolve(stdout);
          }
        });
      });
    } catch (err) {
      log.error({ err }, 'Failed to read logs');
      return '';
    }
  }
}

// Export singleton instance for convenience
export const gatewayProcessManager = new GatewayProcessManager();
