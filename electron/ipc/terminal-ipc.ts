import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { IpcMain, WebContents } from 'electron';
import type { IPty } from 'node-pty';
import * as nodePty from 'node-pty';

import { getGatewayConnection } from '../gateway-process.js';
import { assertTrustedRenderer } from './trusted-renderer.js';

const MAX_TERMINALS = 8;
const MAX_REPLAY_CHARS = 1_000_000;

export type TerminalCreateInput = {
  sessionKey: string;
  sessionId: string;
  cols: number;
  rows: number;
};

export type TerminalDescriptor = {
  terminalId: string;
  sessionKey: string;
  sessionId: string;
  cwd: string;
  replay: string;
  replaySequence: number;
  exited: boolean;
  exitCode?: number;
  signal?: number;
};

type TerminalRecord = Omit<TerminalDescriptor, 'replay'> & {
  owner: WebContents;
  pty: IPty;
  replay: string;
};

type TerminalManagerOptions = {
  resolveWorkspace?: (sessionKey: string, sessionId: string) => Promise<string>;
  spawnPty?: typeof nodePty.spawn;
};

function sendToRenderer(owner: WebContents, channel: string, payload: unknown): void {
  if (owner.isDestroyed()) return;
  try {
    owner.send(channel, payload);
  } catch {
    // The renderer may be destroyed between the state check and send.
  }
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function terminalSize(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function shellEnvironment(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  return {
    ...env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    XOPC_SHELL: 'desktop-terminal',
  };
}

function defaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: process.env.ComSpec || 'cmd.exe', args: [] };
  }
  return {
    file: process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'),
    args: ['-l'],
  };
}

async function ensureNodePtySpawnHelper(): Promise<void> {
  if (process.platform !== 'darwin') return;
  const requireFromMain = createRequire(import.meta.url);
  const packageDir = dirname(requireFromMain.resolve('node-pty/package.json'));
  const virtualHelper = join(packageDir, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper');
  const helper = virtualHelper.includes('app.asar.unpacked')
    ? virtualHelper
    : virtualHelper.replace('app.asar', 'app.asar.unpacked');
  try {
    await access(helper, constants.X_OK);
  } catch {
    await chmod(helper, 0o755);
  }
}

async function fetchGatewayJson(url: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Gateway request failed (${response.status})`);
  }
  return await response.json() as Record<string, unknown>;
}

export async function resolveTerminalWorkspace(sessionKey: string, sessionId: string): Promise<string> {
  const connection = getGatewayConnection();
  if (!connection) {
    throw new Error('Integrated terminal requires a local desktop gateway connection');
  }
  const baseUrl = `http://127.0.0.1:${connection.port}`;
  const resolved = await fetchGatewayJson(
    `${baseUrl}/api/sessions/resolve?sessionKey=${encodeURIComponent(sessionKey)}`,
    connection.token,
  );
  const payload = resolved.payload as Record<string, unknown> | undefined;
  if (payload?.sessionId !== sessionId) {
    throw new Error('Session changed before the terminal was opened');
  }
  const config = await fetchGatewayJson(
    `${baseUrl}/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`,
    connection.token,
  );
  const configPayload = config.payload as Record<string, unknown> | undefined;
  const cwd = requireText(configPayload?.effectiveWorkspacePath, 'effectiveWorkspacePath');
  const info = await stat(cwd);
  if (!info.isDirectory()) {
    throw new Error('Session workspace is not a directory');
  }
  return cwd;
}

export class TerminalManager {
  private readonly records = new Map<string, TerminalRecord>();
  private readonly terminalIdBySessionId = new Map<string, string>();
  private readonly pendingBySessionId = new Map<string, Promise<TerminalDescriptor>>();
  private readonly resolveWorkspace: NonNullable<TerminalManagerOptions['resolveWorkspace']>;
  private readonly spawnPty: NonNullable<TerminalManagerOptions['spawnPty']>;
  private stopped = false;

  constructor(options: TerminalManagerOptions = {}) {
    this.resolveWorkspace = options.resolveWorkspace ?? resolveTerminalWorkspace;
    this.spawnPty = options.spawnPty ?? nodePty.spawn;
  }

  async create(owner: WebContents, raw: TerminalCreateInput): Promise<TerminalDescriptor> {
    const input = {
      sessionKey: requireText(raw?.sessionKey, 'sessionKey'),
      sessionId: requireText(raw?.sessionId, 'sessionId'),
      cols: terminalSize(raw?.cols, 'cols', 20, 500),
      rows: terminalSize(raw?.rows, 'rows', 5, 300),
    };
    if (this.stopped) throw new Error('Terminal manager is stopped');
    const existingId = this.terminalIdBySessionId.get(input.sessionId);
    if (existingId) {
      const existing = this.records.get(existingId);
      if (existing) return this.descriptor(existing);
      this.terminalIdBySessionId.delete(input.sessionId);
    }
    const pending = this.pendingBySessionId.get(input.sessionId);
    if (pending) return pending;
    if (this.records.size + this.pendingBySessionId.size >= MAX_TERMINALS) {
      throw new Error(`At most ${MAX_TERMINALS} terminals may be open`);
    }

    const creation = this.createNew(owner, input).finally(() => {
      this.pendingBySessionId.delete(input.sessionId);
    });
    this.pendingBySessionId.set(input.sessionId, creation);
    return creation;
  }

  private async createNew(owner: WebContents, input: TerminalCreateInput): Promise<TerminalDescriptor> {
    const cwd = await this.resolveWorkspace(input.sessionKey, input.sessionId);
    if (this.stopped) throw new Error('Terminal manager is stopped');
    await ensureNodePtySpawnHelper();
    const shell = defaultShell();
    const child = this.spawnPty(shell.file, shell.args, {
      cwd,
      cols: input.cols,
      rows: input.rows,
      env: shellEnvironment(),
      name: 'xterm-256color',
    });
    const terminalId = crypto.randomUUID();
    const record: TerminalRecord = {
      terminalId,
      sessionKey: input.sessionKey,
      sessionId: input.sessionId,
      cwd,
      replay: '',
      replaySequence: 0,
      exited: false,
      owner,
      pty: child,
    };
    this.records.set(terminalId, record);
    this.terminalIdBySessionId.set(input.sessionId, terminalId);

    child.onData((data) => {
      record.replaySequence += 1;
      record.replay = `${record.replay}${data}`.slice(-MAX_REPLAY_CHARS);
      sendToRenderer(owner, 'terminal:data', { terminalId, data, sequence: record.replaySequence });
    });
    child.onExit(({ exitCode, signal }) => {
      record.exited = true;
      record.exitCode = exitCode;
      record.signal = signal;
      sendToRenderer(owner, 'terminal:exit', { terminalId, exitCode, signal });
    });
    owner.once('destroyed', () => this.close(terminalId));
    if (owner.isDestroyed()) {
      this.close(terminalId);
      throw new Error('Terminal renderer was destroyed');
    }
    return this.descriptor(record);
  }

  write(terminalIdRaw: unknown, data: unknown): void {
    const record = this.requireRecord(terminalIdRaw);
    if (typeof data !== 'string' || !data || data.length > 64 * 1024) {
      throw new Error('Terminal input must be a non-empty string up to 64 KiB');
    }
    if (record.exited) return;
    record.pty.write(data);
  }

  resize(terminalIdRaw: unknown, colsRaw: unknown, rowsRaw: unknown): void {
    const record = this.requireRecord(terminalIdRaw);
    if (record.exited) return;
    record.pty.resize(
      terminalSize(colsRaw, 'cols', 20, 500),
      terminalSize(rowsRaw, 'rows', 5, 300),
    );
  }

  close(terminalIdRaw: unknown): void {
    if (typeof terminalIdRaw !== 'string') return;
    const record = this.records.get(terminalIdRaw);
    if (!record) return;
    this.records.delete(terminalIdRaw);
    this.terminalIdBySessionId.delete(record.sessionId);
    if (!record.exited) record.pty.kill();
  }

  closeAll(): void {
    this.stopped = true;
    for (const terminalId of [...this.records.keys()]) this.close(terminalId);
  }

  private requireRecord(terminalIdRaw: unknown): TerminalRecord {
    const terminalId = requireText(terminalIdRaw, 'terminalId');
    const record = this.records.get(terminalId);
    if (!record) throw new Error('Terminal not found');
    return record;
  }

  private descriptor(record: TerminalRecord): TerminalDescriptor {
    return {
      terminalId: record.terminalId,
      sessionKey: record.sessionKey,
      sessionId: record.sessionId,
      cwd: record.cwd,
      replay: record.replay,
      replaySequence: record.replaySequence,
      exited: record.exited,
      ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
      ...(record.signal !== undefined ? { signal: record.signal } : {}),
    };
  }
}

let activeTerminalManager: TerminalManager | undefined;

export function registerTerminalIpc(ipcMain: IpcMain): void {
  const manager = new TerminalManager();
  activeTerminalManager = manager;

  ipcMain.handle('terminal:create', async (event, input: TerminalCreateInput) => {
    assertTrustedRenderer(event);
    return manager.create(event.sender, input);
  });
  ipcMain.on('terminal:write', (event, terminalId: unknown, data: unknown) => {
    try {
      assertTrustedRenderer(event);
      manager.write(terminalId, data);
    } catch (error) {
      sendToRenderer(event.sender, 'terminal:error', {
        terminalId: typeof terminalId === 'string' ? terminalId : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  ipcMain.handle('terminal:resize', (event, terminalId: unknown, cols: unknown, rows: unknown) => {
    assertTrustedRenderer(event);
    manager.resize(terminalId, cols, rows);
    return { ok: true };
  });
  ipcMain.handle('terminal:close', (event, terminalId: unknown) => {
    assertTrustedRenderer(event);
    manager.close(terminalId);
    return { ok: true };
  });
}

export function stopAllTerminals(): void {
  activeTerminalManager?.closeAll();
  activeTerminalManager = undefined;
}
