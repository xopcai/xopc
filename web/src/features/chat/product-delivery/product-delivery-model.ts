import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';

export type ProductDeliveryEntry = {
  key: string;
  delivery: ProductDeliveryEnvelope;
};

export function productDeliveryPresentations(deliveries: ProductDeliveryEntry[]) {
  return deliveries.flatMap(({ key, delivery }) => (
    delivery.presentation ? [{ key, presentation: delivery.presentation }] : []
  ));
}

export function productDeliveryReferences(deliveries: ProductDeliveryEntry[]) {
  const references = deliveries.flatMap(({ key, delivery }) => {
    if (delivery.presentation) return [];
    return [delivery.primary, ...(delivery.related ?? [])].flatMap((reference, index) => (
      reference ? [{ key: `${key}:${index}:${reference.kind}:${reference.id}`, delivery, reference }] : []
    ));
  });
  return [...new Map(references.map((item) => (
    [`${item.reference.kind}:${item.reference.id}`, item] as const
  ))).values()];
}
