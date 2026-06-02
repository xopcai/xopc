import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createModelsCommand } from '../models.js';

vi.mock('../../providers/index.js', () => ({
  getAllModels: vi.fn(() => []),
  getAvailableModels: vi.fn(async () => []),
  getConfiguredProviders: vi.fn(async () => []),
  isProviderConfigured: vi.fn(async () => false),
}));

vi.mock('../../config/index.js', () => ({
  loadConfig: vi.fn(() => ({ agents: { defaults: {} } })),
}));

vi.mock('../../context.js', () => ({
  getContextWithOpts: vi.fn(() => ({ configPath: '/tmp/xopc.json' })),
}));

describe('Models Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts `models list` subcommand', async () => {
    const cmd = createModelsCommand({} as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await cmd.parseAsync(['node', 'test', 'list', '--json']);

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('keeps root `models --json` working', async () => {
    const cmd = createModelsCommand({} as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await cmd.parseAsync(['node', 'test', '--json']);

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
