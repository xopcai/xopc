import type { Context } from 'grammy';
import type { Message } from '@grammyjs/types';

const TEXT_FRAGMENT_GAP_MS = 500;
const MEDIA_GROUP_GAP_MS = 800;
const MAX_TEXT_FRAGMENTS = 12;
const MAX_TEXT_FRAGMENT_CHARS = 50_000;

export type TelegramCoalescedInbound = {
  ctx: Context;
  accountId: string;
  messages: Message[];
};

type Input = {
  ctx: Context;
  accountId: string;
  message: Message;
  onReady: (batch: TelegramCoalescedInbound) => Promise<void>;
};

type Group = {
  messages: Message[];
  waiters: Array<{ resolve: () => void; reject: (err: unknown) => void }>;
  size: number;
  timer?: ReturnType<typeof setTimeout>;
};

export function createTelegramInboundCoalescer() {
  const groups = new Map<string, Group>();

  return {
    async enqueue({ ctx, accountId, message, onReady }: Input): Promise<void> {
      const album = message.media_group_id;
      const fragment = (message.text?.length ?? 0) >= 3500;
      if (!album && !fragment) {
        await onReady({ ctx, accountId, messages: [message] });
        return;
      }

      const key = JSON.stringify([accountId, ctx.chat?.id, message.message_thread_id, ctx.from?.id, album ?? 'text']);
      const group = groups.get(key) ?? { messages: [], waiters: [], size: 0 };
      groups.set(key, group);
      group.messages.push(message);
      group.size += message.text?.length ?? 0;
      if (group.timer) clearTimeout(group.timer);

      await new Promise<void>((resolve, reject) => {
        group.waiters.push({ resolve, reject });
        const flush = () => {
          groups.delete(key);
          const messages = [...group.messages].sort((a, b) => a.message_id - b.message_id);
          const last = messages.at(-1)!;
          const readyMessages = album ? messages : [{ ...last, text: messages.map(item => item.text ?? '').join('') }];
          void Promise.resolve().then(() => onReady({ ctx, accountId, messages: readyMessages })).then(
            () => { for (const waiter of group.waiters) waiter.resolve(); },
            err => { for (const waiter of group.waiters) waiter.reject(err); },
          );
        };
        if (group.messages.length >= MAX_TEXT_FRAGMENTS || group.size >= MAX_TEXT_FRAGMENT_CHARS) flush();
        else group.timer = setTimeout(flush, album ? MEDIA_GROUP_GAP_MS : TEXT_FRAGMENT_GAP_MS);
      });
    },
  };
}
