import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRestartCommand } from '../restart.js';

// Mock lifecycle-core to avoid real daemon operations
vi.mock('../lifecycle-core.js', () => ({
  executeDaemonRestart: vi.fn(),
}));

describe('Gateway Restart Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRestartCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createRestartCommand();
      expect(cmd.name()).toBe('restart');
      expect(cmd.description()).toBe('Restart the gateway service');
    });

    it('should have --force option', () => {
      const cmd = createRestartCommand();
      const forceOption = cmd.options.find((opt: any) => opt.attributeName() === 'force');
      expect(forceOption).toBeDefined();
    });

    it('should have --wait option', () => {
      const cmd = createRestartCommand();
      const waitOption = cmd.options.find((opt: any) => opt.attributeName() === 'wait');
      expect(waitOption).toBeDefined();
    });

    it('should have --json option', () => {
      const cmd = createRestartCommand();
      const jsonOption = cmd.options.find((opt: any) => opt.attributeName() === 'json');
      expect(jsonOption).toBeDefined();
    });
  });

  describe('restart behavior', () => {
    it('should delegate to executeDaemonRestart', async () => {
      const { executeDaemonRestart } = await import('../lifecycle-core.js');
      vi.mocked(executeDaemonRestart).mockResolvedValue(undefined);

      const cmd = createRestartCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(executeDaemonRestart).toHaveBeenCalledWith(expect.objectContaining({}));
    });

    it('should pass --force option to executeDaemonRestart', async () => {
      const { executeDaemonRestart } = await import('../lifecycle-core.js');
      vi.mocked(executeDaemonRestart).mockResolvedValue(undefined);

      const cmd = createRestartCommand();
      await cmd.parseAsync(['node', 'test', '--force']);

      expect(executeDaemonRestart).toHaveBeenCalledWith(
        expect.objectContaining({ force: true }),
      );
    });

    it('should pass --wait option to executeDaemonRestart', async () => {
      const { executeDaemonRestart } = await import('../lifecycle-core.js');
      vi.mocked(executeDaemonRestart).mockResolvedValue(undefined);

      const cmd = createRestartCommand();
      await cmd.parseAsync(['node', 'test', '--wait', '30s']);

      expect(executeDaemonRestart).toHaveBeenCalledWith(
        expect.objectContaining({ wait: '30s' }),
      );
    });
  });
});
