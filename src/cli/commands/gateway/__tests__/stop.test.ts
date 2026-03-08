// Mock os.homedir for consistent paths across environments
vi.mock("os", () => ({
  homedir: () => "/root",
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStopCommand } from '../stop.js';
import { loadConfig } from '../../../../config/index.js';
import { acquireGatewayLock } from '../../../../gateway/lock.js';
import { forceFreePortAndWait, listPortListeners } from '../../../../gateway/ports.js';

// Set consistent HOME for tests
process.env.HOME = '/root';

// Mock dependencies
vi.mock('../../../../config/index.js', () => ({
  loadConfig: vi.fn(),
  DEFAULT_PATHS: {
    config: '/test/config.json',
  },
}));

vi.mock('../../index.js', () => ({
  getContextWithOpts: vi.fn(() => ({
    configPath: '/root/.xopcbot/config.json',
    workspacePath: '/root/.xopcbot/workspace',
    isVerbose: false,
  })),
}));

vi.mock('../../../../gateway/lock.js', () => ({
  acquireGatewayLock: vi.fn(),
}));

vi.mock('../../../../gateway/ports.js', () => ({
  forceFreePortAndWait: vi.fn(),
  listPortListeners: vi.fn(),
}));

describe('Gateway Stop Command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let processKillSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => {}) as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    processKillSpy.mockRestore();
  });

  describe('createStopCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createStopCommand();
      expect(cmd.name()).toBe('stop');
      expect(cmd.description()).toBe('Stop running gateway');
    });

    it('should have --force option', () => {
      const cmd = createStopCommand();
      const forceOption = cmd.options.find((opt: any) => opt.attributeName() === 'force');
      expect(forceOption).toBeDefined();
    });

    it('should have --timeout option with default value', () => {
      const cmd = createStopCommand();
      const timeoutOption = cmd.options.find((opt: any) => opt.attributeName() === 'timeout');
      expect(timeoutOption).toBeDefined();
    });
  });

  describe('stop behavior', () => {
    it('should exit early if gateway is not running', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockResolvedValue({
        release: vi.fn().mockResolvedValue(undefined),
      } as any);

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should show stopped message after graceful shutdown', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockRejectedValue(new Error('Lock exists'));
      vi.mocked(listPortListeners).mockReturnValue([
        { pid: 1234, command: 'node' },
      ]);
      vi.mocked(forceFreePortAndWait).mockResolvedValue({
        killed: [{ pid: 1234 }],
        escalatedToSigkill: false,
      });

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Stopping gateway'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Stopped pid 1234'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Gateway stopped'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should handle force kill option', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockRejectedValue(new Error('Lock exists'));
      vi.mocked(listPortListeners).mockReturnValue([
        { pid: 1234, command: 'node' },
      ]);

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test', '--force']);

      expect(processKillSpy).toHaveBeenCalledWith(1234, 'SIGKILL');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Killed pid 1234'));
    });

    it('should show escalated message when SIGKILL is used', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockRejectedValue(new Error('Lock exists'));
      vi.mocked(listPortListeners).mockReturnValue([
        { pid: 1234, command: 'node' },
      ]);
      vi.mocked(forceFreePortAndWait).mockResolvedValue({
        killed: [{ pid: 1234 }],
        escalatedToSigkill: true,
      });

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Escalated to SIGKILL'));
    });

    it('should handle no process found', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockRejectedValue(new Error('Lock exists'));
      vi.mocked(listPortListeners).mockReturnValue([]);

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No process found'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('error handling', () => {
    it('should handle stop errors', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockRejectedValue(new Error('Lock exists'));
      vi.mocked(listPortListeners).mockReturnValue([
        { pid: 1234, command: 'node' },
      ]);
      vi.mocked(forceFreePortAndWait).mockRejectedValue(new Error('Stop failed'));

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Failed to stop gateway:', expect.any(Error));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
