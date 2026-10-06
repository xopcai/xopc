import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { common } from '@kit.AbilityKit';
import { markdownBlocks, markdownSpans, markdownLink, XopcMarkdownBlock, XopcMarkdownSpan, XopcMarkdownTableRow, XopcMarkdownCell } from '../common/markdown';
import { copyChatMessage } from '../service/chatMessageActions';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcHistoryMedia } from '../model/chat';
import { XopcMobileRoute } from '../model/home';
import { internalMessageLink } from '../common/messageLink';
import { normalizedFileMimeType } from '../common/filePreview';
import { markdownBlockGap, markdownPreviewBlocks, markdownPreviewBlockLines } from '../common/markdownLayout';

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
  @Event onOpenLink: (href: string) => void = (_href: string): void => {};
  @Event onPreviewTap: () => void = (): void => {};
  @Computed get spans(): XopcMarkdownSpan[] { return markdownSpans(this.content); }
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
    Text() {
      ForEach(this.spans, (span: XopcMarkdownSpan) => {
        Span(span.text)
          .fontWeight(this.spanWeight(span.kind))
          .fontStyle(span.kind === 'italic' ? FontStyle.Italic : FontStyle.Normal)
          .fontFamily(span.kind === 'code' ? 'monospace' : 'sans-serif')
          .fontColor(span.href ? this.colors.accent : this.muted ? this.colors.secondary : this.colors.foreground)
          .decoration({ type: span.href ? TextDecorationType.Underline : span.kind === 'strike' ? TextDecorationType.LineThrough : TextDecorationType.None })
          .onClick((): void => {
            if (span.href) this.openTarget(span.href);
            else this.onPreviewTap();
          })
      }, (span: XopcMarkdownSpan): string => span.id + ':' + span.kind + ':' + span.text + ':' + (span.href || ''))
    }.fontSize(this.textSize)
      .lineHeight(this.textLineHeight)
      .maxLines(this.lineLimit).textOverflow({ overflow: TextOverflow.Ellipsis })
      .copyOption(CopyOptions.InApp).width('100%')
      .textAlign(this.alignment === 'right' ? TextAlign.End : this.alignment === 'center' ? TextAlign.Center : TextAlign.Start)
      .onClick((): void => { this.onPreviewTap(); })
  }
}

@ComponentV2
export struct XopcMarkdownView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param content: string = '';
  @Param conversationId: string = '';
  @Param compactReading: boolean = false;
  @Param previewLineLimit: number = 0;
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onPreviewTap: () => void = (): void => {};
  @Local linkedFile?: XopcHistoryMedia;
  @Local previewRequest: number = 0;
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
    const blocks = markdownBlocks(this.content);
    return this.previewLineLimit > 0 ? markdownPreviewBlocks(blocks, this.previewLineLimit) : blocks;
  }
  private blockGap(index: number): number {
    return this.compactReading ? markdownBlockGap(this.blocks[index], this.blocks[index - 1]) : index > 0 ? 12 : 0;
  }
  private blockLines(index: number): number {
    return markdownPreviewBlockLines(this.blocks, index, this.previewLineLimit);
  }
  private imageFile(block: XopcMarkdownBlock): XopcHistoryMedia {
    return { id: block.id, name: block.text || 'image', type: 'image', mimeType: 'image/png', size: 0, uri: block.href || '' };
  }

  private async copyCode(text: string): Promise<void> {
    try { await copyChatMessage(text); this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copied') }); }
    catch (_) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copy_failed') }); }
  }

  build() {
    Column() {
      Repeat<XopcMarkdownBlock>(this.blocks).each((item: RepeatItem<XopcMarkdownBlock>) => {
        Column() {
        if (this.previewLineLimit > 0) {
          XopcMarkdownInline({ content: item.item.text, headingLevel: item.item.kind === 'heading' ? item.item.level : 0,
            muted: item.item.kind === 'quote', compactReading: this.compactReading, lineLimit: this.blockLines(item.index),
            onOpenLink: (href: string): void => { this.openInternalLink(href); },
            onPreviewTap: (): void => { this.onPreviewTap(); } })
            .width('100%').padding({ left: item.item.kind === 'quote' ? 12 : item.item.kind === 'list' ? Math.min(item.item.level, 6) * 12 : 0 })
        } else if (item.item.kind === 'image') { XopcChatMediaView({ file: this.imageFile(item.item), conversationId: this.conversationId }) }
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
            Text(item.item.text).fontFamily('monospace').fontSize(14).lineHeight(22)
              .fontColor(this.colors.foreground).copyOption(CopyOptions.InApp).width('100%')
          }.padding(12).width('100%').borderRadius(8).backgroundColor(this.colors.grouped)
        } else if (item.item.kind === 'table') {
          Scroll() {
            Column() {
              ForEach(item.item.rows || [], (row: XopcMarkdownTableRow) => {
                Row() {
                  ForEach(row.cells, (cell: XopcMarkdownCell) => {
                    XopcMarkdownInline({ content: cell.text, strong: row.header, alignment: cell.align,
                      compactReading: this.compactReading,
                      onOpenLink: (href: string): void => { this.openInternalLink(href); } })
                      .width(168).padding(10)
                  }, (cell: XopcMarkdownCell): string => cell.id + ':' + cell.text)
                }.alignItems(VerticalAlign.Top).backgroundColor(row.header ? this.colors.grouped : this.colors.panel)
                  .margin({ bottom: 4 })
              }, (row: XopcMarkdownTableRow): string => row.id + ':' + JSON.stringify(row.cells))
            }
          }.width('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Auto)
        } else { XopcMarkdownInline({ content: item.item.text, headingLevel: item.item.kind === 'heading' ? item.item.level : 0, muted: item.item.kind === 'quote',
          compactReading: this.compactReading,
          onOpenLink: (href: string): void => { this.openInternalLink(href); } }).width('100%').padding({ left: item.item.kind === 'quote' ? 12 : item.item.kind === 'list' ? Math.min(item.item.level, 6) * 12 : 0 }) }
        }.width('100%').margin({ top: this.blockGap(item.index) }).alignItems(HorizontalAlign.Start)
      }).key((block: XopcMarkdownBlock): string => block.id + ':' + block.kind)
      if (this.linkedFile) {
        XopcChatMediaView({ file: this.linkedFile, conversationId: this.conversationId, previewOnly: true, previewRequest: this.previewRequest })
          .height(0)
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
