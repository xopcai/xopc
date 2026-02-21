/**
 * Telegram Webhook Server
 * 
 * Production-ready webhook listener for Telegram Bot API
 * Inspired by openclaw's webhook.ts
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('TelegramWebhook');

const TELEGRAM_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024; // 1MB
const TELEGRAM_WEBHOOK_BODY_TIMEOUT_MS = 30_000;
const TELEGRAM_WEBHOOK_CALLBACK_TIMEOUT_MS = 10_000;

export interface TelegramWebhookOptions {
  bot: Bot;
  token: string;
  path?: string;
  port?: number;
  host?: string;
  secret?: string;
  publicUrl?: string;
  abortSignal?: AbortSignal;
}

export interface TelegramWebhookServer {
  server: Server;
  bot: Bot;
  stop: () => void;
}

/**
 * Start Telegram webhook server
 */
export async function startTelegramWebhook(
  options: TelegramWebhookOptions
): Promise<TelegramWebhookServer> {
  const path = options.path ?? '/telegram-webhook';
  const port = options.port ?? 8787;
  const host = options.host ?? '127.0.0.1';
  const secret = typeof options.secret === 'string' ? options.secret.trim() : '';

  if (!secret) {
    throw new Error(
      'Telegram webhook mode requires a non-empty secret token. ' +
      'Set channels.telegram.webhookSecret in your config.'
    );
  }

  const bot = options.bot;
  const handler = webhookCallback(bot, 'http', {
    secretToken: secret,
    onTimeout: 'return',
    timeoutMilliseconds: TELEGRAM_WEBHOOK_CALLBACK_TIMEOUT_MS,
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Health check endpoint
    if (req.url === '/healthz') {
      res.writeHead(200);
      res.end('ok');
      return;
    }

    // Webhook endpoint
    if (req.url !== path || req.method !== 'POST') {
      res.writeHead(404);
      res.end();
      return;
    }

    const startTime = Date.now();

    // Request body size limit guard
    let bodySize = 0;
    const bodyLimitTripped = () => {
      if (!res.headersSent) {
        res.writeHead(413);
      }
      res.end('Request body too large');
    };

    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > TELEGRAM_WEBHOOK_MAX_BODY_BYTES) {
        req.destroy();
        bodyLimitTripped();
      }
    });

    req.setTimeout(TELEGRAM_WEBHOOK_BODY_TIMEOUT_MS, () => {
      req.destroy();
      if (!res.headersSent) {
        res.writeHead(408);
      }
      res.end('Request timeout');
    });

    // Handle webhook callback
    const handled = handler(req, res);
    if (handled && typeof handled.catch === 'function') {
      void handled
        .then(() => {
          const duration = Date.now() - startTime;
          log.debug({ duration, url: req.url }, 'Webhook processed');
        })
        .catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.error({ err: errMsg, url: req.url }, 'Webhook error');
          if (!res.headersSent) {
            res.writeHead(500);
          }
          res.end();
        });
      return;
    }
  });

  const publicUrl =
    options.publicUrl ?? `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}${path}`;

  // Set webhook on Telegram API
  try {
    await bot.api.setWebhook(publicUrl, {
      secret_token: secret,
      allowed_updates: undefined, // Get all updates
    });
    log.info({ publicUrl, path }, 'Telegram webhook registered');
  } catch (err) {
    log.error({ err }, 'Failed to register Telegram webhook');
    server.close();
    throw err;
  }

  // Start server
  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      log.info({ port, host, publicUrl }, 'Telegram webhook server listening');
      resolve();
    });
  });

  const shutdown = () => {
    server.close();
    bot.stop();
    log.info('Telegram webhook server stopped');
  };

  if (options.abortSignal) {
    options.abortSignal.addEventListener('abort', shutdown, { once: true });
  }

  return {
    server,
    bot,
    stop: shutdown,
  };
}

/**
 * Validate webhook secret token
 */
export function validateWebhookSecret(req: IncomingMessage, secret: string): boolean {
  const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
  return typeof receivedSecret === 'string' && receivedSecret === secret;
}
