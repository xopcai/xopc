import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage, userErrorTitle } from '../common/userError';
import { XopcUserErrorContext } from '../common/userErrorClassifier';
import { XopcLoopi } from './Loopi';

@ComponentV2
export struct XopcBrandLoading {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param compact: boolean = false;
  @Param reduceMotion: boolean = false;
  @Param label: ResourceStr = $r('app.string.loading');

  private labelText(): string {
    if (typeof this.label === 'string') return this.label;
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(this.label.id) ?? '';
  }

  build() {
    Column({ space: this.compact ? 0 : 12 }) {
      XopcLoopi({ extent: this.compact ? 20 : 42, compact: this.compact,
        activePage: !this.reduceMotion, mood: 'work' })
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
  @Param backVisible: boolean = false;
  @Event onBack: () => void = (): void => {};
  @Param searchId: string = '';
  @Param searchOpen: boolean = false;
  @Param searchLabel: Resource = $r('app.string.search');
  @Event onSearch: () => void = (): void => {};
  @Param actionLabel: ResourceStr = '';
  @Param actionIcon: Resource = $r('sys.symbol.arrow_clockwise');
  @Event onAction: () => void = (): void => {};

  private actionText(): string {
    if (typeof this.actionLabel === 'string') return this.actionLabel;
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(this.actionLabel.id) ?? '';
  }

  build() {
    Row({ space: 8 }) {
      if (this.backVisible) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(21).fontColor([this.colors.foreground])
        }.width(44).height(44).padding(0)
          .backgroundColor(this.colors.light ? this.colors.panel : Color.Transparent).border(this.colors.panelStroke)
          .accessibilityText($r('app.string.back')).onClick((): void => { this.onBack(); })
      }
      Text(this.heading).fontSize(28).lineHeight(34).fontWeight(FontWeight.Bold)
        .fontColor(this.colors.foreground).layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.searchId) {
        XopcPageSearchButton({ searchId: this.searchId, open: this.searchOpen, label: this.searchLabel, onToggle: this.onSearch })
      }
      if (this.actionLabel !== '') {
        Button() { SymbolGlyph(this.actionIcon).fontSize(22).fontColor([this.colors.foreground]) }
          .width(44).height(44)
          .backgroundColor(this.colors.light ? this.colors.panel : Color.Transparent).border(this.colors.panelStroke)
          .accessibilityText(this.actionText()).onClick((): void => { this.onAction(); })
      }
    }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 12 })
  }
}

@ComponentV2
export struct XopcPageSearchButton {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param searchId: string = '';
  @Param open: boolean = false;
  @Param label: Resource = $r('app.string.search');
  @Event onToggle: () => void = (): void => {};

  build() {
    Button({ type: ButtonType.Circle }) {
      SymbolGlyph(this.open ? $r('sys.symbol.xmark') : $r('sys.symbol.magnifyingglass'))
        .fontSize(21).fontColor([this.colors.foreground])
    }.id(this.open ? this.searchId + '-close' : this.searchId)
      .width(44).height(44).padding(0)
      .backgroundColor(this.colors.light ? this.colors.panel : Color.Transparent).border(this.colors.panelStroke)
      .accessibilityText(this.open ? $r('app.string.close') : this.label).onClick((): void => { this.onToggle(); })
  }
}

@ComponentV2
export struct XopcPageSearchField {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param searchId: string = '';
  @Param text: string = '';
  @Param placeholder: ResourceStr = $r('app.string.search');
  @Event onChange: (text: string) => void = (_text: string): void => {};
  @Event onSubmit: () => void = (): void => {};
  private focusTimer: number = -1;

  build() {
    TextInput({ text: this.text, placeholder: this.placeholder }).id(this.searchId).width('100%').height(46)
      .backgroundColor(this.colors.light ? this.colors.panel : this.colors.input)
      .border(this.colors.controlStroke).borderRadius(this.colors.corner(23)).fontColor(this.colors.foreground).placeholderColor(this.colors.tertiary)
      .enterKeyType(EnterKeyType.Search).defaultFocus(true)
      .onChange(this.onChange).onSubmit(this.onSubmit)
      .onAppear((): void => {
        this.focusTimer = setTimeout((): void => { this.getUIContext().getFocusController().requestFocus(this.searchId); }, 50);
      })
      .onDisAppear((): void => { clearTimeout(this.focusTimer); })
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
  @Param attention: boolean = false;

  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: this.compact ? 10 : 12 }) {
        Stack() {
          SymbolGlyph(this.symbol).fontSize(this.compact ? 17 : 19)
            .fontColor([this.attention ? this.colors.attentionForeground : this.colors.secondary])
        }.width(this.compact ? 30 : 36).height(this.compact ? 30 : 36).borderRadius(this.colors.corner(9))
          .backgroundColor(this.colors.light && !this.attention ? this.colors.grouped : Color.Transparent)
        Column({ space: this.compact ? 2 : 4 }) {
          Text(this.heading).fontSize(this.compact ? 15 : 16).lineHeight(this.compact ? 21 : 23).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.summary !== '') {
            Text(this.summary).fontSize(13).lineHeight(18).fontColor(this.colors.tertiary)
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        if (this.navigable && this.showChevron) { SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([this.colors.tertiary]) }
      }.width('100%').constraintSize({ minHeight: this.compact ? 52 : 64 })
        .padding({ left: this.compact ? 12 : 16, right: this.compact ? 12 : 16,
          top: this.compact ? 6 : 12, bottom: this.compact ? 6 : 12 })
    }.width('100%').padding(0)
      .backgroundColor(this.attention ? this.colors.attentionFill : this.colors.panel)
      .border(this.attention ? this.colors.attentionStroke : this.colors.panelStroke)
      .borderRadius(this.colors.corner(this.compact ? 12 : 16))
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

@ComponentV2
export struct XopcErrorState {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param error: string = '';
  @Param context: XopcUserErrorContext = 'generic';
  @Param compact: boolean = false;
  @Param actionLabel: ResourceStr = $r('app.string.retry');
  @Event onAction: () => void = (): void => {};

  build() {
    Column({ space: this.compact ? 6 : 10 }) {
      SymbolGlyph($r('sys.symbol.exclamationmark_circle')).fontSize(this.compact ? 22 : 30)
        .fontColor([this.colors.secondary])
      Text(userErrorTitle(this.error, this.context)).fontSize(this.compact ? 15 : 18).fontWeight(FontWeight.Medium)
        .fontColor(this.colors.foreground).textAlign(TextAlign.Center)
      Text(userErrorMessage(this.error, this.context)).fontSize(13).lineHeight(19).fontColor(this.colors.secondary)
        .textAlign(TextAlign.Center).constraintSize({ maxWidth: 320 })
      Button(this.actionLabel).height(44).fontSize(14).fontColor(this.colors.foreground)
        .backgroundColor(this.colors.input).margin({ top: 2 }).onClick((): void => { this.onAction(); })
    }.width('100%').constraintSize({ minHeight: this.compact ? 120 : 220 })
      .justifyContent(FlexAlign.Center).padding(this.compact ? 12 : 24)
      .accessibilityGroup(true)
  }
}

@Builder
export function XopcListSkeleton() {
    Column({ space: 18 }) {
      ForEach(['first', 'second', 'third'], (key: string) => {
        Row({ space: 12 }) {
          Column().width(28).height(28).borderRadius(appThemeColors.corner(6)).backgroundColor(appThemeColors.input)
          Column({ space: 8 }) {
            Column().width('75%').height(16).borderRadius(4).backgroundColor(appThemeColors.input)
            Column().width('50%').height(12).borderRadius(4).backgroundColor(appThemeColors.input)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }.width('100%')
      }, (key: string): string => key)
    }.width('100%').padding({ top: 12, bottom: 12 }).accessibilityText($r('app.string.loading'))
}
