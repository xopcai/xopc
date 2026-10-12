import { markdownBlocks, XopcMarkdownBlock } from './markdown';

/** This parser's supported dialect has no document-wide reference definitions. */
export class XopcMarkdownStreamParser {
  private source: string = '';
  private scanned: number = 0;
  private sealed: number = 0;
  private fence: string = '';
  private prefix: XopcMarkdownBlock[] = [];

  parse(source: string): XopcMarkdownBlock[] {
    if (!source.startsWith(this.source) || source.includes('\r')) {
      this.source = ''; this.scanned = 0; this.sealed = 0; this.fence = ''; this.prefix = [];
      if (source.includes('\r')) return markdownBlocks(source);
    }
    let boundary = this.sealed;
    let end = source.indexOf('\n', this.scanned);
    while (end >= 0) {
      const line = source.slice(this.scanned, end);
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (this.fence) {
        if (marker && marker[1][0] === this.fence[0] && marker[1].length >= this.fence.length && !marker[2].trim()) this.fence = '';
      } else if (marker) this.fence = marker[1];
      if (!this.fence && !line.trim()) boundary = end + 1;
      this.scanned = end + 1;
      end = source.indexOf('\n', this.scanned);
    }
    if (boundary > this.sealed) {
      const completed = markdownBlocks(source.slice(this.sealed, boundary));
      completed.forEach((block: XopcMarkdownBlock): void => { block.id = this.prefix.length.toString(); this.prefix.push(block); });
      this.sealed = boundary;
    }
    this.source = source;
    const tail = markdownBlocks(source.slice(this.sealed));
    tail.forEach((block: XopcMarkdownBlock, index: number): void => { block.id = (this.prefix.length + index).toString(); });
    return this.prefix.concat(tail);
  }
}

export function markdownCodePreview(source: string, lines: number = 40): string {
  let cursor = 0;
  for (let count = 0; count < lines; count++) {
    const end = source.indexOf('\n', cursor);
    if (end < 0) return source;
    if (count === lines - 1) return source.slice(0, end);
    cursor = end + 1;
  }
  return source;
}
