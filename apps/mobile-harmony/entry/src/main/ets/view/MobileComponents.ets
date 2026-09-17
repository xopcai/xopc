@ComponentV2
export struct XopcPageHeader {
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
        .fontColor($r('app.color.foreground')).layoutWeight(1)
      if (this.actionLabel !== '') {
        Button() { SymbolGlyph(this.actionIcon).fontSize(22).fontColor([$r('app.color.foreground')]) }
          .width(44).height(44).backgroundColor(Color.Transparent)
          .accessibilityText(this.actionText()).onClick((): void => { this.onAction(); })
      }
    }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 12 })
  }
}

@ComponentV2
export struct XopcHubRow {
  @Param heading: ResourceStr = '';
  @Param summary: ResourceStr = '';
  @Param symbol: Resource = $r('sys.symbol.doc');
  @Param navigable: boolean = true;
  @Event onOpen: () => void = (): void => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph(this.symbol).fontSize(23).fontColor([$r('app.color.secondary')])
        Column({ space: 4 }) {
          Text(this.heading).fontSize(16).lineHeight(23).fontWeight(FontWeight.Medium)
            .fontColor($r('app.color.foreground')).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.summary !== '') {
            Text(this.summary).fontSize(13).lineHeight(18).fontColor($r('app.color.secondary'))
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (this.navigable) { SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([$r('app.color.tertiary')]) }
      }.width('100%').constraintSize({ minHeight: 64 }).padding({ top: 12, bottom: 12 })
    }.width('100%').padding(0).backgroundColor(Color.Transparent)
      .border({ width: { bottom: 0.5 }, color: $r('app.color.border_subtle') })
      .onClick((): void => { if (this.navigable) this.onOpen(); })
  }
}

@ComponentV2
export struct XopcSectionLabel {
  @Param heading: ResourceStr = '';
  build() {
    Text(this.heading).fontSize(13).lineHeight(18).fontWeight(FontWeight.Medium)
      .fontColor($r('app.color.secondary')).width('100%').margin({ top: 28, bottom: 8 })
  }
}

@ComponentV2
export struct XopcEmptyHint {
  @Param message: ResourceStr = '';
  build() {
    Text(this.message).fontSize(16).lineHeight(23).fontColor($r('app.color.secondary'))
      .width('100%').padding({ top: 12, bottom: 12 })
  }
}

@Builder
export function XopcListSkeleton() {
    Column({ space: 18 }) {
      ForEach(['first', 'second', 'third'], (key: string) => {
        Row({ space: 12 }) {
          Column().width(28).height(28).borderRadius(6).backgroundColor($r('app.color.input'))
          Column({ space: 8 }) {
            Column().width('75%').height(16).borderRadius(4).backgroundColor($r('app.color.input'))
            Column().width('50%').height(12).borderRadius(4).backgroundColor($r('app.color.input'))
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }.width('100%')
      }, (key: string): string => key)
    }.width('100%').padding({ top: 12, bottom: 12 }).accessibilityText($r('app.string.loading'))
}
