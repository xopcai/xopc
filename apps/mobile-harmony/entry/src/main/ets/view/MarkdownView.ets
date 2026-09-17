import { common } from '@kit.AbilityKit';
import { markdownBlocks, markdownSpans, markdownLink, XopcMarkdownBlock, XopcMarkdownSpan, XopcMarkdownTableRow, XopcMarkdownCell } from '../common/markdown';
import { copyChatMessage } from '../service/chatMessageActions';

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
  @Computed get blocks(): XopcMarkdownBlock[] { return markdownBlocks(this.content); }

  private async copyCode(text: string): Promise<void> {
    try { await copyChatMessage(text); this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copied') }); }
    catch (_) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_copy_failed') }); }
  }

  @Builder
  richText(block: XopcMarkdownBlock) {
    XopcMarkdownInline({ content: block.text, headingLevel: block.kind === 'heading' ? block.level : 0, muted: block.kind === 'quote' })
      .width('100%').padding({ left: block.kind === 'quote' ? 12 : block.kind === 'list' ? Math.min(block.level, 6) * 12 : 0 })
  }

  build() {
    Column({ space: 12 }) {
      ForEach(this.blocks, (block: XopcMarkdownBlock) => {
        if (block.kind === 'rule') { Divider().color($r('app.color.secondary')).opacity(0.3) }
        else if (block.kind === 'code') {
          Column() {
            Row() {
              Text(block.language || '').fontSize(12).fontColor($r('app.color.secondary')).layoutWeight(1)
              Button($r('app.string.chat_copy')).height(44).backgroundColor(Color.Transparent).fontColor($r('app.color.accent'))
                .onClick((): void => { this.copyCode(block.text); })
            }.width('100%')
            Text(block.text).fontFamily('monospace').fontSize(14).lineHeight(22)
              .fontColor($r('app.color.foreground')).copyOption(CopyOptions.InApp).width('100%')
          }.padding(12).width('100%').borderRadius(8).backgroundColor($r('app.color.grouped'))
        } else if (block.kind === 'table') {
          Scroll() {
            Column() {
              ForEach(block.rows || [], (row: XopcMarkdownTableRow) => {
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
        } else { this.richText(block) }
      }, (block: XopcMarkdownBlock): string => block.id + ':' + JSON.stringify(block))
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
