import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatDrawerViewModel } from '../viewmodel/chatDrawerViewModel';
import { XopcSessionGroup, XopcSessionItem } from '../model/chat';
import { XopcListSkeleton } from './MobileComponents';
import { layoutState } from '../service/layoutState';

@ComponentV2
export struct XopcChatDrawer {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param currentId: string = '';
  @Event onClose: () => void = (): void => {};
  @Event onSession: (id: string) => void = (_id: string): void => {};
  @Event onSearch: () => void = (): void => {};
  @Event onNewChat: () => void = (): void => {};
  @Local drawer: XopcChatDrawerViewModel = new XopcChatDrawerViewModel();
  @Local actionItem?: XopcSessionItem;
  aboutToAppear(): void { this.drawer.open(); }
  aboutToDisappear(): void { this.drawer.dispose(); }

  private text(resource: Resource): string {
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(resource.id) ?? '';
  }

  private async performAction(item: XopcSessionItem, action: string): Promise<void> {
    if (!await this.drawer.action(item, action)) return;
    if (item.key === this.currentId && (action === 'archive' || action === 'delete')) {
      this.onClose(); this.onNewChat();
    }
  }

  private confirmDelete(item: XopcSessionItem): void {
    this.getUIContext().showAlertDialog({
      title: $r('app.string.delete'), message: $r('app.string.sessions_delete_confirm', 1),
      primaryButton: { value: $r('app.string.cancel'), action: (): void => {} },
      secondaryButton: { value: $r('app.string.delete'), fontColor: this.colors.danger,
        action: (): void => { this.performAction(item, 'delete'); } }
    });
  }

  private menu(item: XopcSessionItem): void {
    if (this.drawer.busy) return;
    this.actionItem = item;
  }

  private closeMenu(): void { this.actionItem = undefined; }

  private chooseAction(item: XopcSessionItem, action: string): void {
    this.closeMenu();
    if (action === 'delete') this.confirmDelete(item);
    else this.performAction(item, action);
  }

  private groupLabel(value: string): ResourceStr {
    switch (value) {
      case 'today': return $r('app.string.chat_today');
      case 'yesterday': return $r('app.string.chat_yesterday');
      case 'this_week': return $r('app.string.chat_this_week');
      case 'last_week': return $r('app.string.chat_last_week');
      case 'this_month': return $r('app.string.chat_this_month');
      case 'earlier': return $r('app.string.chat_earlier');
      default: return value;
    }
  }

  build() {
    Stack({ alignContent: Alignment.Start }) {
      Button({ type: ButtonType.Normal }) {}.id('chat-drawer-scrim').width('100%').height('100%')
        .backgroundColor('#66000000').accessibilityText($r('app.string.chat_close_drawer')).onClick((): void => { this.onClose(); })
      Column() {
        Row() {
          Button() { SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(23).fontColor([this.colors.foreground]) }
            .id('chat-drawer-collapse').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
            .fontColor(this.colors.foreground).accessibilityText($r('app.string.chat_close_drawer')).onClick((): void => { this.onClose(); })
          Blank().layoutWeight(1)
          Button() { SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(22).fontColor([this.colors.foreground]) }
            .id('chat-drawer-search').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.search')).onClick((): void => { this.onClose(); this.onSearch(); })
        }.width('100%').height(52).padding({ left: 16, right: 16 })
        Row() {
          Text($r('app.string.history')).fontSize(18).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
          Blank().layoutWeight(1)
          Text(this.drawer.total.toString()).fontSize(12).fontColor(this.colors.tertiary)
        }.width('100%').padding({ left: 32, right: 32, top: 12, bottom: 4 })
        if (this.drawer.actionError) {
          Text(this.drawer.actionError).fontSize(12).fontColor(this.colors.danger).maxLines(2)
            .width('100%').padding({ left: 32, right: 32, bottom: 4 })
        }
        List() {
          if (this.drawer.loading && !this.drawer.items.length) { ListItem() { XopcListSkeleton() } }
          ForEach(this.drawer.groups, (group: XopcSessionGroup) => {
            ListItemGroup({ header: (): void => { this.sectionHeader(group.label); } }) {
              ForEach(group.items, (item: XopcSessionItem) => {
                ListItem() {
                  Button({ type: ButtonType.Normal }) {
                    Row({ space: 8 }) {
                      Text(item.displayName || item.name || item.title || $r('app.string.untitled'))
                        .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1).maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                      if (item.status === 'pinned') {
                        SymbolGlyph($r('sys.symbol.pin')).fontSize(13).fontColor([this.colors.accent])
                      }
                      if (item.key === this.currentId) {
                        Column().width(6).height(6).borderRadius(3).backgroundColor(this.colors.accent)
                      }
                    }.width('100%').height(50).padding({ left: 14, right: 14 })
                  }.id('drawer-session-' + item.key).width('100%').height(50).padding(0).borderRadius(12)
                    .backgroundColor(item.key === this.currentId ? this.colors.accentSoft : Color.Transparent)
                    .accessibilitySelected(item.key === this.currentId).enabled(!this.drawer.busy)
                    .onClick((): void => { this.onClose(); if (item.key !== this.currentId) this.onSession(item.key); })
                    .gesture(LongPressGesture({ duration: 350, repeat: false }).onAction((): void => { this.menu(item); }))
                }.padding({ top: 2, bottom: 2 })
              }, (item: XopcSessionItem): string => item.key)
            }
          }, (group: XopcSessionGroup): string => group.id)
          if (this.drawer.error) {
            ListItem() {
              Column({ space: 8 }) {
                Text($r('app.string.chat_history_failed')).fontColor(this.colors.secondary)
                Button($r('app.string.refresh')).onClick((): void => { this.drawer.load(); })
              }.width('100%').padding(16)
            }
          } else if (!this.drawer.loading && !this.drawer.items.length) {
            ListItem() { Text($r('app.string.no_conversations')).fontColor(this.colors.tertiary).padding(24) }
          }
          if (this.drawer.loading && this.drawer.items.length) {
            ListItem() {
              Row() { LoadingProgress().width(20).height(20).color(this.colors.secondary) }
                .width('100%').height(44).justifyContent(FlexAlign.Center)
            }
          }
        }.id('chat-drawer-history').layoutWeight(1).width('100%').padding({ left: 16, right: 16, bottom: 16 })
          .onReachEnd((): void => { this.drawer.load(undefined, true); })
        Row() {
          Button($r('app.string.new_chat'), { type: ButtonType.Capsule })
            .id('chat-drawer-new').width('100%').height(40).padding({ left: 24, right: 24 })
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .responseRegion({ x: 0, y: -2, width: '100%', height: 44 })
            .onClick((): void => { this.onClose(); this.onNewChat(); })
        }.width('100%').padding({ left: 16, right: 16, top: 12, bottom: 12 })
          .backgroundColor(this.colors.grouped)
      }.id('chat-drawer').width('94%').constraintSize({ maxWidth: 420 }).height('100%').backgroundColor(this.colors.panel)
        .transition(TransitionEffect.move(TransitionEdge.START).animation({ duration: layoutState.reduceMotion ? 0 : 220, curve: Curve.EaseOut }))
        .parallelGesture(PanGesture({ direction: PanDirection.Horizontal, distance: 16 })
          .onActionEnd((event: GestureEvent): void => { if (event.offsetX < -40) this.onClose(); }))
      if (this.actionItem) { this.actionMenu(this.actionItem) }
    }.width('100%').height('100%')
  }

  @Builder
  actionMenu(item: XopcSessionItem) {
    Stack({ alignContent: Alignment.Bottom }) {
      Button({ type: ButtonType.Normal }) {}.width('100%').height('100%').padding(0).backgroundColor('#52000000')
        .accessibilityText($r('app.string.cancel')).onClick((): void => { this.closeMenu(); })
      Column({ space: 12 }) {
        Column().width(40).height(5).borderRadius(3).backgroundColor(this.colors.border)
        Text(item.displayName || item.name || item.title || $r('app.string.untitled')).fontSize(17)
          .fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%').textAlign(TextAlign.Start)
        Column({ space: 4 }) {
          this.actionRow(item, item.status === 'pinned' ? 'unpin' : 'pin',
            item.status === 'pinned' ? $r('app.string.unpin') : $r('app.string.pin'), $r('sys.symbol.pin'), false)
          this.actionRow(item, item.status === 'archived' ? 'unarchive' : 'archive',
            item.status === 'archived' ? $r('app.string.unarchive') : $r('app.string.archive'), $r('sys.symbol.archivebox'), false)
        }.width('100%').padding(4).borderRadius(16).backgroundColor(this.colors.grouped)
        this.actionRow(item, 'delete', $r('app.string.delete'), $r('sys.symbol.trash'), true)
        Button($r('app.string.cancel')).width('100%').height(48).fontColor(this.colors.foreground)
          .backgroundColor(this.colors.grouped).onClick((): void => { this.closeMenu(); })
      }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 20 })
        .borderRadius({ topLeft: 24, topRight: 24 }).backgroundColor(this.colors.panel)
    }.width('100%').height('100%').zIndex(100)
  }

  @Builder
  actionRow(item: XopcSessionItem, action: string, label: Resource, symbol: Resource, destructive: boolean) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        Row() { SymbolGlyph(symbol).fontSize(20).fontColor([destructive ? this.colors.danger : this.colors.secondary]) }
          .width(36).height(36).justifyContent(FlexAlign.Center).borderRadius(12).backgroundColor(this.colors.panel)
        Text(label).fontSize(15).fontWeight(FontWeight.Medium)
          .fontColor(destructive ? this.colors.danger : this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
      }.width('100%').height(52).padding({ left: 8, right: 12 })
    }.width('100%').height(52).padding(0).borderRadius(14).backgroundColor(this.colors.grouped)
      .enabled(!this.drawer.busy).onClick((): void => { this.chooseAction(item, action); })
  }

  @Builder
  sectionHeader(label: string) {
    Text(this.groupLabel(label)).fontSize(12).fontColor(this.colors.tertiary).width('100%')
      .padding({ top: 16, bottom: 4, left: 8 }).textAlign(TextAlign.Start)
  }
}
