/**
 * Telegram ChannelSetupWizard factory (onboard / tooling).
 */

import type { Config } from '@xopcai/xopcbot/config/index.js';
import type { ChannelSetupWizard } from '@xopcai/xopcbot/channels/plugins/types.adapters.js';

function resolveTelegramToken(cfg: Config, _accountId?: string): string | undefined {
  const tg = cfg.channels?.telegram as Record<string, unknown> | undefined;
  const accounts = tg?.accounts as Record<string, { botToken?: string }> | undefined;
  return (
    (accounts && Object.values(accounts).find((a) => a?.botToken)?.botToken) ||
    (tg?.botToken as string | undefined) ||
    process.env.TELEGRAM_BOT_TOKEN
  );
}

export function createTelegramSetupWizard(): ChannelSetupWizard {
  return {
    channel: 'telegram',
    status: {
      check: async (cfg, accountId) => {
        const first = resolveTelegramToken(cfg, accountId);
        return { ok: !!first, detail: first ? '' : 'No bot token configured' };
      },
    },
    envShortcut: {
      envVar: 'TELEGRAM_BOT_TOKEN',
      configPath: 'channels.telegram.botToken',
    },
    credentials: [
      {
        key: 'botToken',
        label: 'Bot API token',
        type: 'password',
        validate: (v) => (v && v.length > 10 ? null : 'Paste a token from @BotFather'),
        hint: 'From BotFather → /newbot or your bot’s API token',
      },
    ],
    finalize: {
      validate: async (cfg) => {
        const token = resolveTelegramToken(cfg);
        return token
          ? { ok: true }
          : { ok: false, error: 'Configure channels.telegram with a bot token' };
      },
      message: 'Telegram bot token saved.',
    },
  };
}
