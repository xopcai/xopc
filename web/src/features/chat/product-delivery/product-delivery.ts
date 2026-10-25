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
  const delivery = parseProductDeliveryEnvelope(record.delivery)
    ?? parseProductDeliveryEnvelope(asRecord(record.details)?.delivery)
    ?? parseProductDeliveryEnvelope(value);
  return attachRun(delivery, record);
}

function attachRun(delivery: ProductDeliveryEnvelope | null, value: unknown): ProductDeliveryEnvelope | null {
  const ref = delivery?.primary;
  if (!delivery || ref?.kind !== 'automation' || ref.runId || delivery.operation !== 'started') return delivery;
  const record = asRecord(value);
  const result = asRecord(record?.result) ?? record;
  const run = asRecord(result?.run);
  if (run?.automationId !== ref.id || typeof run.id !== 'string' || !run.id) return delivery;
  return { ...delivery, primary: { ...ref, runId: run.id } };
}

export function extractProductDelivery(block: ToolUseContent): ProductDeliveryEnvelope | null {
  const live = deliveryFromRecord(block.details);
  if (live) return live;

  const parsed = parseToolResult(block.result);
  const structured = deliveryFromRecord(parsed.details);
  if (structured) return structured;
  const persisted = parseProductDeliveryText(parsed.text);
  if (persisted) {
    try { return attachRun(persisted, JSON.parse(parsed.text.split('\nOpen in xopc:')[0])); }
    catch { return persisted; }
  }

  if (typeof block.result === 'string') {
    try {
      return deliveryFromRecord(JSON.parse(block.result));
    } catch {
      return null;
    }
  }
  return deliveryFromRecord(block.result);
}
