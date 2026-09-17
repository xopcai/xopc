export interface XopcMarkdownCell { id: string; text: string; align: string; }
export interface XopcMarkdownTableRow { id: string; cells: XopcMarkdownCell[]; header: boolean; }
export interface XopcMarkdownBlock { id: string; kind: string; text: string; level: number; language?: string; rows?: XopcMarkdownTableRow[]; href?: string; }
export interface XopcMarkdownSpan { id: string; kind: string; text: string; href?: string; start?: number; end?: number; }

export function markdownLink(target: string): string {
  // Links leave the app only after a tap. Never forward Gateway credentials or accept executable schemes.
  if (!/^https?:\/\/[^\s/\\?#]+(?:[/?#][^\s\\]*)?$/i.test(target) || /[\u0000-\u0020\u007f]/.test(target)) return '';
  const authority = target.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
  return authority.includes('@') ? '' : target;
}

function tableCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = []; let cell = ''; let codeFence = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === '|') { cell += '|'; i++; }
    else if (text[i] === '`') {
      let end = i; while (text[end] === '`') end++;
      const count = end - i;
      if (!codeFence) codeFence = count; else if (codeFence === count) codeFence = 0;
      cell += text.slice(i, end); i = end - 1;
    } else if (text[i] === '|' && !codeFence) { cells.push(cell.trim()); cell = ''; }
    else cell += text[i];
  }
  cells.push(cell.trim()); return cells;
}

export function markdownBlocks(source: string): XopcMarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: XopcMarkdownBlock[] = [];
  let paragraph: string[] = []; let code: string[] = []; let fence = ''; let language = '';
  const push = (kind: string, text: string, level: number = 0): XopcMarkdownBlock => {
    const block: XopcMarkdownBlock = { id: blocks.length.toString(), kind, text, level }; blocks.push(block); return block;
  };
  const flush = (): void => { if (paragraph.length) { push('paragraph', paragraph.join('\n')); paragraph = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        push('code', code.join('\n')).language = language; code = []; fence = '';
      } else code.push(line);
      continue;
    }
    if (marker) { flush(); fence = marker[1]; language = marker[2].trim().split(/\s/)[0]; continue; }
    if (!line.trim()) { flush(); continue; }
    const separators = tableCells(lines[i + 1] ?? '');
    const headers = tableCells(line);
    if (line.includes('|') && separators.length === headers.length && separators.every((cell: string): boolean => /^:?-{3,}:?$/.test(cell))) {
      flush(); const block = push('table', ''); const rows: XopcMarkdownTableRow[] = [];
      const addRow = (cells: string[], header: boolean): void => {
        const rowId = rows.length.toString();
        rows.push({ id: rowId, header, cells: headers.map((_head: string, column: number): XopcMarkdownCell => ({
          id: rowId + ':' + column, text: cells[column] ?? '',
          align: separators[column].endsWith(':') ? (separators[column].startsWith(':') ? 'center' : 'right') : 'left'
        })) });
      };
      addRow(headers, true); i++;
      while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].includes('|')) { i++; addRow(tableCells(lines[i]), false); }
      block.rows = rows; continue;
    }
    const pictures = markdownSpans(line).filter((span: XopcMarkdownSpan): boolean => span.kind === 'image');
    if (pictures.length) {
      flush(); let cursor = 0;
      for (const picture of pictures) {
        const before = line.slice(cursor, picture.start).trim(); if (before) push('paragraph', before);
        push('image', picture.text).href = picture.href; cursor = picture.end || 0;
      }
      const after = line.slice(cursor).trim(); if (after) push('paragraph', after);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { flush(); push('heading', heading[2], heading[1].length); continue; }
    if (/^\s{0,3}(---+|\*\*\*+|___+)\s*$/.test(line)) { flush(); push('rule', ''); continue; }
    const bullet = line.match(/^(\s*)[-+*]\s+(.+)$/);
    if (bullet) {
      flush(); const task = bullet[2].match(/^\[([ xX])\]\s+(.*)$/);
      push('list', task ? (task[1] === ' ' ? '☐ ' : '☑ ') + task[2] : '• ' + bullet[2], Math.floor(bullet[1].length / 2)); continue;
    }
    const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (numbered) { flush(); push('list', numbered[2] + '. ' + numbered[3], Math.floor(numbered[1].length / 2)); continue; }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) { flush(); push('quote', quote[1]); continue; }
    paragraph.push(line);
  }
  flush(); if (fence) push('code', code.join('\n')).language = language;
  return blocks;
}

export function markdownSpans(source: string): XopcMarkdownSpan[] {
  const result: XopcMarkdownSpan[] = [];
  const pattern = /(`+)[^\n]*?\1(?!`)|!?\[(?:\\.|[^\]\\])*\]\((?:\\.|[^()\\]|\([^()]*\))*\)|<https?:\/\/[^\s<>]+>|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|\\[\\`*{}_\[\]()#+\-.!|>~]/g;
  let cursor = 0; let match = pattern.exec(source);
  const push = (kind: string, text: string, href: string = ''): void => { result.push({ id: result.length.toString(), kind, text, href }); };
  while (match) {
    if (match.index > cursor) push('text', source.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('\\')) push('text', token.slice(1));
    else if (token.startsWith('`')) {
      const ticks = token.match(/^`+/)?.[0] ?? '`';
      if (token.endsWith(ticks) && token.length > ticks.length * 2) push('code', token.slice(ticks.length, -ticks.length));
      else push('text', token);
    } else if (token.startsWith('[') || token.startsWith('![') || token.startsWith('<')) {
      const split = token.indexOf('](');
      const target = (token.startsWith('<') ? token.slice(1, -1) : token.slice(split + 2, -1).replace(/\\([()])/g, '$1')).replace(/\s+"[^"]*"$/, '');
      const href = markdownLink(target);
      const label = token.startsWith('<') ? target : token.slice(token.startsWith('!') ? 2 : 1, split);
      if (token.startsWith('![') && ((href && target.startsWith('https://')) || /^(media:\/\/|xopc-file:|data:image\/)/.test(target))) {
        result.push({ id: result.length.toString(), kind: 'image', text: label, href: target, start: match.index, end: match.index + token.length });
      } else if (href) push('link', label || href, href); else push('text', token);
    } else if (token.startsWith('~~')) push('strike', token.slice(2, -2));
    else if (token.startsWith('**') || token.startsWith('__')) push('bold', token.slice(2, -2));
    else push('italic', token.slice(1, -1));
    cursor = match.index + token.length; match = pattern.exec(source);
  }
  if (cursor < source.length) push('text', source.slice(cursor));
  return result;
}
