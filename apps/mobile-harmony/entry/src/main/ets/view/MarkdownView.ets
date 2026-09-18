import { common } from '@kit.AbilityKit';
import { markdownBlocks, markdownSpans, markdownLink, XopcMarkdownBlock, XopcMarkdownSpan, XopcMarkdownTableRow, XopcMarkdownCell } from '../common/markdown';
import { copyChatMessage } from '../service/chatMessageActions';
import { XopcChatMediaView } from './ChatMediaView';
import { XopcHistoryMedia } from '../model/chat';

@ComponentV2
struct XopcMarkdownInline {
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
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') }, { text: $r('app.string.open'), color: $r('app.color.accent') }] });
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
          .fontColor(span.href ? $r('app.color.accent') : this.muted ? $r('app.color.secondary') : $r('app.color.foreground'))
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
        else if (item.item.kind === 'rule') { Divider().color($r('app.color.secondary')).opacity(0.3) }
        else if (item.item.kind === 'code') {
          Column() {
            Row() {
              Text(item.item.language || '').fontSize(12).fontColor($r('app.color.secondary')).layoutWeight(1)
              Button($r('app.string.chat_copy')).height(44).backgroundColor(Color.Transparent).fontColor($r('app.color.accent'))
                .onClick((): void => { this.copyCode(item.item.text); })
            }.width('100%')
            Text(item.item.text).fontFamily('monospace').fontSize(14).lineHeight(22)
              .fontColor($r('app.color.foreground')).copyOption(CopyOptions.InApp).width('100%')
          }.padding(12).width('100%').borderRadius(8).backgroundColor($r('app.color.grouped'))
        } else if (item.item.kind === 'table') {
          Scroll() {
            Column() {
              ForEach(item.item.rows || [], (row: XopcMarkdownTableRow) => {
                Row() {
                  ForEach(row.cells, (cell: XopcMarkdownCell) => {
                    XopcMarkdownInline({ content: cell.text, strong: row.header, alignment: cell.align })
                      .width(168).padding(10)
                  }, (cell: XopcMarkdownCell): string => cell.id + ':' + cell.text)
                }.alignItems(VerticalAlign.Top).backgroundColor(row.header ? $r('app.color.grouped') : Color.Transparent)
                  .border({ width: { bottom: 0.5 }, color: $r('app.color.secondary') })
              }, (row: XopcMarkdownTableRow): string => row.id + ':' + JSON.stringify(row.cells))
            }
          }.width('100%').scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Auto)
        } else { XopcMarkdownInline({ content: item.item.text, headingLevel: item.item.kind === 'heading' ? item.item.level : 0, muted: item.item.kind === 'quote' }).width('100%').padding({ left: item.item.kind === 'quote' ? 12 : item.item.kind === 'list' ? Math.min(item.item.level, 6) * 12 : 0 }) }
      }).key((block: XopcMarkdownBlock): string => block.id + ':' + block.kind)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
