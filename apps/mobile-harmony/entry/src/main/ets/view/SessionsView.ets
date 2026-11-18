import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcSessionsViewModel } from '../viewmodel/sessionsViewModel';
import { XopcChatAgent, XopcSessionItem, XopcSessionGroup, XopcSidebarTaskChild, XopcSidebarTaskGroup } from '../model/chat';
import { groupChatSessions, sessionAge } from '../common/sessionGroups';
import { XopcErrorState, XopcHubRow, XopcListSkeleton, XopcPageSearchButton, XopcPageSearchField, XopcPageTitleMenu, XopcPaginationFooter } from './MobileComponents';
import { userErrorMessage } from '../common/userError';
import { appSettings } from '../service/settings';
import { XopcConversationShare } from './ConversationShare';
import { XopcPersonalAgentRecord } from '../model/personalAgent';

import { XopcChatRepository } from '../repository/chatRepository';
import { XopcWorkspaceRepository } from '../repository/workspaceRepository';
import { XopcWorkspaceItem } from '../model/workspace';

interface XopcHistoryGroup { id: string; name: ResourceStr; }

interface XopcSessionDisplayRow {
  key: string;
  label: string;
  session?: XopcSessionItem;
  task?: XopcSidebarTaskChild;
  taskGroup?: XopcSidebarTaskGroup;
  expanded?: boolean;
  first: boolean;
  last: boolean;
}

function xopcTaskStatus(task: XopcSidebarTaskChild): string {
  const status = task.runStatus ?? task.phase;
  if (appSettings.effectiveLanguage() === 'zh') {
    if (status === 'running' || status === 'active' || status === 'verifying') return '进行中';
    if (status === 'completed' || status === 'succeeded' || status === 'closed') return '已完成';
    if (status === 'failed') return '失败';
    if (status === 'backlog' || status === 'ready' || status === 'queued' || status === 'waiting') return '待开始';
  }
  return status;
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
  @Event onToggle: (id: string) => void = (_id: string): void => {};
  @Event onOpenTask: (id: string) => void = (_id: string): void => {};

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
    if (this.entry.task) {
      Row({ space: 10 }) {
        SymbolGlyph($r('sys.symbol.circle')).fontSize(10).fontColor([this.colors.accent])
        Text(this.entry.task.title).fontSize(14).fontColor(this.colors.secondary).maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
        Text(xopcTaskStatus(this.entry.task)).fontSize(12).fontColor(this.colors.tertiary)
      }.width('100%').constraintSize({ minHeight: 52 })
        .padding({ left: 56, right: 16, top: 8, bottom: 8 })
        .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12)).margin({ bottom: 6 })
        .id('sessions-task-' + this.entry.task.taskId)
        .enabled(!this.locked)
        .onClick((): void => {
          if (this.entry.task) this.onOpenTask(this.entry.task.taskId);
        })
    } else if (this.entry.session) {
      Row({ space: 12 }) {
        if (this.entry.taskGroup && this.entry.taskGroup.total > 0 && !this.selecting) {
          Button() {
            SymbolGlyph(this.entry.expanded ? $r('sys.symbol.chevron_down') : $r('sys.symbol.chevron_right'))
              .fontSize(16).fontColor([this.colors.secondary])
          }.width(32).height(40).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText(this.entry.expanded ? $r('app.string.sessions_collapse_tasks') : $r('app.string.sessions_expand_tasks'))
            .onClick((): void => { if (this.entry.session) this.onToggle(this.entry.session.key); })
        }
        if (this.selecting) {
          SymbolGlyph(this.selected ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.circle'))
            .fontSize(24).fontColor([this.selected ? this.colors.accent : this.colors.tertiary])
        }
        Column({ space: 4 }) {
          Text(this.entry.session.displayName || this.entry.session.name || this.entry.session.title || $r('app.string.untitled'))
            .fontSize(16).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.light && (this.selected || this.current) ? this.colors.accent
              : this.entry.session.status === 'archived' ? this.colors.secondary : this.colors.foreground)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.entry.session.status === 'pinned' || this.entry.session.status === 'archived') {
            Text(this.entry.session.status === 'pinned' ? $r('app.string.sessions_pinned') : $r('app.string.sessions_archived'))
              .fontSize(12).fontColor(this.colors.secondary)
          }
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Text(this.time()).fontSize(12).fontColor(this.colors.tertiary).maxLines(1)
      }.width('100%').constraintSize({ minHeight: 64 }).padding({ left: 16, right: 16, top: 12, bottom: 12 })
        .backgroundColor(this.selected || this.current ? this.colors.active : this.colors.panel)
        .borderRadius(this.colors.corner(16)).clipShape(this.colors.cornerClip(16)).margin({ bottom: 8 })
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
  @Param startSearching: boolean = false;
  @Param currentId: string = '';
  @Param personalAgent: XopcPersonalAgentRecord | null = null;
  @Event onExit: () => void = (): void => {};
  @Event onOpen: (id: string) => void = (_id: string): void => {};
  @Event onTask: (id: string) => void = (_id: string): void => {};
  @Event onNew: (id: string) => void = (_id: string): void => {};
  @Event onDelete: (id: string) => void = (_id: string): void => {};
  @Local sessions: XopcSessionsViewModel = new XopcSessionsViewModel();
  @Local historyMode: string = 'recent';
  @Local groupId: string = '';
  @Local groupName: ResourceStr = '';
  @Local groupQuery: string = '';
  @Local groups: XopcHistoryGroup[] = [];
  @Local groupsLoading: boolean = false;
  @Local groupsError: string = '';
  private catalogRevision: number = 0;
  @Local searchOpen: boolean = false;
  @Local expandedTaskParents: string[] = [];
  @Local collapsedTaskParents: string[] = [];
  @Local renameOpen: boolean = false;
  @Local menuOpen: boolean = false;
  @Local menuItem?: XopcSessionItem;
  private pendingMenuAction: string = '';
  @Local renameId: string = '';
  @Local renameText: string = '';
  @Local shareConversationId: string = '';
  @Local shareOpen: boolean = false;
  private scroller: Scroller = new Scroller();
  private opening: boolean = false;

  aboutToAppear(): void {
    this.historyMode = appSettings.pageSelection('conversation-history', ['recent', 'projects', 'experts'], 'recent');
    this.searchOpen = this.startSearching;
  }
  aboutToDisappear(): void { this.catalogRevision++; this.sessions.dispose(); }
  private activate(): void {
    this.opening = false;
    if (this.browsingGroups()) void this.loadGroups(); else void this.sessions.load();
  }
  private browsingGroups(): boolean { return this.historyMode !== 'recent' && !this.groupId; }

  private async loadGroups(): Promise<void> {
    const mode = this.historyMode;
    const revision = ++this.catalogRevision;
    this.groupsLoading = true; this.groupsError = '';
    try {
      let groups: XopcHistoryGroup[];
      if (mode === 'projects') {
        const page = await new XopcWorkspaceRepository().list('projects', '');
        groups = page.items.filter((item: XopcWorkspaceItem): boolean => item.status !== 'archived')
          .map((item: XopcWorkspaceItem): XopcHistoryGroup => ({ id: item.id, name: item.title }));
        groups.unshift({ id: 'unassigned', name: $r('app.string.sessions_unassigned') });
      } else {
        const catalog = await new XopcChatRepository().agents();
        groups = catalog.agents.filter((agent: XopcChatAgent): boolean =>
          agent.id !== 'main' && agent.id !== 'task-router' && !/^personal-[a-f0-9]{12}$/i.test(agent.id)
          && agent.override?.purpose !== 'task_dispatcher')
          .map((agent: XopcChatAgent): XopcHistoryGroup => ({ id: agent.id, name: agent.name || agent.id }));
      }
      if (revision === this.catalogRevision) this.groups = groups;
    } catch (error) {
      if (revision === this.catalogRevision) this.groupsError = (error as Error).message;
    } finally { if (revision === this.catalogRevision) this.groupsLoading = false; }
  }

  private selectMode(mode: string): void {
    if (mode === this.historyMode) return;
    this.catalogRevision++;
    this.historyMode = mode; this.groupId = ''; this.groupName = '';
    appSettings.rememberPageSelection('conversation-history', mode);
    this.groups = []; this.groupQuery = '';
    this.closeSearch();
    if (mode === 'recent') this.sessions.setScope({});
    else void this.loadGroups();
  }

  private chooseGroup(group: XopcHistoryGroup): void {
    this.searchOpen = false;
    this.getUIContext().getFocusController().clearFocus();
    this.groupId = group.id; this.groupName = group.name;
    if (this.historyMode === 'experts') this.sessions.setScope({ expertId: group.id });
    else if (group.id === 'unassigned') this.sessions.setScope({ unassigned: true });
    else this.sessions.setScope({ projectId: group.id });
  }

  private clearGroup(): void {
    this.groupId = ''; this.groupName = ''; this.closeSearch();
  }

  private searchLabel(): Resource {
    if (!this.browsingGroups()) return $r('app.string.sessions_search');
    return this.historyMode === 'projects' ? $r('app.string.sessions_search_projects') : $r('app.string.sessions_search_experts');
  }

  private groupText(name: ResourceStr): string {
    return typeof name === 'string' ? name : this.text(name);
  }

  @Builder
  private groupList() {
    List({ space: 8 }) {
      if (this.groupsLoading) {
        ListItem() { XopcListSkeleton() }
      } else if (this.groupsError) {
        ListItem() { XopcErrorState({ error: this.groupsError, context: 'collection',
          onAction: (): void => { void this.loadGroups(); } }) }
      } else {
        ForEach(this.groups.filter((group: XopcHistoryGroup): boolean =>
          this.groupText(group.name).toLowerCase().includes(this.groupQuery.trim().toLowerCase())),
          (group: XopcHistoryGroup): void => {
            ListItem() {
              XopcHubRow({ heading: group.name, symbol: this.historyMode === 'projects' ? $r('sys.symbol.folder') : $r('sys.symbol.person'),
                onOpen: (): void => { this.chooseGroup(group); } })
            }
          }, (group: XopcHistoryGroup): string => group.id)
        if (!this.groups.some((group: XopcHistoryGroup): boolean =>
          this.groupText(group.name).toLowerCase().includes(this.groupQuery.trim().toLowerCase()))) {
          ListItem() { Text($r('app.string.workspace_no_matches')).fontColor(this.colors.secondary).padding(24) }
        }
      }
    }.width('100%').layoutWeight(1).padding({ left: 20, right: 20 })
  }

  @Computed
  get rows(): XopcSessionDisplayRow[] {
    const result: XopcSessionDisplayRow[] = [];
    groupChatSessions(this.sessions.items.filter((item: XopcSessionItem): boolean => !this.sessions.hidden.includes(item.key) && item.key !== this.personalAgent?.conversationId))
      .forEach((group: XopcSessionGroup): void => {
        result.push({ key: 'section:' + group.id, label: group.label, first: false, last: false });
        group.items.forEach((item: XopcSessionItem, index: number): void => {
          const taskGroup = this.sessions.taskGroups[item.key];
          const expanded = !this.collapsedTaskParents.includes(item.key) && (this.expandedTaskParents.includes(item.key)
            || (taskGroup?.items.some((task: XopcSidebarTaskChild): boolean => task.activeConversationId === this.currentId) ?? false));
          result.push({ key: item.key, label: '', session: item, taskGroup, expanded,
            first: index === 0, last: index === group.items.length - 1 });
          if (expanded && !this.sessions.selecting && !this.sessions.search.trim() && taskGroup) {
            taskGroup.items.forEach((task: XopcSidebarTaskChild): void => {
              result.push({ key: 'task:' + task.taskId, label: '', task, first: false, last: false });
            });
          }
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
  private openTask(id: string): void {
    if (!this.opening && !this.sessions.selecting) {
      this.getUIContext().getFocusController().clearFocus();
      this.onTask(id);
    }
  }
  private toggleTasks(id: string): void {
    const group = this.sessions.taskGroups[id];
    const active = group?.items.some((task: XopcSidebarTaskChild): boolean => task.activeConversationId === this.currentId) ?? false;
    const expanded = !this.collapsedTaskParents.includes(id) && (this.expandedTaskParents.includes(id) || active);
    if (expanded) {
      this.expandedTaskParents = this.expandedTaskParents.filter((key: string): boolean => key !== id);
      this.collapsedTaskParents = this.collapsedTaskParents.concat(id);
    } else {
      this.collapsedTaskParents = this.collapsedTaskParents.filter((key: string): boolean => key !== id);
      if (!this.expandedTaskParents.includes(id)) this.expandedTaskParents = this.expandedTaskParents.concat(id);
    }
  }
  private async createConversation(): Promise<void> {
    const id = await this.sessions.newConversation();
    if (!id) return;
    this.opening = true;
    this.getUIContext().getFocusController().clearFocus();
    this.onNew(id);
  }
  private closeSearch(): void {
    this.getUIContext().getFocusController().clearFocus();
    this.searchOpen = false;
    this.groupQuery = '';
    if (!this.browsingGroups()) this.sessions.setSearch('');
  }

  private back(): boolean {
    if (this.menuOpen) { this.menuOpen = false; return true; }
    if (this.sessions.busy) return true;
    if (this.renameOpen) { this.renameOpen = false; return true; }
    if (this.sessions.selecting) { this.sessions.cancelSelection(); return true; }
    if (this.searchOpen) { this.closeSearch(); return true; }
    if (this.groupId) { this.clearGroup(); return true; }
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
    else if (action === 'delete') this.sessions.scheduleDelete(item.key, this.onDelete);
    else if (action === 'select') this.sessions.select(item.key);
  }
  private shareSession(item: XopcSessionItem): void {
    this.shareConversationId = item.key;
    this.shareOpen = true;
  }
  private confirmDelete(): void {
    const targets = this.sessions.selectedItems();
    if (!targets.length) return;
    this.getUIContext().showAlertDialog({ title: $r('app.string.delete'), message: $r('app.string.sessions_delete_confirm', targets.length),
      primaryButton: { value: $r('app.string.cancel'), action: (): void => {} },
      secondaryButton: { value: $r('app.string.delete'), fontColor: this.colors.danger,
        action: (): void => { void this.sessions.act(targets, 'delete', this.onDelete); } } });
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
              .padding({ left: 16, right: 16, top: 14, bottom: 14 }).borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12))
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
    XopcConversationShare({ conversationId: this.shareConversationId,
      onClose: (): void => { this.shareOpen = false; } })
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
      .borderRadius(this.colors.corner(28)).margin({ top: 6, bottom: 8 })
      .enabled(!this.sessions.busy && this.sessions.selected.length > 0)
  }
  @Builder
  content() {
    Column() {
        Stack({ alignContent: Alignment.Center }) {
          Row({ space: 8 }) {
            Button({ type: ButtonType.Circle }) {
              SymbolGlyph($r('sys.symbol.arrow_left')).fontSize(21).fontColor([this.colors.foreground])
            }.id('sessions-back').width(44).height(44).padding(0)
              .backgroundColor(this.colors.panel)
              .accessibilityText($r('app.string.back')).onClick((): void => { if (!this.back()) this.onExit(); })
            if (this.sessions.selecting) {
              Text($r('app.string.sessions_selected', this.sessions.selected.length))
                .fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1)
            } else { Blank().layoutWeight(1) }
            if (!this.sessions.selecting) {
              XopcPageSearchButton({ searchId: 'sessions-open-search', open: this.searchOpen,
                label: this.searchLabel(), onToggle: (): void => {
                  if (this.searchOpen) this.closeSearch(); else this.searchOpen = true;
                } })
              if (this.historyMode === 'recent') {
                Button() {
                  SymbolGlyph($r('sys.symbol.plus')).fontSize(22).fontColor([this.colors.foreground])
                }.id('sessions-new').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
                  .accessibilityText($r('app.string.new_chat')).enabled(!this.sessions.busy)
                  .onClick(async (): Promise<void> => { await this.createConversation(); })
              }
            }
          }.width('100%')
          if (!this.sessions.selecting) {
            XopcPageTitleMenu({ heading: this.historyMode === 'projects' ? $r('app.string.projects')
              : this.historyMode === 'experts' ? $r('app.string.capability_experts') : $r('app.string.sessions_recent'),
              selected: this.historyMode, menuId: 'sessions-mode-menu', options: [
                { key: 'recent', label: $r('app.string.sessions_recent'), id: 'sessions-mode-recent' },
                { key: 'projects', label: $r('app.string.projects'), id: 'sessions-mode-projects' },
                { key: 'experts', label: $r('app.string.capability_experts'), id: 'sessions-mode-experts' }
              ], onSelect: (mode: string): void => { this.selectMode(mode); } }).constraintSize({ maxWidth: '48%' })
          }
        }.width('100%').padding({ left: 12, right: 12, top: 12, bottom: 12 })
        if (this.groupId) {
          Button(this.groupText(this.groupName) + ' ×').onClick((): void => { this.clearGroup(); })
            .margin({ left: 20, bottom: 8 }).height(40).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
        }
        if (this.searchOpen && !this.sessions.selecting) {
          Column() {
            XopcPageSearchField({ searchId: 'sessions-search', text: this.browsingGroups() ? this.groupQuery : this.sessions.search,
              placeholder: this.searchLabel(),
              onChange: (text: string): void => {
                if (this.browsingGroups()) this.groupQuery = text;
                else { this.scroller.scrollTo({ xOffset: 0, yOffset: 0 }); this.sessions.setSearch(text); }
              },
              onSubmit: (): void => { if (!this.browsingGroups()) void this.sessions.load(); } })
          }.padding({ left: 20, right: 20, bottom: 8 })
        }
        if (this.browsingGroups()) { this.groupList(); } else {
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
                    onOpen: (item: XopcSessionItem): void => { this.open(item); }, onMenu: (item: XopcSessionItem): void => { this.menu(item); },
                    onToggle: (id: string): void => { this.toggleTasks(id); },
                    onOpenTask: (id: string): void => { this.openTask(id); } })
                }
              }).key((row: XopcSessionDisplayRow): string => row.key).virtualScroll({ totalCount: this.rows.length })
              if (!this.sessions.loading && !this.rows.length && !this.sessions.error) {
                ListItem() { Text(this.sessions.search.trim() ? $r('app.string.sessions_no_results') : $r('app.string.no_conversations'))
                  .fontColor(this.colors.secondary).width('100%').padding(24) }
              }
              if (this.sessions.hasMore) {
                ListItem() {
                  XopcPaginationFooter({ loadingPage: this.sessions.loading || this.sessions.loadingMore || this.sessions.busy,
                    failedPage: !!this.sessions.error,
                    onLoad: (): void => { void this.sessions.load(true); } })
                }
              }
            }.id('sessions-list').width('100%').height('100%').padding({ left: 20, right: 20 }).cachedCount(5)
          }.layoutWeight(1).pullToRefresh(!this.sessions.busy).onRefreshing((): void => { this.sessions.load(false, true); })
        }
        if (this.sessions.undoId) {
          Row() {
            Text($r('app.string.sessions_deleted')).fontColor(this.colors.foreground).layoutWeight(1)
            Button($r('app.string.sessions_undo')).id('sessions-undo').height(44).onClick((): void => { this.sessions.undoDelete(); })
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
    NavDestination() { this.content() }
      .hideTitleBar(true).backgroundColor(this.colors.surface)
      .onShown((): void => { this.activate(); })
      .onBackPressed((): boolean => { if (!this.back()) this.onExit(); return true; })
  }
}
