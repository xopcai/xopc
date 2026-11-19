import { appThemeColors, XopcThemeColors } from '../common/themePalette';

export const CAPABILITY_CARD_GAP: number = 14;
export const CAPABILITY_CARD_HEIGHT: number = 76;
export const CAPABILITY_CARD_CORNER: number = 18;
export const CAPABILITY_CARD_PADDING: Padding = { left: 14, right: 14, top: 12, bottom: 12 };

@ComponentV2
export struct XopcCapabilityCardText {
  @Param title: ResourceStr = '';
  @Param description: ResourceStr = '';
  @Local colors: XopcThemeColors = appThemeColors;

  build() {
    Column({ space: 4 }) {
      Text(this.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.description) Text(this.description).fontSize(13).lineHeight(18).fontColor(this.colors.secondary)
        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
    }.alignItems(HorizontalAlign.Start).width('100%')
  }
}
