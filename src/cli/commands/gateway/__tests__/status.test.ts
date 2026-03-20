// Mock os.homedir for consistent paths across environments
vi.mock("os", () => ({
  homedir: () => "/root",
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set consistent HOME for tests
process.env.HOME = '/root';

import { createStatusCommand } from '../status.js';
import { loadConfig } from '../../../../config/index.js';
import { acquireGatewayLock } from '../../../../gateway/lock.js';

// Mock dependencies
vi.mock('../../../../config/index.js', () => ({
  loadConfig: vi.fn(),
  DEFAULT_PATHS: {
    config: '/test/config.json',
  },
}));

vi.mock('../../index.js', () => ({
  getContextWithOpts: vi.fn(() => ({
    configPath: '/root/.xopcbot/xopcbot.json',
    workspacePath: '/root/.xopcbot/workspace',
    isVerbose: false,
  })),
}));

vi.mock('../../../../gateway/lock.js', () => ({
  acquireGatewayLock: vi.fn(),
  GatewayLockError: class GatewayLockError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'GatewayLockError';
    }
  },
}));

describe('Gateway Status Command', () => {
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

  describe('createStatusCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createStatusCommand();
      expect(cmd.name()).toBe('status');
      expect(cmd.description()).toBe('Check gateway status');
    });
  });

  describe('status checking', () => {
    it('should show not running when lock can be acquired', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockResolvedValue({
        release: vi.fn().mockResolvedValue(undefined),
      } as any);

      const cmd = createStatusCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(acquireGatewayLock).toHaveBeenCalledWith('/root/.xopcbot/xopcbot.json', {
        timeoutMs: 100,
        port: 18790,
      });
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should show running when GatewayLockError is thrown', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
          auth: {
            token: 'test-token',
          },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockRejectedValue(new (await import('../../../../gateway/lock.js')).GatewayLockError('Lock exists'));

      const cmd = createStatusCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('running'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Port: 18790'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should display token preview when available', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
          auth: {
            token: 'abcdef1234567890abcdef1234567890',
          },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockRejectedValue(new (await import('../../../../gateway/lock.js')).GatewayLockError('Lock exists'));

      const cmd = createStatusCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('abcdef12'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('567890'));
    });

    it('should use default port when not configured', async () => {
      const mockConfig = {
        gateway: {},
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockResolvedValue({
        release: vi.fn().mockResolvedValue(undefined),
      } as any);

      const cmd = createStatusCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(acquireGatewayLock).toHaveBeenCalledWith(expect.any(String), {
        timeoutMs: 100,
        port: 18790,
      });
    });
  });

  describe('error handling', () => {
    it('should handle unexpected errors', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(acquireGatewayLock).mockRejectedValue(new Error('Unexpected error'));

      const cmd = createStatusCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Failed to check status:', expect.any(Error));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
