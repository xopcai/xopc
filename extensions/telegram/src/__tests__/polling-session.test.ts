import { describe, expect, it, vi } from 'vitest';

const { readTelegramUpdateOffset, writeTelegramUpdateOffset } = vi.hoisted(() => ({
  readTelegramUpdateOffset: vi.fn(),
  writeTelegramUpdateOffset: vi.fn(),
}));

vi.mock('../update-offset-store.js', () => ({
  readTelegramUpdateOffset,
  writeTelegramUpdateOffset,
}));

import { wireTelegramUpdateOffsetPersistence } from '../polling-session.js';

describe('wireTelegramUpdateOffsetPersistence', () => {
  it('restores the saved offset only on the first getUpdates call', async () => {
    readTelegramUpdateOffset.mockReturnValue(41);
    let apiMiddleware:
      | ((
          prev: (method: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>,
          method: string,
          payload: unknown,
          signal?: AbortSignal,
        ) => Promise<unknown>)
      | undefined;

    const bot = {
      api: {
        config: {
          use(fn: typeof apiMiddleware) {
            apiMiddleware = fn;
          },
        },
      },
      use: vi.fn(),
    };

    wireTelegramUpdateOffsetPersistence(bot as any, {
      accountId: 'default',
      botToken: '1:token',
    });

    const prev = vi.fn(async (_method: string, payload: unknown) => payload);
    await expect(apiMiddleware?.(prev, 'getUpdates', { timeout: 30 })).resolves.toEqual({
      timeout: 30,
      offset: 42,
    });
    await expect(apiMiddleware?.(prev, 'getUpdates', { timeout: 30, offset: 99 })).resolves.toEqual({
      timeout: 30,
      offset: 99,
    });
  });
});
