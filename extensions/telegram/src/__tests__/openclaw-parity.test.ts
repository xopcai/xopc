import { describe, it, expect } from 'vitest';

import {
  normalizeTelegramApiRoot,
  hasTelegramBotEndpointApiRoot,
  DEFAULT_TELEGRAM_API_ROOT,
} from '../api-root.js';
import { resolveTelegramStreamingMode } from '../config-schema.js';
import { TelegramConfigSchema } from '../config-schema.js';
import { TelegramReplyTracker } from '../reply-params.js';
import { isTelegramUnauthorizedTokenError, formatTelegramStartupError } from '../startup-errors.js';

describe('api-root', () => {
  it('returns default when empty', () => {
    expect(normalizeTelegramApiRoot()).toBe(DEFAULT_TELEGRAM_API_ROOT);
  });

  it('strips bot token path segment', () => {
    expect(
      normalizeTelegramApiRoot('https://api.telegram.org/bot123456:ABC-DEF'),
    ).toBe('https://api.telegram.org');
  });

  it('detects bot endpoint in apiRoot', () => {
    expect(hasTelegramBotEndpointApiRoot('https://host/bot1:token')).toBe(true);
    expect(hasTelegramBotEndpointApiRoot('https://host')).toBe(false);
  });
});

describe('TelegramConfigSchema streaming migration', () => {
  it('migrates streamMode block to streaming.mode', () => {
    const r = TelegramConfigSchema.safeParse({
      enabled: true,
      accounts: {
        default: { accountId: 'default', botToken: '1:tok', streamMode: 'block' },
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.accounts?.default?.streaming?.mode).toBe('block');
  });

  it('resolveTelegramStreamingMode prefers streaming.mode', () => {
    expect(
      resolveTelegramStreamingMode({ streamMode: 'off', streaming: { mode: 'partial' } }),
    ).toBe('partial');
  });
});

describe('reply-params', () => {
  it('first mode replies once per chat', () => {
    const tracker = new TelegramReplyTracker();
    const first = tracker.resolveReplyToMessageId({
      mode: 'first',
      inboundMessageId: '99',
      accountId: 'default',
      chatId: '1',
    });
    const second = tracker.resolveReplyToMessageId({
      mode: 'first',
      inboundMessageId: '99',
      accountId: 'default',
      chatId: '1',
    });
    expect(first).toBe('99');
    expect(second).toBeUndefined();
  });
});

describe('startup-errors', () => {
  it('detects 401 unauthorized', () => {
    expect(isTelegramUnauthorizedTokenError(new Error('401: Unauthorized'))).toBe(true);
    expect(formatTelegramStartupError(new Error('401: Unauthorized'))).toMatch(/401/);
  });
});
