import { describe, expect, it } from 'vitest';
import { useTestDatabase } from '../../../../src/storage/sqlite/__tests__/test-database.js';
import { readTelegramUpdateOffset, writeTelegramUpdateOffset } from '../update-offset-store.js';

useTestDatabase();

describe('Telegram SQLite cursors', () => {
  it('does not move backwards and resets position when the bot identity changes', () => {
    writeTelegramUpdateOffset({ accountId: 'one', botToken: '123:secret', lastUpdateId: 20 });
    writeTelegramUpdateOffset({ accountId: 'one', botToken: '123:secret', lastUpdateId: 10 });
    expect(readTelegramUpdateOffset({ accountId: 'one', botToken: '123:secret' })).toBe(20);
    expect(readTelegramUpdateOffset({ accountId: 'one', botToken: '456:secret' })).toBeUndefined();
    writeTelegramUpdateOffset({ accountId: 'one', botToken: '456:secret', lastUpdateId: 1 });
    expect(readTelegramUpdateOffset({ accountId: 'one', botToken: '456:secret' })).toBe(1);
  });

  it('keeps distinct account ids separate instead of normalizing both to a filename', () => {
    writeTelegramUpdateOffset({ accountId: 'a/b', lastUpdateId: 1 });
    writeTelegramUpdateOffset({ accountId: 'a_b', lastUpdateId: 2 });
    expect(readTelegramUpdateOffset({ accountId: 'a/b' })).toBe(1);
    expect(readTelegramUpdateOffset({ accountId: 'a_b' })).toBe(2);
  });
});
