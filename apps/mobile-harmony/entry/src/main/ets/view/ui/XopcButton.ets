import {
  XOPC_BUTTON_HEIGHT_LG,
  XOPC_BUTTON_HEIGHT_MD,
  XOPC_BUTTON_HEIGHT_SM,
  XOPC_DISABLED_OPACITY,
  XOPC_ICON_HEADER,
  XOPC_RADIUS_MD,
  XOPC_RADIUS_SM,
} from '../../common/designTokens';
import { xopcClickEffect } from '../../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../../common/themePalette';

export type XopcButtonVariant = 'primary' | 'tonal' | 'secondary' | 'ghost' | 'danger';
export type XopcButtonSize = 'sm' | 'md' | 'lg';
export type XopcIconButtonTone = 'panel' | 'input' | 'accent' | 'transparent' | 'chatCard';

@ComponentV2
export struct XopcButton {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param label: ResourceStr = '';
  @Param variant: XopcButtonVariant = 'primary';
  @Param buttonSize: XopcButtonSize = 'md';
  @Param icon?: Resource = undefined;
  @Param loading: boolean = false;
  @Param buttonEnabled: boolean = true;
  @Param fullWidth: boolean = false;
  @Param buttonId: string = '';
  @Event onAction: () => void = (): void => {};

  private buttonHeight(): number {
    if (this.buttonSize === 'sm') return XOPC_BUTTON_HEIGHT_SM;
    if (this.buttonSize === 'lg') return XOPC_BUTTON_HEIGHT_LG;
    return XOPC_BUTTON_HEIGHT_MD;
  }

  private buttonRadius(): number {
    return this.colors.corner(this.buttonSize === 'lg' ? XOPC_RADIUS_MD : XOPC_RADIUS_SM);
  }

  private fill(): ResourceColor {
    if (this.variant === 'primary') return this.colors.accent;
    if (this.variant === 'tonal') return this.colors.accentSoft;
    if (this.variant === 'secondary') return this.colors.input;
    if (this.variant === 'danger') return this.colors.dangerSoft;
    return Color.Transparent;
  }

  private tint(): Resource {
    if (this.variant === 'primary') return this.colors.onAccent;
    if (this.variant === 'tonal') return this.colors.accent;
    if (this.variant === 'danger') return this.colors.danger;
    if (this.variant === 'ghost') return this.colors.accent;
    return this.colors.foreground;
  }

  private isInteractive(): boolean {
    return this.buttonEnabled && !this.loading;
  }

  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 6 }) {
        if (this.loading) {
          LoadingProgress().width(18).height(18).color(this.tint())
        } else if (this.icon) {
          SymbolGlyph(this.icon).fontSize(this.buttonSize === 'sm' ? 15 : 17).fontColor([this.tint()])
        }
        Text(this.label)
          .fontSize(this.buttonSize === 'sm' ? 13 : this.buttonSize === 'lg' ? 15 : 14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.tint())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }.justifyContent(FlexAlign.Center).padding({ left: this.buttonSize === 'sm' ? 12 : 16,
        right: this.buttonSize === 'sm' ? 12 : 16 })
    }
      .id(this.buttonId)
      .width(this.fullWidth ? '100%' : undefined)
      .height(this.buttonHeight())
      .padding(0)
      .backgroundColor(this.fill())
      .borderRadius(this.buttonRadius())
      .clipShape(this.colors.cornerClip(this.buttonSize === 'lg' ? XOPC_RADIUS_MD : XOPC_RADIUS_SM))
      .enabled(this.isInteractive())
      .opacity(this.isInteractive() ? 1 : XOPC_DISABLED_OPACITY)
      .clickEffect(xopcClickEffect())
      .onClick((): void => { if (this.isInteractive()) this.onAction(); })
  }
}

@ComponentV2
export struct XopcIconButton {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param symbol: Resource = $r('sys.symbol.xmark');
  @Param tone: XopcIconButtonTone = 'panel';
  @Param iconSize: number = XOPC_ICON_HEADER;
  @Param accessibilityLabel: ResourceStr = '';
  @Param buttonId: string = '';
  @Param buttonEnabled: boolean = true;
  @Event onAction: () => void = (): void => {};

  private fill(): ResourceColor {
    if (this.tone === 'input') return this.colors.input;
    if (this.tone === 'accent') return this.colors.accentSoft;
    if (this.tone === 'chatCard') return this.colors.chat.card;
    if (this.tone === 'transparent') return Color.Transparent;
    return this.colors.panel;
  }

  private tint(): Resource {
    if (this.tone === 'accent') return this.colors.accent;
    return this.colors.foreground;
  }

  private labelText(): string {
    if (typeof this.accessibilityLabel === 'string') return this.accessibilityLabel;
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(this.accessibilityLabel.id) ?? '';
  }

  build() {
    Button({ type: ButtonType.Circle }) {
      SymbolGlyph(this.symbol).fontSize(this.iconSize).fontColor([this.tint()])
    }
      .id(this.buttonId)
      .width(XOPC_BUTTON_HEIGHT_MD)
      .height(XOPC_BUTTON_HEIGHT_MD)
      .padding(0)
      .backgroundColor(this.fill())
      .enabled(this.buttonEnabled)
      .opacity(this.buttonEnabled ? 1 : XOPC_DISABLED_OPACITY)
      .clickEffect(xopcClickEffect())
      .accessibilityText(this.labelText())
      .onClick((): void => { if (this.buttonEnabled) this.onAction(); })
  }
}
