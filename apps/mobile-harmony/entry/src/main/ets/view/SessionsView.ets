import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcSessionsViewModel } from '../viewmodel/sessionsViewModel';
import { XopcSessionItem, XopcSessionGroup } from '../model/chat';
import { groupChatSessions, sessionAge } from '../common/sessionGroups';
import { XopcErrorState, XopcListSkeleton } from './MobileComponents';
import { userErrorMessage } from '../common/userError';
import { appSettings } from '../service/settings';
import { XopcShareResult } from '../model/share';
import { shareService } from '../service/shareService';
import { XopcShareResultView } from './ShareResultView';

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
  @Local colors: XopcThemeColors = appThemeColors;
  @Param entry: XopcSessionDisplayRow = { key: '', label: '', first: false, last: false };
  @Param selecting: boolean = false;
  @Param selected: boolean = false;
  @Param current: boolean = false;
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
      Row({ space: 12 }) {
        if (this.selecting) {
          SymbolGlyph(this.selected ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.circle'))
            .fontSize(24).fontColor([this.selected ? this.colors.accent : this.colors.tertiary])
        }
        Column({ space: 4 }) {
          Text(this.entry.session.displayName || this.entry.session.name || this.entry.session.title || $r('app.string.untitled'))
            .fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis }).opacity(this.entry.session.status === 'archived' ? 0.6 : 1)
          if (this.entry.session.status === 'pinned' || this.entry.session.status === 'archived') {
            Text(this.entry.session.status === 'pinned' ? $r('app.string.sessions_pinned') : $r('app.string.sessions_archived'))
              .fontSize(12).fontColor(this.colors.secondary)
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Text(this.time()).fontSize(12).fontColor(this.colors.tertiary).maxLines(1)
      }.width('100%').constraintSize({ minHeight: 64 }).padding({ left: 16, right: 16, top: 12, bottom: 12 })
        .backgroundColor(this.selected || this.current ? this.colors.active : this.colors.panel)
        .borderRadius(16).margin({ bottom: 8 })
        .id('sessions-row-' + this.entry.session.key).accessibilitySelected(this.selected || this.current).enabled(!this.locked)
        .onClick((): void => { if (this.entry.session) this.onOpen(this.entry.session); })
        .gesture(LongPressGesture({ duration: 300, repeat: false }).onAction((): void => {
          if (!this.selecting && this.entry.session) this.onMenu(this.entry.session);
        }))
    } else {
      Text(sessionGroupLabel(this.entry.label)).fontSize(12).fontColor(this.colors.secondary)
        .width('100%').padding({ top: 22, bottom: 8, left: 4 })
    }
  }
}

@ComponentV2
export struct XopcSessionsView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param embedded: boolean = false;
  @Param bottomInset: number = 0;
  @Param activePage: boolean = true;
  @Param currentId: string = '';
  @Event onExit: () => void = (): void => {};
  @Event onOpen: (id: string) => void = (_id: string): void => {};
  @Event onNew: (id: string) => void = (_id: string): void => {};
  @Event onDelete: (id: string) => void = (_id: string): void => {};
  @Event onUndoDelete: (id: string) => void = (_id: string): void => {};
  @Local sessions: XopcSessionsViewModel = new XopcSessionsViewModel();
  @Local searchOpen: boolean = true;
  @Local renameOpen: boolean = false;
  @Local menuOpen: boolean = false;
  @Local menuItem?: XopcSessionItem;
  private pendingMenuAction: string = '';
  @Local renameId: string = '';
  @Local renameText: string = '';
  @Local shareResult?: XopcShareResult;
  @Local shareOpen: boolean = false;
  @Local shareBusy: boolean = false;
  private scroller: Scroller = new Scroller();
  private opening: boolean = false;
  private loaded: boolean = false;

  aboutToAppear(): void { if (this.activePage) this.activate(); }
  aboutToDisappear(): void { this.sessions.dispose(); }
  @Monitor('activePage')
  onActivityChange(): void { if (this.activePage) this.activate(); }
  private activate(): void {
    this.opening = false;
    this.sessions.load();
    this.loaded = true;
  }
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
    else if (!this.opening) {
      this.opening = true;
      this.getUIContext().getFocusController().clearFocus();
      this.onOpen(item.key);
    }
  }
  private async createConversation(): Promise<void> {
    const id = await this.sessions.newConversation();
    if (!id) return;
    this.opening = true;
    this.getUIContext().getFocusController().clearFocus();
    this.onNew(id);
  }
  private back(): boolean {
    if (this.menuOpen) { this.menuOpen = false; return true; }
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
    this.getUIContext().getFocusController().clearFocus();
    this.menuItem = item; this.pendingMenuAction = ''; this.menuOpen = true;
  }
  private menuLabel(action: string): Resource {
    if (action === 'share') return $r('app.string.chat_share');
    if (action === 'rename') return $r('app.string.sessions_rename');
    if (action === 'pin') return this.menuItem?.status === 'pinned' ? $r('app.string.unpin') : $r('app.string.pin');
    if (action === 'archive') return this.menuItem?.status === 'archived' ? $r('app.string.unarchive') : $r('app.string.archive');
    return action === 'delete' ? $r('app.string.delete') : $r('app.string.sessions_select');
  }
  private chooseMenuAction(action: string): void {
    if (!this.menuOpen || this.sessions.busy) return;
    this.pendingMenuAction = action; this.menuOpen = false;
  }
  private finishMenuDismiss(): void {
    const item = this.menuItem; const action = this.pendingMenuAction;
    this.pendingMenuAction = ''; this.menuItem = undefined;
    if (!item || !action || this.sessions.busy) return;
    // Open follow-up dialogs only after the action sheet has fully dismissed.
    if (action === 'share') this.shareSession(item);
    else if (action === 'rename') this.renameItem(item);
    else if (action === 'pin') this.sessions.act([item], item.status === 'pinned' ? 'unpin' : 'pin');
    else if (action === 'archive') this.sessions.act([item], 'archive');
    else if (action === 'delete') { this.sessions.scheduleDelete(item.key); this.onDelete(item.key); }
    else if (action === 'select') this.sessions.select(item.key);
  }
  private async shareSession(item: XopcSessionItem): Promise<void> {
    if (this.shareBusy || this.sessions.busy) return;
    this.shareBusy = true; this.sessions.actionError = '';
    try {
      const preview = await shareService.sessionPreview(item.key);
      const result = await this.getUIContext().getPromptAction().showDialog({ title: $r('app.string.share_session_title'),
        message: this.text($r('app.string.share_session_confirm')).replace('%d', preview.messageCount.toString())
          .replace('%d', preview.attachmentCandidates.length.toString()),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.chat_share'), color: this.colors.accent }] });
      if (result.index === 1) { this.shareResult = await shareService.session(item.key, preview); this.shareOpen = true; }
    } catch (error) { this.sessions.actionError = (error as Error).message; }
    finally { this.shareBusy = false; }
  }
  private confirmDelete(): void {
    const targets = this.sessions.selectedItems();
    if (!targets.length) return;
    this.getUIContext().showAlertDialog({ title: $r('app.string.delete'), message: $r('app.string.sessions_delete_confirm', targets.length),
      primaryButton: { value: $r('app.string.cancel'), action: (): void => {} },
      secondaryButton: { value: $r('app.string.delete'), fontColor: this.colors.danger,
        action: (): void => { void this.deleteSelected(targets); } } });
  }
  private async deleteSelected(targets: XopcSessionItem[]): Promise<void> {
    await this.sessions.act(targets, 'delete');
    targets.forEach((item: XopcSessionItem): void => {
      if (!this.sessions.items.some((remaining: XopcSessionItem): boolean => remaining.key === item.key)) this.onDelete(item.key);
    });
  }
  @Builder
  sessionMenuSheet() {
    Column({ space: 12 }) {
      Text(this.menuItem?.displayName || this.menuItem?.name || this.menuItem?.title || $r('app.string.untitled'))
        .fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        .padding({ left: 16, right: 16, top: 8, bottom: 4 })
      Scroll() {
        Column({ space: 4 }) {
          ForEach(['share', 'rename', 'pin', 'archive', 'select', 'delete'], (action: string) => {
            Button({ type: ButtonType.Normal }) {
              Text(this.menuLabel(action)).fontSize(16)
                .fontColor(action === 'delete' ? this.colors.danger : this.colors.foreground)
                .width('100%').textAlign(TextAlign.Start)
            }.id('session-menu-' + action).width('100%').constraintSize({ minHeight: 52 })
              .padding({ left: 16, right: 16, top: 14, bottom: 14 }).borderRadius(12)
              .backgroundColor(this.colors.grouped).enabled(!this.sessions.busy)
              .onClick((): void => { this.chooseMenuAction(action); })
          }, (action: string): string => action)
        }.width('100%')
      }.layoutWeight(1).width('100%').align(Alignment.TopStart).scrollBar(BarState.Auto)
      Button($r('app.string.cancel')).id('session-menu-cancel').width('100%').height(48)
        .backgroundColor(this.colors.input).fontColor(this.colors.secondary)
        .onClick((): void => { this.menuOpen = false; })
    }.id('session-actions-sheet').width('100%').height('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 24 }).alignItems(HorizontalAlign.Start)
  }
  @Builder
  renameSheet() {
    Column({ space: 16 }) {
      Text($r('app.string.sessions_rename')).fontSize(20).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
      TextInput({ text: this.renameText, placeholder: $r('app.string.name') }).id('sessions-rename-input')
        .onChange((text: string): void => { this.renameText = text; }).enabled(!this.sessions.busy)
      if (this.sessions.actionError) { Text(userErrorMessage(this.sessions.actionError, 'save')).fontColor(this.colors.danger).fontSize(13) }
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
  shareSheet() {
    if (this.shareResult) { XopcShareResultView({ share: this.shareResult, onClose: (): void => { this.shareOpen = false; } }) }
  }
  @Builder
  batchBar() {
    Row({ space: 4 }) {
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.archivebox')).fontSize(18).fontColor([this.colors.secondary])
          Text($r('app.string.archive')).fontSize(11).fontColor(this.colors.tertiary)
        }
      }.id('sessions-batch-archive').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.archive'))
        .onClick((): void => { this.sessions.act(this.sessions.selectedItems(), 'archive'); })
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.pin')).fontSize(18).fontColor([this.colors.secondary])
          Text($r('app.string.pin')).fontSize(11).fontColor(this.colors.tertiary)
        }
      }.id('sessions-batch-pin').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.pin'))
        .onClick((): void => { this.sessions.act(this.sessions.selectedItems(), 'pin'); })
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.pencil_line')).fontSize(18).fontColor([this.colors.secondary])
          Text($r('app.string.sessions_rename')).fontSize(11).fontColor(this.colors.tertiary)
        }
      }.id('sessions-batch-rename').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.sessions_rename'))
        .enabled(this.sessions.selected.length === 1).onClick((): void => {
          const item = this.sessions.selectedItems()[0]; if (item) this.renameItem(item);
        })
      Button() {
        Column({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.trash')).fontSize(18).fontColor([this.colors.danger])
          Text($r('app.string.delete')).fontSize(11).fontColor(this.colors.danger)
        }
      }.id('sessions-batch-delete').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
        .accessibilityText($r('app.string.delete')).onClick((): void => { this.confirmDelete(); })
    }.id('sessions-batch-bar').width('92%').padding(6).backgroundColor(this.colors.panel)
      .borderRadius(28).margin({ top: 6, bottom: 8 })
      .enabled(!this.sessions.busy && this.sessions.selected.length > 0)
  }
  @Builder
  content() {
    Column() {
        Row({ space: 8 }) {
          if (!this.embedded) {
            Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground]) }
              .id('sessions-back').width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.back'))
              .onClick((): void => { if (!this.back()) this.onExit(); })
          }
          Text(this.sessions.selecting ? $r('app.string.sessions_selected', this.sessions.selected.length)
            : this.embedded ? $r('app.string.conversations') : $r('app.string.history'))
            .fontSize(this.embedded ? 30 : 24).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).layoutWeight(1)
          if (!this.sessions.selecting) {
            if (!this.searchOpen) {
              Button() { SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize(22).fontColor([this.colors.foreground]) }
                .width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.search'))
                .onClick((): void => { this.searchOpen = true; })
            }
            Button() {
              SymbolGlyph($r('sys.symbol.plus')).fontSize(22).fontColor([this.colors.foreground])
            }.id('sessions-new').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
              .accessibilityText($r('app.string.new_chat')).enabled(!this.sessions.busy)
              .onClick(async (): Promise<void> => { await this.createConversation(); })
          }
        }.width('100%').padding({ left: this.embedded ? 20 : 12, right: 12, top: 12, bottom: 12 })
        if (this.searchOpen && !this.sessions.selecting) {
          Row({ space: 4 }) {
            TextInput({ text: this.sessions.search, placeholder: $r('app.string.sessions_search') }).id('sessions-search')
              .layoutWeight(1).height(44).enterKeyType(EnterKeyType.Search).enabled(!this.sessions.busy)
              .onChange((text: string): void => { this.scroller.scrollTo({ xOffset: 0, yOffset: 0 }); this.sessions.setSearch(text); })
              .onSubmit((): void => { this.sessions.load(); })
            Button('×').id('sessions-search-close').width(44).height(44).fontSize(24).backgroundColor(Color.Transparent)
              .fontColor(this.colors.secondary).accessibilityText($r('app.string.close')).enabled(!this.sessions.busy)
              .onClick((): void => { this.searchOpen = false; this.sessions.setSearch(''); })
          }.padding({ left: 20, right: 20, bottom: 8 })
        }
        if ((this.sessions.error || this.sessions.actionError) && this.sessions.items.length) {
          Row({ space: 8 }) {
            Text(userErrorMessage(this.sessions.actionError || this.sessions.error, 'collection')).fontSize(13)
              .fontColor(this.colors.secondary).layoutWeight(1).maxLines(3)
            Button($r('app.string.refresh')).height(44).enabled(!this.sessions.busy).onClick((): void => { this.sessions.load(); })
          }.padding({ left: 20, right: 20, top: 4, bottom: 4 }).backgroundColor(this.colors.panel)
        }
        Refresh({ refreshing: this.sessions.refreshing }) {
          List({ scroller: this.scroller }) {
            if (this.sessions.loading && !this.sessions.items.length) { ListItem() { XopcListSkeleton() } }
            if (!this.sessions.loading && this.sessions.error && !this.sessions.items.length) {
              ListItem() { XopcErrorState({ error: this.sessions.error, context: 'collection',
                onAction: (): void => { this.sessions.load(); } }) }
            }
            Repeat<XopcSessionDisplayRow>(this.rows).each((row: RepeatItem<XopcSessionDisplayRow>) => {
              ListItem() {
                XopcSessionManagerRow({ entry: row.item, selecting: this.sessions.selecting,
                  selected: this.sessions.selected.includes(row.item.key), current: row.item.key === this.currentId,
                  locked: this.sessions.busy,
                  onOpen: (item: XopcSessionItem): void => { this.open(item); }, onMenu: (item: XopcSessionItem): void => { this.menu(item); } })
              }
            }).key((row: XopcSessionDisplayRow): string => row.key).virtualScroll({ totalCount: this.rows.length })
            if (!this.sessions.loading && !this.rows.length && !this.sessions.error) {
              ListItem() { Text(this.sessions.search.trim() ? $r('app.string.sessions_no_results') : $r('app.string.no_conversations'))
                .fontColor(this.colors.secondary).width('100%').padding(24) }
            }
            if (this.sessions.loadingMore) { ListItem() { XopcListSkeleton() } }
            if (this.sessions.hasMore && !this.sessions.loadingMore) {
              ListItem() { Button($r('app.string.load_more')).width('100%').height(44).enabled(!this.sessions.busy)
                .onClick((): void => { this.sessions.load(true); }) }
            }
          }.id('sessions-list').width('100%').height('100%').padding({ left: 20, right: 20 }).cachedCount(5)
            .contentEndOffset(this.bottomInset)
            .onReachEnd((): void => { if (!this.sessions.error && !this.sessions.busy) this.sessions.load(true); })
        }.layoutWeight(1).pullToRefresh(!this.sessions.busy).onRefreshing((): void => { this.sessions.load(false, true); })
        if (this.sessions.undoId) {
          Row() {
            Text($r('app.string.sessions_deleted')).fontColor(this.colors.foreground).layoutWeight(1)
            Button($r('app.string.sessions_undo')).id('sessions-undo').height(44).onClick((): void => {
              const id = this.sessions.undoId; this.sessions.undoDelete(); this.onUndoDelete(id);
            })
          }.padding(12).backgroundColor(this.colors.panel)
        }
        if (this.sessions.selecting) { this.batchBar() }
        Column().id('session-menu-sheet-host').width('100%').height(0)
          .bindSheet($$this.menuOpen, this.sessionMenuSheet, { height: '65%', dragBar: true, showClose: false,
            backgroundColor: this.colors.panel, onDisappear: (): void => { this.finishMenuDismiss(); } })
        Column().id('session-rename-sheet-host').width('100%').height(0)
          .bindSheet($$this.renameOpen, this.renameSheet, { height: '45%', dragBar: true, backgroundColor: this.colors.panel })
    }.width('100%').height('100%')
      .bindSheet($$this.shareOpen, this.shareSheet, { height: '92%', dragBar: false })
  }
  build() {
    if (this.embedded) {
      this.content()
    } else {
      NavDestination() { this.content() }
        .hideTitleBar(true).backgroundColor(this.colors.surface)
        .onShown((): void => { this.opening = false; if (!this.loaded) this.activate(); })
        .onBackPressed((): boolean => this.back())
    }
  }
}
