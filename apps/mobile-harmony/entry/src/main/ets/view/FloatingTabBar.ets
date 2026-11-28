import {
  FLOATING_TAB_BAR_HEIGHT_VP,
  FLOATING_TAB_BAR_MARGIN_BOTTOM_VP,
  FLOATING_TAB_BAR_TOP_PADDING_VP,
  XopcMobileTab,
} from '../common/mobileTabNavigation';
import { xopcClickEffect } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
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
      Column({ space: 1 }) {
        Stack({ alignContent: Alignment.TopEnd }) {
          XopcPersonalAgentAvatar({
            extent: 20,
            compact: true,
            activePage: false,
            agentId: this.personalAgent?.agentId ?? '',
            appearance: this.personalAgent?.appearance ?? 'loopi',
            revision: this.personalAgent?.revision ?? 0,
          })
          this.tabBadge(this.personalUnread, false)
        }.width(26).height(21).alignContent(Alignment.Center)
        Text(this.adaLabel())
          .fontSize(10)
          .fontWeight(this.selectedTab === 'ada' ? FontWeight.Medium : FontWeight.Normal)
          .fontColor(this.selectedTab === 'ada' ? this.colors.accent : this.colors.secondary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%').justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
    }
    .id('floating-tab-ada')
    .layoutWeight(1)
    .constraintSize({ minWidth: 44, minHeight: 44 })
    .height(46)
    .padding({ left: 2, right: 2 })
    .borderRadius(23)
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
      Column({ space: 1 }) {
        Stack({ alignContent: Alignment.TopEnd }) {
          SymbolGlyph(symbol)
            .fontSize(18)
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
        }.width(26).height(21).alignContent(Alignment.Center)
        Text(label)
          .fontSize(10)
          .fontWeight(this.selectedTab === tab ? FontWeight.Medium : FontWeight.Normal)
          .fontColor(this.selectedTab === tab ? this.colors.accent : this.colors.secondary)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%').justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
    }
    .id('floating-tab-' + tab)
    .layoutWeight(1)
    .constraintSize({ minWidth: 44, minHeight: 44 })
    .height(46)
    .padding({ left: 2, right: 2 })
    .borderRadius(23)
    .backgroundColor(this.selectedTab === tab ? this.colors.accentSoft : Color.Transparent)
    .clickEffect(xopcClickEffect())
    .accessibilitySelected(this.selectedTab === tab)
    .accessibilityText(label)
    .onClick((): void => { this.onSelectTab(tab); })
  }

  build() {
    Row() {
      Row({ space: 2 }) {
        this.adaTab()
        this.iconTab('conversations', $r('app.string.sessions'), $r('sys.symbol.ellipsis_bubble'), 0, false)
        this.iconTab('workbench', $r('app.string.workbench'), $r('sys.symbol.square_grid_2x2'), this.pendingAttention, false)
        this.iconTab('notes', $r('app.string.notes'), $r('sys.symbol.doc_text'), 0, this.recordingAvailable)
        this.iconTab('library', $r('app.string.library_title'), $r('sys.symbol.doc'), 0, false)
      }
      .id('floating-tab-bar')
      .width('100%')
      .constraintSize({ maxWidth: 460 })
      .height(FLOATING_TAB_BAR_HEIGHT_VP)
      .padding({ left: 4, right: 4 })
      .borderRadius(FLOATING_TAB_BAR_HEIGHT_VP / 2)
      .backgroundColor(this.colors.panel)
      .alignItems(VerticalAlign.Center)
    }
    .id('floating-tab-bar-host')
    .width('100%')
    .padding({
      left: 12,
      right: 12,
      top: FLOATING_TAB_BAR_TOP_PADDING_VP,
      bottom: FLOATING_TAB_BAR_MARGIN_BOTTOM_VP,
    })
    .backgroundColor(this.colors.surface)
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
    .justifyContent(FlexAlign.Center)
  }
}
