import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import type { InboundMessage } from '@xopcai/xopc/channels/transport-types.js';
import { createInboundDebouncer, hasControlCommand } from '@xopcai/xopc/infra/debounce.js';

export type FeishuInboundWorkKind = 'text' | 'card_action' | 'reaction' | 'recall';

export interface FeishuInboundWork {
  kind: FeishuInboundWorkKind;
  accountId: string;
  chatId: string;
  /** Effective debounce for this work item (0 = no coalescing). */
  debounceMs: number;
  inbound: InboundMessage;
}

function mergeTextInbound(items: FeishuInboundWork[]): InboundMessage {
  const last = items[items.length - 1]!;
  const parts = items.map((i) => (i.inbound.content ?? '').trim()).filter(Boolean);
  const mergedContent = parts.join('\n\n');
  const lastMeta = { ...(last.inbound.metadata ?? {}) };
  const ids = items
    .map((i) => i.inbound.metadata?.messageId)
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return {
    ...last.inbound,
    content: mergedContent,
    metadata: {
      ...lastMeta,
      messageId: lastMeta.messageId,
      feishuMergedCount: items.length,
      ...(ids.length > 0 ? { feishuMergedMessageIds: ids } : {}),
    },
  };
}

function worksToInboundMessages(items: FeishuInboundWork[]): InboundMessage[] {
  if (items.length === 0) return [];
  const first = items[0]!;
  if (first.kind !== 'text') {
    return items.map((i) => i.inbound);
  }
  if (items.length === 1) {
    return [first.inbound];
  }
  return [mergeTextInbound(items)];
}

export interface FeishuInboundPipelineOptions {
  bus: MessageBus;
  /** Fallback when work.debounceMs is unset (should not happen if callers set it). */
  defaultDebounceMs: number;
  onError?: (err: unknown, items: FeishuInboundWork[]) => void;
}

export function createFeishuInboundPipeline(options: FeishuInboundPipelineOptions) {
  const { bus, defaultDebounceMs, onError } = options;

  const debouncer = createInboundDebouncer<FeishuInboundWork>({
    debounceMs: defaultDebounceMs,
    buildKey: (item) => `${item.accountId}:${item.chatId}`,
    shouldDebounce: (item) =>
      item.kind === 'text' && item.debounceMs > 0 && !hasControlCommand(item.inbound.content ?? ''),
    resolveDebounceMs: (item) => (item.kind === 'text' ? item.debounceMs : 0),
    onFlush: async (items) => {
      const messages = worksToInboundMessages(items);
      for (const msg of messages) {
        await bus.publishInbound(msg);
      }
    },
    onError,
  });

  return {
    async enqueue(work: FeishuInboundWork): Promise<void> {
      await debouncer.enqueue(work);
    },
    flushAll: () => debouncer.flushAll(),
    flushKey: (accountId: string, chatId: string) => debouncer.flushKey(`${accountId}:${chatId}`),
  };
}
