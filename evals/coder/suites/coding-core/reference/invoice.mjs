import { toCents } from './money.mjs';
export function invoice(lines) {
  return lines.reduce((sum, line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) throw new RangeError('invalid quantity');
    const next = sum + toCents(line.price) * line.quantity;
    if (!Number.isSafeInteger(next)) throw new RangeError('overflow');
    return next;
  }, 0);
}
