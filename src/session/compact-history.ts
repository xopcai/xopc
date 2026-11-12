import { parseProductDeliveryEnvelope, parseProductDeliveryText, type ProductDeliveryEnvelope } from '@xopcai/gateway-contract';
import type { ClientHistoryMessage } from './client-history.js';

export function conciseProgress(text: string): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  return plain.length > 160 ? plain.slice(0, 159) + '…' : plain;
}

export function productDeliveries(result: unknown): ProductDeliveryEnvelope[] {
  if (!result || typeof result !== 'object') return [];
  const value = result as Record<string, unknown>;
  const details = value.details as Record<string, unknown> | undefined;
  const text = typeof value.text === 'string' ? value.text : typeof value.result === 'string' ? value.result
    : Array.isArray(value.content) ? value.content.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '';
  const delivery = parseProductDeliveryEnvelope(details?.delivery) ?? parseProductDeliveryEnvelope(details)
    ?? parseProductDeliveryText(text);
  return delivery ? [delivery] : [];
}

function generatedMediaId(call: NonNullable<ClientHistoryMessage['toolCalls']>[number]): string | undefined {
  if (call.isError || (call.name !== 'music_generation' && call.name !== 'video_draft') || !call.result) return;
  try {
    const id: unknown = JSON.parse(call.result)?.id;
    if (typeof id !== 'string') return;
    const pattern = call.name === 'music_generation'
      ? /^[a-f0-9]{64}$/
      : /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
    return pattern.test(id) ? id : undefined;
  } catch { return undefined; }
}

/** Transport-only projection: stored transcripts and default clients remain unchanged. */
export function compactHistory(messages: ClientHistoryMessage[]): ClientHistoryMessage[] {
  const replyIndex = new Map<string, number>();
  const mediaByReply = new Map<number, Set<string>>();
  const seenMedia = new Set<string>();
  messages.forEach((message, index) => {
    if (message.role === 'assistant' && message.turnId && !message.toolCalls?.length && message.content.trim()) {
      replyIndex.set(message.turnId, index);
    }
  });
  messages.forEach((message, index) => {
    for (const call of message.toolCalls ?? []) {
      const id = generatedMediaId(call);
      if (!id || seenMedia.has(id)) continue;
      seenMedia.add(id);
      const target = (message.turnId ? replyIndex.get(message.turnId) : undefined) ?? index;
      const ids = mediaByReply.get(target) ?? new Set<string>();
      ids.add(id);
      mediaByReply.set(target, ids);
    }
  });
  return messages.flatMap((message, index) => {
    if (message.role === 'system') return [];
    if (message.role === 'user') return [message];
    const narration = !!message.toolCalls?.length;
    const content = narration ? conciseProgress(message.content) : message.content;
    const raw = Array.isArray(message.rawContent) ? message.rawContent : [];
    const mediaAndReview = raw.filter(block => block && typeof block === 'object'
      && ['image', 'audio', 'tts_audio', 'review'].includes(String((block as Record<string, unknown>).type)));
    const deliveries = (message.toolCalls ?? []).filter(call => !call.isError).flatMap(productDeliveries);
    const activities = (message.toolCalls ?? []).map((call, index) => ({ type: 'tool_use',
      id: call.id ?? `${message.id ?? message.turnId ?? message.timestamp ?? 'activity'}:tool:${index}`,
      name: call.name, status: call.isError ? 'error' : 'done' }));
    const outcome = message.metadata?.turnOutcome;
    if (!content && !mediaAndReview.length && !message.media?.length && !outcome && !deliveries.length && !activities.length) return [];
    return [{ id: message.id, ...(!narration && message.transcriptEntryId ? { transcriptEntryId: message.transcriptEntryId } : {}), turnId: message.turnId, startsNewBubble: message.startsNewBubble,
      ...(message.stopReason ? { stopReason: message.stopReason } : {}),
      role: message.role, content, timestamp: message.timestamp,
      media: message.media, deliveries,
      ...(mediaByReply.has(index) ? { generatedMediaIds: [...(mediaByReply.get(index) ?? [])] } : {}),
      rawContent: [...(content ? [{ type: 'text', text: content, presentation: narration ? 'narration' : 'answer' }] : []), ...activities, ...mediaAndReview],
      ...(outcome ? { metadata: { turnOutcome: { ...outcome, evidence: [], changeSet: undefined },
        ...(message.metadata?.taskResultDelivery ? { taskResultDelivery: message.metadata.taskResultDelivery } : {}) } } : {}),
    }];
  });
}
