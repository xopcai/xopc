import { toCents } from './money.mjs';
export function invoice(lines) {
  return lines.reduce((sum, line) => sum + toCents(line.price) * line.quantity, 0);
}
