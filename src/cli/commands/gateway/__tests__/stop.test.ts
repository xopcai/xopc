import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStopCommand } from '../stop.js';

// Mock lifecycle to avoid real daemon operations
vi.mock('../lifecycle.js', () => ({
  runDaemonStop: vi.fn(),
}));

describe('Gateway Stop Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createStopCommand', () => {
    it('should create command with correct name and description', () => {
      const cmd = createStopCommand();
      expect(cmd.name()).toBe('stop');
      expect(cmd.description()).toBe('Stop the gateway service');
    });

    it('should have --disable option', () => {
      const cmd = createStopCommand();
      const disableOption = cmd.options.find((opt: any) => opt.attributeName() === 'disable');
      expect(disableOption).toBeDefined();
    });

    it('should have --json option', () => {
      const cmd = createStopCommand();
      const jsonOption = cmd.options.find((opt: any) => opt.attributeName() === 'json');
      expect(jsonOption).toBeDefined();
    });
  });

  describe('stop behavior', () => {
    it('should delegate to runDaemonStop', async () => {
      const { runDaemonStop } = await import('../lifecycle.js');
      vi.mocked(runDaemonStop).mockResolvedValue(undefined);

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(runDaemonStop).toHaveBeenCalledWith(expect.objectContaining({}));
    });

    it('should pass --disable option to runDaemonStop', async () => {
      const { runDaemonStop } = await import('../lifecycle.js');
      vi.mocked(runDaemonStop).mockResolvedValue(undefined);

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test', '--disable']);

      expect(runDaemonStop).toHaveBeenCalledWith(
        expect.objectContaining({ disable: true }),
      );
    });

    it('should pass --json option to runDaemonStop', async () => {
      const { runDaemonStop } = await import('../lifecycle.js');
      vi.mocked(runDaemonStop).mockResolvedValue(undefined);

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test', '--json']);

      expect(runDaemonStop).toHaveBeenCalledWith(
        expect.objectContaining({ json: true }),
      );
    });
  });
});
