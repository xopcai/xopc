import { xopcClickEffect } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMobileRoute } from '../model/home';
import { layoutState, XopcLayoutState } from '../service/layoutState';

const SIDEBAR_TAP_SLOP_VP = 8;

@ComponentV2
export struct XopcChatSidebar {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Param reveal: number = 1;
  @Param drawerWidth: number = 0;
  @Param interactive: boolean = false;
  @Event onClose: () => void = (): void => {};
  @Event onDismissDrag: (offset: number) => void = (_offset: number): void => {};
  @Event onDismissEnd: (offset: number, velocity: number) => void = (_offset: number, _velocity: number): void => {};
  @Event onNew: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};

  private go(page: string, itemId: string = ''): void {
    this.onNavigate({ page, itemId });
  }

  @Builder
  sectionHeader(label: Resource) {
    Text(label)
      .fontSize(12)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.colors.secondary)
      .width('100%')
      .padding({ left: 10, right: 10, top: 14, bottom: 4 })
  }

  @Builder
  shortcut(label: Resource, icon: Resource, page: string, itemId: string = '') {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Row() {
          SymbolGlyph(icon).fontSize(19).fontColor([this.colors.secondary])
        }.width(28).height(28).justifyContent(FlexAlign.Center).accessibilityLevel('no-hide-descendants')
        Text(label)
          .fontSize(15).fontColor(this.colors.foreground).layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%').constraintSize({ minHeight: 44 }).padding({ left: 10, right: 10 })
    }.id(itemId ? 'chat-sidebar-' + page + '-' + itemId : 'chat-sidebar-' + page)
      .width('100%').padding(0)
      .borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12))
      .backgroundColor(Color.Transparent)
      .clickEffect(xopcClickEffect())
      .onClick((): void => {
        this.go(page, itemId);
      }, SIDEBAR_TAP_SLOP_VP)
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
      Column().width('100%').height('100%').backgroundColor(this.colors.scrim)
        .opacity(this.reveal)
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
        .accessibilityLevel('no').onClick((): void => { this.onClose(); })
      Column() {
        Row({ space: 8 }) {
          Image($r('app.media.brand_logo')).width(27).height(27).accessibilityLevel('no')
          Text('xopc').fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).layoutWeight(1)
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(18).fontColor([this.colors.foreground])
          }.id('chat-sidebar-close').width(44).height(44).padding(0).backgroundColor(this.colors.input)
            .clickEffect(xopcClickEffect())
            .accessibilityText($r('app.string.chat_close_drawer'))
            .onClick((): void => { this.onClose(); })
        }.width('100%').padding({ left: 16, right: 14, bottom: 8 })
        List({ space: 2 }) {
          ListItem() {
            Column({ space: 6 }) {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 10 }) {
                  SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(18).fontColor([this.colors.secondary])
                  Text($r('app.string.sessions_search')).fontSize(14).fontColor(this.colors.secondary).layoutWeight(1)
                }.width('100%').height(44).padding({ left: 12, right: 12 })
              }.id('chat-sidebar-search').width('100%').padding(0).backgroundColor(this.colors.input)
                .borderRadius(this.colors.corner(22)).clipShape(this.colors.cornerClip(22))
                .onClick((): void => { this.go('sessions-search'); }, SIDEBAR_TAP_SLOP_VP)
            }.width('100%').padding({ bottom: 4 })
          }
          ListItem() { this.sectionHeader($r('app.string.capability_title')) }
          ListItem() { this.shortcut($r('app.string.capability_plugins'), $r('sys.symbol.square_grid_2x2'), 'capabilities', 'plugins') }
          ListItem() { this.shortcut($r('app.string.capability_skills'), $r('sys.symbol.lightbulb'), 'capabilities', 'skills') }
          ListItem() { this.shortcut($r('app.string.capability_connections'), $r('sys.symbol.link'), 'capabilities', 'connections') }
          ListItem() { this.shortcut($r('app.string.device_connection_devices'), $r('sys.symbol.phone_1'), 'capabilities', 'devices') }
          ListItem() { this.shortcut($r('app.string.capability_agents'), $r('sys.symbol.person'), 'capabilities', 'agents') }
          ListItem() { this.shortcut($r('app.string.capability_channels'), $r('sys.symbol.ellipsis_bubble'), 'capabilities', 'channels') }
          ListItem() { this.sectionHeader($r('app.string.sidebar_section_work_tools')) }
          ListItem() { this.shortcut($r('app.string.automations'), $r('sys.symbol.clock'), 'automations') }
          ListItem() { this.shortcut($r('app.string.sidebar_share_center'), $r('sys.symbol.share'), 'sharing') }
          ListItem() { this.sectionHeader($r('app.string.sidebar_section_mine')) }
          ListItem() { this.shortcut($r('app.string.about_you'), $r('sys.symbol.person'), 'about-you') }
          ListItem() { this.shortcut($r('app.string.sidebar_goals'), $r('sys.symbol.flag'), 'personal-goals') }
        }.id('chat-sidebar-list').layoutWeight(1).width('100%').scrollBar(BarState.Off)
        Row() {
          Button() {
            Row({ space: 8 }) {
              SymbolGlyph($r('sys.symbol.square_and_pencil')).fontSize(18).fontColor([this.colors.chat.onAction])
              Text($r('app.string.new_chat')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.chat.onAction)
            }
          }.id('chat-sidebar-new').constraintSize({ minHeight: 46, minWidth: 142 })
            .padding({ left: 16, right: 16 }).backgroundColor(this.colors.chat.action)
            .onClick((): void => { this.onNew(); })
          Blank().layoutWeight(1)
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.gearshape')).fontSize(22).fontColor([this.colors.foreground])
          }.id('chat-sidebar-profile').width(46).height(46).padding(0).backgroundColor(this.colors.input)
            .accessibilityText($r('app.string.settings')).onClick((): void => { this.go('settings'); })
        }.width('100%').padding({ top: 8, bottom: 8 })
      }.id('chat-sidebar').width('84%').constraintSize({ maxWidth: 350 }).height('100%')
        .padding({ left: 14, right: 14, top: this.getUIContext().px2vp(this.layout.systemTopInsetPx) + 8 })
        .alignItems(HorizontalAlign.Start).backgroundColor(this.colors.panel)
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
        .translate({ x: (this.reveal - 1) * this.drawerWidth })
    }.width('100%').height('100%')
      .priorityGesture(PanGesture({ direction: PanDirection.Left, distance: SIDEBAR_TAP_SLOP_VP })
        .onActionUpdate((event: GestureEvent): void => { this.onDismissDrag(event.offsetX); })
        .onActionEnd((event: GestureEvent): void => { this.onDismissEnd(event.offsetX, event.velocityX); })
        .onActionCancel((): void => { this.onDismissEnd(0, 0); }))
      .hitTestBehavior(this.interactive ? HitTestMode.Default : HitTestMode.None)
      .accessibilityLevel(this.interactive ? 'auto' : 'no-hide-descendants')
  }
}
