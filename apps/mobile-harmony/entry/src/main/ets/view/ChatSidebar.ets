import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
import { XopcSessionItem } from '../model/chat';
import { XopcMobileRoute } from '../model/home';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { XopcChatRepository } from '../repository/chatRepository';
import { gatewaySession } from '../service/gatewaySession';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcListSkeleton } from './MobileComponents';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';

@ComponentV2
export struct XopcChatSidebar {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local recent: XopcSessionItem[] = [];
  @Local loading: boolean = true;
  @Local hasSnapshot: boolean = false;
  @Local loadError: string = '';
  @Param personalAgent: XopcPersonalAgentRecord | null = null;
  @Param personalBusy: boolean = false;
  @Param currentId: string = '';
  @Param pendingAttention: number = 0;
  @Param reveal: number = 1;
  @Param drawerWidth: number = 0;
  @Param interactive: boolean = false;
  @Event onClose: () => void = (): void => {};
  @Event onPersonal: () => void = (): void => {};
  @Event onNew: () => void = (): void => {};
  @Event onConversation: (id: string) => void = (_id: string): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  private repository: XopcChatRepository = new XopcChatRepository();
  private disposed: boolean = false;

  @Computed get recentConversations(): XopcSessionItem[] {
    return this.recent.filter((item: XopcSessionItem): boolean =>
      item.key !== this.personalAgent?.conversationId && item.status !== 'archived').slice(0, 6);
  }

  aboutToAppear(): void {
    const cached = this.repository.cachedRecent();
    if (cached) { this.recent = cached.items; this.hasSnapshot = true; }
    void this.loadRecent();
  }
  aboutToDisappear(): void { this.disposed = true; }

  private async loadRecent(): Promise<void> {
    const connection = gatewaySession.connectionRevision();
    this.loading = true;
    this.loadError = '';
    try {
      if (!this.hasSnapshot) {
        try {
          const cached = await this.repository.restoreRecent();
          if (!this.disposed && cached) { this.recent = cached.items; this.hasSnapshot = true; }
        } catch (_) { /* Account changed while loading the previous snapshot. */ }
      }
      const page = await this.repository.refreshRecent();
      gatewaySession.assertConnection(connection);
      if (!this.disposed) { this.recent = page.items; this.hasSnapshot = true; }
    } catch (error) {
      if (!this.disposed && gatewaySession.connectionRevision() === connection) this.loadError = (error as Error).message;
    } finally { if (!this.disposed) this.loading = false; }
  }

  private go(page: string): void { this.onNavigate({ page, itemId: '' }); }

  @Builder
  shortcut(label: Resource, icon: Resource, page: string, count: number = 0) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph(icon).fontSize(19).fontColor([this.colors.secondary]).width(28)
        Text(label).fontSize(15).fontColor(this.colors.foreground).layoutWeight(1)
        if (count > 0) {
          Text(count > 99 ? '99+' : count.toString()).fontSize(12)
            .fontColor(this.colors.attentionForeground)
            .padding({ left: 8, right: 8 }).height(24).borderRadius(12)
            .backgroundColor(this.colors.attentionFill)
        }
      }.width('100%').constraintSize({ minHeight: 44 }).padding({ left: 10, right: 10 })
    }.id('chat-sidebar-' + page).width('100%').padding(0).backgroundColor(Color.Transparent)
      .onClick((): void => { this.go(page); })
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
      Column().width('100%').height('100%').backgroundColor('#66000000')
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
            .accessibilityText($r('app.string.chat_close_drawer')).onClick((): void => { this.onClose(); })
        }.width('100%').padding({ left: 16, right: 14, bottom: 8 })
        Button({ type: ButtonType.Normal }) {
          Row({ space: 10 }) {
            SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(18).fontColor([this.colors.secondary])
            Text($r('app.string.sessions_search')).fontSize(14).fontColor(this.colors.secondary).layoutWeight(1)
          }.width('100%').height(44).padding({ left: 12, right: 12 })
        }.id('chat-sidebar-search').width('100%').padding(0)
          .backgroundColor(this.colors.input)
          .borderRadius(this.colors.corner(22))
          .onClick((): void => { this.go('sessions-search'); })
        Scroll() {
          Column({ space: 2 }) {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 10 }) {
                XopcPersonalAgentAvatar({ extent: 42, compact: true, activePage: !this.personalBusy,
                  agentId: this.personalAgent?.agentId ?? '', appearance: this.personalAgent?.appearance ?? 'loopi',
                  revision: this.personalAgent?.revision ?? 0 })
                Column({ space: 3 }) {
                  Text(this.personalAgent?.displayName || $r('app.string.chat_personal_agent')).fontSize(17)
                    .fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (this.personalAgent?.displayName) {
                    Text($r('app.string.chat_personal_agent')).fontSize(12).fontColor(this.colors.secondary).width('100%')
                  }
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.secondary])
              }.width('100%').constraintSize({ minHeight: 62 }).padding({ left: 8, right: 10, top: 7, bottom: 7 })
            }.id('chat-sidebar-personal').width('100%').padding(0).borderRadius(this.colors.corner(16))
              .backgroundColor(this.personalAgent?.conversationId === this.currentId ? this.colors.active : this.colors.panel)
              .enabled(!this.personalBusy).onClick((): void => { this.onPersonal(); })
            this.shortcut($r('app.string.progress'), $r('sys.symbol.checkmark_circle'), 'progress', this.pendingAttention)
            this.shortcut($r('app.string.projects'), $r('sys.symbol.folder'), 'projects')
            this.shortcut($r('app.string.automations'), $r('sys.symbol.clock'), 'automations')
            this.shortcut($r('app.string.library_title'), $r('sys.symbol.doc'), 'library')
            this.shortcut($r('app.string.capability_title'), $r('sys.symbol.square_grid_2x2'), 'capabilities')
            Text($r('app.string.chat_recent_conversations')).fontSize(13).fontColor(this.colors.secondary)
              .width('100%').padding({ left: 10, top: 14, bottom: 4 })
            if (this.loading && !this.hasSnapshot) {
              XopcListSkeleton()
            } else if (this.loadError && !this.hasSnapshot) {
              Text(userErrorMessage(this.loadError, 'collection')).fontSize(13).fontColor(this.colors.secondary)
                .width('100%').padding({ left: 10, right: 10, top: 6 })
              Button($r('app.string.retry')).height(44).onClick((): void => { void this.loadRecent(); })
            } else {
              ForEach(this.recentConversations, (item: XopcSessionItem) => {
                Button({ type: ButtonType.Normal }) {
                  Text(item.displayName || item.name || item.title || $r('app.string.untitled')).fontSize(15)
                    .fontWeight(item.key === this.currentId ? FontWeight.Medium : FontWeight.Normal)
                    .fontColor(this.colors.light && item.key === this.currentId ? this.colors.accent : this.colors.foreground)
                    .width('100%').maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis }).textAlign(TextAlign.Start)
                }.id('chat-sidebar-session-' + item.key).width('100%').constraintSize({ minHeight: 44 })
                  .padding({ left: 10, right: 10 }).borderRadius(this.colors.corner(12))
                  .backgroundColor(item.key === this.currentId ? this.colors.active : Color.Transparent)
                  .accessibilitySelected(item.key === this.currentId).onClick((): void => { this.onConversation(item.key); })
              }, (item: XopcSessionItem): string => item.key + ':' + item.updatedAt)
            }
            this.shortcut($r('app.string.history'), $r('sys.symbol.list_bullet'), 'sessions')
          }.width('100%').padding({ top: 12, bottom: 8 }).alignItems(HorizontalAlign.Start)
        }.layoutWeight(1).width('100%').align(Alignment.TopStart).scrollBar(BarState.Off)
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
      .hitTestBehavior(this.interactive ? HitTestMode.Default : HitTestMode.None)
      .accessibilityLevel(this.interactive ? 'auto' : 'no-hide-descendants')
  }
}
