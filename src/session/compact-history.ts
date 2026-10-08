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

/** Transport-only projection: stored transcripts and default clients remain unchanged. */
export function compactHistory(messages: ClientHistoryMessage[]): ClientHistoryMessage[] {
  return messages.flatMap(message => {
    if (message.role === 'system') return [];
    if (message.role === 'user') return [message];
    const narration = !!message.toolCalls?.length;
    const content = narration ? conciseProgress(message.content) : message.content;
    const raw = Array.isArray(message.rawContent) ? message.rawContent : [];
    const mediaAndReview = raw.filter(block => block && typeof block === 'object'
      && ['image', 'audio', 'tts_audio', 'review'].includes(String((block as Record<string, unknown>).type)));
    const deliveries = (message.toolCalls ?? []).filter(call => !call.isError).flatMap(productDeliveries);
    const outcome = message.metadata?.turnOutcome;
    if (!content && !mediaAndReview.length && !message.media?.length && !outcome && !deliveries.length) return [];
    return [{ id: message.id, turnId: message.turnId, startsNewBubble: message.startsNewBubble,
      role: message.role, content, timestamp: message.timestamp,
      media: message.media, deliveries,
      rawContent: [...(content ? [{ type: 'text', text: content, presentation: narration ? 'narration' : 'answer' }] : []), ...mediaAndReview],
      ...(outcome ? { metadata: { turnOutcome: { ...outcome, evidence: [], changeSet: undefined },
        ...(message.metadata?.taskResultDelivery ? { taskResultDelivery: message.metadata.taskResultDelivery } : {}) } } : {}),
    }];
  });
}
