import { LengthMetrics, SymbolGlyphModifier } from '@kit.ArkUI';

import { agentDisplayName } from '../common/agentPresentation';
import { xopcConfirmDialog, xopcSheetOptions } from '../common/dialogActions';
import { xopcClickEffect } from '../common/motionTokens';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
import { XopcChatAgent, XopcSessionItem } from '../model/chat';
import { XopcMobileRoute } from '../model/home';
import { XopcPersonalAgentRecord } from '../model/personalAgent';
import { XopcChatRepository } from '../repository/chatRepository';
import { gatewaySession } from '../service/gatewaySession';
import { layoutState, XopcLayoutState } from '../service/layoutState';
import { XopcSessionsViewModel } from '../viewmodel/sessionsViewModel';
import { XopcListSkeleton, XopcPaginationFooter } from './MobileComponents';
import { XopcPersonalAgentAvatar } from './PersonalAgentAvatar';
import { XopcSessionRenameForm } from './SessionRenameForm';

const SIDEBAR_TAP_SLOP_VP = 8;
type XopcSidebarSessionAction = '' | 'rename' | 'pin' | 'select' | 'delete';

@ComponentV2
export struct XopcChatSidebar {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local layout: XopcLayoutState = layoutState;
  @Local sessions: XopcSessionsViewModel = new XopcSessionsViewModel(true);
  @Local agents: Map<string, XopcChatAgent> = new Map<string, XopcChatAgent>();
  @Local renameOpen: boolean = false;
  @Local renameText: string = '';
  @Param personalAgent: XopcPersonalAgentRecord | null = null;
  @Param personalBusy: boolean = false;
  @Param currentId: string = '';
  @Param pendingAttention: number = 0;
  @Param personalUnread: number = 0;
  @Param reveal: number = 1;
  @Param drawerWidth: number = 0;
  @Param interactive: boolean = false;
  @Event onClose: () => void = (): void => {};
  @Event onDismissDrag: (offset: number) => void = (_offset: number): void => {};
  @Event onDismissEnd: (offset: number, velocity: number) => void = (_offset: number, _velocity: number): void => {};
  @Event onPersonal: () => void = (): void => {};
  @Event onNew: () => void = (): void => {};
  @Event onConversation: (id: string) => void = (_id: string): void => {};
  @Event onDelete: (id: string) => void = (_id: string): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  private renameId: string = '';
  private menuTargetId: string = '';
  private pendingAction: XopcSidebarSessionAction = '';
  private agentLoadRevision: number = 0;

  @Computed get recentConversations(): XopcSessionItem[] {
    return this.sessions.items.filter((item: XopcSessionItem): boolean =>
      item.key !== this.personalAgent?.conversationId && item.status !== 'archived' && item.messageCount > 0)
      .sort((first: XopcSessionItem, second: XopcSessionItem): number =>
        Number(second.status === 'pinned') - Number(first.status === 'pinned')
          || (Date.parse(second.updatedAt || '') || 0) - (Date.parse(first.updatedAt || '') || 0));
  }

  aboutToAppear(): void {
    void this.sessions.load();
    void this.loadAgents();
  }

  aboutToDisappear(): void {
    this.agentLoadRevision++;
    this.sessions.dispose();
  }

  private async loadAgents(): Promise<void> {
    const revision = ++this.agentLoadRevision;
    const connection = gatewaySession.connectionRevision();
    try {
      const catalog = await new XopcChatRepository().agents();
      if (revision !== this.agentLoadRevision || connection !== gatewaySession.connectionRevision()) return;
      const agents = new Map<string, XopcChatAgent>();
      catalog.agents.forEach((agent: XopcChatAgent): void => { agents.set(agent.id, agent); });
      this.agents = agents;
    } catch (_) { /* Conversations can still open if the Agent catalog is unavailable. */ }
  }

  private agentName(agentId: string): string {
    if (!agentId) return '';
    const label = agentDisplayName(this.agents.get(agentId) ?? { id: agentId });
    return typeof label === 'string' ? label : this.getUIContext().getHostContext()?.resourceManager.getStringSync(label.id) ?? agentId;
  }

  private avatarAppearance(agentId: string): string {
    const reference = this.agents.get(agentId)?.avatar ?? '';
    if (!reference.startsWith('xopc:loopi:')) return 'configured';
    return reference.endsWith(':care') ? 'loopi-care' : 'loopi';
  }

  private finishSessionMenu(): void {
    const id = this.menuTargetId;
    const action = this.pendingAction;
    this.menuTargetId = '';
    this.pendingAction = '';
    if (!action || !this.interactive || this.sessions.busy) return;
    const item = this.recentConversations.find((row: XopcSessionItem): boolean => row.key === id);
    if (!item) return;
    if (action === 'rename') {
      this.sessions.actionError = '';
      this.renameId = id;
      this.renameText = item.name || item.displayName || item.title || '';
      this.renameOpen = true;
    } else if (action === 'pin') {
      void this.sessions.act([item], item.status === 'pinned' ? 'unpin' : 'pin');
    } else if (action === 'select') {
      this.sessions.select(id);
    } else {
      this.confirmDelete([item]);
    }
  }

  private async confirmDelete(items: XopcSessionItem[]): Promise<void> {
    if (!items.length || this.sessions.busy) return;
    const confirmed = await xopcConfirmDialog(this.getUIContext(), {
      title: $r('app.string.delete'),
      message: items.length === 1 ? $r('app.string.sessions_delete_one_confirm')
        : $r('app.string.sessions_delete_confirm', items.length),
      confirmLabel: $r('app.string.delete'),
      destructive: true,
    });
    if (confirmed) void this.sessions.act(items, 'delete', this.onDelete);
  }

  private go(page: string): void { this.onNavigate({ page, itemId: '' }); }

  @Builder
  sessionMenu(pinned: boolean) {
    Menu() {
      MenuItem({ content: $r('app.string.sessions_rename'), symbolStartIcon: new SymbolGlyphModifier($r('sys.symbol.pencil_line')) })
        .id('chat-sidebar-menu-rename').onClick((): void => { this.pendingAction = 'rename'; })
      MenuItem({ content: pinned ? $r('app.string.unpin') : $r('app.string.pin'),
        symbolStartIcon: new SymbolGlyphModifier($r('sys.symbol.pin')) })
        .id('chat-sidebar-menu-pin').onClick((): void => { this.pendingAction = 'pin'; })
      MenuItem({ content: $r('app.string.sessions_multi_select'), symbolStartIcon: new SymbolGlyphModifier($r('sys.symbol.list_bullet')) })
        .id('chat-sidebar-menu-select').onClick((): void => { this.pendingAction = 'select'; })
      MenuItem({ content: $r('app.string.delete'),
        symbolStartIcon: new SymbolGlyphModifier($r('sys.symbol.trash')).fontColor([this.colors.danger]) })
        .id('chat-sidebar-menu-delete').contentFontColor(this.colors.danger)
        .onClick((): void => { this.pendingAction = 'delete'; })
    }.id('chat-sidebar-session-menu').width(Math.min(220, this.drawerWidth - 28))
      .menuItemDivider({ strokeWidth: LengthMetrics.vp(1), color: this.colors.border })
  }

  @Builder
  renameSheet() {
    XopcSessionRenameForm({ name: this.renameText, busy: this.sessions.busy, error: this.sessions.actionError,
      onChange: (name: string): void => { this.renameText = name; },
      onCancel: (): void => { this.renameOpen = false; },
      onSave: async (): Promise<void> => {
        if (await this.sessions.rename(this.renameId, this.renameText)) this.renameOpen = false;
      } })
  }

  @Builder
  shortcut(label: Resource, icon: Resource | undefined, page: string, count: number = 0) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Row() {
          if (page === 'personal') {
            XopcPersonalAgentAvatar({ extent: 22, compact: true, activePage: false,
              agentId: this.personalAgent?.agentId ?? '', appearance: this.personalAgent?.appearance ?? 'loopi',
              revision: this.personalAgent?.revision ?? 0 })
          } else if (icon) {
            SymbolGlyph(icon).fontSize(19).fontColor([this.colors.secondary])
          }
        }.width(28).height(28).justifyContent(FlexAlign.Center).accessibilityLevel('no-hide-descendants')
        Text(page === 'personal' ? this.personalAgent?.displayName || label : label)
          .fontSize(15).fontColor(this.colors.foreground).layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (page === 'personal' && this.personalUnread > 0) {
          Text(this.personalUnread > 99 ? '99+' : this.personalUnread.toString()).fontSize(12)
            .fontColor(this.colors.accent)
            .padding({ left: 8, right: 8 }).height(24).borderRadius(12)
            .backgroundColor(this.colors.accentSoft)
            .accessibilityText($r('app.string.personal_unread_messages', this.personalUnread))
        } else if (count > 0) {
          Text(count > 99 ? '99+' : count.toString()).fontSize(12)
            .fontColor(this.colors.attentionForeground)
            .padding({ left: 8, right: 8 }).height(24).borderRadius(12)
            .backgroundColor(this.colors.attentionFill)
        }
      }.width('100%').constraintSize({ minHeight: 44 }).padding({ left: 10, right: 10 })
    }.id('chat-sidebar-' + page).width('100%').padding(0).borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12))
      .backgroundColor(page === 'personal' && this.currentId && this.personalAgent?.conversationId === this.currentId
        ? this.colors.active : Color.Transparent)
      .enabled(!this.sessions.selecting && !this.sessions.busy && (page !== 'personal' || !this.personalBusy)).onClick((): void => {
        if (page === 'personal') this.onPersonal();
        else this.go(page);
      }, SIDEBAR_TAP_SLOP_VP)
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
      Column().width('100%').height('100%').backgroundColor(this.colors.scrim)
        .opacity(this.reveal)
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
        .accessibilityLevel('no').onClick((): void => { if (!this.sessions.busy) this.onClose(); })
      Column() {
        Row({ space: 8 }) {
          if (this.sessions.selecting) {
            Text($r('app.string.sessions_selected', this.sessions.selected.length)).fontSize(17)
              .fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1)
          } else {
            Image($r('app.media.brand_logo')).width(27).height(27).accessibilityLevel('no')
            Text('xopc').fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).layoutWeight(1)
          }
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(18).fontColor([this.colors.foreground])
          }.id('chat-sidebar-close').width(44).height(44).padding(0).backgroundColor(this.colors.input)
            .clickEffect(xopcClickEffect())
            .enabled(!this.sessions.busy)
            .accessibilityText(this.sessions.selecting ? $r('app.string.cancel') : $r('app.string.chat_close_drawer'))
            .onClick((): void => {
              if (this.sessions.selecting) this.sessions.cancelSelection();
              else this.onClose();
            })
        }.width('100%').padding({ left: 16, right: 14, bottom: 8 })
        if (this.sessions.actionError) {
          Text(userErrorMessage(this.sessions.actionError, 'save')).fontSize(13)
            .fontColor(this.colors.danger).width('100%').padding({ left: 10, right: 10, bottom: 8 })
        }
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
                .enabled(!this.sessions.selecting && !this.sessions.busy)
                .onClick((): void => { this.go('sessions-search'); }, SIDEBAR_TAP_SLOP_VP)
              this.shortcut($r('app.string.chat_personal_agent'), undefined, 'personal')
            }.width('100%').padding({ bottom: 4 })
          }
          ListItem() {
            this.shortcut($r('app.string.workbench'), $r('sys.symbol.square_grid_2x2'), 'workbench', this.pendingAttention)
          }
          ListItem() {
            this.shortcut($r('app.string.automations'), $r('sys.symbol.clock'), 'automations')
          }
          ListItem() {
            this.shortcut($r('app.string.notes'), $r('sys.symbol.doc_text'), 'notes-list')
          }
          ListItem() {
            this.shortcut($r('app.string.library_title'), $r('sys.symbol.doc'), 'library')
          }
          ListItem() {
            this.shortcut($r('app.string.capability_title'), $r('sys.symbol.square_grid_2x2'), 'capabilities')
          }
          if (this.sessions.loading && !this.sessions.hasSnapshot) {
            ListItem() { XopcListSkeleton() }
          } else if (this.sessions.error && !this.sessions.hasSnapshot) {
            ListItem() {
              Column() {
                Text(userErrorMessage(this.sessions.error, 'collection')).fontSize(13).fontColor(this.colors.secondary)
                  .width('100%').padding({ left: 10, right: 10, top: 6 })
                Button($r('app.string.retry')).height(44).onClick((): void => { void this.sessions.load(); })
              }.width('100%')
            }
          }
          Repeat<XopcSessionItem>(this.recentConversations).each((row: RepeatItem<XopcSessionItem>) => {
            ListItem() {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 8 }) {
                  if (this.sessions.selecting) {
                    SymbolGlyph(this.sessions.selected.includes(row.item.key) ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.circle'))
                      .fontSize(20).fontColor([this.sessions.selected.includes(row.item.key) ? this.colors.accent : this.colors.tertiary])
                      .accessibilityLevel('no')
                  }
                  XopcPersonalAgentAvatar({ agentId: row.item.agentId ?? '',
                    avatarReference: this.agents.get(row.item.agentId ?? '')?.avatar ?? '',
                    appearance: this.avatarAppearance(row.item.agentId ?? ''), fallbackLabel: this.agentName(row.item.agentId ?? ''),
                    resolveUnconfigured: false, extent: 22, activePage: false, compact: true })
                  Text(row.item.displayName || row.item.name || row.item.title || $r('app.string.untitled')).fontSize(15)
                    .fontWeight(row.item.key === this.currentId ? FontWeight.Medium : FontWeight.Normal)
                    .fontColor(this.colors.light && row.item.key === this.currentId ? this.colors.accent : this.colors.foreground)
                    .layoutWeight(1).maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis }).textAlign(TextAlign.Start)
                  if (row.item.status === 'pinned') {
                    SymbolGlyph($r('sys.symbol.pin')).fontSize(14).fontColor([this.colors.secondary])
                      .accessibilityText($r('app.string.sessions_pinned'))
                  }
                }.width('100%')
              }.id('chat-sidebar-session-' + row.item.key).width('100%').constraintSize({ minHeight: 44 })
                .padding({ left: 10, right: 10 }).borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12))
                .backgroundColor((this.sessions.selecting ? this.sessions.selected.includes(row.item.key)
                  : row.item.key === this.currentId) ? this.colors.active : Color.Transparent)
                .accessibilityDescription(this.agentName(row.item.agentId ?? ''))
                .accessibilitySelected(this.sessions.selecting ? this.sessions.selected.includes(row.item.key) : row.item.key === this.currentId)
                .enabled(!this.sessions.busy)
                .onClick((): void => {
                  if (this.sessions.selecting) this.sessions.select(row.item.key);
                  else this.onConversation(row.item.key);
                }, SIDEBAR_TAP_SLOP_VP)
                .bindContextMenu(this.sessions.selecting ? undefined : this.sessionMenu(row.item.status === 'pinned'), ResponseType.LongPress, {
                  placement: Placement.TopRight,
                  hapticFeedbackMode: HapticFeedbackMode.ENABLED,
                  aboutToAppear: (): void => { this.menuTargetId = row.item.key; this.pendingAction = ''; },
                  onDisappear: (): void => { this.finishSessionMenu(); }
                })
            }
          }).key((item: XopcSessionItem): string => item.key).virtualScroll({ totalCount: this.recentConversations.length })
          if (this.sessions.hasMore || (this.sessions.hasSnapshot && this.sessions.error)) {
            ListItem() {
              XopcPaginationFooter({ loadingPage: this.sessions.loading || this.sessions.loadingMore || this.sessions.busy,
                failedPage: !!this.sessions.error, onLoad: (): void => { void this.sessions.load(this.sessions.hasMore); } })
            }
          }
        }.id('chat-sidebar-list').layoutWeight(1).width('100%').cachedCount(4).scrollBar(BarState.Off)
        if (this.sessions.selecting) {
          Button($r('app.string.delete')).id('chat-sidebar-batch-delete').width('100%').height(46)
            .backgroundColor(this.colors.input).fontColor(this.colors.danger).margin({ top: 8, bottom: 8 })
            .enabled(!this.sessions.busy && this.sessions.selected.length > 0)
            .onClick((): void => { this.confirmDelete(this.sessions.selectedItems()); })
        } else {
          Row() {
            Button() {
              Row({ space: 8 }) {
                SymbolGlyph($r('sys.symbol.square_and_pencil')).fontSize(18).fontColor([this.colors.chat.onAction])
                Text($r('app.string.new_chat')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.chat.onAction)
              }
            }.id('chat-sidebar-new').constraintSize({ minHeight: 46, minWidth: 142 })
              .padding({ left: 16, right: 16 }).backgroundColor(this.colors.chat.action)
              .enabled(!this.sessions.busy)
              .onClick((): void => { this.onNew(); })
            Blank().layoutWeight(1)
            Button({ type: ButtonType.Circle }) {
              SymbolGlyph($r('sys.symbol.gearshape')).fontSize(22).fontColor([this.colors.foreground])
            }.id('chat-sidebar-profile').width(46).height(46).padding(0).backgroundColor(this.colors.input)
              .enabled(!this.sessions.busy)
              .accessibilityText($r('app.string.settings')).onClick((): void => { this.go('settings'); })
          }.width('100%').padding({ top: 8, bottom: 8 })
        }
        Column().width('100%').height(0)
          .bindSheet($$this.renameOpen, this.renameSheet, xopcSheetOptions('compact'))
      }.id('chat-sidebar').width('84%').constraintSize({ maxWidth: 350 }).height('100%')
        .padding({ left: 14, right: 14, top: this.getUIContext().px2vp(this.layout.systemTopInsetPx) + 8 })
        .alignItems(HorizontalAlign.Start).backgroundColor(this.colors.panel)
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
        .translate({ x: (this.reveal - 1) * this.drawerWidth })
    }.width('100%').height('100%')
      .priorityGesture(PanGesture({ direction: PanDirection.Left, distance: SIDEBAR_TAP_SLOP_VP })
        .onActionUpdate((event: GestureEvent): void => { if (!this.sessions.busy) this.onDismissDrag(event.offsetX); })
        .onActionEnd((event: GestureEvent): void => {
          if (this.sessions.busy) this.onDismissEnd(0, 0);
          else this.onDismissEnd(event.offsetX, event.velocityX);
        })
        .onActionCancel((): void => { this.onDismissEnd(0, 0); }))
      .hitTestBehavior(this.interactive ? HitTestMode.Default : HitTestMode.None)
      .accessibilityLevel(this.interactive ? 'auto' : 'no-hide-descendants')
  }
}
