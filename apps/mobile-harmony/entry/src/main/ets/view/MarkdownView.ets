import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { common } from '@kit.AbilityKit';
import { markdownBlocks, markdownSpans, markdownLink, XopcMarkdownBlock, XopcMarkdownSpan, XopcMarkdownTableRow, XopcMarkdownCell } from '../common/markdown';
import { copyChatMessage } from '../service/chatMessageActions';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcHistoryMedia } from '../model/chat';

@ComponentV2
struct XopcMarkdownInline {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param content: string = '';
  @Param headingLevel: number = 0;
  @Param muted: boolean = false;
  @Param strong: boolean = false;
  @Param alignment: string = 'left';
  @Computed get spans(): XopcMarkdownSpan[] { return markdownSpans(this.content); }
  private async openTarget(href: string): Promise<void> {
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
          .fontWeight(span.kind === 'bold' || this.headingLevel > 0 || this.strong ? FontWeight.Bold : FontWeight.Normal)
          .fontStyle(span.kind === 'italic' ? FontStyle.Italic : FontStyle.Normal)
          .fontFamily(span.kind === 'code' ? 'monospace' : 'sans-serif')
          .fontColor(span.href ? this.colors.accent : this.muted ? this.colors.secondary : this.colors.foreground)
          .decoration({ type: span.href ? TextDecorationType.Underline : span.kind === 'strike' ? TextDecorationType.LineThrough : TextDecorationType.None })
          .onClick((): void => { if (span.href) this.openTarget(span.href); })
      }, (span: XopcMarkdownSpan): string => span.id + ':' + span.kind + ':' + span.text + ':' + (span.href || ''))
    }.fontSize(this.headingLevel ? Math.max(17, 28 - this.headingLevel * 2) : 16)
      .lineHeight(this.headingLevel ? 32 : 25).copyOption(CopyOptions.InApp).width('100%')
      .textAlign(this.alignment === 'right' ? TextAlign.End : this.alignment === 'center' ? TextAlign.Center : TextAlign.Start)
  }
}

@ComponentV2
export struct XopcMarkdownView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param content: string = '';
  @Param conversationId: string = '';
  @Computed get blocks(): XopcMarkdownBlock[] { return markdownBlocks(this.content); }
  private imageFile(block: XopcMarkdownBlock): XopcHistoryMedia {
    return { id: block.id, name: block.text || 'image', type: 'image', mimeType: 'image/png', size: 0, uri: block.href || '' };
  }

  private async copyCode(text: string): Promise<void> {
    try { await copyChatMessage(text); this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copied') }); }
    catch (_) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copy_failed') }); }
  }

  build() {
    Column({ space: 12 }) {
      Repeat<XopcMarkdownBlock>(this.blocks).each((item: RepeatItem<XopcMarkdownBlock>) => {
        if (item.item.kind === 'image') { XopcChatMediaView({ file: this.imageFile(item.item), conversationId: this.conversationId }) }
        else if (item.item.kind === 'rule') {
          Column().width('100%').height(8).borderRadius(4).backgroundColor(this.colors.grouped)
            .margin({ top: 4, bottom: 4 })
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
                    XopcMarkdownInline({ content: cell.text, strong: row.header, alignment: cell.align })
                      .width(168).padding(10)
                  }, (cell: XopcMarkdownCell): string => cell.id + ':' + cell.text)
                }.alignItems(VerticalAlign.Top).backgroundColor(row.header ? this.colors.grouped : this.colors.panel)
                  .margin({ bottom: 4 })
              }, (row: XopcMarkdownTableRow): string => row.id + ':' + JSON.stringify(row.cells))
            }
          }.width('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Auto)
        } else { XopcMarkdownInline({ content: item.item.text, headingLevel: item.item.kind === 'heading' ? item.item.level : 0, muted: item.item.kind === 'quote' }).width('100%').padding({ left: item.item.kind === 'quote' ? 12 : item.item.kind === 'list' ? Math.min(item.item.level, 6) * 12 : 0 }) }
      }).key((block: XopcMarkdownBlock): string => block.id + ':' + block.kind)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
