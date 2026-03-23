import path from 'node:path';

import type { Config } from '@xopcai/xopcbot/config/schema.js';
import type {
  ChannelOutboundContext,
  OutboundDeliveryResult,
} from '@xopcai/xopcbot/channels/plugin-types.js';

import { assertSessionActive } from './api/session-guard.js';
import {
  listWeixinAccountIds,
  resolveWeixinAccount,
  type ResolvedWeixinAccount,
} from './auth/accounts.js';
import { downloadRemoteImageToTemp } from './cdn/upload.js';
import { getContextToken, findAccountIdsByContextToken } from './messaging/inbound.js';
import { sendMessageWeixin } from './messaging/send.js';
import { sendWeixinMediaFile } from './messaging/send-media.js';
import { logger } from './util/logger.js';
import { resolveWeixinRootDir } from './storage/state-dir.js';

const MEDIA_OUTBOUND_TEMP_DIR = path.join(resolveWeixinRootDir(), 'media', 'outbound-temp');

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

export function createWeixinOutboundHandlers() {
  return {
    sendText: async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
      const accountId = resolveOutboundAccountId(ctx.cfg, ctx.to, ctx.accountId);
      const account = resolveWeixinAccount(ctx.cfg, accountId);
      assertSessionActive(accountId);
      if (!account.configured || !account.token) {
        return { messageId: '', chatId: ctx.to, success: false, error: 'weixin not logged in' };
      }
      const ctxTok = getContextToken(accountId, ctx.to);
      const text = ctx.text ?? '';
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
        return { messageId: '', chatId: ctx.to, success: false, error: msg };
      }
    },

    sendMedia: async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
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
      try {
        let filePath: string;
        if (isLocalFilePath(mediaUrl) || mediaUrl.startsWith('file://')) {
          filePath = resolveLocalPath(mediaUrl);
        } else if (isRemoteUrl(mediaUrl)) {
          filePath = await downloadRemoteImageToTemp(mediaUrl, MEDIA_OUTBOUND_TEMP_DIR);
        } else {
          await sendMessageWeixin({
            to: ctx.to,
            text: ctx.text ?? '',
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
          text: ctx.text ?? '',
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
        return { messageId: '', chatId: ctx.to, success: false, error: msg };
      }
    },
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
