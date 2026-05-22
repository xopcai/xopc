/**
 * Port Inspection - Cross-platform port usage detection
 *
 * Provides utilities to:
 * - Check if a port is in use
 * - Identify which process is listening
 * - Classify whether a listener is the gateway
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createLogger } from '../utils/logger.js';

const log = createLogger('PortInspect');

// ─── Types ───

export type PortUsageStatus = 'free' | 'busy' | 'unknown';

export interface PortListener {
  pid?: number;
  ppid?: number;
  command?: string;
  commandLine?: string;
  address?: string;
}

export interface PortUsage {
  port: number;
  status: PortUsageStatus;
  listeners: PortListener[];
  hints: string[];
  errors?: string[];
}

export type PortListenerKind = 'gateway' | 'other' | 'unknown';

// ─── Core API ───

/** Inspect port usage: check if busy and identify listeners */
export async function inspectPortUsage(port: number): Promise<PortUsage> {
  const errors: string[] = [];

  // First try OS-level listener detection
  let listeners: PortListener[] = [];
  try {
    listeners = await detectListeners(port);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  // Determine status
  let status: PortUsageStatus;
  if (listeners.length > 0) {
    status = 'busy';
  } else {
    // Fallback: try to bind the port
    status = await probePortAvailability(port);
  }

  // If busy but no listeners detected, clear the list
  if (status !== 'busy') {
    listeners = [];
  }

  const hints = buildPortHints(listeners, port);
  if (status === 'busy' && listeners.length === 0) {
    hints.push('Port is in use but process details unavailable (try running with elevated permissions).');
  }

  return {
    port,
    status,
    listeners,
    hints,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/** Classify whether a port listener belongs to the gateway */
export function classifyPortListener(listener: PortListener, runtimePid?: number): PortListenerKind {
  // PID match
  if (runtimePid && listener.pid === runtimePid) {
    return 'gateway';
  }

  // Command/commandLine heuristics
  const cmd = (listener.command || listener.commandLine || '').toLowerCase();
  if (cmd.includes('xopc') || cmd.includes('gateway')) {
    return 'gateway';
  }

  if (listener.pid) {
    return 'other';
  }

  return 'unknown';
}

/** Format port diagnostics for display */
export function formatPortDiagnostics(usage: PortUsage): string[] {
  const lines: string[] = [];

  lines.push(`Port ${usage.port}: ${usage.status}`);

  for (const listener of usage.listeners) {
    const parts: string[] = [];
    if (listener.pid) parts.push(`pid=${listener.pid}`);
    if (listener.command) parts.push(`cmd=${listener.command}`);
    if (listener.address) parts.push(`addr=${listener.address}`);
    lines.push(`  Listener: ${parts.join(' ')}`);
  }

  for (const hint of usage.hints) {
    lines.push(`  💡 ${hint}`);
  }

  return lines;
}

// ─── Platform Detection ───

async function detectListeners(port: number): Promise<PortListener[]> {
  if (process.platform === 'win32') {
    return detectWindowsListeners(port);
  }
  return detectUnixListeners(port);
}

async function detectUnixListeners(port: number): Promise<PortListener[]> {
  // Try lsof first (available on macOS and most Linux)
  const lsofResult = await runCommand(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pcn']);
  if (lsofResult.exitCode === 0 && lsofResult.stdout.trim()) {
    return parseLsofOutput(lsofResult.stdout);
  }

  // Fallback to ss (Linux)
  const ssResult = await runCommand(['ss', '-tlnp', `sport = :${port}`]);
  if (ssResult.exitCode === 0 && ssResult.stdout.trim()) {
    return parseSsOutput(ssResult.stdout, port);
  }

  return [];
}

async function detectWindowsListeners(port: number): Promise<PortListener[]> {
  const result = await runCommand(['netstat', '-ano', '-p', 'tcp']);
  if (result.exitCode !== 0) return [];

  const listeners: PortListener[] = [];
  const portToken = `:${port}`;

  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.includes('LISTENING') || !trimmed.includes(portToken)) continue;

    const parts = trimmed.split(/\s+/);
    const pidStr = parts[parts.length - 1];
    const pid = parseInt(pidStr, 10);

    if (Number.isFinite(pid) && pid > 0) {
      listeners.push({ pid, address: parts[1] });
    }
  }

  return listeners;
}

// ─── Output Parsing ───

function parseLsofOutput(output: string): PortListener[] {
  const listeners: PortListener[] = [];
  let current: Partial<PortListener> = {};

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;

    const type = line[0];
    const value = line.slice(1);

    switch (type) {
      case 'p':
        if (current.pid) {
          listeners.push(current as PortListener);
        }
        current = { pid: parseInt(value, 10) };
        break;
      case 'c':
        current.command = value;
        break;
      case 'n':
        current.address = value;
        break;
    }
  }

  if (current.pid) {
    listeners.push(current as PortListener);
  }

  return listeners;
}

function parseSsOutput(output: string, port: number): PortListener[] {
  const listeners: PortListener[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes('LISTEN')) continue;
    if (!trimmed.includes(`:${port}`)) continue;

    const listener: PortListener = {};

    // Extract PID from users:(("name",pid=N,...))
    const pidMatch = trimmed.match(/pid=(\d+)/);
    if (pidMatch) {
      listener.pid = parseInt(pidMatch[1], 10);
    }

    const cmdMatch = trimmed.match(/users:\(\("([^"]+)"/);
    if (cmdMatch) {
      listener.command = cmdMatch[1];
    }

    // Extract local address
    const parts = trimmed.split(/\s+/);
    const addrPart = parts.find((p) => p.includes(`:${port}`));
    if (addrPart) {
      listener.address = addrPart;
    }

    listeners.push(listener);
  }

  return listeners;
}

// ─── Port Probing ───

async function probePortAvailability(port: number): Promise<PortUsageStatus> {
  const hosts = ['127.0.0.1', '0.0.0.0'];

  for (const host of hosts) {
    const result = await tryListenOnPort(port, host);
    if (result === 'busy') return 'busy';
  }

  return 'free';
}

function tryListenOnPort(port: number, host: string): Promise<PortUsageStatus> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve('busy');
      } else {
        resolve('unknown');
      }
    });

    server.listen(port, host, () => {
      server.close(() => resolve('free'));
    });
  });
}

// ─── Hints ───

function buildPortHints(listeners: PortListener[], port: number): string[] {
  const hints: string[] = [];

  for (const listener of listeners) {
    const cmd = (listener.command || listener.commandLine || '').toLowerCase();
    if (cmd.includes('xopc') || cmd.includes('gateway')) {
      hints.push(`xopc gateway is already running (pid ${listener.pid}).`);
    }
  }

  if (hints.length === 0 && listeners.length > 0) {
    const pids = listeners.map((l) => l.pid).filter(Boolean);
    if (pids.length > 0) {
      hints.push(`Port ${port} is used by pid ${pids.join(', ')}.`);
    }
  }

  return hints;
}

// ─── Command Runner ───

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

function runCommand(args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    try {
      const [cmd, ...cmdArgs] = args;
      const child = spawn(cmd, cmdArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code });
      });

      child.on('error', (err) => {
        resolve({ stdout: '', stderr: '', exitCode: null, error: err.message });
      });
    } catch (err) {
      resolve({ stdout: '', stderr: '', exitCode: null, error: String(err) });
    }
  });
}
