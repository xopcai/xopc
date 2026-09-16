import { markdownBlocks, markdownSpans, XopcMarkdownBlock, XopcMarkdownSpan } from '../common/markdown';

@ComponentV2
export struct XopcMarkdownView {
  @Param content: string = '';

  @Builder
  richText(block: XopcMarkdownBlock) {
    Text() {
      ForEach(markdownSpans(block.text), (span: XopcMarkdownSpan) => {
        Span(span.text)
          .fontWeight(span.kind === 'bold' || block.kind === 'heading' ? FontWeight.Bold : FontWeight.Normal)
          .fontStyle(span.kind === 'italic' ? FontStyle.Italic : FontStyle.Normal)
          .fontFamily(span.kind === 'code' ? 'monospace' : 'sans-serif')
      }, (span: XopcMarkdownSpan): string => span.id)
    }.fontSize(block.kind === 'heading' ? Math.max(17, 28 - block.level * 2) : 16)
      .fontColor(block.kind === 'quote' ? $r('app.color.secondary') : $r('app.color.foreground'))
      .lineHeight(block.kind === 'heading' ? 32 : 25).copyOption(CopyOptions.InApp)
      .width('100%').padding({ left: block.kind === 'quote' ? 12 : 0 })
  }

  build() {
    Column({ space: 12 }) {
      ForEach(markdownBlocks(this.content), (block: XopcMarkdownBlock) => {
        if (block.kind === 'rule') { Divider().color($r('app.color.secondary')).opacity(0.3) }
        else if (block.kind === 'code') {
          Text(block.text).fontFamily('monospace').fontSize(14).lineHeight(22)
            .fontColor($r('app.color.foreground')).copyOption(CopyOptions.InApp)
            .padding(12).width('100%').borderRadius(8).backgroundColor($r('app.color.panel'))
        } else { this.richText(block) }
      }, (block: XopcMarkdownBlock): string => block.id)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
