import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRestartCommand } from '../restart.js';

// Mock lifecycle to avoid real daemon operations
vi.mock('../lifecycle.js', () => ({
  runDaemonRestart: vi.fn(),
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
    it('should delegate to runDaemonRestart', async () => {
      const { runDaemonRestart } = await import('../lifecycle.js');
      vi.mocked(runDaemonRestart).mockResolvedValue(undefined);

      const cmd = createRestartCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(runDaemonRestart).toHaveBeenCalledWith(expect.objectContaining({}));
    });

    it('should pass --wait option to runDaemonRestart', async () => {
      const { runDaemonRestart } = await import('../lifecycle.js');
      vi.mocked(runDaemonRestart).mockResolvedValue(undefined);

      const cmd = createRestartCommand();
      await cmd.parseAsync(['node', 'test', '--wait', '30s']);

      expect(runDaemonRestart).toHaveBeenCalledWith(
        expect.objectContaining({ wait: '30s' }),
      );
    });
  });
});
