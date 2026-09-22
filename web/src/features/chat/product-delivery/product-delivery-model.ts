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

export function productDeliveryReferences(deliveries: ProductDeliveryEntry[]) {
  const references = deliveries.flatMap(({ key, delivery }) => {
    const candidates = delivery.presentation?.kind === 'table'
      ? delivery.presentation.items
      : delivery.presentation
        ? []
        : [delivery.primary, ...(delivery.related ?? [])];
    return candidates.flatMap((reference, index) => (
      reference ? [{ key: `${key}:${index}:${reference.kind}:${reference.id}`, delivery, reference }] : []
    ));
  });
  return [...new Map(references.map((item) => (
    [`${item.reference.kind}:${item.reference.id}`, item] as const
  ))).values()];
}
