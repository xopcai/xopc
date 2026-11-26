import {
  FLOATING_TAB_BAR_HEIGHT_VP,
  FLOATING_TAB_BAR_MARGIN_BOTTOM_VP,
  XopcMobileTab,
} from '../common/mobileTabNavigation';
import { xopcClickEffect } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';

@ComponentV2
export struct XopcFloatingTabBar {
  @Param selectedTab: XopcMobileTab = 'ada';
  @Param personalAgent: XopcPersonalAgentRecord | null = null;
  @Param personalUnread: number = 0;
  @Param pendingAttention: number = 0;
  @Param recordingAvailable: boolean = false;
  @Param recordingActive: boolean = false;
  @Event onSelectTab: (tab: XopcMobileTab) => void = (_tab: XopcMobileTab): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;

  private adaLabel(): string {
    const name = this.personalAgent?.displayName?.trim() ?? '';
    return name || 'Ada';
  }

  private badgeText(count: number): string {
    return count > 99 ? '99+' : count.toString();
  }

  @Builder
  tabBadge(count: number, attention: boolean) {
    if (count > 0) {
      Text(this.badgeText(count))
        .fontSize(10)
        .fontWeight(FontWeight.Medium)
        .fontColor(attention ? this.colors.attentionForeground : this.colors.onAccent)
        .backgroundColor(attention ? this.colors.attentionFill : this.colors.accent)
        .padding({ left: 5, right: 5 })
        .constraintSize({ minWidth: 16, minHeight: 16 })
        .borderRadius(8)
        .textAlign(TextAlign.Center)
        .maxLines(1)
        .offset({ x: 8, y: -4 })
        .accessibilityLevel('no')
    }
  }

  @Builder
  adaTab() {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 2 }) {
        Stack({ alignContent: Alignment.TopEnd }) {
          XopcPersonalAgentAvatar({
            extent: 22,
            compact: true,
            activePage: false,
            agentId: this.personalAgent?.agentId ?? '',
            appearance: this.personalAgent?.appearance ?? 'loopi',
            revision: this.personalAgent?.revision ?? 0,
          })
          this.tabBadge(this.personalUnread, false)
        }.width(28).height(24).alignContent(Alignment.Center)
        Text(this.adaLabel())
          .fontSize(11)
          .fontWeight(this.selectedTab === 'ada' ? FontWeight.Medium : FontWeight.Normal)
          .fontColor(this.selectedTab === 'ada' ? this.colors.accent : this.colors.secondary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%').justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
    }
    .id('floating-tab-ada')
    .layoutWeight(1)
    .constraintSize({ minWidth: 44, minHeight: 48 })
    .height(50)
    .padding({ left: 6, right: 6 })
    .borderRadius(25)
    .backgroundColor(this.selectedTab === 'ada' ? this.colors.accentSoft : Color.Transparent)
    .clickEffect(xopcClickEffect())
    .accessibilitySelected(this.selectedTab === 'ada')
    .accessibilityText(this.adaLabel())
    .onClick((): void => { this.onSelectTab('ada'); })
  }

  @Builder
  iconTab(
    tab: XopcMobileTab,
    label: Resource,
    symbol: Resource,
    badgeCount: number = 0,
    showRecordingDot: boolean = false,
  ) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 2 }) {
        Stack({ alignContent: Alignment.TopEnd }) {
          SymbolGlyph(symbol)
            .fontSize(20)
            .fontColor([this.selectedTab === tab ? this.colors.accent : this.colors.secondary])
            .accessibilityLevel('no')
          if (badgeCount > 0) {
            this.tabBadge(badgeCount, true)
          } else if (showRecordingDot) {
            Circle()
              .width(7)
              .height(7)
              .fill(this.recordingActive ? this.colors.danger : this.colors.accent)
              .offset({ x: 4, y: -2 })
              .accessibilityLevel('no')
          }
        }.width(28).height(24).alignContent(Alignment.Center)
        Text(label)
          .fontSize(11)
          .fontWeight(this.selectedTab === tab ? FontWeight.Medium : FontWeight.Normal)
          .fontColor(this.selectedTab === tab ? this.colors.accent : this.colors.secondary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%').justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
    }
    .id('floating-tab-' + tab)
    .layoutWeight(1)
    .constraintSize({ minWidth: 44, minHeight: 48 })
    .height(50)
    .padding({ left: 6, right: 6 })
    .borderRadius(25)
    .backgroundColor(this.selectedTab === tab ? this.colors.accentSoft : Color.Transparent)
    .clickEffect(xopcClickEffect())
    .accessibilitySelected(this.selectedTab === tab)
    .accessibilityText(label)
    .onClick((): void => { this.onSelectTab(tab); })
  }

  build() {
    Row() {
      Row({ space: 4 }) {
        this.adaTab()
        this.iconTab('workbench', $r('app.string.workbench'), $r('sys.symbol.square_grid_2x2'), this.pendingAttention, false)
        this.iconTab('notes', $r('app.string.notes'), $r('sys.symbol.doc_text'), 0, this.recordingAvailable)
        this.iconTab('library', $r('app.string.library_title'), $r('sys.symbol.doc'), 0, false)
      }
      .id('floating-tab-bar')
      .width('100%')
      .constraintSize({ maxWidth: 420 })
      .height(FLOATING_TAB_BAR_HEIGHT_VP)
      .padding({ left: 6, right: 6 })
      .borderRadius(FLOATING_TAB_BAR_HEIGHT_VP / 2)
      .backgroundColor(this.colors.panel)
      .backgroundBlurStyle(
        this.layout.reduceMotion ? BlurStyle.NONE : BlurStyle.COMPONENT_THICK,
        {
          colorMode: this.colors.light ? ThemeColorMode.LIGHT : ThemeColorMode.DARK,
          adaptiveColor: AdaptiveColor.DEFAULT,
          scale: 1.0,
        },
      )
      .shadow(ShadowStyle.OUTER_DEFAULT_SM)
      .alignItems(VerticalAlign.Center)
    }
    .id('floating-tab-bar-host')
    .width('100%')
    .padding({ left: 16, right: 16, bottom: FLOATING_TAB_BAR_MARGIN_BOTTOM_VP })
    .justifyContent(FlexAlign.Center)
    .hitTestBehavior(HitTestMode.Transparent)
  }
}
