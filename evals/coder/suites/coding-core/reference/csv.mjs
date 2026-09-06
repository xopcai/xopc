export function parseCsv(text) {
  if (text === '') return [];
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(field); field = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      rows.push([...row, field]); row = []; field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('unterminated quoted field');
  if (row.length || field || !/[\r\n]$/.test(text)) rows.push([...row, field]);
  return rows;
}
