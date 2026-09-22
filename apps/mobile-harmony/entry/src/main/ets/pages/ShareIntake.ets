@Entry
@ComponentV2
struct XopcShareIntakePage {
  build() {
    Column({ space: 14 }) {
      SymbolGlyph($r('sys.symbol.square_and_arrow_down')).fontSize(38).fontColor([$r('app.color.accent')])
      Text($r('app.string.share_receiving')).fontSize(16).fontColor($r('app.color.secondary'))
      LoadingProgress().width(28).height(28).color($r('app.color.accent'))
    }.width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor($r('app.color.surface'))
  }
}
