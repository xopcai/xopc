import { createContext } from 'react';
import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';

export const AutomationRunLinkContext = createContext<ReadonlyMap<string, string>>(new Map());

export function automationRunBindings(deliveries: { delivery: ProductDeliveryEnvelope }[]): ReadonlyMap<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const { delivery } of deliveries) {
    const ref = delivery.primary;
    if (ref?.kind !== 'automation' || !ref.runId) continue;
    const ids = candidates.get(ref.id) ?? new Set<string>();
    ids.add(ref.runId); candidates.set(ref.id, ids);
  }
  return new Map([...candidates].flatMap(([id, runs]) => runs.size === 1 ? [[id, [...runs][0]]] : []));
}
