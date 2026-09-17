import { XopcSessionsViewModel } from '../viewmodel/sessionsViewModel';
import { XopcSessionItem, XopcSessionGroup } from '../model/chat';
import { groupChatSessions, sessionAge } from '../common/sessionGroups';
import { XopcListSkeleton } from './MobileComponents';
import { appSettings } from '../service/settings';

interface XopcSessionDisplayRow {
  key: string;
  label: string;
  session?: XopcSessionItem;
  first: boolean;
  last: boolean;
}

function sessionGroupLabel(label: string): ResourceStr {
  switch (label) {
    case 'today': return $r('app.string.chat_today');
    case 'yesterday': return $r('app.string.chat_yesterday');
    case 'this_week': return $r('app.string.chat_this_week');
    case 'last_week': return $r('app.string.chat_last_week');
    case 'this_month': return $r('app.string.chat_this_month');
    case 'earlier': return $r('app.string.chat_earlier');
    default: {
      const date = new Date(label + '-01T12:00:00');
      return Number.isFinite(date.getTime()) ? date.toLocaleDateString(appSettings.effectiveLanguage() === 'zh' ? 'zh-CN' : 'en-US',
        { month: 'long', year: 'numeric' }) : label;
    }
  }
}

@ComponentV2
struct XopcSessionManagerRow {
  @Param entry: XopcSessionDisplayRow = { key: '', label: '', first: false, last: false };
  @Param selecting: boolean = false;
  @Param selected: boolean = false;
  @Param locked: boolean = false;
  @Event onOpen: (item: XopcSessionItem) => void = (_item: XopcSessionItem): void => {};
  @Event onMenu: (item: XopcSessionItem) => void = (_item: XopcSessionItem): void => {};

  private time(): ResourceStr {
    const stamp = Date.parse(this.entry.session?.updatedAt ?? '');
    if (!Number.isFinite(stamp)) return '';
    const age = sessionAge(this.entry.session?.updatedAt ?? '');
    switch (age.unit) {
      case 'now': return $r('app.string.sessions_now');
      case 'minute': return $r('app.string.sessions_minutes_ago', age.count);
      case 'hour': return $r('app.string.sessions_hours_ago', age.count);
      case 'day': return $r('app.string.sessions_days_ago', age.count);
      case 'week': return $r('app.string.sessions_weeks_ago', age.count);
    }
    return new Date(stamp).toLocaleDateString(appSettings.effectiveLanguage() === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' });
  }
  build() {
    if (this.entry.session) {
      Row({ space: 10 }) {
        if (this.selecting) {
          SymbolGlyph(this.selected ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.circle'))
            .fontSize(24).fontColor([this.selected ? $r('app.color.accent') : $r('app.color.tertiary')])
        }
        SymbolGlyph($r('sys.symbol.message')).fontSize(24).fontColor([$r('app.color.secondary')])
        Column({ space: 4 }) {
          Text(this.entry.session.displayName || this.entry.session.name || this.entry.session.title || $r('app.string.untitled'))
            .fontSize(16).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).opacity(this.entry.session.status === 'archived' ? 0.6 : 1)
          Row({ space: 6 }) {
            Text($r('app.string.sessions_message_count', this.entry.session.messageCount)).fontSize(12).fontColor($r('app.color.tertiary'))
            if (this.entry.session.status === 'pinned' || this.entry.session.status === 'archived') {
              Text(this.entry.session.status === 'pinned' ? $r('app.string.sessions_pinned') : $r('app.string.sessions_archived'))
                .fontSize(12).fontColor($r('app.color.secondary'))
            }
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Text(this.time()).fontSize(12).fontColor($r('app.color.tertiary')).maxLines(1)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([$r('app.color.tertiary')])
      }.width('100%').constraintSize({ minHeight: 76 }).padding({ left: 14, right: 14, top: 12, bottom: 12 })
        .backgroundColor(this.selected ? $r('app.color.accent_soft') : $r('app.color.panel'))
        .border({ width: 0.5, color: this.selected ? $r('app.color.accent') : $r('app.color.border_subtle'),
          radius: { topLeft: this.entry.first ? 16 : 0, topRight: this.entry.first ? 16 : 0,
            bottomLeft: this.entry.last ? 16 : 0, bottomRight: this.entry.last ? 16 : 0 } })
        .id('sessions-row-' + this.entry.session.key).accessibilitySelected(this.selected).enabled(!this.locked)
        .onClick((): void => { if (this.entry.session) this.onOpen(this.entry.session); })
        .gesture(LongPressGesture({ duration: 300, repeat: false }).onAction((): void => {
          if (!this.selecting && this.entry.session) this.onMenu(this.entry.session);
        }))
    } else {
      Text(sessionGroupLabel(this.entry.label)).fontSize(12).fontColor($r('app.color.secondary'))
        .width('100%').padding({ top: 22, bottom: 8, left: 4 })
    }
  }
}

@ComponentV2
export struct XopcSessionsView {
  @Event onExit: () => void = (): void => {};
  @Event onOpen: (id: string) => void = (_id: string): void => {};
  @Local sessions: XopcSessionsViewModel = new XopcSessionsViewModel();
  @Local searchOpen: boolean = true;
  @Local renameOpen: boolean = false;
  @Local renameId: string = '';
  @Local renameText: string = '';
  private scroller: Scroller = new Scroller();
  private opening: boolean = false;

  aboutToDisappear(): void { this.sessions.dispose(); }
  @Computed
  get rows(): XopcSessionDisplayRow[] {
    const result: XopcSessionDisplayRow[] = [];
    groupChatSessions(this.sessions.items.filter((item: XopcSessionItem): boolean => !this.sessions.hidden.includes(item.key)))
      .forEach((group: XopcSessionGroup): void => {
        result.push({ key: 'section:' + group.id, label: group.label, first: false, last: false });
        group.items.forEach((item: XopcSessionItem, index: number): void => {
          result.push({ key: item.key, label: '', session: item, first: index === 0, last: index === group.items.length - 1 });
        });
      });
    return result;
  }
  private text(resource: Resource): string { return this.getUIContext().getHostContext()?.resourceManager.getStringSync(resource.id) ?? ''; }
  private open(item: XopcSessionItem): void {
    if (this.sessions.selecting) this.sessions.select(item.key);
    else if (!this.opening) { this.opening = true; this.onOpen(item.key); }
  }
  private back(): boolean {
    if (this.sessions.busy) return true;
    if (this.renameOpen) { this.renameOpen = false; return true; }
    if (this.sessions.selecting) { this.sessions.cancelSelection(); return true; }
    return false;
  }
  private renameItem(item: XopcSessionItem): void {
    this.renameId = item.key; this.renameText = item.name || item.displayName || item.title || ''; this.renameOpen = true;
  }
  private menu(item: XopcSessionItem): void {
    if (this.sessions.busy) return;
    this.getUIContext().showActionSheet({ title: item.displayName || item.name || item.title || this.text($r('app.string.untitled')), message: '',
      sheets: [
        { title: this.text($r('app.string.sessions_rename')), action: (): void => { this.renameItem(item); } },
        { title: this.text(item.status === 'pinned' ? $r('app.string.unpin') : $r('app.string.pin')),
          action: (): void => { this.sessions.act([item], item.status === 'pinned' ? 'unpin' : 'pin'); } },
        { title: this.text(item.status === 'archived' ? $r('app.string.unarchive') : $r('app.string.archive')),
          action: (): void => { this.sessions.act([item], 'archive'); } },
        { title: this.text($r('app.string.delete')), action: (): void => { this.sessions.scheduleDelete(item.key); } },
        { title: this.text($r('app.string.sessions_select')), action: (): void => { this.sessions.select(item.key); } }
      ] });
  }
  private confirmDelete(): void {
    const targets = this.sessions.selectedItems();
    if (!targets.length) return;
    this.getUIContext().showAlertDialog({ title: $r('app.string.delete'), message: $r('app.string.sessions_delete_confirm', targets.length),
      primaryButton: { value: $r('app.string.cancel'), action: (): void => {} },
      secondaryButton: { value: $r('app.string.delete'), fontColor: $r('app.color.danger'),
        action: (): void => { this.sessions.act(targets, 'delete'); } } });
  }
  @Builder
  renameSheet() {
    Column({ space: 16 }) {
      Text($r('app.string.sessions_rename')).fontSize(20).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground'))
      TextInput({ text: this.renameText, placeholder: $r('app.string.name') }).id('sessions-rename-input')
        .onChange((text: string): void => { this.renameText = text; }).enabled(!this.sessions.busy)
      if (this.sessions.actionError) { Text(this.sessions.actionError).fontColor($r('app.color.danger')).fontSize(13) }
      Row({ space: 12 }) {
        Button($r('app.string.cancel')).layoutWeight(1).height(44).enabled(!this.sessions.busy)
          .onClick((): void => { this.renameOpen = false; })
        Button($r('app.string.save')).id('sessions-rename-save').layoutWeight(1).height(44)
          .enabled(!this.sessions.busy && this.renameText.trim().length > 0)
          .onClick(async (): Promise<void> => { if (await this.sessions.rename(this.renameId, this.renameText)) this.renameOpen = false; })
      }
    }.width('100%').padding(20)
  }
  @Builder
  batchBar() {
    Row({ space: 4 }) {
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.archivebox')).fontSize(18).fontColor([$r('app.color.secondary')])
          Text($r('app.string.archive')).fontSize(11).fontColor($r('app.color.tertiary'))
        }
      }.id('sessions-batch-archive').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.archive'))
        .onClick((): void => { this.sessions.act(this.sessions.selectedItems(), 'archive'); })
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.pin')).fontSize(18).fontColor([$r('app.color.secondary')])
          Text($r('app.string.pin')).fontSize(11).fontColor($r('app.color.tertiary'))
        }
      }.id('sessions-batch-pin').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.pin'))
        .onClick((): void => { this.sessions.act(this.sessions.selectedItems(), 'pin'); })
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.pencil_line')).fontSize(18).fontColor([$r('app.color.secondary')])
          Text($r('app.string.sessions_rename')).fontSize(11).fontColor($r('app.color.tertiary'))
        }
      }.id('sessions-batch-rename').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.sessions_rename'))
        .enabled(this.sessions.selected.length === 1).onClick((): void => {
          const item = this.sessions.selectedItems()[0]; if (item) this.renameItem(item);
        })
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.trash')).fontSize(18).fontColor([$r('app.color.danger')])
          Text($r('app.string.delete')).fontSize(11).fontColor($r('app.color.danger'))
        }
      }.id('sessions-batch-delete').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.delete')).onClick((): void => { this.confirmDelete(); })
    }.id('sessions-batch-bar').width('92%').padding(6).backgroundColor($r('app.color.panel'))
      .border({ width: 0.5, color: $r('app.color.border_subtle'), radius: 28 }).margin({ top: 6, bottom: 8 })
      .enabled(!this.sessions.busy && this.sessions.selected.length > 0)
  }
  build() {
    NavDestination() {
      Column() {
        Row({ space: 8 }) {
          Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([$r('app.color.foreground')]) }
            .id('sessions-back').width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.back'))
            .onClick((): void => { if (!this.back()) this.onExit(); })
          Text(this.sessions.selecting ? $r('app.string.sessions_selected', this.sessions.selected.length) : $r('app.string.history'))
            .fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground')).layoutWeight(1)
          if (!this.sessions.selecting) {
            Button() { SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(22).fontColor([$r('app.color.foreground')]) }
              .width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.search'))
              .onClick((): void => { this.searchOpen = true; })
            Button('+').id('sessions-new').width(44).height(44).fontSize(28).backgroundColor(Color.Transparent)
              .fontColor($r('app.color.foreground')).accessibilityText($r('app.string.new_chat')).enabled(!this.sessions.busy)
              .onClick(async (): Promise<void> => { const id = await this.sessions.newConversation(); if (id) this.onOpen(id); })
          }
        }.width('100%').padding({ left: 12, right: 12, top: 12, bottom: 12 })
        if (this.searchOpen && !this.sessions.selecting) {
          Row({ space: 4 }) {
            TextInput({ text: this.sessions.search, placeholder: $r('app.string.sessions_search') }).id('sessions-search')
              .layoutWeight(1).height(44).enterKeyType(EnterKeyType.Search).enabled(!this.sessions.busy)
              .onChange((text: string): void => { this.scroller.scrollTo({ xOffset: 0, yOffset: 0 }); this.sessions.setSearch(text); })
              .onSubmit((): void => { this.sessions.load(); })
            Button('×').id('sessions-search-close').width(44).height(44).fontSize(24).backgroundColor(Color.Transparent)
              .fontColor($r('app.color.secondary')).accessibilityText($r('app.string.close')).enabled(!this.sessions.busy)
              .onClick((): void => { this.searchOpen = false; this.sessions.setSearch(''); })
          }.padding({ left: 20, right: 20, bottom: 8 })
        }
        if (this.sessions.error || this.sessions.actionError) {
          Row({ space: 8 }) {
            Text(this.sessions.actionError || this.sessions.error).fontSize(13).fontColor($r('app.color.danger')).layoutWeight(1).maxLines(3)
            Button($r('app.string.refresh')).height(44).enabled(!this.sessions.busy).onClick((): void => { this.sessions.load(); })
          }.padding({ left: 20, right: 20 })
        }
        Refresh({ refreshing: this.sessions.loading && this.sessions.items.length > 0 }) {
          List({ scroller: this.scroller }) {
            if (this.sessions.loading && !this.sessions.items.length) { ListItem() { XopcListSkeleton() } }
            Repeat<XopcSessionDisplayRow>(this.rows).each((row: RepeatItem<XopcSessionDisplayRow>) => {
              ListItem() {
                XopcSessionManagerRow({ entry: row.item, selecting: this.sessions.selecting,
                  selected: this.sessions.selected.includes(row.item.key), locked: this.sessions.busy || this.sessions.loading,
                  onOpen: (item: XopcSessionItem): void => { this.open(item); }, onMenu: (item: XopcSessionItem): void => { this.menu(item); } })
              }
            }).key((row: XopcSessionDisplayRow): string => row.key).virtualScroll({ totalCount: this.rows.length })
            if (!this.sessions.loading && !this.rows.length && !this.sessions.error) {
              ListItem() { Text(this.sessions.search.trim() ? $r('app.string.sessions_no_results') : $r('app.string.no_conversations'))
                .fontColor($r('app.color.secondary')).width('100%').padding(24) }
            }
            if (this.sessions.loadingMore) { ListItem() { XopcListSkeleton() } }
            if (this.sessions.hasMore && !this.sessions.loadingMore) {
              ListItem() { Button($r('app.string.load_more')).width('100%').height(44).enabled(!this.sessions.busy)
                .onClick((): void => { this.sessions.load(true); }) }
            }
          }.id('sessions-list').width('100%').height('100%').padding({ left: 20, right: 20, bottom: 20 }).cachedCount(5)
            .onReachEnd((): void => { if (!this.sessions.error && !this.sessions.busy) this.sessions.load(true); })
        }.layoutWeight(1).pullToRefresh(!this.sessions.busy).onRefreshing((): void => { this.sessions.load(); })
        if (this.sessions.undoId) {
          Row() {
            Text($r('app.string.sessions_deleted')).fontColor($r('app.color.foreground')).layoutWeight(1)
            Button($r('app.string.sessions_undo')).id('sessions-undo').height(44).onClick((): void => { this.sessions.undoDelete(); })
          }.padding(12).backgroundColor($r('app.color.panel'))
        }
        if (this.sessions.selecting) { this.batchBar() }
      }.width('100%').height('100%')
        .bindSheet($$this.renameOpen, this.renameSheet, { height: '45%', dragBar: true, backgroundColor: $r('app.color.panel') })
    }.hideTitleBar(true).backgroundColor($r('app.color.surface'))
      .onShown((): void => { this.opening = false; this.sessions.load(); })
      .onBackPressed((): boolean => this.back())
  }
}
