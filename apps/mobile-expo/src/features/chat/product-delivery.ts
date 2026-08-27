import {
  parseProductDeliveryEnvelope,
  parseProductDeliveryText,
  parseProductReferenceDeepLink,
  type ProductDeliveryEnvelope,
  type ProductReferenceKind,
  type ProductReferenceLocator,
} from '@xopcai/gateway-contract';

import type { ToolUseContent } from './messages.types';
import { asRecord, parseToolResult } from './parse-tool-result';

function fromRecord(value: unknown): ProductDeliveryEnvelope | null {
  const record = asRecord(value);
  return parseProductDeliveryEnvelope(record?.delivery)
    ?? parseProductDeliveryEnvelope(asRecord(record?.details)?.delivery)
    ?? parseProductDeliveryEnvelope(value);
}

export function extractMobileProductDelivery(block: ToolUseContent): ProductDeliveryEnvelope | null {
  const live = fromRecord(block.details);
  if (live) return live;
  const parsed = parseToolResult(block.result);
  return fromRecord(parsed.details)
    ?? parseProductDeliveryText(parsed.text)
    ?? fromRecord(block.result);
}

export function mobileProductRoute(reference: ProductReferenceLocator & { projectId?: string }): string | null {
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
    case 'workflow_run':
      return `/workflows/runs/${id}${reference.projectId ? `?projectId=${encodeURIComponent(reference.projectId)}` : ''}`;
    case 'workflow_definition':
    case 'local_app':
      return null;
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
  'workflow_run',
]);
