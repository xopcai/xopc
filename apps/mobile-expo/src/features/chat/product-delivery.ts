import {
  parseProductDeliveryEnvelope,
  parseProductDeliveryText,
  parseProductReferenceDeepLink,
  type ProductDeliveryEnvelope,
  type ProductReferenceKind,
  type ProductReferenceLocator,
} from '@xopcai/gateway-contract';

import type { ToolUseContent } from './messages.types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseResult(result: unknown): { details: unknown; text: string } {
  const direct = asRecord(result);
  if (direct && ('details' in direct || 'content' in direct)) {
    const content = Array.isArray(direct.content)
      ? direct.content
        .map((item) => asRecord(item))
        .filter((item) => item?.type === 'text' && typeof item.text === 'string')
        .map((item) => item!.text as string)
        .join('\n')
      : '';
    return { details: direct.details, text: content };
  }
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result) as unknown;
      const record = asRecord(parsed);
      if (record && ('details' in record || 'content' in record)) {
        return parseResult(record);
      }
    } catch {
      // A plain historical tool-result string.
    }
    return { details: null, text: result };
  }
  return { details: null, text: '' };
}

function fromRecord(value: unknown): ProductDeliveryEnvelope | null {
  const record = asRecord(value);
  return parseProductDeliveryEnvelope(record?.delivery)
    ?? parseProductDeliveryEnvelope(asRecord(record?.details)?.delivery)
    ?? parseProductDeliveryEnvelope(value);
}

export function extractMobileProductDelivery(block: ToolUseContent): ProductDeliveryEnvelope | null {
  const live = fromRecord(block.details);
  if (live) return live;
  const parsed = parseResult(block.result);
  return fromRecord(parsed.details)
    ?? parseProductDeliveryText(parsed.text)
    ?? fromRecord(block.result);
}

export function mobileProductRoute(reference: ProductReferenceLocator): string {
  const id = encodeURIComponent(reference.id);
  switch (reference.kind) {
    case 'task':
      return `/tasks/${id}`;
    case 'project':
      return `/projects/${id}`;
    case 'note':
      return `/items/${id}`;
    case 'automation':
      return '/automation';
    case 'session':
      return `/chat/${id}`;
    case 'file':
      return '/files';
    case 'settings':
      return '/settings';
    case 'workflow_definition':
    case 'workflow_run':
    case 'local_app':
      return '/';
  }
}

export function mobileRouteFromProductDeepLink(value: string): string | null {
  const reference = parseProductReferenceDeepLink(value);
  return reference ? mobileProductRoute(reference) : null;
}

export const MOBILE_NATIVE_PRODUCT_KINDS = new Set<ProductReferenceKind>([
  'task',
  'project',
  'note',
  'automation',
  'session',
  'file',
  'settings',
]);
