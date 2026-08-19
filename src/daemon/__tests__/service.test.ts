import { describe, expect, it, vi } from 'vitest';

import { startGatewayService } from '../service.js';
import type { GatewayService } from '../types.js';

function createMockGatewayService(overrides: Partial<GatewayService>): GatewayService {
  return {
    label: 'ai.xopc.gateway',
    loadedText: 'LaunchAgent (loaded)',
    notLoadedText: 'LaunchAgent (not loaded)',
    install: vi.fn(),
    uninstall: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn().mockResolvedValue({ task: 'restarted' }),
    isLoaded: vi.fn().mockResolvedValue(true),
    readRuntime: vi.fn().mockResolvedValue({ status: 'stopped' }),
    readCommand: vi.fn().mockResolvedValue({
      programArguments: [process.execPath, 'src/cli/bin.ts', 'gateway', '--foreground'],
      environment: {},
    }),
    ...overrides,
  };
}

describe('startGatewayService', () => {
  it('starts an installed but unloaded service', async () => {
    const restart = vi.fn().mockResolvedValue({ task: 'restarted' });
    const service = createMockGatewayService({
      isLoaded: vi.fn().mockResolvedValue(false),
      restart,
    });

    const result = await startGatewayService({ service });

    expect(result.task).toBe('started');
    expect(restart).toHaveBeenCalledWith({ env: process.env });
  });

  it('reports missing install only when no command configuration exists', async () => {
    const restart = vi.fn().mockResolvedValue({ task: 'restarted' });
    const service = createMockGatewayService({
      isLoaded: vi.fn().mockResolvedValue(false),
      readCommand: vi.fn().mockResolvedValue(null),
      restart,
    });

    const result = await startGatewayService({ service });

    expect(result.task).toBe('missing-install');
    expect(restart).not.toHaveBeenCalled();
  });
});
