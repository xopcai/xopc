import { appThemeColors, XopcThemeColors } from '../common/themePalette';

@ComponentV2
export struct XopcBrandLoading {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param compact: boolean = false;
  @Param reduceMotion: boolean = false;
  @Param label: ResourceStr = $r('app.string.loading');
  @Local accentAngle: number = 0;
  private animationTimer: number = -1;

  aboutToAppear(): void { this.startAnimation(); }

  aboutToDisappear(): void {
    clearTimeout(this.animationTimer);
    this.animationTimer = -1;
  }

  @Monitor('reduceMotion')
  onReduceMotionChange(): void { this.startAnimation(); }

  private startAnimation(): void {
    clearTimeout(this.animationTimer);
    this.animationTimer = -1;
    this.accentAngle = 0;
    if (this.reduceMotion) return;
    this.animationTimer = setTimeout((): void => { this.accentAngle = 360; }, 0);
  }

  private labelText(): string {
    if (typeof this.label === 'string') return this.label;
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(this.label.id) ?? '';
  }

  build() {
    Column({ space: this.compact ? 0 : 12 }) {
      Stack({ alignContent: Alignment.Center }) {
        Image($r('app.media.brand_logo_base')).width(this.compact ? 20 : 42).height(this.compact ? 20 : 42)
          .objectFit(ImageFit.Contain)
        Image($r('app.media.brand_logo_accent')).width(this.compact ? 20 : 42).height(this.compact ? 20 : 42)
          .objectFit(ImageFit.Contain).rotate({ angle: this.accentAngle })
          .animation({ duration: this.reduceMotion ? 0 : 1450, curve: Curve.Linear,
            iterations: this.reduceMotion ? 1 : -1 })
      }.width(this.compact ? 20 : 42).height(this.compact ? 20 : 42)
      if (!this.compact) {
        Text(this.label).fontSize(13).fontColor(this.colors.tertiary)
      }
    }.width(this.compact ? 20 : '100%').constraintSize({ minHeight: this.compact ? 20 : 220 })
      .justifyContent(FlexAlign.Center).accessibilityText(this.labelText())
  }
}

@ComponentV2
export struct XopcPageHeader {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param heading: ResourceStr = '';
  @Param actionLabel: ResourceStr = '';
  @Param actionIcon: Resource = $r('sys.symbol.arrow_clockwise');
  @Event onAction: () => void = (): void => {};

  private actionText(): string {
    if (typeof this.actionLabel === 'string') return this.actionLabel;
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(this.actionLabel.id) ?? '';
  }

  build() {
    Row({ space: 12 }) {
      Text(this.heading).fontSize(28).lineHeight(34).fontWeight(FontWeight.Bold)
        .fontColor(this.colors.foreground).layoutWeight(1)
      if (this.actionLabel !== '') {
        Button() { SymbolGlyph(this.actionIcon).fontSize(22).fontColor([this.colors.foreground]) }
          .width(44).height(44).backgroundColor(Color.Transparent)
          .accessibilityText(this.actionText()).onClick((): void => { this.onAction(); })
      }
    }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 12 })
  }
}

@ComponentV2
export struct XopcHubRow {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param heading: ResourceStr = '';
  @Param summary: ResourceStr = '';
  @Param symbol: Resource = $r('sys.symbol.doc');
  @Param navigable: boolean = true;
  @Param showChevron: boolean = true;
  @Param compact: boolean = false;
  @Event onOpen: () => void = (): void => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: this.compact ? 10 : 12 }) {
        SymbolGlyph(this.symbol).fontSize(this.compact ? 20 : 23).fontColor([this.colors.secondary])
        Column({ space: this.compact ? 2 : 4 }) {
          Text(this.heading).fontSize(this.compact ? 15 : 16).lineHeight(this.compact ? 21 : 23).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.summary !== '') {
            Text(this.summary).fontSize(13).lineHeight(18).fontColor(this.colors.secondary)
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (this.navigable && this.showChevron) { SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([this.colors.tertiary]) }
      }.width('100%').constraintSize({ minHeight: this.compact ? 52 : 64 })
        .padding({ left: this.compact ? 12 : 16, right: this.compact ? 12 : 16,
          top: this.compact ? 6 : 12, bottom: this.compact ? 6 : 12 })
    }.width('100%').padding(0).borderRadius(this.compact ? 12 : 14).backgroundColor(this.colors.panel)
      .margin({ bottom: 8 })
      .onClick((): void => { if (this.navigable) this.onOpen(); })
  }
}

@ComponentV2
export struct XopcSectionLabel {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param heading: ResourceStr = '';
  build() {
    Text(this.heading).fontSize(13).lineHeight(18).fontWeight(FontWeight.Medium)
      .fontColor(this.colors.secondary).width('100%').margin({ top: 28, bottom: 8 })
  }
}

@ComponentV2
export struct XopcEmptyHint {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param message: ResourceStr = '';
  build() {
    Text(this.message).fontSize(16).lineHeight(23).fontColor(this.colors.secondary)
      .width('100%').padding({ top: 12, bottom: 12 })
  }
}

@Builder
export function XopcListSkeleton() {
    Column({ space: 18 }) {
      ForEach(['first', 'second', 'third'], (key: string) => {
        Row({ space: 12 }) {
          Column().width(28).height(28).borderRadius(6).backgroundColor(appThemeColors.input)
          Column({ space: 8 }) {
            Column().width('75%').height(16).borderRadius(4).backgroundColor(appThemeColors.input)
            Column().width('50%').height(12).borderRadius(4).backgroundColor(appThemeColors.input)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }.width('100%')
      }, (key: string): string => key)
    }.width('100%').padding({ top: 12, bottom: 12 }).accessibilityText($r('app.string.loading'))
}
