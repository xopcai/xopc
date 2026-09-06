export function parseCsv(text) {
  return text.trim().split('\n').map(row => row.split(','));
}
