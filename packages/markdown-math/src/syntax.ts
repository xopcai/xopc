import type { MathSource } from './types';

export function isEscaped(source: string, offset: number): boolean {
  let count = 0;
  while (offset > 0 && source[--offset] === '\\') count++;
  return count % 2 === 1;
}

function closingOffset(source: string, start: number, closer: string, inline: boolean): number {
  let comment = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\n' || source[i] === '\r') {
      if (inline) return -1;
      comment = false;
    }
    if (comment) continue;
    if (source[i] === '%' && !isEscaped(source, i)) { comment = true; continue; }
    if (source.startsWith(closer, i) && !isEscaped(source, i)) return i;
  }
  return -1;
}

export function readInlineMathAt(source: string, offset = 0): MathSource | undefined {
  if (isEscaped(source, offset)) return;
  const paren = source.startsWith('\\(', offset);
  if (!paren && (source[offset] !== '$' || source[offset + 1] === '$' || source[offset - 1] === '$')) return;
  const width = paren ? 2 : 1;
  const start = offset + width;
  if (!paren && (!source[start] || /\s/.test(source[start]))) return;
  const close = closingOffset(source, start, paren ? '\\)' : '$', true);
  if (close === -1) {
    if (!paren) return;
    const lineEnd = source.slice(start).search(/[\r\n]/);
    const end = lineEnd < 0 ? source.length : start + lineEnd;
    return { raw: source.slice(offset, end), latex: source.slice(start, end), display: false,
      delimiter: 'paren', state: 'pending', range: { start: offset, end } };
  }
  const latex = source.slice(start, close);
  if (!paren && (!latex || /\s$/.test(latex) || /\d/.test(source[close + 1] ?? '')
    || source[close + 1] === '$' || /^[\d\s.,+\-€£¥￥]+$/.test(latex))) return;
  const end = close + width;
  return { raw: source.slice(offset, end), latex, display: false,
    delimiter: paren ? 'paren' : 'dollar', state: 'complete', range: { start: offset, end } };
}

/** Called only at a logical block start, after the host handles container prefixes. */
export function readDisplayMathAt(source: string, offset = 0): MathSource | undefined {
  const opening = /^( {0,3})(\\\[|\$\$)/.exec(source.slice(offset));
  if (!opening) return;
  const start = offset + opening[0].length;
  const bracket = opening[2] === '\\[';
  const close = closingOffset(source, start, bracket ? '\\]' : '$$', false);
  if (close >= 0) {
    const end = close + 2;
    const suffix = source.slice(end).match(/^[^\r\n]*/)?.[0] ?? '';
    if (suffix.trim()) return;
    return { raw: source.slice(offset, end + suffix.length), latex: source.slice(start, close), display: true,
      delimiter: bracket ? 'bracket' : 'double-dollar', state: 'complete', range: { start: offset, end: end + suffix.length } };
  }
  // An embedded display opener is literal prose, not a pending block.
  if (!bracket && /^\S.*\$\$/.test(source.slice(start).split(/\r?\n/, 1)[0])) return;
  return { raw: source.slice(offset), latex: source.slice(start), display: true,
    delimiter: bracket ? 'bracket' : 'double-dollar', state: 'pending', range: { start: offset, end: source.length } };
}

export function mathFenceSource(raw: string, latex: string, complete = true): MathSource {
  return { raw, latex, display: true, delimiter: 'math-fence', state: complete ? 'complete' : 'pending', range: { start: 0, end: raw.length } };
}

export function readMathFenceAt(source: string): MathSource | undefined {
  const opening = /^ {0,3}(`{3,}|~{3,})math[^\S\r\n]*(?:\r?\n|$)/.exec(source);
  if (!opening) return;
  const marker = opening[1];
  let offset = opening[0].length;
  while (offset < source.length) {
    const end = source.indexOf('\n', offset);
    const lineEnd = end < 0 ? source.length : end;
    const line = source.slice(offset, lineEnd).replace(/\r$/, '');
    const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (closing && closing[1][0] === marker[0] && closing[1].length >= marker.length) {
      return mathFenceSource(source.slice(0, lineEnd), source.slice(opening[0].length, offset).replace(/\r?\n$/, ''));
    }
    if (end < 0) break;
    offset = end + 1;
  }
  return mathFenceSource(source, source.slice(opening[0].length), false);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function encodeMathSource(source: MathSource): string { return encodeURIComponent(JSON.stringify(source)); }
export function decodeMathSource(encoded: string): MathSource | undefined {
  try {
    const value = JSON.parse(decodeURIComponent(encoded)) as MathSource;
    if (typeof value.raw !== 'string' || typeof value.latex !== 'string' || typeof value.display !== 'boolean'
      || !['pending', 'complete'].includes(value.state)
      || !['paren', 'dollar', 'bracket', 'double-dollar', 'math-fence'].includes(value.delimiter)) return;
    return value;
  } catch { return; }
}

export function mathPlaceholder(source: MathSource): string {
  const code = `<code class="${source.display ? 'math-display' : 'math-inline'}" data-xopc-math-source="${escapeHtml(encodeMathSource(source))}">${escapeHtml(source.raw)}</code>`;
  return source.display ? `<pre>${code}</pre>\n` : code;
}
