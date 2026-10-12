import { XopcMathMarkdownView } from './MathMarkdownView';
import { mayContainMath, mathCandidateCount } from '../common/mathMarkdown';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { common } from '@kit.AbilityKit';
import { i18n } from '@kit.LocalizationKit';
import { markdownLink, XopcMarkdownBlock, XopcMarkdownTableRow, XopcMarkdownCell } from '../common/markdown';
import { XopcMarkdownProjection, XopcMarkdownInlineProjection, XopcMarkdownRenderSpan } from '../common/markdownProjection';
import { copyChatMessage } from '../service/chatMessageActions';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcHistoryMedia } from '../model/chat';
import { XopcMobileRoute } from '../model/home';
import { internalMessageLink } from '../common/messageLink';
import { normalizedFileMimeType } from '../common/filePreview';
import { markdownBlockGap, markdownPreviewBlocks, markdownPreviewBlockLines } from '../common/markdownLayout';
import { markdownCodePreview } from '../common/markdownStreamParser';

@ComponentV2
struct XopcMarkdownInline {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param content: string = '';
  @Param headingLevel: number = 0;
  @Param muted: boolean = false;
  @Param strong: boolean = false;
  @Param alignment: string = 'left';
  @Param compactReading: boolean = false;
  @Param lineLimit: number = Infinity;
  @Param streaming: boolean = false;
  @Param allowMath: boolean = true;
  @Event onOpenLink: (href: string) => void = (_href: string): void => {};
  @Event onPreviewTap: () => void = (): void => {};
  @Event onReading: () => void = (): void => {};
  @Local projection: XopcMarkdownInlineProjection = new XopcMarkdownInlineProjection();
  private fadeTimer: number = -1;
  private ready: boolean = false;
  @Local selecting: boolean = false;
  private lineBreaks?: i18n.BreakIterator;
  private acceptsAppendBoundary(previous: string, next: string): boolean {
    if (!previous.length) return false;
    try {
      if (!this.lineBreaks) this.lineBreaks = i18n.getLineInstance('zh-CN');
      this.lineBreaks.setLineBreakText(next);
      return this.lineBreaks.following(previous.length - 1) === previous.length;
    } catch (_) { return false; }
  }
  aboutToAppear(): void { this.syncContent(); this.ready = true; }
  aboutToDisappear(): void { clearTimeout(this.fadeTimer); this.ready = false; }
  @Monitor('content', 'streaming')
  syncContent(): void {
    this.projection.update(this.content, this.streaming && this.ready && !this.selecting,
      (previous: string, next: string): boolean => this.acceptsAppendBoundary(previous, next));
    clearTimeout(this.fadeTimer);
    if (!this.ready || !this.streaming || this.selecting) return;
    this.fadeTimer = setTimeout((): void => {
      this.getUIContext().animateTo({ duration: 180, curve: Curve.EaseOut }, (): void => {
        this.projection.spans.forEach((span: XopcMarkdownRenderSpan): void => { span.fresh = false; });
      });
    }, 16);
  }
  @Computed get textSize(): number {
    if (!this.headingLevel) return 16;
    if (this.compactReading) {
      if (this.headingLevel === 1) return 20;
      if (this.headingLevel === 2) return 18;
      return 16;
    }
    if (this.headingLevel === 1) return 24;
    if (this.headingLevel === 2) return 20;
    if (this.headingLevel === 3) return 18;
    return 16;
  }
  @Computed get textLineHeight(): number {
    if (!this.headingLevel) return this.compactReading ? 23 : 25;
    if (this.compactReading) {
      if (this.headingLevel === 1) return 27;
      if (this.headingLevel === 2) return 25;
      return 23;
    }
    if (this.headingLevel === 1) return 32;
    if (this.headingLevel === 2) return 28;
    if (this.headingLevel === 3) return 26;
    return 24;
  }
  private spanWeight(kind: string): FontWeight {
    if (kind === 'bold' || this.strong) return this.compactReading ? FontWeight.Medium : FontWeight.Bold;
    if (this.headingLevel > 0) return this.compactReading ? FontWeight.Medium : FontWeight.Bold;
    return FontWeight.Normal;
  }
  private async openTarget(href: string): Promise<void> {
    if (internalMessageLink(href)) { this.onOpenLink(href); return; }
    if (!markdownLink(href)) return;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({ title: $r('app.string.chat_open_link'), message: href,
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary }, { text: $r('app.string.open'), color: this.colors.accent }] });
      if (result.index === 1) await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(href, { appLinkingOnly: false });
    } catch (_) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_link_failed') }); }
  }
  build() {
    Column() {
      if (mayContainMath(this.content) && (!Number.isFinite(this.lineLimit) || this.lineLimit <= 0)) {
        XopcMathMarkdownView({ content: this.content, streaming: this.streaming, fontSize: this.textSize, mathRenderingAllowed: this.allowMath,
          onOpenLink: (href: string): void => { this.openTarget(href); } })
      } else {
        Text() {
          ForEach(this.projection.spans, (span: XopcMarkdownRenderSpan) => {
            Span(span.leadingText)
              .fontWeight(this.spanWeight(span.kind))
              .fontStyle(span.kind === 'italic' ? FontStyle.Italic : FontStyle.Normal)
              .fontFamily(span.kind === 'code' ? 'monospace' : 'sans-serif')
              .fontColor(span.href ? this.colors.accent : this.muted ? this.colors.secondary : this.colors.foreground)
              .decoration({ type: span.href ? TextDecorationType.Underline : span.kind === 'strike' ? TextDecorationType.LineThrough : TextDecorationType.None })
              .onClick((): void => {
                if (span.href) this.openTarget(span.href);
                else this.onPreviewTap();
              })
            if (span.addedText) {
              Span(span.addedText)
                .fontWeight(this.spanWeight(span.kind))
                .fontStyle(span.kind === 'italic' ? FontStyle.Italic : FontStyle.Normal)
                .fontFamily(span.kind === 'code' ? 'monospace' : 'sans-serif')
                .fontColor(span.fresh ? this.colors.secondary : span.href ? this.colors.accent : this.muted ? this.colors.secondary : this.colors.foreground)
                .decoration({ type: span.href ? TextDecorationType.Underline : span.kind === 'strike' ? TextDecorationType.LineThrough : TextDecorationType.None })
                .onClick((): void => { if (span.href) this.openTarget(span.href); else this.onPreviewTap(); })
            }
          }, (span: XopcMarkdownRenderSpan): string => span.id)
        }.fontSize(this.textSize)
          .lineHeight(this.textLineHeight)
          .maxLines(this.lineLimit).textOverflow({ overflow: TextOverflow.Ellipsis })
          .copyOption(CopyOptions.InApp).width('100%')
          .onTextSelectionChange((start: number, end: number): void => {
            this.selecting = start >= 0 && end > start;
            if (this.selecting) {
              this.onReading();
              clearTimeout(this.fadeTimer);
              this.projection.spans.forEach((span: XopcMarkdownRenderSpan): void => { span.fresh = false; });
            }
          })
          .textAlign(this.alignment === 'right' ? TextAlign.End : this.alignment === 'center' ? TextAlign.Center : TextAlign.Start)
          .onClick((): void => { this.onPreviewTap(); })
      }
    }.width('100%')
  }
}

@ComponentV2
export struct XopcMarkdownView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param content: string = '';
  @Param conversationId: string = '';
  @Param compactReading: boolean = false;
  @Param previewLineLimit: number = 0;
  @Param inlineNoteImages: boolean = false;
  @Param streaming: boolean = false;
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onPreviewTap: () => void = (): void => {};
  @Event onReading: () => void = (): void => {};
  @Local linkedFile?: XopcHistoryMedia;
  @Local previewRequest: number = 0;
  @Local expandedBlocks: Set<string> = new Set<string>();
  @Local projection: XopcMarkdownProjection = new XopcMarkdownProjection();
  aboutToAppear(): void { this.syncContent(); }
  @Monitor('content')
  syncContent(): void { this.projection.update(this.content); }
  private openInternalLink(href: string): void {
    const target = internalMessageLink(href);
    if (!target) return;
    if (target.kind === 'route') { this.onNavigate({ page: target.page, itemId: target.itemId }); return; }
    const name = target.path.split('/').pop() || target.path;
    this.linkedFile = { id: href, name, uri: '', workspaceRelativePath: target.path,
      type: 'file', mimeType: normalizedFileMimeType(name, ''), size: 0 };
    this.previewRequest++;
  }
  @Computed get blocks(): XopcMarkdownBlock[] {
    const blocks = this.projection.blocks;
    return this.previewLineLimit > 0 ? markdownPreviewBlocks(blocks, this.previewLineLimit) : blocks;
  }
  @Computed get mathAllowed(): boolean { return mathCandidateCount(this.content) <= 256; }
  private blockGap(index: number): number {
    return this.compactReading ? markdownBlockGap(this.blocks[index], this.blocks[index - 1]) : index > 0 ? 12 : 0;
  }
  private blockLines(index: number): number {
    return markdownPreviewBlockLines(this.blocks, index, this.previewLineLimit);
  }
  private imageFile(block: XopcMarkdownBlock): XopcHistoryMedia {
    return { id: block.id, name: block.text || 'image', type: 'image', mimeType: 'image/png', size: 0, uri: block.href || '' };
  }
  private codeText(block: XopcMarkdownBlock): string { return this.expandedBlocks.has(block.id) ? block.text : markdownCodePreview(block.text); }
  private listMarker(block: XopcMarkdownBlock): string { return block.text.match(/^(?:[•☐☑]|\d+\.)\s+/)?.[0] || ''; }
  private tableRows(block: XopcMarkdownBlock): XopcMarkdownTableRow[] {
    return this.expandedBlocks.has(block.id) ? block.rows || [] : (block.rows || []).slice(0, 40);
  }
  private toggleBlock(id: string): void {
    const expanded = new Set<string>(Array.from(this.expandedBlocks));
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    this.expandedBlocks = expanded;
  }

  private async copyCode(text: string): Promise<void> {
    try { await copyChatMessage(text); this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copied') }); }
    catch (_) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copy_failed') }); }
  }

  build() {
    Column() {
      Repeat<XopcMarkdownBlock>(this.blocks).each((item: RepeatItem<XopcMarkdownBlock>) => {
        Column() {
        if (item.item.kind === 'math' && this.previewLineLimit <= 0) {
          XopcMathMarkdownView({ content: item.item.text, streaming: this.streaming, mathRenderingAllowed: this.mathAllowed,
            onOpenLink: (href: string): void => { this.openInternalLink(href); } })
          Button('复制公式源码').onClick((): void => { this.copyCode(item.item.text); })
        } else if (this.previewLineLimit > 0) {
          XopcMarkdownInline({ allowMath: this.mathAllowed, content: item.item.text, headingLevel: item.item.kind === 'heading' ? item.item.level : 0,
            muted: item.item.kind === 'quote', compactReading: this.compactReading, lineLimit: this.blockLines(item.index),
            onOpenLink: (href: string): void => { this.openInternalLink(href); },
            onPreviewTap: (): void => { this.onPreviewTap(); } })
            .width('100%').padding({ left: item.item.kind === 'quote' ? 12 : item.item.kind === 'list' ? Math.min(item.item.level, 6) * 12 : 0 })
        } else if (item.item.kind === 'image') { XopcChatMediaView({ file: this.imageFile(item.item), conversationId: this.conversationId,
          noteInlineImage: this.inlineNoteImages }) }
        else if (item.item.kind === 'rule') {
          Column().width('100%').height(1).backgroundColor(this.colors.border)
            .margin({ top: 8, bottom: 8 })
        }
        else if (item.item.kind === 'code') {
          Column() {
            Row() {
              Text(item.item.language || '').fontSize(12).fontColor(this.colors.secondary).layoutWeight(1)
              Button($r('app.string.chat_copy')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
                .onClick((): void => { this.copyCode(item.item.text); })
            }.width('100%')
            Scroll() {
              Text(this.codeText(item.item)).fontFamily('monospace').fontSize(14).lineHeight(22)
                .fontColor(this.colors.foreground).copyOption(CopyOptions.InApp)
            }.width('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Auto)
            if (markdownCodePreview(item.item.text).length < item.item.text.length) {
              Button(this.expandedBlocks.has(item.item.id) ? $r('app.string.chat_collapse_content') : $r('app.string.chat_view_more'))
                .height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
                .onClick((): void => { this.toggleBlock(item.item.id); })
            }
          }.padding(12).width('100%').borderRadius(8).backgroundColor(this.colors.grouped)
        } else if (item.item.kind === 'table') {
          Column() {
          Scroll() {
            Column() {
              Repeat<XopcMarkdownTableRow>(this.tableRows(item.item)).each((row: RepeatItem<XopcMarkdownTableRow>) => {
                Row() {
                  Repeat<XopcMarkdownCell>(row.item.cells).each((cell: RepeatItem<XopcMarkdownCell>) => {
                    XopcMarkdownInline({ allowMath: this.mathAllowed, content: cell.item.text, strong: row.item.header, alignment: cell.item.align,
                      compactReading: this.compactReading,
                      onReading: this.onReading,
                      onOpenLink: (href: string): void => { this.openInternalLink(href); } })
                      .width(168).padding(10)
                  }).key((cell: XopcMarkdownCell): string => cell.id)
                }.alignItems(VerticalAlign.Top).backgroundColor(row.item.header ? this.colors.grouped : this.colors.panel)
                  .margin({ bottom: 4 })
              }).key((row: XopcMarkdownTableRow): string => row.id)
            }
          }.width('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Auto)
          if ((item.item.rows || []).length > 40) {
            Button(this.expandedBlocks.has(item.item.id) ? $r('app.string.chat_collapse_content') : $r('app.string.chat_view_more'))
              .height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
              .onClick((): void => { this.toggleBlock(item.item.id); })
          }
          }.width('100%')
        } else if (item.item.kind === 'list') {
          Row() {
            Text(this.listMarker(item.item)).fontSize(16).lineHeight(this.compactReading ? 23 : 25)
              .fontColor(this.colors.foreground)
            XopcMarkdownInline({ allowMath: this.mathAllowed, content: item.item.text.slice(this.listMarker(item.item).length),
              compactReading: this.compactReading,
              streaming: this.streaming && item.index === this.blocks.length - 1,
              onReading: this.onReading,
              onOpenLink: (href: string): void => { this.openInternalLink(href); } }).layoutWeight(1)
          }.width('100%').alignItems(VerticalAlign.Top).padding({ left: Math.min(item.item.level, 6) * 12 })
        } else { XopcMarkdownInline({ allowMath: this.mathAllowed, content: item.item.text, headingLevel: item.item.kind === 'heading' ? item.item.level : 0, muted: item.item.kind === 'quote',
          compactReading: this.compactReading,
          streaming: this.streaming && item.index === this.blocks.length - 1,
          onReading: this.onReading,
          onOpenLink: (href: string): void => { this.openInternalLink(href); } }).width('100%').padding({ left: item.item.kind === 'quote' ? 12 : item.item.kind === 'list' ? Math.min(item.item.level, 6) * 12 : 0 }) }
        }.width('100%').margin({ top: this.blockGap(item.index) }).alignItems(HorizontalAlign.Start)
      }).key((block: XopcMarkdownBlock): string => block.id)
      if (this.linkedFile) {
        XopcChatMediaView({ file: this.linkedFile, conversationId: this.conversationId, previewOnly: true, previewRequest: this.previewRequest })
          .height(0)
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
