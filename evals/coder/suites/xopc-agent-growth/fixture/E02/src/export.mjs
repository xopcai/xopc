import {eligible} from './orders.mjs';
export function exportOrders(orders, {limit = orders.length} = {}) {
  const selected = eligible(orders).slice(0, limit);
  return {ids: selected.map(order => order.id), totalCents: selected.reduce((sum, order) => sum + order.cents, 0)};
}
