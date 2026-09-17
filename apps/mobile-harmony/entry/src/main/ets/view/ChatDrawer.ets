import { XopcChatDrawerViewModel } from '../viewmodel/chatDrawerViewModel';
import { XopcSessionGroup, XopcSessionItem } from '../model/chat';
import { XopcListSkeleton } from './MobileComponents';
import { layoutState } from '../service/layoutState';

@ComponentV2
export struct XopcChatDrawer {
  @Param currentId: string = '';
  @Event onClose: () => void = (): void => {};
  @Event onSession: (id: string) => void = (_id: string): void => {};
  @Event onSearch: () => void = (): void => {};
  @Event onNewChat: () => void = (): void => {};
  @Local drawer: XopcChatDrawerViewModel = new XopcChatDrawerViewModel();
  aboutToAppear(): void { this.drawer.open(); }
  aboutToDisappear(): void { this.drawer.dispose(); }

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
          Button() { SymbolGlyph($r('sys.symbol.line_3_horizontal')).fontSize(23).fontColor([$r('app.color.foreground')]) }
            .id('chat-drawer-collapse').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
            .fontColor($r('app.color.foreground')).accessibilityText($r('app.string.chat_close_drawer')).onClick((): void => { this.onClose(); })
          Blank().layoutWeight(1)
          Button() { SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(22).fontColor([$r('app.color.foreground')]) }
            .id('chat-drawer-search').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.search')).onClick((): void => { this.onClose(); this.onSearch(); })
        }.width('100%').height(52).padding({ left: 16, right: 16 })
        Row() {
          Text($r('app.string.history')).fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground'))
          Blank().layoutWeight(1)
          Text(this.drawer.total.toString()).fontSize(12).fontColor($r('app.color.tertiary'))
        }.width('100%').padding({ left: 32, right: 32, top: 12, bottom: 4 })
        List() {
          if (this.drawer.loading && !this.drawer.items.length) { ListItem() { XopcListSkeleton() } }
          ForEach(this.drawer.groups, (group: XopcSessionGroup) => {
            ListItemGroup({ header: (): void => { this.sectionHeader(group.label); } }) {
              ForEach(group.items, (item: XopcSessionItem) => {
                ListItem() {
                  Button({ type: ButtonType.Normal }) {
                    Row({ space: 8 }) {
                      Text(item.displayName || item.name || item.title || $r('app.string.untitled'))
                        .fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).layoutWeight(1).maxLines(1)
                      if (item.key === this.currentId) { Column().width(6).height(6).borderRadius(3).backgroundColor($r('app.color.accent')) }
                    }.width('100%').constraintSize({ minHeight: 50 }).padding({ left: 16, right: 16 })
                  }.id('drawer-session-' + item.key).width('100%').padding(0).borderRadius(12)
                    .backgroundColor(item.key === this.currentId ? $r('app.color.grouped') : Color.Transparent)
                    .accessibilitySelected(item.key === this.currentId)
                    .onClick((): void => { this.onClose(); if (item.key !== this.currentId) this.onSession(item.key); })
                }.padding({ top: 2, bottom: 2 })
              }, (item: XopcSessionItem): string => item.key)
            }
          }, (group: XopcSessionGroup): string => group.id)
          if (this.drawer.error) {
            ListItem() {
              Column({ space: 8 }) {
                Text($r('app.string.chat_history_failed')).fontColor($r('app.color.secondary'))
                Button($r('app.string.refresh')).onClick((): void => { this.drawer.load(); })
              }.width('100%').padding(16)
            }
          } else if (!this.drawer.loading && !this.drawer.items.length) {
            ListItem() { Text($r('app.string.no_conversations')).fontColor($r('app.color.tertiary')).padding(24) }
          }
          if (this.drawer.hasMore) {
            ListItem() { Button($r('app.string.load_more')).enabled(!this.drawer.loading).onClick((): void => { this.drawer.load(undefined, true); }) }
          }
        }.id('chat-drawer-history').layoutWeight(1).width('100%').padding({ left: 24, right: 24, bottom: 16 })
          .onReachEnd((): void => { this.drawer.load(undefined, true); })
        Row() {
          Button($r('app.string.new_chat')).id('chat-drawer-new').height(44).padding({ left: 24, right: 24 })
            .backgroundColor($r('app.color.panel')).fontColor($r('app.color.foreground'))
            .border({ width: 1, color: $r('app.color.border_subtle') })
            .onClick((): void => { this.onClose(); this.onNewChat(); })
        }.width('100%').justifyContent(FlexAlign.Center).padding(16)
          .border({ width: { top: 0.5 }, color: $r('app.color.border_subtle') })
      }.id('chat-drawer').width('94%').constraintSize({ maxWidth: 420 }).height('100%').backgroundColor($r('app.color.panel'))
        .transition(TransitionEffect.move(TransitionEdge.START).animation({ duration: layoutState.reduceMotion ? 0 : 220, curve: Curve.EaseOut }))
        .parallelGesture(PanGesture({ direction: PanDirection.Horizontal, distance: 16 })
          .onActionEnd((event: GestureEvent): void => { if (event.offsetX < -40) this.onClose(); }))
    }.width('100%').height('100%')
  }

  @Builder
  sectionHeader(label: string) {
    Text(this.groupLabel(label)).fontSize(12).fontColor($r('app.color.tertiary')).width('100%')
      .padding({ top: 16, bottom: 4, left: 8 }).textAlign(TextAlign.Start)
  }
}
