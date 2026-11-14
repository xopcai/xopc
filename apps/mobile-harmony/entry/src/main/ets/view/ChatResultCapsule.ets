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
        SymbolGlyph(this.symbol).fontSize(18).fontColor([this.colors.chat.action]).flexShrink(0)
        Column({ space: 2 }) {
          Text(this.title).fontSize(14).fontColor(this.colors.foreground)
            .width('100%').textAlign(TextAlign.Start).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.subtitle) {
            Text(this.subtitle).fontSize(12).fontColor(this.colors.chat.secondary)
              .width('100%').textAlign(TextAlign.Start).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
        if (this.canOpen) {
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(13).fontColor([this.colors.chat.secondary]).flexShrink(0)
        }
      }.width('100%').constraintSize({ minHeight: 44 }).padding({ left: 12, right: 12, top: 8, bottom: 8 })
    }.id(this.entryId).width('100%').constraintSize({ maxWidth: 320, minHeight: 44 }).padding(0)
      .borderRadius(18).backgroundColor(this.colors.chat.card).enabled(this.canOpen)
      .accessibilityText(this.title).onClick((): void => { this.onOpen(); })
  }
}
