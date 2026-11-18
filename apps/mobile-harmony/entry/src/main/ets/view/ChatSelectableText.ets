import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { markdownBlocks, markdownSpans, XopcMarkdownBlock, XopcMarkdownCell, XopcMarkdownSpan,
  XopcMarkdownTableRow } from '../common/markdown';
import { shareSelectedChatText } from '../service/chatMediaShare';

export interface XopcChatMenuTouch {
  rowId: string;
  x: number;
  y: number;
}

interface XopcSelectionSpan {
  id: string;
  text: string;
  kind: string;
  heading: number;
}

@ComponentV2
export struct XopcChatSelectableText {
  @Param source: string = '';
  @Param rowId: string = '';
  @Param origin: XopcChatMenuTouch = { rowId: '', x: 0, y: 0 };
  @Event onEndSelection: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  private hadSelection: boolean = false;
  private didStartSelection: boolean = false;
  private controller: TextController = new TextController();

  @Computed get spans(): XopcSelectionSpan[] {
    const result: XopcSelectionSpan[] = [];
    const blocks = markdownBlocks(this.source).filter((block: XopcMarkdownBlock): boolean => block.kind !== 'rule');
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index];
      if (index > 0) result.push({ id: index + '-line', text: '\n', kind: 'text', heading: 0 });
      const text = block.kind === 'table'
        ? (block.rows ?? []).map((row: XopcMarkdownTableRow): string =>
          row.cells.map((cell: XopcMarkdownCell): string => cell.text).join('  ')).join('\n')
        : block.text;
      const spans: XopcMarkdownSpan[] = ['code', 'math', 'image'].includes(block.kind)
        ? [{ id: '0', text, kind: block.kind }] : markdownSpans(text);
      for (const span of spans) {
        result.push({ id: index + '-' + span.id, text: span.text, kind: span.kind,
          heading: block.kind === 'heading' ? block.level : 0 });
      }
    }
    if (!result.some((span: XopcSelectionSpan): boolean => !!span.text.trim())) {
      return [{ id: 'source', text: this.source, kind: 'text', heading: 0 }];
    }
    return result;
  }

  @Computed get selectedDocument(): string {
    return this.spans.map((span: XopcSelectionSpan): string => span.text).join('');
  }

  private startSelection(): void {
    if (this.didStartSelection || !this.selectedDocument.trim()) return;
    const ui = this.getUIContext();
    const bounds = ui.getComponentUtils().getRectangleById('chat-inline-text-selection');
    if (!bounds.size.width || !bounds.size.height) return;
    const doc = this.selectedDocument;
    let start = doc.length - doc.trimStart().length;
    if (this.origin.rowId === this.rowId) {
      const x = ui.vp2px(this.origin.x) - bounds.windowOffset.x;
      const y = ui.vp2px(this.origin.y) - bounds.windowOffset.y;
      const glyph = this.controller.getLayoutManager().getGlyphPositionAtCoordinate(
        Math.max(0, Math.min(bounds.size.width - 1, x)), Math.max(0, Math.min(bounds.size.height - 1, y)));
      start = Math.max(0, Math.min(glyph.position, doc.length - 1));
    }
    while (start > 0 && /[\uDC00-\uDFFF]/.test(doc[start])) start--;
    if (/[A-Za-z0-9]/.test(doc[start])) {
      while (start > 0 && /[A-Za-z0-9]/.test(doc[start - 1])) start--;
    }
    const initial = doc.slice(start).match(/^[\u3400-\u9fff]{1,4}|^[A-Za-z0-9]{1,32}|^\s*\S/u)?.[0] ?? doc.slice(start);
    this.didStartSelection = true;
    this.controller.setTextSelection(start, start + initial.length, { menuPolicy: MenuPolicy.SHOW });
  }

  private selectionMenu(): EditMenuOptions {
    const shareId = TextMenuItemId.of('xopc-share-text');
    return {
      onCreateMenu: (items: TextMenuItem[]): TextMenuItem[] => {
        const actions = items.filter((item: TextMenuItem): boolean =>
          item.id.equals(TextMenuItemId.COPY) || item.id.equals(TextMenuItemId.SELECT_ALL) || item.id.equals(TextMenuItemId.SHARE));
        if (!actions.some((item: TextMenuItem): boolean => item.id.equals(TextMenuItemId.SHARE))) {
          actions.push({ content: $r('app.string.chat_share'), id: shareId });
        }
        return actions;
      },
      onMenuItemClick: (item: TextMenuItem, range: TextRange): boolean => {
        if (!item.id.equals(shareId)) return false;
        void shareSelectedChatText(this.getUIContext(), this.selectedDocument.slice(range.start ?? 0, range.end));
        return true;
      }
    };
  }

  build() {
    Text(undefined, { controller: this.controller }) {
      ForEach(this.spans, (span: XopcSelectionSpan) => {
        Span(span.text)
          .fontSize(span.heading === 1 ? 20 : span.heading === 2 ? 18 : 16)
          .fontWeight(span.heading > 0 || span.kind === 'bold' ? FontWeight.Medium : FontWeight.Normal)
          .fontStyle(span.kind === 'italic' ? FontStyle.Italic : FontStyle.Normal)
          .fontFamily(span.kind === 'code' ? 'monospace' : 'sans-serif')
          .decoration({ type: span.kind === 'strike' ? TextDecorationType.LineThrough
            : span.kind === 'link' ? TextDecorationType.Underline : TextDecorationType.None })
      }, (span: XopcSelectionSpan): string => span.id)
    }.id('chat-inline-text-selection').fontSize(16).lineHeight(23).fontColor(this.colors.foreground)
      .width('100%').textAlign(TextAlign.Start).copyOption(CopyOptions.LocalDevice)
      .editMenuOptions(this.selectionMenu())
      .onAreaChange((_previous: Area, _current: Area): void => { this.startSelection(); })
      .onTextSelectionChange((start: number, end: number): void => {
        if (start >= 0 && end > start) this.hadSelection = true;
        else if (this.hadSelection) this.onEndSelection();
      })
  }
}
