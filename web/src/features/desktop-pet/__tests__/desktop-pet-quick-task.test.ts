import { describe, expect, it, vi } from 'vitest';

import { runDesktopPetQuickTask } from '../desktop-pet-quick-task';

describe('desktop pet quick task', () => {
  it('creates a dedicated session and sends trimmed text through the shared stream client', async () => {
    const onSession = vi.fn();
    const send = vi.fn(async (_message, _sessionKey, callbacks) => {
      callbacks.onStreamStart();
      callbacks.onResult();
    });
    const onStarted = vi.fn();
    const onCompleted = vi.fn();

    await expect(runDesktopPetQuickTask('  check the build  ', {
      onSession,
      onStarted,
      onTool: vi.fn(),
      onClarify: vi.fn(),
      onCompleted,
      onError: vi.fn(),
    }, {
      createSession: async () => ({ key: 'agent:main:webchat:default:direct:pet-task' }),
      send,
    })).resolves.toBe('agent:main:webchat:default:direct:pet-task');

    expect(onSession).toHaveBeenCalledWith('agent:main:webchat:default:direct:pet-task');
    expect(send).toHaveBeenCalledWith('check the build', 'agent:main:webchat:default:direct:pet-task', expect.any(Object));
    expect(onStarted).toHaveBeenCalledOnce();
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it('rejects empty tasks before creating a session', async () => {
    const createSession = vi.fn();
    await expect(runDesktopPetQuickTask('   ', {
      onSession: vi.fn(),
      onStarted: vi.fn(),
      onTool: vi.fn(),
      onClarify: vi.fn(),
      onCompleted: vi.fn(),
      onError: vi.fn(),
    }, { createSession, send: vi.fn() })).rejects.toThrow('A task is required');
    expect(createSession).not.toHaveBeenCalled();
  });
});
