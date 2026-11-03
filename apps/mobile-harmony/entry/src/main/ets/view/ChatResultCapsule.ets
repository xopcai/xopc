import { appThemeColors, XopcThemeColors } from '../common/themePalette';

@ComponentV2
export struct XopcChatResultCapsule {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param title: string = '';
  @Param subtitle: ResourceStr = '';
  @Param symbol: Resource = $r('sys.symbol.doc_plaintext');
  @Param canOpen: boolean = true;
  @Param entryId: string = '';
  @Event onOpen: () => void = (): void => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        SymbolGlyph(this.symbol).fontSize(18).fontColor([this.colors.accent]).flexShrink(0)
        Column({ space: 2 }) {
          Text(this.title).fontSize(14).fontColor(this.colors.foreground)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.subtitle) {
            Text(this.subtitle).fontSize(12).fontColor(this.colors.secondary)
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }.alignItems(HorizontalAlign.Start).flexShrink(1).constraintSize({ maxWidth: '100%' })
        if (this.canOpen) {
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(13).fontColor([this.colors.tertiary]).flexShrink(0)
        }
      }.constraintSize({ maxWidth: '100%', minHeight: 44 }).padding({ left: 12, right: 12, top: 8, bottom: 8 })
    }.id(this.entryId).constraintSize({ maxWidth: '100%', minHeight: 44 }).padding(0)
      .borderRadius(18).backgroundColor(this.colors.input).enabled(this.canOpen)
      .accessibilityText(this.title).onClick((): void => { this.onOpen(); })
  }
}
