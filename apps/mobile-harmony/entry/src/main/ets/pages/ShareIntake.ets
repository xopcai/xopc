import { appThemeColors, XopcThemeColors } from '../common/themePalette';
@Entry
@ComponentV2
struct XopcShareIntakePage {
  @Local colors: XopcThemeColors = appThemeColors;
  build() {
    Column({ space: 14 }) {
      SymbolGlyph($r('sys.symbol.square_and_arrow_down')).fontSize(38).fontColor([this.colors.accent])
      Text($r('app.string.share_receiving')).fontSize(16).fontColor(this.colors.secondary)
      LoadingProgress().width(28).height(28).color(this.colors.accent)
    }.width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor(this.colors.surface)
  }
}
