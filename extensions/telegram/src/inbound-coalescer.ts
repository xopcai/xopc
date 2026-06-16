import type { Context } from 'grammy';
import type { Message } from '@grammyjs/types';

const TEXT_FRAGMENT_GAP_MS = 500;
const MEDIA_GROUP_GAP_MS = 800;
const MAX_TEXT_FRAGMENTS = 12;
const MAX_TEXT_FRAGMENT_CHARS = 50_000;

type PendingTextFragment = {
  key: string;
  messages: Message[];
  timer?: ReturnType<typeof setTimeout>;
};

type PendingMediaGroup = {
  key: string;
  messages: Message[];
  timer?: ReturnType<typeof setTimeout>;
};

export type TelegramCoalescedInbound = {
  ctx: Context;
  accountId: string;
  messages: Message[];
};

export function createTelegramInboundCoalescer() {
  const textFragments = new Map<string, PendingTextFragment>();
  const mediaGroups = new Map<string, PendingMediaGroup>();

  return {
    async enqueue(params: {
      ctx: Context;
      accountId: string;
      message: Message;
      onReady: (batch: TelegramCoalescedInbound) => Promise<void>;
    }): Promise<void> {
      const { ctx, accountId, message, onReady } = params;
      const mediaGroupId = message.media_group_id;
      if (mediaGroupId) {
        await enqueueMediaGroup({
          key: `${accountId}:${ctx.chat?.id}:${mediaGroupId}`,
          ctx,
          accountId,
          message,
          onReady,
          mediaGroups,
        });
        return;
      }

      if (message.text && message.message_id) {
        await enqueueTextFragment({
          key: `${accountId}:${ctx.chat?.id}:${ctx.from?.id}:${message.message_id}`,
          ctx,
          accountId,
          message,
          onReady,
          textFragments,
        });
        return;
      }

      await onReady({ ctx, accountId, messages: [message] });
    },
  };
}

async function enqueueMediaGroup(params: {
  key: string;
  ctx: Context;
  accountId: string;
  message: Message;
  onReady: (batch: TelegramCoalescedInbound) => Promise<void>;
  mediaGroups: Map<string, PendingMediaGroup>;
}): Promise<void> {
  const existing = params.mediaGroups.get(params.key);
  const entry = existing ?? { key: params.key, messages: [] };
  entry.messages.push(params.message);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(async () => {
    params.mediaGroups.delete(params.key);
    await params.onReady({
      ctx: params.ctx,
      accountId: params.accountId,
      messages: entry.messages,
    });
  }, MEDIA_GROUP_GAP_MS);
  entry.timer.unref?.();
  params.mediaGroups.set(params.key, entry);
}

async function enqueueTextFragment(params: {
  key: string;
  ctx: Context;
  accountId: string;
  message: Message;
  onReady: (batch: TelegramCoalescedInbound) => Promise<void>;
  textFragments: Map<string, PendingTextFragment>;
}): Promise<void> {
  const text = params.message.text ?? '';
  const isFragmentCandidate = text.length >= 3500;
  if (!isFragmentCandidate) {
    await params.onReady({ ctx: params.ctx, accountId: params.accountId, messages: [params.message] });
    return;
  }

  const baseKey = `${params.accountId}:${params.ctx.chat?.id}:${params.ctx.from?.id}`;
  const existing = [...params.textFragments.values()].find((e) => e.key.startsWith(baseKey));
  const entry = existing ?? { key: `${baseKey}:${params.message.message_id}`, messages: [] };

  if (entry.messages.length >= MAX_TEXT_FRAGMENTS) {
    await flushTextFragment(entry, params);
    return;
  }

  entry.messages.push(params.message);
  const combinedLen = entry.messages.reduce((n, m) => n + (m.text?.length ?? 0), 0);
  if (combinedLen > MAX_TEXT_FRAGMENT_CHARS) {
    await flushTextFragment(entry, params);
    return;
  }

  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(async () => {
    await flushTextFragment(entry, params);
  }, TEXT_FRAGMENT_GAP_MS);
  entry.timer.unref?.();
  params.textFragments.set(entry.key, entry);
}

async function flushTextFragment(
  entry: PendingTextFragment,
  params: {
    ctx: Context;
    accountId: string;
    onReady: (batch: TelegramCoalescedInbound) => Promise<void>;
    textFragments: Map<string, PendingTextFragment>;
  },
): Promise<void> {
  params.textFragments.delete(entry.key);
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.messages.length === 0) return;
  const mergedText = entry.messages.map((m) => m.text ?? '').join('');
  const base = entry.messages[entry.messages.length - 1]!;
  const merged: Message = { ...base, text: mergedText };
  await params.onReady({ ctx: params.ctx, accountId: params.accountId, messages: [merged] });
}
