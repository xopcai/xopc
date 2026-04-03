import path from 'node:path';

import type { Config } from '@xopcai/xopcbot/config/schema.js';
import type {
  ChannelOutboundContext,
  ChannelOutboundPayloadContext,
  OutboundDeliveryResult,
} from '@xopcai/xopcbot/channels/plugin-types.js';
import type { OutboundMessage } from '@xopcai/xopcbot/channels/transport-types.js';

import { sendTyping } from './api/api.js';
import { TypingStatus } from './api/types.js';
import { assertSessionActive } from './api/session-guard.js';
import {
  listWeixinAccountIds,
  resolveWeixinAccount,
  type ResolvedWeixinAccount,
} from './auth/accounts.js';
import { downloadRemoteImageToTemp } from './cdn/upload.js';
import { getContextToken, findAccountIdsByContextToken } from './messaging/inbound.js';
import { mapWeixinOutboundErrorNotice, sendWeixinErrorNotice } from './messaging/error-notice.js';
import { StreamingMarkdownFilter } from './messaging/markdown-filter.js';
import { markdownToPlainText, sendMessageWeixin } from './messaging/send.js';
import { sendWeixinMediaFile } from './messaging/send-media.js';
import { getWeixinTypingTicket } from './messaging/typing-ticket-store.js';
import { logger } from './util/logger.js';
import { resolveWeixinRootDir } from './storage/state-dir.js';

const MEDIA_OUTBOUND_TEMP_DIR = path.join(resolveWeixinRootDir(), 'media', 'outbound-temp');

/**
 * Weixin ilink text items are plain text (no client-side markdown).
 * Apply StreamingMarkdownFilter (openclaw-weixin), then strip remaining markdown to plain text.
 */
export function formatWeixinOutboundText(text: string): string {
  const f = new StreamingMarkdownFilter();
  const filtered = f.feed(text) + f.flush();
  return markdownToPlainText(filtered);
}

function isLocalFilePath(mediaUrl: string): boolean {
  return !mediaUrl.includes('://');
}

function isRemoteUrl(mediaUrl: string): boolean {
  return mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://');
}

function resolveLocalPath(mediaUrl: string): string {
  if (mediaUrl.startsWith('file://')) return new URL(mediaUrl).pathname;
  if (!path.isAbsolute(mediaUrl)) return path.resolve(mediaUrl);
  return mediaUrl;
}

function resolveOutboundAccountId(cfg: Config, to: string, explicit?: string | null): string {
  if (explicit?.trim()) return explicit.trim();
  const allIds = listWeixinAccountIds(cfg);
  if (allIds.length === 0) {
    throw new Error('weixin: no accounts — complete QR login for Weixin first');
  }
  if (allIds.length === 1) return allIds[0];
  const matched = findAccountIdsByContextToken(allIds, to);
  if (matched.length === 1) return matched[0];
  if (matched.length > 1) {
    throw new Error(
      `weixin: ambiguous account for to=${to}; set delivery.accountId in cron or tool calls.`,
    );
  }
  throw new Error(
    `weixin: cannot pick account for to=${to}; specify accountId or ensure an active session with this user.`,
  );
}

async function sendWeixinTypingIndicator(
  ctx: ChannelOutboundContext,
  mode: 'on' | 'off',
): Promise<OutboundDeliveryResult> {
  try {
    const accountId = resolveOutboundAccountId(ctx.cfg, ctx.to, ctx.accountId);
    const account = resolveWeixinAccount(ctx.cfg, accountId);
    assertSessionActive(accountId);
    if (!account.configured || !account.token) {
      return { messageId: '', chatId: ctx.to, success: true };
    }
    const ticket = getWeixinTypingTicket(accountId, ctx.to);
    if (!ticket) {
      return { messageId: '', chatId: ctx.to, success: true };
    }
    await sendTyping({
      baseUrl: account.baseUrl,
      token: account.token,
      routeTag: account.routeTag,
      body: {
        ilink_user_id: ctx.to,
        typing_ticket: ticket,
        status: mode === 'on' ? TypingStatus.TYPING : TypingStatus.CANCEL,
      },
    });
    return { messageId: '', chatId: ctx.to, success: true };
  } catch (err) {
    logger.debug(
      { err, to: ctx.to },
      `weixin sendTyping ${mode} skipped or failed (best-effort)`,
    );
    return { messageId: '', chatId: ctx.to, success: true };
  }
}

export function createWeixinOutboundHandlers() {
  const sendTextImpl = async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
    const accountId = resolveOutboundAccountId(ctx.cfg, ctx.to, ctx.accountId);
    const account = resolveWeixinAccount(ctx.cfg, accountId);
    assertSessionActive(accountId);
    if (!account.configured || !account.token) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'weixin not logged in' };
    }
    const ctxTok = getContextToken(accountId, ctx.to);
    const raw = ctx.text ?? '';
    const text = formatWeixinOutboundText(raw);
    try {
      const r = await sendMessageWeixin({
        to: ctx.to,
        text,
        opts: {
          baseUrl: account.baseUrl,
          token: account.token,
          routeTag: account.routeTag,
          contextToken: ctxTok,
        },
      });
      return { messageId: r.messageId, chatId: ctx.to, success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, to: ctx.to }, 'weixin sendText failed');
      void sendWeixinErrorNotice({
        to: ctx.to,
        contextToken: ctxTok,
        message: mapWeixinOutboundErrorNotice(msg),
        baseUrl: account.baseUrl,
        token: account.token,
        routeTag: account.routeTag,
        errLog: (m) => logger.warn(m),
      });
      return { messageId: '', chatId: ctx.to, success: false, error: msg };
    }
  };

  const sendMediaImpl = async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
    const accountId = resolveOutboundAccountId(ctx.cfg, ctx.to, ctx.accountId);
    const account = resolveWeixinAccount(ctx.cfg, accountId) as ResolvedWeixinAccount;
    assertSessionActive(accountId);
    if (!account.configured || !account.token) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'weixin not logged in' };
    }
    const ctxTok = getContextToken(accountId, ctx.to);
    const mediaUrl = ctx.mediaUrl?.trim();
    if (!mediaUrl) {
      return { messageId: '', chatId: ctx.to, success: false, error: 'No media URL' };
    }
    const caption = formatWeixinOutboundText(ctx.text ?? '');
    try {
      let filePath: string;
      if (isLocalFilePath(mediaUrl) || mediaUrl.startsWith('file://')) {
        filePath = resolveLocalPath(mediaUrl);
      } else if (isRemoteUrl(mediaUrl)) {
        filePath = await downloadRemoteImageToTemp(mediaUrl, MEDIA_OUTBOUND_TEMP_DIR);
      } else {
        await sendMessageWeixin({
          to: ctx.to,
          text: caption,
          opts: {
            baseUrl: account.baseUrl,
            token: account.token,
            routeTag: account.routeTag,
            contextToken: ctxTok,
          },
        });
        return { messageId: '', chatId: ctx.to, success: true };
      }
      const r = await sendWeixinMediaFile({
        filePath,
        to: ctx.to,
        text: caption,
        opts: {
          baseUrl: account.baseUrl,
          token: account.token,
          routeTag: account.routeTag,
          contextToken: ctxTok,
        },
        cdnBaseUrl: account.cdnBaseUrl,
      });
      return { messageId: r.messageId, chatId: ctx.to, success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, to: ctx.to }, 'weixin sendMedia failed');
      void sendWeixinErrorNotice({
        to: ctx.to,
        contextToken: ctxTok,
        message: mapWeixinOutboundErrorNotice(msg),
        baseUrl: account.baseUrl,
        token: account.token,
        routeTag: account.routeTag,
        errLog: (m) => logger.warn(m),
      });
      return { messageId: '', chatId: ctx.to, success: false, error: msg };
    }
  };

  const sendPayloadImpl = async (
    ctx: ChannelOutboundPayloadContext,
  ): Promise<OutboundDeliveryResult> => {
    const payload = ctx.payload as OutboundMessage;
    if (payload.type === 'typing_on') {
      return sendWeixinTypingIndicator(ctx, 'on');
    }
    if (payload.type === 'typing_off') {
      return sendWeixinTypingIndicator(ctx, 'off');
    }
    const hasMediaUrl = Boolean(ctx.mediaUrl?.trim());
    if (hasMediaUrl) {
      return sendMediaImpl(ctx);
    }
    return sendTextImpl(ctx);
  };

  return {
    sendPayload: sendPayloadImpl,
    sendText: sendTextImpl,
    sendMedia: sendMediaImpl,
  };
}

export function weixinTextChunker(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + limit));
    i += limit;
  }
  return chunks.length ? chunks : [''];
}
