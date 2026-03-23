// Mock os.homedir for consistent paths across environments
vi.mock("os", () => ({
  homedir: () => "/root",
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set consistent HOME for tests
process.env.HOME = '/root';

import { createLogsCommand } from '../logs.js';

// Mock child_process — re-export everything the module under test needs
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
    execSync: vi.fn(),
  };
});

// Mock dependencies
vi.mock('../../index.js', () => ({
  getContextWithOpts: vi.fn(() => ({
    configPath: '/root/.xopcbot/config.json',
    workspacePath: '/root/.xopcbot/workspace',
    isVerbose: false,
  })),
}));

import { spawn, execSync } from 'child_process';

describe('Gateway Logs Command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('createLogsCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createLogsCommand();
      expect(cmd.name()).toBe('logs');
      expect(cmd.description()).toBe('View gateway logs');
    });

    it('should have --lines option with default value', () => {
      const cmd = createLogsCommand();
      const linesOption = cmd.options.find((opt: any) => opt.attributeName() === 'lines');
      expect(linesOption).toBeDefined();
    });

    it('should have --follow option', () => {
      const cmd = createLogsCommand();
      const followOption = cmd.options.find((opt: any) => opt.attributeName() === 'follow');
      expect(followOption).toBeDefined();
    });
  });

  describe('logs display', () => {
    it('should use tail -f in follow mode', async () => {
      const mockTail = {
        on: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockTail as any);

      const cmd = createLogsCommand();
      await cmd.parseAsync(['node', 'test', '--follow']);

      expect(spawn).toHaveBeenCalledWith('tail', ['-f', '-n', '50', expect.stringContaining('app.log')], {
        stdio: 'inherit',
      });
    });

    it('should use execSync in static mode', async () => {
      vi.mocked(execSync).mockReturnValue('log line 1\nlog line 2\n');

      const cmd = createLogsCommand();
      await cmd.parseAsync(['node', 'test', '--lines', '10']);

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('tail -n 10'),
        { encoding: 'utf-8' }
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Last 10 lines'));
    });

    it('should handle custom line count', async () => {
      vi.mocked(execSync).mockReturnValue('log content');

      const cmd = createLogsCommand();
      await cmd.parseAsync(['node', 'test', '--lines', '100']);

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('tail -n 100'),
        { encoding: 'utf-8' }
      );
    });
  });

  describe('error handling', () => {
    it('should handle tail errors in follow mode', async () => {
      const mockTail = {
        on: vi.fn((event: string, callback: Function) => {
          if (event === 'error') {
            callback(new Error('Tail failed'));
          }
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockTail as any);

      const cmd = createLogsCommand();
      await cmd.parseAsync(['node', 'test', '--follow']);

      // Error handler is registered
      expect(mockTail.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should handle execSync errors', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Command failed');
      });

      const cmd = createLogsCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '❌ Failed to read logs:',
        expect.any(Error)
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
