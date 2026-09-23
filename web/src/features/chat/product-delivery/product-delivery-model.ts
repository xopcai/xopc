import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';

export type ProductDeliveryEntry = {
  key: string;
  delivery: ProductDeliveryEnvelope;
};

export function productDeliveryDiffPresentations(deliveries: ProductDeliveryEntry[]) {
  return deliveries.flatMap(({ key, delivery }) => (
    delivery.presentation?.kind === 'diff' ? [{ key, presentation: delivery.presentation }] : []
  ));
}

export function productDeliveryQueryState(deliveries: ProductDeliveryEntry[]) {
  const tables = deliveries.flatMap(({ delivery }) => (
    delivery.presentation?.kind === 'table' ? [delivery.presentation] : []
  ));
  return {
    truncated: tables.some(table => table.truncated),
  };
}

export function productDeliveryInlineApps(deliveries: ProductDeliveryEntry[]) {
  const inlineApps = deliveries.flatMap(({ key, delivery }) => (
    delivery.presentation?.kind === 'inline_app'
      ? [{ key, delivery, presentation: delivery.presentation }]
      : []
  ));
  return [...new Map(inlineApps.map((item) => (
    [`${item.presentation.reference.id}:${item.presentation.snapshot.sourceHash}`, item] as const
  ))).values()];
}

export function productDeliveryInlinePreviews(deliveries: ProductDeliveryEntry[]) {
  const previews = deliveries.flatMap(({ key, delivery }) => (
    delivery.presentation?.kind === 'inline_preview'
      ? [{ key, delivery, presentation: delivery.presentation }]
      : []
  ));
  return [...new Map(previews.map((item) => (
    [`${item.presentation.reference.id}:${item.presentation.sourceHash}`, item] as const
  ))).values()];
}

export function productDeliveryReferences(
  deliveries: ProductDeliveryEntry[],
  excludedReferenceKeys?: ReadonlySet<string>,
) {
  const references = deliveries.flatMap(({ key, delivery }) => {
    const candidates = delivery.presentation?.kind === 'table'
      ? delivery.presentation.items
      : delivery.presentation
        ? []
        : [delivery.primary, ...(delivery.related ?? [])];
    return candidates.flatMap((reference, index) => {
      if (!reference) return [];
      const referenceKey = `${reference.kind}:${reference.id}`;
      return excludedReferenceKeys?.has(referenceKey)
        ? []
        : [{ key: `${key}:${index}:${referenceKey}`, delivery, reference }];
    });
  });
  return [...new Map(references.map((item) => (
    [`${item.reference.kind}:${item.reference.id}`, item] as const
  ))).values()];
}
