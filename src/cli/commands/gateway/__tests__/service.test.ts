import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createInstallCommand,
  createUninstallCommand,
  createServiceStartCommand,
  createServiceStatusCommand,
} from '../service.js';

// Mock lifecycle-core
vi.mock('../lifecycle-core.js', () => ({
  executeDaemonUninstall: vi.fn(),
}));

// Mock daemon service
vi.mock('../../../../daemon/service.js', () => ({
  resolveGatewayService: vi.fn(),
  isDaemonAvailableAsync: vi.fn(),
  getPlatformName: vi.fn(() => 'macOS (LaunchAgent)'),
  startGatewayService: vi.fn(),
}));

// Mock daemon install-plan
vi.mock('../../../../daemon/install-plan.js', () => ({
  buildGatewayInstallArgs: vi.fn(() => ({
    programArguments: ['/usr/local/bin/node', '/usr/local/bin/xopc', 'gateway', '--foreground'],
    environment: {},
    workingDirectory: '/root',
  })),
}));

// Mock config
vi.mock('../../../../config/index.js', () => ({
  loadConfig: vi.fn(() => ({ gateway: { port: 18790, host: '0.0.0.0' } })),
}));

vi.mock('../../../../config/paths.js', () => ({
  resolveConfigPath: vi.fn(() => '/root/.xopc/xopc.json'),
}));

vi.mock('../../index.js', () => ({
  getContextWithOpts: vi.fn(() => ({
    configPath: '/root/.xopc/xopc.json',
    workspacePath: '/root/.xopc/workspace/main',
    isVerbose: false,
  })),
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
      expect(cmd.description()).toBe('Install gateway as OS service (LaunchAgent / systemd / Task)');
    });

    it('should have --port option', () => {
      const cmd = createInstallCommand();
      const portOption = cmd.options.find((opt: any) => opt.attributeName() === 'port');
      expect(portOption).toBeDefined();
    });

    it('should have --force option', () => {
      const cmd = createInstallCommand();
      const forceOption = cmd.options.find((opt: any) => opt.attributeName() === 'force');
      expect(forceOption).toBeDefined();
    });

    it('should have --json option', () => {
      const cmd = createInstallCommand();
      const jsonOption = cmd.options.find((opt: any) => opt.attributeName() === 'json');
      expect(jsonOption).toBeDefined();
    });

    it('should show error when daemon is not available', async () => {
      const { isDaemonAvailableAsync } = await import('../../../../daemon/service.js');
      vi.mocked(isDaemonAvailableAsync).mockResolvedValue(false);

      // Make process.exit throw to halt execution (since mock doesn't actually exit)
      processExitSpy.mockImplementation((code?: number) => { throw new Error(`exit ${code}`); });

      const cmd = createInstallCommand();
      await expect(cmd.parseAsync(['node', 'test'])).rejects.toThrow('exit 1');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('not available'));
    });

    it('should report already installed without --force', async () => {
      const { isDaemonAvailableAsync, resolveGatewayService } = await import('../../../../daemon/service.js');
      vi.mocked(isDaemonAvailableAsync).mockResolvedValue(true);
      vi.mocked(resolveGatewayService).mockResolvedValue({
        label: 'ai.xopc.gateway',
        isLoaded: vi.fn().mockResolvedValue(true),
        install: vi.fn(),
        uninstall: vi.fn(),
      } as any);

      const cmd = createInstallCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('already installed'));
    });
  });

  describe('createUninstallCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createUninstallCommand();
      expect(cmd.name()).toBe('uninstall');
      expect(cmd.description()).toBe('Uninstall gateway OS service');
    });

    it('should delegate to executeDaemonUninstall', async () => {
      const { executeDaemonUninstall } = await import('../lifecycle-core.js');
      vi.mocked(executeDaemonUninstall).mockResolvedValue(undefined);

      const cmd = createUninstallCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(executeDaemonUninstall).toHaveBeenCalled();
    });
  });

  describe('createServiceStartCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createServiceStartCommand();
      expect(cmd.name()).toBe('start');
      expect(cmd.description()).toBe('Start gateway via OS service manager');
    });

    it('should have --json option', () => {
      const cmd = createServiceStartCommand();
      const jsonOption = cmd.options.find((opt: any) => opt.attributeName() === 'json');
      expect(jsonOption).toBeDefined();
    });
  });

  describe('createServiceStatusCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createServiceStatusCommand();
      expect(cmd.name()).toBe('service-status');
      expect(cmd.description()).toBe('Show OS service status');
    });

    it('should have --json option', () => {
      const cmd = createServiceStatusCommand();
      const jsonOption = cmd.options.find((opt: any) => opt.attributeName() === 'json');
      expect(jsonOption).toBeDefined();
    });
  });
});
