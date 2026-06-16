import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Bot } from 'grammy';
import { webhookCallback } from 'grammy';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

const log = createLogger('TelegramWebhook');

export async function startTelegramWebhookServer(params: {
  accountId: string;
  bot: Bot;
  webhookUrl: string;
  webhookSecret: string;
  webhookPath?: string;
}): Promise<() => Promise<void>> {
  const path = params.webhookPath?.trim() || '/telegram/webhook';
  const handler = webhookCallback(params.bot, 'http', {
    secretToken: params.webhookSecret,
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== path || req.method !== 'POST') {
      res.statusCode = 404;
      res.end();
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      log.error({ err, accountId: params.accountId }, 'Telegram webhook handler error');
      res.statusCode = 500;
      res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err?: Error) => (err ? reject(err) : resolve()));
  });

  const addr = server.address();
  const localPort = typeof addr === 'object' && addr ? addr.port : 0;
  log.info(
    { accountId: params.accountId, webhookUrl: params.webhookUrl, localPort, path },
    'Telegram webhook listener started (register webhookUrl with your reverse proxy)',
  );

  try {
    await params.bot.api.setWebhook(params.webhookUrl, { secret_token: params.webhookSecret });
  } catch (err) {
    log.warn({ err, accountId: params.accountId }, 'Telegram setWebhook failed; retry on next start');
  }

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await params.bot.api.deleteWebhook();
    } catch {
      // ignore cleanup errors
    }
  };
}
