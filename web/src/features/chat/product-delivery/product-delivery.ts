import {
  parseProductDeliveryEnvelope,
  parseProductDeliveryText,
  type ProductDeliveryEnvelope,
} from '@xopcai/gateway-contract';

import type { ToolUseContent } from '@/features/chat/messages/messages.types';
import { parseToolResult } from '@/features/chat/tool-results/parse-tool-result';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function deliveryFromRecord(value: unknown): ProductDeliveryEnvelope | null {
  const record = asRecord(value);
  if (!record) return null;
  return parseProductDeliveryEnvelope(record.delivery)
    ?? parseProductDeliveryEnvelope(asRecord(record.details)?.delivery)
    ?? parseProductDeliveryEnvelope(value);
}

export function extractProductDelivery(block: ToolUseContent): ProductDeliveryEnvelope | null {
  const live = deliveryFromRecord(block.details);
  if (live) return live;

  const parsed = parseToolResult(block.result);
  const structured = deliveryFromRecord(parsed.details);
  if (structured) return structured;
  const persisted = parseProductDeliveryText(parsed.text);
  if (persisted) return persisted;

  if (typeof block.result === 'string') {
    try {
      return deliveryFromRecord(JSON.parse(block.result));
    } catch {
      return null;
    }
  }
  return deliveryFromRecord(block.result);
}
