export interface XopcMathBlockSource { text: string; end: number; }

export function mathCandidateCount(source: string): number {
  return source.match(/\\[\(\[]|\$\$|\$(?=[^\s$])|(?:`{3,}|~{3,})math\b/g)?.length ?? 0;
}

export function mayContainMath(source: string): boolean {
  return source.includes('\\(') || source.includes('\\[') || source.includes('$$') || /\$[^\s$][^\n]*\$/.test(source);
}

export function mathDisplayClosingOffset(source: string): number {
  const closer = source.startsWith('\\[') ? '\\]' : '$$';
  let comment = false; let slashes = 0;
  for (let index = 2; index < source.length; index++) {
    const char = source[index];
    if (char === '\n') comment = false;
    if (char === '%' && slashes % 2 === 0) comment = true;
    if (!comment && slashes % 2 === 0 && source.slice(index, index + 2) === closer) return index;
    slashes = char === '\\' ? slashes + 1 : 0;
  }
  return -1;
}

export function mathDisplayClosed(source: string): boolean {
  const offset = mathDisplayClosingOffset(source);
  return offset >= 0 && !source.slice(offset + 2).trim();
}

export function mathDisplayBlock(lines: string[], start: number): XopcMathBlockSource | undefined {
  const opening = /^( {0,3}(?:> ?)*(?:(?:[-+*]|\d+[.)]) +)?)(\\\[|\$\$)/.exec(lines[start]);
  if (!opening) return undefined;
  const prefix = opening[1];
  const quoted = prefix.includes('>');
  const listed = /(?:[-+*]|\d+[.)]) +$/.test(prefix);
  let logical = lines[start].slice(prefix.length); let text = lines[start]; let end = start;
  if (mathDisplayClosingOffset(logical) >= 0 && !mathDisplayClosed(logical)) return undefined;
  while (!mathDisplayClosed(logical) && end + 1 < lines.length) {
    const next = lines[end + 1];
    if (quoted && !/^ {0,3}>/.test(next)) break;
    if (listed && !quoted && next.trim() && (next.match(/^ */)?.[0].length ?? 0) < prefix.length) break;
    text += '\n' + next; logical += '\n' + next.replace(/^ {0,3}(?:> ?)*/, '').trimStart(); end++;
  }
  return { text, end };
}
