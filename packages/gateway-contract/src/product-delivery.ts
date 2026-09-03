import { z } from 'zod';

export const PRODUCT_DELIVERY_VERSION = 1 as const;

export const ProductReferenceKindSchema = z.enum([
  'task',
  'project',
  'note',
  'workflow_definition',
  'workflow_run',
  'automation',
  'local_app',
  'file',
  'session',
  'settings',
]);

export type ProductReferenceKind = z.infer<typeof ProductReferenceKindSchema>;

export const ProductCapabilitySchema = z.enum([
  'open',
  'preview',
  'edit',
  'continue_in_chat',
  'run',
  'pause',
  'resume',
  'share',
  'reveal',
  'configure',
]);

export type ProductCapability = z.infer<typeof ProductCapabilitySchema>;

export const ProductReferenceSchema = z.object({
  kind: ProductReferenceKindSchema,
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  status: z.string().optional(),
  revision: z.string().optional(),
  projectId: z.string().optional(),
  capabilities: z.array(ProductCapabilitySchema).default([]),
});

export type ProductReference = z.infer<typeof ProductReferenceSchema>;

export type ProductReferenceLocator = Pick<ProductReference, 'kind' | 'id'>;

export const ProductDeliveryOperationSchema = z.enum([
  'created',
  'updated',
  'opened',
  'started',
  'completed',
  'failed',
]);

export type ProductDeliveryOperation = z.infer<typeof ProductDeliveryOperationSchema>;

export const ProductDeliveryEnvelopeSchema = z.object({
  version: z.literal(PRODUCT_DELIVERY_VERSION),
  operation: ProductDeliveryOperationSchema,
  primary: ProductReferenceSchema.optional(),
  related: z.array(ProductReferenceSchema).optional(),
});

export type ProductDeliveryEnvelope = z.infer<typeof ProductDeliveryEnvelopeSchema>;

export function parseProductDeliveryEnvelope(value: unknown): ProductDeliveryEnvelope | null {
  const parsed = ProductDeliveryEnvelopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const PRODUCT_DELIVERY_TEXT_PREFIX = 'xopc-product-delivery:';

export function appendProductDeliveryText(
  text: string,
  delivery: ProductDeliveryEnvelope | undefined,
): string {
  if (!delivery) return text;
  const accessLink = delivery.primary
    ? `\nOpen in xopc: [Open](${productReferenceDeepLink(delivery.primary)})`
    : '';
  return `${text}${accessLink}\n${PRODUCT_DELIVERY_TEXT_PREFIX}${encodeURIComponent(JSON.stringify(delivery))}`;
}

export function parseProductDeliveryText(text: string): ProductDeliveryEnvelope | null {
  const marker = text.split(/\s+/).find((part) => part.startsWith(PRODUCT_DELIVERY_TEXT_PREFIX));
  if (!marker) return null;
  try {
    return parseProductDeliveryEnvelope(
      JSON.parse(decodeURIComponent(marker.slice(PRODUCT_DELIVERY_TEXT_PREFIX.length))),
    );
  } catch {
    return null;
  }
}

export function productReferenceRoute(reference: ProductReference): string | null {
  const id = encodeURIComponent(reference.id);
  switch (reference.kind) {
    case 'task':
      return `/tasks/${id}`;
    case 'project':
      return `/projects/${id}`;
    case 'note':
      return `/notes/${id}`;
    case 'workflow_definition':
      return `/workflows/${id}`;
    case 'workflow_run':
      return `/workflows/runs/${id}`;
    case 'automation':
      return `/automations?automation=${id}`;
    case 'local_app':
      return `/local-apps/${id}`;
    case 'session':
      return `/chat/${id}`;
    case 'settings': {
      const section = reference.id
        .replace(/^\/+/, '')
        .split('/')
        .map(encodeURIComponent)
        .join('/');
      return `/settings/${section}`;
    }
    case 'file':
      return null;
  }
}

/**
 * Resolve the user-facing "open" intent. Local apps need a transient route so the
 * console can choose between the installed app and its draft workbench at click time.
 */
export function productReferenceOpenRoute(reference: ProductReference): string | null {
  if (reference.kind !== 'local_app') return productReferenceRoute(reference);
  const params = new URLSearchParams({ kind: reference.kind, id: reference.id });
  return `/open?${params.toString()}`;
}

export function productReferenceDeepLink(reference: Pick<ProductReference, 'kind' | 'id'>): string {
  const params = new URLSearchParams({ kind: reference.kind, id: reference.id });
  return `xopc://open?${params.toString()}`;
}

export function parseProductReferenceDeepLink(value: string): ProductReferenceLocator | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'xopc:' || url.hostname !== 'open') return null;
    const kind = ProductReferenceKindSchema.safeParse(url.searchParams.get('kind'));
    // Older/model-authored session links use the session key as `key`.
    const id = url.searchParams.get('id')?.trim()
      || (kind.success && kind.data === 'session' ? url.searchParams.get('key')?.trim() : undefined);
    return kind.success && id ? { kind: kind.data, id } : null;
  } catch {
    return null;
  }
}
