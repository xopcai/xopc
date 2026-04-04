import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import type { Config } from '@xopcai/xopcbot/config/schema.js';
import type { MessageBus } from '@xopcai/xopcbot/infra/bus/index.js';
import { generateSessionKey } from '@xopcai/xopcbot/chat-commands/session-key.js';
import { evaluateAccess } from '@xopcai/xopcbot/channels/security.js';
import type { WeixinMessage } from '../api/types.js';
import { MessageItemType } from '../api/types.js';
import type { ResolvedWeixinAccount } from '../auth/accounts.js';
import { readFrameworkAllowFromList } from '../auth/pairing.js';
import { downloadMediaFromItem } from '../media/media-download.js';
import { logger } from '../util/logger.js';
import { resolveWeixinRootDir } from '../storage/state-dir.js';
import { handleSlashCommand } from './slash-commands.js';
import {
  setContextToken,
  weixinMessageToMsgContext,
  isMediaItem,
  type WeixinInboundMediaOpts,
} from './inbound.js';
import { isDebugMode } from './debug-mode.js';

function extractTextBody(itemList?: import('../api/types.js').MessageItem[]): string {
  if (!itemList?.length) return '';
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
  }
  return '';
}

function mergeAllowFrom(account: ResolvedWeixinAccount, accountId: string): string[] {
  const store = readFrameworkAllowFromList(accountId);
  return [...new Set([...(account.allowFrom ?? []).map(String), ...store])];
}

async function saveMediaBuffer(
  buffer: Buffer,
  contentType?: string,
  _subdir?: string,
  maxBytes?: number,
  originalFilename?: string,
): Promise<{ path: string }> {
  const cap = maxBytes ?? 100 * 1024 * 1024;
  if (buffer.length > cap) {
    throw new Error(`weixin media exceeds max bytes (${cap})`);
  }
  const dir = path.join(resolveWeixinRootDir(), 'media', 'inbound-temp');
  await mkdir(dir, { recursive: true });
  const ext = originalFilename ? path.extname(originalFilename) : contentType?.includes('wav') ? '.wav' : '.bin';
  const fname = `${Date.now()}-${randomBytes(6).toString('hex')}${ext || '.bin'}`;
  const filePath = path.join(dir, fname);
  await writeFile(filePath, buffer);
  return { path: filePath };
}

export type ProcessWeixinMessageDeps = {
  accountId: string;
  account: ResolvedWeixinAccount;
  config: Config;
  bus: MessageBus;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  routeTag?: string;
};

export async function processWeixinInboundMessage(
  full: WeixinMessage,
  deps: ProcessWeixinMessageDeps,
): Promise<void> {
  const receivedAt = Date.now();
  const senderId = full.from_user_id ?? '';
  // Persist ilink context_token before slash handling and DM policy. Pairing only gates the agent
  // pipeline; cron/tools still need a cached token to call sendmessage.
  if (full.context_token?.trim() && senderId) {
    setContextToken(deps.accountId, senderId, full.context_token, { sendToUserId: senderId });
  }

  const textBody = extractTextBody(full.item_list);

  if (textBody.startsWith('/')) {
    const slashResult = await handleSlashCommand(
      textBody,
      {
        to: full.from_user_id ?? '',
        contextToken: full.context_token,
        baseUrl: deps.baseUrl,
        token: deps.token,
        accountId: deps.accountId,
        log: () => {},
        errLog: () => {},
      },
      receivedAt,
      full.create_time_ms,
    );
    if (slashResult.handled) {
      return;
    }
  }

  const mergedAllow = mergeAllowFrom(deps.account, deps.accountId);
  const access = evaluateAccess({
    context: {
      channel: 'weixin',
      accountId: deps.accountId,
      chatId: senderId,
      senderId,
      isGroup: false,
      isDm: true,
    },
    dmPolicy: deps.account.dmPolicy ?? 'pairing',
    allowFrom: mergedAllow,
  });
  if (!access.allowed) {
    logger.info(
      `weixin: dropped message from=${senderId} dmPolicy=${deps.account.dmPolicy ?? 'pairing'} reason=${access.reason ?? 'not allowed'}`,
    );
    return;
  }

  const mediaOpts: WeixinInboundMediaOpts = {};

  const hasDownloadableMedia = (m?: { encrypt_query_param?: string; full_url?: string }) =>
    Boolean(m?.encrypt_query_param || m?.full_url);

  const mainMediaItem =
    full.item_list?.find(
      (i) => i.type === MessageItemType.IMAGE && hasDownloadableMedia(i.image_item?.media),
    ) ??
    full.item_list?.find(
      (i) => i.type === MessageItemType.VIDEO && hasDownloadableMedia(i.video_item?.media),
    ) ??
    full.item_list?.find(
      (i) => i.type === MessageItemType.FILE && hasDownloadableMedia(i.file_item?.media),
    ) ??
    full.item_list?.find(
      (i) =>
        i.type === MessageItemType.VOICE &&
        hasDownloadableMedia(i.voice_item?.media) &&
        !i.voice_item?.text,
    );
  const refMediaItem = !mainMediaItem
    ? full.item_list?.find(
        (i) =>
          i.type === MessageItemType.TEXT &&
          i.ref_msg?.message_item &&
          isMediaItem(i.ref_msg.message_item!),
      )?.ref_msg?.message_item
    : undefined;

  const mediaItem = mainMediaItem ?? refMediaItem;
  if (mediaItem) {
    const label = refMediaItem ? 'ref' : 'inbound';
    const downloaded = await downloadMediaFromItem(mediaItem, {
      cdnBaseUrl: deps.cdnBaseUrl,
      saveMedia: saveMediaBuffer,
      log: (m) => logger.debug(m),
      errLog: (m) => logger.warn(m),
      label,
    });
    Object.assign(mediaOpts, downloaded);
  }

  const ctx = weixinMessageToMsgContext(full, deps.accountId, mediaOpts);
  const body = ctx.Body?.trim() ?? '';

  const sessionKey = generateSessionKey({
    source: 'weixin',
    chatId: senderId,
    senderId,
    isGroup: false,
    accountId: deps.accountId,
  });

  const attachments: Array<{ type: string; mimeType?: string; data?: string; name?: string }> = [];

  if (mediaOpts.decryptedPicPath) {
    const buf = await readFile(mediaOpts.decryptedPicPath);
    attachments.push({
      type: 'image',
      mimeType: 'image/jpeg',
      data: buf.toString('base64'),
      name: path.basename(mediaOpts.decryptedPicPath),
    });
  } else if (mediaOpts.decryptedVoicePath) {
    const buf = await readFile(mediaOpts.decryptedVoicePath);
    attachments.push({
      type: 'audio',
      mimeType: mediaOpts.voiceMediaType ?? 'audio/wav',
      data: buf.toString('base64'),
      name: path.basename(mediaOpts.decryptedVoicePath),
    });
  } else if (mediaOpts.decryptedFilePath) {
    const buf = await readFile(mediaOpts.decryptedFilePath);
    attachments.push({
      type: 'file',
      mimeType: mediaOpts.fileMediaType ?? 'application/octet-stream',
      data: buf.toString('base64'),
      name: path.basename(mediaOpts.decryptedFilePath),
    });
  } else if (mediaOpts.decryptedVideoPath) {
    const buf = await readFile(mediaOpts.decryptedVideoPath);
    attachments.push({
      type: 'file',
      mimeType: 'video/mp4',
      data: buf.toString('base64'),
      name: path.basename(mediaOpts.decryptedVideoPath),
    });
  }

  const debug = isDebugMode(deps.accountId);
  if (debug) {
    logger.debug(
      `weixin debug inbound from=${senderId} bodyLen=${body.length} attachments=${attachments.length}`,
    );
  }

  await deps.bus.publishInbound({
    channel: 'weixin',
    sender_id: senderId,
    chat_id: senderId,
    content: body,
    metadata: {
      accountId: deps.accountId,
      sessionKey,
      messageId: full.message_id != null ? String(full.message_id) : undefined,
      isGroup: false,
      isCommand: body.trim().startsWith('/'),
      contextToken: ctx.context_token,
    },
    attachments: attachments.length ? attachments : undefined,
  });
}
