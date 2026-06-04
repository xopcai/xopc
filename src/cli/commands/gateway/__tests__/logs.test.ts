import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogsCommand, gatewayLogsTestInternals } from '../logs.js';

vi.mock('../../../context.js', () => ({
  getContextWithOpts: vi.fn(() => ({
    configPath: '/root/.xopc/xopc.json',
    workspacePath: '/root/.xopc/workspace/main',
    isVerbose: false,
  })),
}));

describe('Gateway Logs Command', () => {
  let tempDir: string;
  let originalLogDir: string | undefined;

  beforeEach(async () => {
    originalLogDir = process.env.XOPC_LOG_DIR;
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'xopc-gateway-logs-'));
  });

  afterEach(async () => {
    if (originalLogDir === undefined) {
      delete process.env.XOPC_LOG_DIR;
    } else {
      process.env.XOPC_LOG_DIR = originalLogDir;
    }
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('creates command with expected options', () => {
    const cmd = createLogsCommand();

    expect(cmd.name()).toBe('logs');
    expect(cmd.description()).toBe('View gateway logs');
    expect(cmd.options.some((option) => option.attributeName() === 'lines')).toBe(true);
    expect(cmd.options.some((option) => option.attributeName() === 'follow')).toBe(true);
  });

  it('resolves log path without shell-specific path concatenation', () => {
    process.env.XOPC_LOG_DIR = path.join(tempDir, 'logs with spaces');

    const logPath = gatewayLogsTestInternals.resolveGatewayLogPath('/root/.xopc/xopc.json');

    expect(logPath).toBe(path.join(tempDir, 'logs with spaces', 'app.log'));
  });

  it('reads last lines using Node APIs instead of shell tail', async () => {
    const logPath = path.join(tempDir, 'app.log');
    await writeFile(logPath, 'one\ntwo\nthree\nfour\n', 'utf8');

    const output = await gatewayLogsTestInternals.readLastLines(logPath, 2);

    expect(output).toBe('three\nfour\n');
  });

  it('returns a friendly message when log file is missing', async () => {
    const output = await gatewayLogsTestInternals.readLastLines(path.join(tempDir, 'missing.log'), 10);

    expect(output).toBe('No logs found\n');
  });

  it('prints static logs from custom log dir', async () => {
    const logDir = path.join(tempDir, 'logs');
    await mkdir(logDir, { recursive: true });
    await writeFile(path.join(logDir, 'app.log'), 'alpha\nbeta\ngamma\n', 'utf8');
    process.env.XOPC_LOG_DIR = logDir;
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const cmd = createLogsCommand();
    await cmd.parseAsync(['node', 'test', '--lines', '2']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Last 2 lines'));
    expect(consoleLogSpy).toHaveBeenCalledWith('beta\ngamma\n');
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
