import { describe, expect, it } from 'vitest';

import { createRuntimeDispatcher, type RuntimeDispatchRequest } from '../runtime-dispatcher.js';

describe('local voice runtime dispatcher', () => {
  it('responds to health while a model installation is still running', async () => {
    let releaseInstall!: () => void;
    const installBlocked = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    const results: Array<{ id: number; result: unknown }> = [];
    const dispatch = createRuntimeDispatcher<RuntimeDispatchRequest>({
      execute: async (request) => {
        if (request.method === 'model.install') await installBlocked;
        return request.method;
      },
      sendResult: (request, result) => results.push({ id: request.id, result }),
      sendError: () => {},
    });

    dispatch({ id: 1, method: 'model.install' });
    dispatch({ id: 2, method: 'health' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(results).toEqual([{ id: 2, result: 'health' }]);

    releaseInstall();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(results).toContainEqual({ id: 1, result: 'model.install' });
  });
});
