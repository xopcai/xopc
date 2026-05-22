import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStopCommand } from '../stop.js';

// Mock lifecycle-core to avoid real daemon operations
vi.mock('../lifecycle-core.js', () => ({
  executeDaemonStop: vi.fn(),
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
    it('should delegate to executeDaemonStop', async () => {
      const { executeDaemonStop } = await import('../lifecycle-core.js');
      vi.mocked(executeDaemonStop).mockResolvedValue(undefined);

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test']);

      expect(executeDaemonStop).toHaveBeenCalledWith(expect.objectContaining({}));
    });

    it('should pass --disable option to executeDaemonStop', async () => {
      const { executeDaemonStop } = await import('../lifecycle-core.js');
      vi.mocked(executeDaemonStop).mockResolvedValue(undefined);

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test', '--disable']);

      expect(executeDaemonStop).toHaveBeenCalledWith(
        expect.objectContaining({ disable: true }),
      );
    });

    it('should pass --json option to executeDaemonStop', async () => {
      const { executeDaemonStop } = await import('../lifecycle-core.js');
      vi.mocked(executeDaemonStop).mockResolvedValue(undefined);

      const cmd = createStopCommand();
      await cmd.parseAsync(['node', 'test', '--json']);

      expect(executeDaemonStop).toHaveBeenCalledWith(
        expect.objectContaining({ json: true }),
      );
    });
  });
});
