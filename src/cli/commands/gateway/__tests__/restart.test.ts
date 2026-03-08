// Mock os.homedir for consistent paths across environments
vi.mock("os", () => ({
  homedir: () => "/root",
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set consistent HOME for tests
process.env.HOME = '/root';

import { createRestartCommand } from '../restart.js';
import { loadConfig } from '../../../../config/index.js';
import { listPortListeners, forceFreePortAndWait } from '../../../../gateway/ports.js';

// Mock child_process
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

// Mock dependencies
vi.mock('../../../../config/index.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../index.js', () => ({
  getContextWithOpts: vi.fn(() => ({
    configPath: '/root/.xopcbot/config.json',
    workspacePath: '/root/.xopcbot/workspace',
    isVerbose: false,
  })),
}));

vi.mock('../../../../gateway/ports.js', () => ({
  listPortListeners: vi.fn(),
  forceFreePortAndWait: vi.fn(),
}));

import { spawn } from 'child_process';

describe('Gateway Restart Command', () => {
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

  describe('createRestartCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createRestartCommand();
      expect(cmd.name()).toBe('restart');
      expect(cmd.description()).toBe('Restart gateway');
    });

    it('should have --force option', () => {
      const cmd = createRestartCommand();
      const forceOption = cmd.options.find((opt: any) => opt.attributeName() === 'force');
      expect(forceOption).toBeDefined();
    });
  });

  describe('restart behavior', () => {
    it('should start gateway if not running', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
          host: '0.0.0.0',
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(listPortListeners).mockReturnValue([]);

      const mockChild = {
        pid: 1234,
        killed: false,
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const cmd = createRestartCommand();
      await cmd.parseAsync(['node', 'test']);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Gateway is not running'));
      expect(spawn).toHaveBeenCalled();
    });

    it('should send SIGUSR1 for graceful restart when gateway is running', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
          host: '0.0.0.0',
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(listPortListeners).mockReturnValue([
        { pid: 1234, command: 'node' },
      ]);

      const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => {}) as any);

      const cmd = createRestartCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(processKillSpy).toHaveBeenCalledWith(1234, 'SIGUSR1');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Restart signal sent'));
      expect(processExitSpy).toHaveBeenCalledWith(0);

      processKillSpy.mockRestore();
    });

    it('should force restart when --force flag is used', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
          host: '0.0.0.0',
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(listPortListeners).mockReturnValue([
        { pid: 1234, command: 'node' },
      ]);
      vi.mocked(forceFreePortAndWait).mockResolvedValue({
        killed: [{ pid: 1234 }],
        escalatedToSigkill: false,
      });

      const mockChild = {
        pid: 5678,
        killed: false,
        unref: vi.fn(),
      };
      vi.mocked(spawn).mockReturnValue(mockChild as any);

      const cmd = createRestartCommand();
      await cmd.parseAsync(['node', 'test', '--force']);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(forceFreePortAndWait).toHaveBeenCalled();
      expect(spawn).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle restart errors', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
          host: '0.0.0.0',
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(listPortListeners).mockReturnValue([
        { pid: 1234, command: 'node' },
      ]);
      vi.mocked(forceFreePortAndWait).mockRejectedValue(new Error('Force free failed'));

      const cmd = createRestartCommand();
      await cmd.parseAsync(['node', 'test', '--force']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Failed to stop gateway:', expect.any(Error));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
