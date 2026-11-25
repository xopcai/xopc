import { XOPC_ICON_HEADER, XOPC_PAGE_PADDING_X, xopcBackIcon } from '../common/designTokens';
import {
  XOPC_MOTION_SKELETON_MS,
  xopcClickEffect,
  xopcRevealTransition,
} from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage, userErrorTitle } from '../common/userError';
import { XopcUserErrorContext } from '../common/userErrorClassifier';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcLoopi } from './Loopi';

export { XopcButton, XopcButtonSize, XopcButtonVariant, XopcIconButton, XopcIconButtonTone } from './ui/XopcButton';
export { XopcBadge, XopcBadgeTone, XopcCard, XopcCardSurface } from './ui/XopcSurface';
export { XopcBannerTone, XopcBatchActionBar, XopcInlineBanner, XopcSheetHeader, XopcUndoBar } from './ui/XopcOverlays';

@ComponentV2
export struct XopcPaginationFooter {
  @Param loadingPage: boolean = false;
  @Param failedPage: boolean = false;
  @Event onLoad: () => void = (): void => {};
  @Local colors: XopcThemeColors = appThemeColors;

  build() {
    Row() {
      if (this.loadingPage) {
        LoadingProgress().width(22).height(22).color(this.colors.secondary)
          .accessibilityText($r('app.string.loading'))
      } else if (this.failedPage) {
        Button($r('app.string.retry')).height(44).backgroundColor(Color.Transparent)
          .fontColor(this.colors.accent).clickEffect(xopcClickEffect()).onClick(this.onLoad)
      } else {
        Blank().width('100%').height(32).accessibilityLevel('no')
          .onVisibleAreaChange([0.25], (visible: boolean, ratio: number): void => {
            if (visible && ratio >= 0.25 && !this.loadingPage && !this.failedPage) this.onLoad();
          })
      }
    }.width('100%').height(this.loadingPage || this.failedPage ? 44 : 32).justifyContent(FlexAlign.Center)
  }
}

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
export struct XopcPageTitleMenu {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param heading: ResourceStr = '';
  @Param selected: string = '';
  @Param options: XopcPageTitleOption[] = [];
  @Param menuId: string = '';
  @Event onSelect: (key: string) => void = (_key: string): void => {};

  @Builder
  menu() {
    Menu() {
      ForEach(this.options, (option: XopcPageTitleOption) => {
        MenuItem({ content: option.label }).id(option.id ?? '')
          .selected(option.key === this.selected).selectIcon(true)
          .onChange((): void => { this.onSelect(option.key); })
      }, (option: XopcPageTitleOption): string => option.key)
    }.width(208).borderRadius(this.colors.corner(22))
  }

  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 6 }) {
        Text(this.heading).fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(13).fontColor([this.colors.secondary])
      }.constraintSize({ maxWidth: '100%' }).justifyContent(FlexAlign.Center)
    }.id(this.menuId).height(44).padding({ left: 8, right: 8 }).backgroundColor(Color.Transparent)
      .borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14))
      .clickEffect(xopcClickEffect())
      .bindMenu(this.menu, { placement: Placement.Bottom })
  }
}

export interface XopcPageTitleOption {
  key: string;
  label: ResourceStr;
  id?: string;
}

@ComponentV2
export struct XopcPageHeader {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param heading: ResourceStr = '';
  @Param showStaticTitle: boolean = false;
  @Param selectionTitle: ResourceStr = '';
  @Param titleOptions: XopcPageTitleOption[] = [];
  @Param selectedTitle: string = '';
  @Param titleMenuId: string = '';
  @Event onSelectTitle: (key: string) => void = (_key: string): void => {};
  @Param backVisible: boolean = false;
  @Param backId: string = '';
  @Param backEnabled: boolean = true;
  @Event onBack: () => void = (): void => {};
  @Param searchId: string = '';
  @Param searchOpen: boolean = false;
  @Param searchLabel: Resource = $r('app.string.search');
  @Event onSearch: () => void = (): void => {};
  @Param secondaryActionLabel: ResourceStr = '';
  @Param secondaryActionIcon: Resource = $r('sys.symbol.plus');
  @Param secondaryActionId: string = '';
  @Param secondaryActionTone: 'default' | 'accent' = 'default';
  @Param secondaryActionEnabled: boolean = true;
  @Event onSecondaryAction: () => void = (): void => {};
  @Param actionLabel: ResourceStr = '';
  @Param actionIcon: Resource = $r('sys.symbol.arrow_clockwise');
  @Param actionId: string = '';
  @Param actionTone: 'default' | 'accent' = 'default';
  @Param actionEnabled: boolean = true;
  @Event onAction: () => void = (): void => {};

  private resolveText(value: ResourceStr): string {
    if (typeof value === 'string') return value;
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(value.id) ?? '';
  }

  private actionFill(tone: 'default' | 'accent'): ResourceColor {
    if (tone === 'accent') return this.colors.accentSoft;
    return this.colors.light ? this.colors.panel : Color.Transparent;
  }

  private actionTint(tone: 'default' | 'accent'): Resource {
    return tone === 'accent' ? this.colors.accent : this.colors.foreground;
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
     Row({ space: 8 }) {
      if (this.backVisible) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph(xopcBackIcon()).fontSize(XOPC_ICON_HEADER).fontColor([this.colors.foreground])
        }.id(this.backId).width(44).height(44).padding(0)
          .backgroundColor(this.colors.panel).enabled(this.backEnabled)
          .clickEffect(xopcClickEffect())
          .accessibilityText($r('app.string.back')).onClick((): void => { this.onBack(); })
      }
      if (this.selectionTitle !== '') {
        Text(this.selectionTitle).fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
      } else {
        Blank().layoutWeight(1)
      }
      if (this.selectionTitle === '' && this.searchId) {
        XopcPageSearchButton({ searchId: this.searchId, open: this.searchOpen, label: this.searchLabel, onToggle: this.onSearch })
      }
      if (this.selectionTitle === '' && this.secondaryActionLabel !== '') {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph(this.secondaryActionIcon).fontSize(XOPC_ICON_HEADER).fontColor([this.actionTint(this.secondaryActionTone)])
        }
          .id(this.secondaryActionId).width(44).height(44).padding(0)
          .backgroundColor(this.actionFill(this.secondaryActionTone)).enabled(this.secondaryActionEnabled)
          .clickEffect(xopcClickEffect())
          .accessibilityText(this.resolveText(this.secondaryActionLabel)).onClick((): void => { this.onSecondaryAction(); })
      }
      if (this.selectionTitle === '' && this.actionLabel !== '') {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph(this.actionIcon).fontSize(XOPC_ICON_HEADER).fontColor([this.actionTint(this.actionTone)])
        }
          .id(this.actionId).width(44).height(44).padding(0)
          .backgroundColor(this.actionFill(this.actionTone)).enabled(this.actionEnabled)
          .clickEffect(xopcClickEffect())
          .accessibilityText(this.resolveText(this.actionLabel)).onClick((): void => { this.onAction(); })
      }
     }.width('100%').height(44)
      if (this.selectionTitle === '' && this.titleOptions.length) {
        XopcPageTitleMenu({ heading: this.heading, options: this.titleOptions,
          selected: this.selectedTitle, menuId: this.titleMenuId, onSelect: this.onSelectTitle })
          .constraintSize({ maxWidth: '54%' })
      } else if (this.selectionTitle === '' && this.showStaticTitle) {
        Text(this.heading).fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).constraintSize({ maxWidth: '57%' })
          .accessibilityGroup(true).hitTestBehavior(HitTestMode.None)
      }
    }.width('100%').padding({ left: XOPC_PAGE_PADDING_X, right: XOPC_PAGE_PADDING_X, top: 8, bottom: 8 })
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
        .fontSize(XOPC_ICON_HEADER).fontColor([this.colors.foreground])
    }.id(this.open ? this.searchId + '-close' : this.searchId)
      .width(44).height(44).padding(0)
      .backgroundColor(this.colors.light ? this.colors.panel : Color.Transparent)
      .clickEffect(xopcClickEffect())
      .accessibilityText(this.open ? $r('app.string.close') : this.label).onClick((): void => { this.onToggle(); })
  }
}

@ComponentV2
export struct XopcPageSearchField {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Param searchId: string = '';
  @Param text: string = '';
  @Param placeholder: ResourceStr = $r('app.string.search');
  @Event onChange: (text: string) => void = (_text: string): void => {};
  @Event onSubmit: () => void = (): void => {};
  private focusTimer: number = -1;

  build() {
    TextInput({ text: this.text, placeholder: this.placeholder }).id(this.searchId).width('100%').height(46)
      .backgroundColor(this.colors.input)
      .borderRadius(this.colors.corner(23)).fontColor(this.colors.foreground).placeholderColor(this.colors.tertiary)
      .enterKeyType(EnterKeyType.Search).defaultFocus(true)
      .transition(xopcRevealTransition(TransitionEdge.TOP, this.layout.reduceMotion))
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
  @Param trailingValue: ResourceStr = '';
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
        if (this.trailingValue !== '') {
          Text(this.trailingValue).fontSize(13).fontColor(this.colors.secondary).textAlign(TextAlign.End)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).constraintSize({ maxWidth: '38%' })
        }
        if (this.navigable && this.showChevron) { SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(16).fontColor([this.colors.tertiary]) }
      }.width('100%').constraintSize({ minHeight: this.compact ? 52 : 64 })
        .padding({ left: this.compact ? 12 : 16, right: this.compact ? 12 : 16,
          top: this.compact ? 6 : 12, bottom: this.compact ? 6 : 12 })
    }.width('100%').padding(0)
      .backgroundColor(this.attention ? this.colors.attentionFill : this.colors.panel)
      .borderRadius(this.colors.corner(this.compact ? 12 : 16)).clipShape(this.colors.cornerClip(this.compact ? 12 : 16))
      .margin({ bottom: 8 })
      .hoverEffect(this.navigable ? HoverEffect.Auto : HoverEffect.None)
      .clickEffect(this.navigable ? xopcClickEffect() : null)
      .onClick((): void => { if (this.navigable) this.onOpen(); })
  }
}

@ComponentV2
export struct XopcSectionLabel {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param heading: ResourceStr = '';
  build() {
    Text(this.heading).fontSize(13).lineHeight(18).fontWeight(FontWeight.Medium)
      .fontColor(this.colors.secondary).width('100%').margin({ top: 24, bottom: 8 })
  }
}

@ComponentV2
export struct XopcEmptyHint {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param message: ResourceStr = '';
  @Param detail: ResourceStr = '';
  @Param actionLabel: ResourceStr = '';
  @Param centered: boolean = false;
  @Event onAction: () => void = (): void => {};

  build() {
    Column({ space: 8 }) {
      Text(this.message).fontSize(15).lineHeight(22).fontColor(this.colors.secondary)
        .textAlign(this.centered ? TextAlign.Center : TextAlign.Start).width('100%')
      if (this.detail !== '') {
        Text(this.detail).fontSize(13).lineHeight(19).fontColor(this.colors.tertiary)
          .textAlign(this.centered ? TextAlign.Center : TextAlign.Start).width('100%')
      }
      if (this.actionLabel !== '') {
        Button(this.actionLabel, { type: ButtonType.Normal })
          .height(44).padding({ left: 18, right: 18 }).fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
          .borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12))
          .clickEffect(xopcClickEffect()).margin({ top: 4 })
          .onClick((): void => { this.onAction(); })
      }
    }
      .width('100%')
      .padding({ top: this.centered ? 28 : 12, bottom: this.centered ? 28 : 12 })
      .alignItems(this.centered ? HorizontalAlign.Center : HorizontalAlign.Start)
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
        .backgroundColor(this.colors.input).clickEffect(xopcClickEffect()).margin({ top: 2 })
        .onClick((): void => { this.onAction(); })
    }.width('100%').constraintSize({ minHeight: this.compact ? 120 : 220 })
      .justifyContent(FlexAlign.Center).padding(this.compact ? 12 : 24)
      .accessibilityGroup(true)
  }
}

@ComponentV2
struct XopcAnimatedListSkeleton {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local pulsed: boolean = false;

  @Computed get shouldAnimate(): boolean {
    return this.layout.foreground && !this.layout.reduceMotion;
  }

  aboutToAppear(): void {
    if (this.shouldAnimate) this.pulsed = true;
  }

  @Monitor('layout.foreground', 'layout.reduceMotion')
  onMotionChanged(): void {
    this.pulsed = this.shouldAnimate;
  }

  build() {
    Column({ space: 18 }) {
      ForEach(['first', 'second', 'third'], (key: string) => {
        Row({ space: 12 }) {
          Column().width(28).height(28).borderRadius(this.colors.corner(6)).backgroundColor(this.colors.input)
          Column({ space: 8 }) {
            Column().width('75%').height(16).borderRadius(4).backgroundColor(this.colors.input)
            Column().width('50%').height(12).borderRadius(4).backgroundColor(this.colors.input)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        }.width('100%')
      }, (key: string): string => key)
    }
      .width('100%')
      .padding({ top: 12, bottom: 12 })
      .opacity(this.shouldAnimate && this.pulsed ? 0.5 : 0.92)
      .animation({
        duration: this.shouldAnimate ? XOPC_MOTION_SKELETON_MS : 0,
        curve: Curve.EaseInOut,
        iterations: this.shouldAnimate ? -1 : 1,
        playMode: PlayMode.Alternate,
      })
      .accessibilityText($r('app.string.loading'))
  }
}

@Builder
export function XopcListSkeleton() {
  XopcAnimatedListSkeleton()
}
