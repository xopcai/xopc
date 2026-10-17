export function summarize(rows) { return { rowCount: rows.length, totalCents: rows.reduce((sum, row) => sum + row.cents, 0) }; }
