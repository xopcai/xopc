export function eligible(orders) { return orders.filter(order => order.status !== 'cancelled'); }
