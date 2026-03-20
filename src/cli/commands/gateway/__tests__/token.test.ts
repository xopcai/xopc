// Mock os.homedir for consistent paths across environments
vi.mock("os", () => ({
  homedir: () => "/root",
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set consistent HOME for tests
process.env.HOME = '/root';

import { createTokenCommand } from '../token.js';
import { loadConfig, saveConfig } from '../../../../config/index.js';

// Mock dependencies
vi.mock('../../../../config/index.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
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

describe('Gateway Token Command', () => {
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

  describe('createTokenCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createTokenCommand();
      expect(cmd.name()).toBe('token');
      expect(cmd.description()).toBe('Manage gateway authentication token');
    });

    it('should have --generate option', () => {
      const cmd = createTokenCommand();
      const generateOption = cmd.options.find((opt: any) => opt.attributeName() === 'generate');
      expect(generateOption).toBeDefined();
    });

    it('should have --mode option with default value', () => {
      const cmd = createTokenCommand();
      const modeOption = cmd.options.find((opt: any) => opt.attributeName() === 'mode');
      expect(modeOption).toBeDefined();
    });
  });

  describe('token display', () => {
    it('should display current token when available', async () => {
      const mockConfig = {
        gateway: {
          auth: {
            mode: 'token',
            token: 'test-token-1234567890abcdef',
          },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);

      const cmd = createTokenCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(loadConfig).toHaveBeenCalledWith('/root/.xopcbot/xopcbot.json');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Current gateway token'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should display warning when no token configured', async () => {
      const mockConfig = {
        gateway: {
          auth: {},
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);

      const cmd = createTokenCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No token configured'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should display disabled message when mode is none', async () => {
      const mockConfig = {
        gateway: {
          auth: {
            mode: 'none',
          },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);

      const cmd = createTokenCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('authentication is disabled'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('token generation', () => {
    it('should generate new token with --generate flag', async () => {
      const mockConfig = {
        gateway: {},
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(saveConfig).mockResolvedValue(undefined);

      const cmd = createTokenCommand();
      await cmd.parseAsync(['node', 'test', '--generate']);

      expect(saveConfig).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Generated new gateway token'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should generate token with correct length', async () => {
      const mockConfig = {
        gateway: {},
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      let savedConfig: any;
      vi.mocked(saveConfig).mockImplementation((config: any) => {
        savedConfig = config;
        return Promise.resolve();
      });

      const cmd = createTokenCommand();
      await cmd.parseAsync(['node', 'test', '--generate']);

      expect(savedConfig.gateway.auth.token).toHaveLength(48); // 24 bytes = 48 hex chars
      expect(savedConfig.gateway.auth.mode).toBe('token');
    });
  });

  describe('error handling', () => {
    it('should handle config load errors', async () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error('Config load failed');
      });

      const cmd = createTokenCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
