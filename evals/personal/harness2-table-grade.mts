interface MonthResult {
  month: string;
  total: number;
  change: number | null;
}

export function expectedMonthResults(input: string): MonthResult[] {
  const totals = new Map<string, number>();
  for (const row of input.trim().split(/\r?\n/).slice(1)) {
    const [date, amount] = row.split(',');
    const month = date.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + Number(amount));
  }
  const sorted = [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
  return sorted.map(([month, total], index) => ({
    month,
    total,
    change: index === 0 ? null : (total / sorted[index - 1]![1] - 1) * 100,
  }));
}

export function matchesMonthResults(csv: string, expected: readonly MonthResult[]): boolean {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  if (header !== 'month,total,mom_pct' || rows.length !== expected.length) return false;
  return rows.every((row, index) => {
    const fields = row.split(',').map(field => field.trim().replace(/^"(.*)"$/, '$1'));
    const [month, total, change] = fields;
    const result = expected[index]!;
    return fields.length === 3 && month === result.month && total !== '' && Number(total) === result.total
      && (result.change === null ? change === '' : change !== '' && Math.abs(Number(change) - result.change) <= 0.01);
  });
}
