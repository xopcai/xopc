import { describe, expect, it } from 'vitest';

import type { Config } from '../../../config/schema.js';
import {
  applyTelegramAccount,
  maskToken,
  removeChannelAccount,
  validateTelegramToken,
} from '../channels.js';
import { SetupValidationError } from '../setup-shared/index.js';

const VALID_TOKEN = '1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ_-_-_-_-';

describe('xopc channels helpers', () => {
  describe('validateTelegramToken', () => {
    it('accepts a well-formed token', () => {
      expect(validateTelegramToken(VALID_TOKEN)).toBe(true);
    });

    it('rejects obvious garbage', () => {
      expect(validateTelegramToken('bogus')).toBe(false);
      expect(validateTelegramToken('123:short')).toBe(false);
      expect(validateTelegramToken('')).toBe(false);
    });
  });

  describe('maskToken', () => {
    it('shows head and tail for long tokens', () => {
      expect(maskToken(VALID_TOKEN)).toBe('1234…_-_-');
    });

    it('fully masks short tokens', () => {
      expect(maskToken('abc')).toBe('***');
    });
  });

  describe('applyTelegramAccount', () => {
    it('writes the bot token under the per-account record only', () => {
      const before = {} as Config;
      const after = applyTelegramAccount(before, 'default', VALID_TOKEN, true);
      const tg = (after.channels as Record<string, Record<string, unknown>>).telegram;
      expect(tg.enabled).toBe(true);
      expect(tg.botToken).toBeUndefined();
      const accounts = tg.accounts as Record<string, Record<string, unknown>>;
      expect(accounts.default).toMatchObject({
        accountId: 'default',
        enabled: true,
        botToken: VALID_TOKEN,
      });
    });

    it('preserves prior accounts when adding a second one', () => {
      const after1 = applyTelegramAccount({} as Config, 'work', VALID_TOKEN, true);
      const after2 = applyTelegramAccount(after1, 'play', VALID_TOKEN, true);
      const accounts = (
        (after2.channels as Record<string, Record<string, unknown>>).telegram.accounts as Record<
          string,
          unknown
        >
      );
      expect(Object.keys(accounts).sort()).toEqual(['play', 'work']);
    });
  });

  describe('removeChannelAccount', () => {
    it('removes the account and disables the channel when last account goes', () => {
      const seeded = applyTelegramAccount({} as Config, 'default', VALID_TOKEN, true);
      const after = removeChannelAccount(seeded, 'telegram', 'default');
      const tg = (after.channels as Record<string, Record<string, unknown>>).telegram;
      expect(Object.keys(tg.accounts as Record<string, unknown>)).toHaveLength(0);
      expect(tg.enabled).toBe(false);
      expect(tg.botToken).toBeUndefined();
    });

    it('throws SetupValidationError when account does not exist', () => {
      expect(() => removeChannelAccount({} as Config, 'telegram', 'ghost')).toThrow(
        SetupValidationError,
      );
    });

    it('throws SetupValidationError on unknown channel', () => {
      expect(() => removeChannelAccount({} as Config, 'discord', 'default')).toThrow(
        SetupValidationError,
      );
    });
  });
});
