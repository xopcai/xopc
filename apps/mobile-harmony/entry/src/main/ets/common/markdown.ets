export interface XopcMarkdownBlock { id: string; kind: string; text: string; level: number; }
export interface XopcMarkdownSpan { id: string; kind: string; text: string; }

// A native, non-HTML Markdown subset. Remote images and executable links are never fetched implicitly.
export function markdownBlocks(source: string): XopcMarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: XopcMarkdownBlock[] = [];
  let paragraph: string[] = []; let code: string[] = []; let fence: string = '';
  const push = (kind: string, text: string, level: number = 0): void => {
    blocks.push({ id: blocks.length.toString(), kind, text, level });
  };
  const flush = (): void => { if (paragraph.length) { push('paragraph', paragraph.join('\n')); paragraph = []; } };
  lines.forEach((line: string): void => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) { push('code', code.join('\n')); code = []; fence = ''; }
      else code.push(line);
      return;
    }
    if (marker) { flush(); fence = marker[1]; return; }
    if (!line.trim()) { flush(); return; }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { flush(); push('heading', heading[2], heading[1].length); return; }
    const bullet = line.match(/^\s*[-+*]\s+(.+)$/);
    if (bullet) { flush(); push('list', '• ' + bullet[1]); return; }
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (numbered) { flush(); push('list', numbered[1] + '. ' + numbered[2]); return; }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) { flush(); push('quote', quote[1]); return; }
    if (/^\s{0,3}(---+|\*\*\*+|___+)\s*$/.test(line)) { flush(); push('rule', ''); return; }
    paragraph.push(line);
  });
  flush(); if (fence) push('code', code.join('\n'));
  return blocks;
}

export function markdownSpans(source: string): XopcMarkdownSpan[] {
  const result: XopcMarkdownSpan[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g;
  let cursor: number = 0; let match = pattern.exec(source);
  const push = (kind: string, text: string): void => { result.push({ id: result.length.toString(), kind, text }); };
  while (match) {
    if (match.index > cursor) push('text', source.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('`')) push('code', token.slice(1, -1));
    else if (token.startsWith('**') || token.startsWith('__')) push('bold', token.slice(2, -2));
    else push('italic', token.slice(1, -1));
    cursor = match.index + token.length; match = pattern.exec(source);
  }
  if (cursor < source.length) push('text', source.slice(cursor));
  return result;
}
