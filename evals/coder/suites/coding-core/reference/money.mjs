export function toCents(price) {
  if (typeof price !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(price)) throw new TypeError('invalid price');
  const [whole, fraction = ''] = price.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('overflow');
  return Number(cents);
}
