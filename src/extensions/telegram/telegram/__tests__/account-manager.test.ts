import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramAccountManager } from '../account-manager.js';
import type { TelegramAccountConfig, ChannelStatus } from '../../../../channels/channel-domain.js';
import type { Bot } from 'grammy';
import type { run } from '@grammyjs/runner';

describe('TelegramAccountManager', () => {
  let manager: TelegramAccountManager;

  beforeEach(() => {
    manager = new TelegramAccountManager();
  });

  describe('registerAccount', () => {
    it('should register account with stopped status', () => {
      const account: TelegramAccountConfig = {
        accountId: 'test-account',
        name: 'Test Account',
        enabled: true,
        botToken: 'test-token',
      };

      manager.registerAccount(account);

      expect(manager.getAccount('test-account')).toEqual(account);
      expect(manager.getStatus('test-account')).toEqual({
        accountId: 'test-account',
        running: false,
        mode: 'stopped',
      });
    });

    it('should overwrite existing account', () => {
      const account1: TelegramAccountConfig = {
        accountId: 'test',
        name: 'Test 1',
        enabled: true,
        botToken: 'token1',
      };
      const account2: TelegramAccountConfig = {
        accountId: 'test',
        name: 'Test 2',
        enabled: true,
        botToken: 'token2',
      };

      manager.registerAccount(account1);
      manager.registerAccount(account2);

      expect(manager.getAccount('test')?.name).toBe('Test 2');
    });
  });

  describe('getAccount', () => {
    it('should return undefined for non-existent account', () => {
      expect(manager.getAccount('non-existent')).toBeUndefined();
    });

    it('should return registered account', () => {
      const account: TelegramAccountConfig = {
        accountId: 'test',
        name: 'Test',
        enabled: true,
        botToken: 'token',
      };
      manager.registerAccount(account);

      expect(manager.getAccount('test')).toEqual(account);
    });
  });

  describe('getAllAccounts', () => {
    it('should return empty array when no accounts', () => {
      expect(manager.getAllAccounts()).toEqual([]);
    });

    it('should return all registered accounts', () => {
      const account1: TelegramAccountConfig = {
        accountId: 'account1',
        name: 'Account 1',
        enabled: true,
        botToken: 'token1',
      };
      const account2: TelegramAccountConfig = {
        accountId: 'account2',
        name: 'Account 2',
        enabled: true,
        botToken: 'token2',
      };

      manager.registerAccount(account1);
      manager.registerAccount(account2);

      const accounts = manager.getAllAccounts();
      expect(accounts).toHaveLength(2);
      expect(accounts).toContainEqual(account1);
      expect(accounts).toContainEqual(account2);
    });
  });

  describe('registerBot / getBot', () => {
    it('should register and retrieve bot', () => {
      const mockBot = { api: {} } as unknown as Bot;

      manager.registerBot('test-account', mockBot);

      expect(manager.getBot('test-account')).toBe(mockBot);
    });

    it('should return undefined for non-existent bot', () => {
      expect(manager.getBot('non-existent')).toBeUndefined();
    });

    it('should overwrite existing bot', () => {
      const mockBot1 = { api: { id: 1 } } as unknown as Bot;
      const mockBot2 = { api: { id: 2 } } as unknown as Bot;

      manager.registerBot('test', mockBot1);
      manager.registerBot('test', mockBot2);

      expect(manager.getBot('test')).toBe(mockBot2);
    });
  });

  describe('registerRunner / stopRunner', () => {
    it('should register runner', () => {
      const mockRunner = { stop: vi.fn() } as unknown as ReturnType<typeof run>;

      manager.registerRunner('test', mockRunner);
    });

    it('should stop and remove runner', async () => {
      const mockStop = vi.fn().mockResolvedValue(undefined);
      const mockRunner = { stop: mockStop } as unknown as ReturnType<typeof run>;

      manager.registerRunner('test', mockRunner);
      await manager.stopRunner('test');

      expect(mockStop).toHaveBeenCalledTimes(1);
      // After stopping, runner should be removed
      // (can't directly test this, but coverage will show)
    });

    it('should handle stopping non-existent runner gracefully', async () => {
      await expect(manager.stopRunner('non-existent')).resolves.not.toThrow();
    });
  });

  describe('updateStatus / getStatus', () => {
    it('should update and retrieve status', () => {
      const status: ChannelStatus = {
        accountId: 'test',
        running: true,
        mode: 'polling',
        lastStartAt: Date.now(),
      };

      manager.updateStatus(status);

      expect(manager.getStatus('test')).toEqual(status);
    });

    it('should return undefined for non-existent status', () => {
      expect(manager.getStatus('non-existent')).toBeUndefined();
    });

    it('should overwrite existing status', () => {
      const status1: ChannelStatus = {
        accountId: 'test',
        running: false,
        mode: 'stopped',
      };
      const status2: ChannelStatus = {
        accountId: 'test',
        running: true,
        mode: 'polling',
        lastStartAt: Date.now(),
      };

      manager.updateStatus(status1);
      manager.updateStatus(status2);

      expect(manager.getStatus('test')).toEqual(status2);
    });
  });

  describe('setBotUsername / getBotUsername', () => {
    it('should set and get bot username', () => {
      manager.setBotUsername('test-account', 'test_bot');

      expect(manager.getBotUsername('test-account')).toBe('test_bot');
    });

    it('should return undefined for non-existent username', () => {
      expect(manager.getBotUsername('non-existent')).toBeUndefined();
    });

    it('should overwrite existing username', () => {
      manager.setBotUsername('test', 'old_bot');
      manager.setBotUsername('test', 'new_bot');

      expect(manager.getBotUsername('test')).toBe('new_bot');
    });
  });

  describe('reset', () => {
    it('should clear accounts and runtime maps', () => {
      manager.registerAccount({
        accountId: 'a',
        name: 'A',
        enabled: true,
        botToken: 't',
      });
      manager.setBotUsername('a', 'bot');
      manager.reset();
      expect(manager.getAccount('a')).toBeUndefined();
      expect(manager.getAllAccounts()).toHaveLength(0);
      expect(manager.getBotUsername('a')).toBeUndefined();
    });
  });

  describe('integration', () => {
    it('should manage complete account lifecycle', () => {
      const account: TelegramAccountConfig = {
        accountId: 'lifecycle-test',
        name: 'Lifecycle Test',
        enabled: true,
        botToken: 'test-token',
      };

      // Register account
      manager.registerAccount(account);
      expect(manager.getAccount('lifecycle-test')).toEqual(account);
      expect(manager.getStatus('lifecycle-test')?.running).toBe(false);

      // Update status to running
      manager.updateStatus({
        accountId: 'lifecycle-test',
        running: true,
        mode: 'polling',
        lastStartAt: Date.now(),
      });
      expect(manager.getStatus('lifecycle-test')?.running).toBe(true);

      // Set bot username
      manager.setBotUsername('lifecycle-test', 'my_bot');
      expect(manager.getBotUsername('lifecycle-test')).toBe('my_bot');
    });
  });
});
