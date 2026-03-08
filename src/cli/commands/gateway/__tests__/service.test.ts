// Mock os.homedir for consistent paths across environments
vi.mock("os", () => ({
  homedir: () => "/root",
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set consistent HOME for tests
process.env.HOME = '/root';

import {
  createInstallCommand,
  createUninstallCommand,
  createServiceStartCommand,
  createServiceStatusCommand,
} from '../service.js';
import { loadConfig } from '../../../../config/index.js';
import { resolveGatewayService, isDaemonAvailableAsync, getPlatformName } from '../../../../daemon/index.js';
import { buildGatewayInstallPlan } from '../../../../daemon/install-plan.js';

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

vi.mock('../../../../daemon/index.js', () => ({
  resolveGatewayService: vi.fn(),
  isDaemonAvailableAsync: vi.fn(),
  getPlatformName: vi.fn(() => 'Linux (systemd)'),
}));

vi.mock('../../../../daemon/install-plan.js', () => ({
  buildGatewayInstallPlan: vi.fn(),
}));

describe('Gateway Service Commands', () => {
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

  describe('createInstallCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createInstallCommand();
      expect(cmd.name()).toBe('install');
      expect(cmd.description()).toBe('Install gateway as system service');
    });

    it('should show error when daemon is not available', async () => {
      vi.mocked(isDaemonAvailableAsync).mockResolvedValue(false);
      vi.mocked(getPlatformName).mockReturnValue('Unknown Platform');

      const cmd = createInstallCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('not available'));
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should show install instructions when daemon is available', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
          host: '0.0.0.0',
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(isDaemonAvailableAsync).mockResolvedValue(true);
      vi.mocked(resolveGatewayService).mockResolvedValue({
        label: 'xopcbot-gateway',
      } as any);
      vi.mocked(buildGatewayInstallPlan).mockReturnValue({
        workingDirectory: '/test',
        programArguments: ['node', 'xopcbot', 'gateway'],
      } as any);

      // Mock Linux platform
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      const cmd = createInstallCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Installing gateway'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('systemd'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should show macOS instructions on darwin', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
          host: '0.0.0.0',
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(isDaemonAvailableAsync).mockResolvedValue(true);
      vi.mocked(resolveGatewayService).mockResolvedValue({
        label: 'xopcbot-gateway',
      } as any);
      vi.mocked(buildGatewayInstallPlan).mockReturnValue({
        workingDirectory: '/test',
        programArguments: ['node', 'xopcbot', 'gateway'],
      } as any);

      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      const cmd = createInstallCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('launchd'));
    });

    it('should show Windows instructions on win32', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
          host: '0.0.0.0',
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);
      vi.mocked(isDaemonAvailableAsync).mockResolvedValue(true);
      vi.mocked(resolveGatewayService).mockResolvedValue({
        label: 'xopcbot-gateway',
      } as any);
      vi.mocked(buildGatewayInstallPlan).mockReturnValue({
        workingDirectory: '/test',
        programArguments: ['node', 'xopcbot', 'gateway'],
      } as any);

      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      const cmd = createInstallCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Windows'));
    });
  });

  describe('createUninstallCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createUninstallCommand();
      expect(cmd.name()).toBe('uninstall');
      expect(cmd.description()).toBe('Uninstall gateway system service');
    });

    it('should show uninstall instructions', async () => {
      vi.mocked(resolveGatewayService).mockResolvedValue({
        label: 'xopcbot-gateway',
      } as any);

      const cmd = createUninstallCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Uninstalling'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('systemctl stop'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('launchctl unload'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('sc delete'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('createServiceStartCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createServiceStartCommand();
      expect(cmd.name()).toBe('start');
      expect(cmd.description()).toBe('Start gateway system service');
    });

    it('should show start instructions', async () => {
      const mockConfig = {
        gateway: {
          port: 18790,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(mockConfig as any);

      const cmd = createServiceStartCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Starting gateway'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Port: 18790'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('systemctl start'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('createServiceStatusCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createServiceStatusCommand();
      expect(cmd.name()).toBe('service-status');
      expect(cmd.description()).toBe('Check system service status');
    });

    it('should show status check instructions', async () => {
      const cmd = createServiceStatusCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Gateway service status'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('systemctl status'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('launchctl list'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('sc query'));
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });
  });
});
