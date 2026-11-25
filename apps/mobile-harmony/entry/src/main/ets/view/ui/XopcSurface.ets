import {
  XOPC_CARD_PADDING,
  XOPC_CARD_PADDING_COMPACT,
  XOPC_RADIUS_MD,
  XOPC_RADIUS_PILL,
  XOPC_RADIUS_SM,
} from '../../common/designTokens';
import { appThemeColors, XopcThemeColors } from '../../common/themePalette';

export type XopcCardSurface = 'panel' | 'grouped' | 'attention' | 'accentSoft';
export type XopcBadgeTone = 'neutral' | 'accent' | 'warning' | 'danger';

@ComponentV2
export struct XopcCard {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param compact: boolean = false;
  @Param surface: XopcCardSurface = 'panel';
  @BuilderParam content: () => void = this.emptyContent;

  @Builder
  private emptyContent() {}

  private fill(): Resource {
    if (this.surface === 'grouped') return this.colors.grouped;
    if (this.surface === 'attention') return this.colors.attentionFill;
    if (this.surface === 'accentSoft') return this.colors.accentSoft;
    return this.colors.panel;
  }

  build() {
    Column() {
      this.content()
    }
      .width('100%')
      .padding(this.compact ? XOPC_CARD_PADDING_COMPACT : XOPC_CARD_PADDING)
      .backgroundColor(this.fill())
      .borderRadius(this.colors.corner(this.compact ? XOPC_RADIUS_SM : XOPC_RADIUS_MD))
      .clipShape(this.colors.cornerClip(this.compact ? XOPC_RADIUS_SM : XOPC_RADIUS_MD))
      .alignItems(HorizontalAlign.Start)
  }
}

@ComponentV2
export struct XopcBadge {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param label: ResourceStr = '';
  @Param tone: XopcBadgeTone = 'neutral';

  private fill(): Resource {
    if (this.tone === 'accent') return this.colors.accentSoft;
    if (this.tone === 'warning') return this.colors.warningFill;
    if (this.tone === 'danger') return this.colors.dangerSoft;
    return this.colors.grouped;
  }

  private tint(): Resource {
    if (this.tone === 'accent') return this.colors.accent;
    if (this.tone === 'warning') return this.colors.warningForeground;
    if (this.tone === 'danger') return this.colors.danger;
    return this.colors.secondary;
  }

  build() {
    Text(this.label)
      .fontSize(12)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.tint())
      .padding({ left: 9, right: 9, top: 4, bottom: 4 })
      .borderRadius(XOPC_RADIUS_PILL)
      .backgroundColor(this.fill())
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
  }
}
