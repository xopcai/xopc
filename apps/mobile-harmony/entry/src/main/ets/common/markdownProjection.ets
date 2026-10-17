import { markdownSpans, XopcMarkdownBlock, XopcMarkdownSpan, XopcMarkdownTableRow } from './markdown';
import { XopcMarkdownStreamParser } from './markdownStreamParser';

@ObservedV2
export class XopcMarkdownRenderSpan implements XopcMarkdownSpan {
  id: string;
  @Trace kind: string = '';
  @Trace text: string = '';
  @Trace href: string = '';
  @Trace leadingText: string = '';
  @Trace addedText: string = '';
  @Trace fresh: boolean = false;
  constructor(id: string, span: XopcMarkdownSpan) { this.id = id; this.update(span); }
  update(span: XopcMarkdownSpan, animate: boolean = false,
    acceptsBoundary?: (previous: string, next: string) => boolean): void {
    const added = span.text.length - this.text.length;
    const append = animate && this.kind === span.kind && this.href === (span.href || '')
      && span.text.startsWith(this.text) && added > 0 && added <= 256 && span.text.length <= 8192
      && (acceptsBoundary ? acceptsBoundary(this.text, span.text) : false);
    this.leadingText = append ? this.text : span.text;
    this.addedText = append ? span.text.slice(this.text.length) : '';
    this.fresh = append;
    this.kind = span.kind; this.text = span.text; this.href = span.href || '';
  }
}

@ObservedV2
export class XopcMarkdownInlineProjection {
  @Trace spans: XopcMarkdownRenderSpan[] = [];
  private source: string = '';
  private sequence: number = 0;
  update(source: string, animate: boolean = false, acceptsBoundary?: (previous: string, next: string) => boolean): void {
    if (!animate) this.spans.forEach((span: XopcMarkdownRenderSpan): void => { span.fresh = false; });
    if (source === this.source) return;
    this.source = source;
    const parsed = markdownSpans(source);
    const previous = this.spans;
    this.spans = parsed.map((span: XopcMarkdownSpan, index: number): XopcMarkdownRenderSpan => {
      const retained = previous[index];
      if (retained) { retained.update(span, animate, acceptsBoundary); return retained; }
      return new XopcMarkdownRenderSpan('span:' + this.sequence++, span);
    });
  }
}

@ObservedV2
export class XopcMarkdownRenderBlock implements XopcMarkdownBlock {
  id: string;
  @Trace kind: string = '';
  @Trace text: string = '';
  @Trace level: number = 0;
  @Trace language: string = '';
  @Trace closed: boolean = false;
  @Trace href: string = '';
  @Trace rows: XopcMarkdownTableRow[] = [];
  private tableSignature: string = '[]';
  private source?: XopcMarkdownBlock;
  constructor(id: string, block: XopcMarkdownBlock) { this.id = id; this.update(block); }
  update(block: XopcMarkdownBlock): void {
    if (block === this.source) return;
    this.source = block;
    this.kind = block.kind; this.text = block.text; this.level = block.level;
    this.closed = block.closed === true; this.language = block.language || ''; this.href = block.href || '';
    const signature = JSON.stringify(block.rows || []);
    if (this.tableSignature !== signature) { this.tableSignature = signature; this.rows = block.rows || []; }
  }
}

@ObservedV2
export class XopcMarkdownProjection {
  @Trace blocks: XopcMarkdownRenderBlock[] = [];
  private source: string = '';
  private sequence: number = 0;
  private parser: XopcMarkdownStreamParser = new XopcMarkdownStreamParser();
  update(source: string): void {
    if (source === this.source) return;
    this.source = source;
    const previous = this.blocks;
    this.blocks = this.parser.parse(source).map((block: XopcMarkdownBlock, index: number): XopcMarkdownRenderBlock => {
      const retained = previous[index];
      if (retained) { retained.update(block); return retained; }
      return new XopcMarkdownRenderBlock('block:' + this.sequence++, block);
    });
  }
}
