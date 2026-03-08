/**
 * Telegram Account Manager
 *
 * Manages multiple Telegram bot accounts, including:
 * - Account configuration storage
 * - Bot instance management
 * - Runner lifecycle
 * - Status tracking
 * - Bot username mapping
 */

import type { Bot } from 'grammy';
import { run } from '@grammyjs/runner';
import type { TelegramAccountConfig, ChannelStatus } from '../types.js';

export class TelegramAccountManager {
  private accounts = new Map<string, TelegramAccountConfig>();
  private bots = new Map<string, Bot>();
  private runners = new Map<string, ReturnType<typeof run>>();
  private statuses = new Map<string, ChannelStatus>();
  private botUsernames = new Map<string, string>();
  private startingAccounts = new Set<string>();

  registerAccount(account: TelegramAccountConfig): void {
    this.accounts.set(account.accountId, account);
    this.statuses.set(account.accountId, {
      accountId: account.accountId,
      running: false,
      mode: 'stopped',
    });
  }

  getAccount(accountId: string): TelegramAccountConfig | undefined {
    return this.accounts.get(accountId);
  }

  getAllAccounts(): TelegramAccountConfig[] {
    return Array.from(this.accounts.values());
  }

  registerBot(accountId: string, bot: Bot): void {
    this.bots.set(accountId, bot);
  }

  getBot(accountId: string): Bot | undefined {
    return this.bots.get(accountId);
  }

  registerRunner(accountId: string, runner: ReturnType<typeof run>): void {
    this.runners.set(accountId, runner);
  }

  async stopRunner(accountId: string): Promise<void> {
    const runner = this.runners.get(accountId);
    const bot = this.bots.get(accountId);
    
    if (runner) {
      await runner.stop();
      this.runners.delete(accountId);
    }
    
    if (bot) {
      bot.stop();
      this.bots.delete(accountId);
    }
    
    this.startingAccounts.delete(accountId);
    
    // Update status to stopped
    this.updateStatus({
      accountId,
      running: false,
      mode: 'stopped',
    });
  }

  isStarting(accountId: string): boolean {
    return this.startingAccounts.has(accountId);
  }

  markStarting(accountId: string): void {
    this.startingAccounts.add(accountId);
  }

  markStartComplete(accountId: string): void {
    this.startingAccounts.delete(accountId);
  }

  isRunning(accountId: string): boolean {
    const status = this.statuses.get(accountId);
    return status?.running ?? false;
  }

  updateStatus(status: ChannelStatus): void {
    this.statuses.set(status.accountId, status);
  }

  getStatus(accountId: string): ChannelStatus | undefined {
    return this.statuses.get(accountId);
  }

  setBotUsername(accountId: string, username: string): void {
    this.botUsernames.set(accountId, username);
  }

  getBotUsername(accountId: string): string | undefined {
    return this.botUsernames.get(accountId);
  }
}
