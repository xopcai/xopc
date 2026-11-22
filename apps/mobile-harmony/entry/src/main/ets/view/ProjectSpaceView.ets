import { layoutState, XopcLayoutState } from '../service/layoutState';
import { appSettings } from '../service/settings';
import { SEGMENTED_PAGE_TAP_SLOP_VP } from './SegmentedTabs';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcHomeDelivery, XopcHomeItem, XopcMobileRoute } from '../model/home';
import { mobileRoute } from '../common/homeProtocol';
import { XopcNoteIndexEntry } from '../model/note';
import { XopcWorkspaceItem } from '../model/workspace';
import { XopcSessionItem } from '../model/chat';
import { XopcProjectSpaceViewModel } from '../viewmodel/projectSpaceViewModel';
import { XopcHubRow, XopcListSkeleton, XopcPageHeader, XopcPageTitleOption, XopcPaginationFooter, XopcSectionLabel } from './MobileComponents';
import { XopcAutomationIdeas } from './AutomationIdeas';

@ComponentV2
export struct XopcProjectSpaceView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param projectId: string = '';
  @Param attention: XopcHomeItem[] = [];
  @Computed get projectAttention(): XopcHomeItem[] {
    return this.attention.filter((item: XopcHomeItem): boolean => item.projectId === this.projectId);
  }
  @Param deliveries: XopcHomeDelivery[] = [];
  @Computed get continuingTasks(): XopcWorkspaceItem[] {
    return this.model.tasks.filter((item: XopcWorkspaceItem): boolean => item.status !== 'closed').slice(0, 3);
  }
  @Computed get projectDeliveries(): XopcHomeDelivery[] {
    return this.deliveries.filter((item: XopcHomeDelivery): boolean => item.projectId === this.projectId).slice(0, 5);
  }
  @Event onExit: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local model: XopcProjectSpaceViewModel = new XopcProjectSpaceViewModel();
  @Local tab: string = 'overview';
  @Local menuOpen: boolean = false;
  private menuDestination: string = '';
  private shownOnce: boolean = false;

  aboutToAppear(): void { this.onProjectChange(); }
  aboutToDisappear(): void { this.model.dispose(); }
  @Monitor('projectId')
  onProjectChange(): void {
    this.tab = appSettings.pageSelection('project.' + this.projectId,
      this.tabOptions.map((option: XopcPageTitleOption): string => option.key), 'overview');
    void this.model.load(this.projectId);
  }

  private go(page: string, itemId: string = ''): void {
    const title = page === 'project-new-chat' || page === 'project-chat' ? this.model.project?.name : undefined;
    this.onNavigate({ page, itemId, projectId: this.projectId, title });
  }

  private taskStatus(status: string): ResourceStr {
    if (status === 'needsUser' || status === 'needs_user') return $r('app.string.task_status_needs_user');
    if (status === 'failed') return $r('app.string.status_failed');
    if (status === 'blocked') return $r('app.string.task_execution_blocked');
    if (status === 'paused') return $r('app.string.paused');
    if (status === 'running') return $r('app.string.status_running');
    if (status === 'verifying') return $r('app.string.task_execution_verifying');
    if (status === 'queued') return $r('app.string.status_queued');
    if (status === 'allocating') return $r('app.string.task_status_allocating');
    if (status === 'waiting') return $r('app.string.task_execution_waiting');
    if (status === 'cancelled') return $r('app.string.status_cancelled');
    if (status === 'completed' || status === 'done') return $r('app.string.task_status_completed');
    if (status === 'ended') return $r('app.string.task_status_ended');
    if (status === 'closed') return $r('app.string.task_phase_closed');
    if (status === 'in_progress' || status === 'active') return $r('app.string.task_phase_in_progress');
    if (status === 'ready') return $r('app.string.task_phase_ready');
    if (status === 'review') return $r('app.string.task_phase_review');
    return $r('app.string.task_phase_backlog');
  }

  @Builder
  taskCard(item: XopcWorkspaceItem) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(22).fontColor([this.colors.accent])
        Column({ space: 5 }) {
          Text(item.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(this.taskStatus(item.displayStatus || item.status)).fontSize(12).fontColor(this.colors.secondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
      }.width('100%').padding(15)
    }.width('100%').padding(0).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(15)).clipShape(this.colors.cornerClip(15))
      .onClick((): void => { this.go('tasks', item.id); }, SEGMENTED_PAGE_TAP_SLOP_VP)
  }

  @Builder
  sessionCard(item: XopcSessionItem) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph($r('sys.symbol.message')).fontSize(21).fontColor([this.colors.accent])
        Column({ space: 4 }) {
          Text(item.displayName || item.name || item.title || $r('app.string.untitled'))
            .fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '')
            .fontSize(12).fontColor(this.colors.secondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
      }.width('100%').padding(15)
    }.width('100%').padding(0).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(15)).clipShape(this.colors.cornerClip(15))
      .onClick((): void => { this.go('project-chat', item.key); }, SEGMENTED_PAGE_TAP_SLOP_VP)
  }

  @Builder
  noteCard(item: XopcNoteIndexEntry) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph($r('sys.symbol.doc_text')).fontSize(22).fontColor([this.colors.accent])
        Column({ space: 5 }) {
          Text(item.title || $r('app.string.untitled')).fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(item.snippet ?? '').fontSize(12).fontColor(this.colors.secondary)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
      }.width('100%').padding(15)
    }.width('100%').padding(0).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(15)).clipShape(this.colors.cornerClip(15))
      .onClick((): void => { this.go('notes', item.id); }, SEGMENTED_PAGE_TAP_SLOP_VP)
  }

  @Builder
  automationCard(item: XopcWorkspaceItem) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph($r('sys.symbol.clock')).fontSize(22).fontColor([this.colors.accent])
        Column({ space: 5 }) {
          Text(item.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(item.enabled ? $r('app.string.enabled') : $r('app.string.paused'))
            .fontSize(12).fontColor(this.colors.secondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
      }.width('100%').padding(15)
    }.width('100%').padding(0).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(15)).clipShape(this.colors.cornerClip(15))
      .onClick((): void => { this.go('automations', item.id); }, SEGMENTED_PAGE_TAP_SLOP_VP)
  }

  private chooseAction(page: string): void {
    this.menuDestination = page; this.menuOpen = false;
  }

  @Builder
  projectMenu() {
    Column({ space: 5 }) {
      Text(this.model.project?.name || $r('app.string.projects')).fontSize(20).fontWeight(FontWeight.Bold)
        .fontColor(this.colors.foreground).width('100%').margin({ bottom: 8 })
      XopcHubRow({ heading: $r('app.string.project_new_chat'), symbol: $r('sys.symbol.message'),
        onOpen: (): void => { this.chooseAction('project-new-chat'); } })
      XopcHubRow({ heading: $r('app.string.new_task'), symbol: $r('sys.symbol.checkmark_circle'),
        onOpen: (): void => { this.chooseAction('task-create'); } })
      XopcHubRow({ heading: $r('app.string.new_note'), symbol: $r('sys.symbol.doc'),
        onOpen: (): void => { this.chooseAction('note-create'); } })
      XopcHubRow({ heading: $r('app.string.new_automation'), symbol: $r('sys.symbol.clock'),
        onOpen: (): void => { this.chooseAction('automation-setup'); } })
      XopcHubRow({ heading: $r('app.string.project_manage'), symbol: $r('sys.symbol.folder'),
        onOpen: (): void => { this.chooseAction('project-settings'); } })
    }.width('100%').padding(18)
  }

  @Local layout: XopcLayoutState = layoutState;
  private pager: SwiperController = new SwiperController();

  private selectTab(key: string): void {
    const current = this.tabOptions.findIndex((option: XopcPageTitleOption): boolean => option.key === this.tab);
    const target = this.tabOptions.findIndex((option: XopcPageTitleOption): boolean => option.key === key);
    if (target < 0 || current === target) return;
    this.pager.changeIndex(target, !this.layout.reduceMotion && Math.abs(current - target) === 1);
  }

  private commitTab(index: number): void {
    const key = this.tabOptions[index]?.key;
    if (!key || this.tab === key) return;
    this.tab = key;
    appSettings.rememberPageSelection('project.' + this.projectId, key);
  }

  private tabOptions: XopcPageTitleOption[] = [
    { key: 'overview', label: $r('app.string.project_overview'), id: 'project-tab-overview' },
    { key: 'sessions', label: $r('app.string.conversations'), id: 'project-tab-sessions' },
    { key: 'tasks', label: $r('app.string.tasks'), id: 'project-tab-tasks' },
    { key: 'notes', label: $r('app.string.notes'), id: 'project-tab-notes' },
    { key: 'automations', label: $r('app.string.automations'), id: 'project-tab-automations' }
  ];

  @Builder
  private sectionPage(section: string) {
    Column() {
      if (section === 'overview' && (this.model.project?.brief || this.model.project?.description)) {
        Text(this.model.project?.brief || this.model.project?.description || '').fontSize(14).lineHeight(21)
          .fontColor(this.colors.secondary).width('100%').padding({ left: 20, right: 20, bottom: 10 })
      }
      List({ space: 12 }) {
        if (this.model.loading && !this.model.project) {
          ListItem() { XopcListSkeleton() }
        }
        if (section === 'overview' && this.projectAttention.length) {
          ListItem() { XopcSectionLabel({ heading: $r('app.string.needs_you') }) }
          ForEach(this.projectAttention, (item: XopcHomeItem) => {
            ListItem() {
              XopcHubRow({ heading: item.title, summary: item.summary, symbol: $r('sys.symbol.bell'), attention: true,
                navigable: !!item.openAction, onOpen: (): void => {
                  const route = mobileRoute(item.openAction?.href ?? '');
                  if (route) this.onNavigate(route);
                } })
            }
          }, (item: XopcHomeItem): string => item.id)
        }
        if ((section === 'overview' || section === 'notes') && this.projectDeliveries.length) {
          ListItem() { Text($r('app.string.library_recent_results')).fontSize(15).fontWeight(FontWeight.Bold).fontColor(this.colors.secondary) }
          ForEach(this.projectDeliveries, (item: XopcHomeDelivery) => {
            ListItem() {
              XopcHubRow({ heading: item.title, summary: item.summary, symbol: $r('sys.symbol.checkmark_circle'),
                onOpen: (): void => {
                  const route = mobileRoute(item.href);
                  if (route) this.onNavigate(route);
                } })
            }
          }, (item: XopcHomeDelivery): string => item.id + ':' + item.summary)
        }
        if (section === 'sessions') {
          if (this.model.sessionsError) {
            ListItem() { Text($r('app.string.project_section_error')).fontSize(13).fontColor(this.colors.danger) }
          } else if (this.model.loading && !this.model.sessions.length) {
            ListItem() { XopcListSkeleton() }
          } else if (!this.model.sessions.length) {
            ListItem() { Text($r('app.string.project_no_sessions')).fontSize(14).fontColor(this.colors.secondary).padding(14) }
          }
          ForEach(this.model.sessions, (item: XopcSessionItem) => {
            ListItem() { this.sessionCard(item) }
          }, (item: XopcSessionItem): string => item.key)
        }
        if (section === 'overview' || section === 'tasks') {
          if (section === 'overview' && this.continuingTasks.length) {
            ListItem() { XopcSectionLabel({ heading: $r('app.string.project_continue_work') }) }
          }
          if (this.model.tasksError) {
            ListItem() { Text($r('app.string.project_section_error')).fontSize(13).fontColor(this.colors.danger) }
          } else if (this.model.loading && !this.model.tasks.length) {
            ListItem() { XopcListSkeleton() }
          } else if (section === 'tasks' && !this.model.tasks.length) {
            ListItem() { Text($r('app.string.project_no_tasks')).fontSize(14).fontColor(this.colors.secondary).padding(14) }
          }
          ForEach(section === 'overview' ? this.continuingTasks : this.model.tasks, (item: XopcWorkspaceItem) => {
            ListItem() { this.taskCard(item) }
          }, (item: XopcWorkspaceItem): string => item.id)
          if (section === 'tasks' && this.model.tasks.length < this.model.tasksTotal) {
            ListItem() {
              XopcPaginationFooter({ loadingPage: this.model.loadingTasksMore, failedPage: this.model.tasksError,
                onLoad: (): void => { void this.model.moreTasks(this.projectId); } })
            }
          }
        }
        if (section === 'notes') {
          if (this.model.notesError) {
            ListItem() { Text($r('app.string.project_section_error')).fontSize(13).fontColor(this.colors.danger) }
          } else if (this.model.loading && !this.model.notes.length) {
            ListItem() { XopcListSkeleton() }
          } else if (!this.model.notes.length) {
            ListItem() { Text($r('app.string.project_no_notes')).fontSize(14).fontColor(this.colors.secondary).padding(14) }
          }
          ForEach(this.model.notes, (item: XopcNoteIndexEntry) => {
            ListItem() { this.noteCard(item) }
          }, (item: XopcNoteIndexEntry): string => item.id)
          if (section === 'notes' && this.model.notes.length < this.model.notesTotal) {
            ListItem() {
              XopcPaginationFooter({ loadingPage: this.model.loadingNotesMore, failedPage: this.model.notesError,
                onLoad: (): void => { void this.model.moreNotes(this.projectId); } })
            }
          }
        }
        if (section === 'automations') {
          if (this.model.automationsError) {
            ListItem() { Text($r('app.string.project_section_error')).fontSize(13).fontColor(this.colors.danger) }
          } else if (this.model.loading && !this.model.automations.length) {
            ListItem() { XopcListSkeleton() }
          } else if (this.model.project && !this.model.automations.length) {
            ListItem() {
              XopcAutomationIdeas({ projectScoped: true, onChoose: (prompt: string): void => {
                this.onNavigate({ page: 'automation-setup', itemId: '', projectId: this.projectId, prompt });
              } })
            }
          }
          ForEach(this.model.automations, (item: XopcWorkspaceItem) => {
            ListItem() { this.automationCard(item) }
          }, (item: XopcWorkspaceItem): string => item.id)
        }
      }.layoutWeight(1).width('100%').padding({ left: 20, right: 20 }).scrollBar(BarState.Off)
      if (this.model.project && (section === 'overview' || section === 'sessions')) {
        Button(section === 'overview' ? $r('app.string.project_chat_cta') : $r('app.string.project_new_chat'))
          .id('project-start-chat').width('100%').height(50).fontColor(this.colors.chat.onAction)
          .backgroundColor(this.colors.chat.action).onClick((): void => { this.go('project-new-chat'); })
      }
    }.width('100%').height('100%')
      .accessibilityLevel(section === this.tab ? 'auto' : 'no-hide-descendants')
  }

  build() {
    NavDestination() {
      Column() {
        XopcPageHeader({ heading: this.tabOptions.find((option: XopcPageTitleOption): boolean => option.key === this.tab)?.label
          ?? $r('app.string.project_overview'), selectedTitle: this.tab, titleOptions: this.tabOptions,
          titleMenuId: 'project-tabs', onSelectTitle: (key: string): void => { this.selectTab(key); },
          backVisible: true, onBack: this.onExit, actionLabel: $r('app.string.project_add_item'), actionIcon: $r('sys.symbol.plus'),
          onAction: (): void => { this.menuOpen = true; } })
        if (this.model.project) {
          Text(this.model.project.name).fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
            .width('100%').padding({ left: 20, right: 20, bottom: 8 })
        }
        if (this.model.error) {
          Row({ space: 8 }) {
            Text($r('app.string.project_load_error')).fontSize(13).fontColor(this.colors.danger).layoutWeight(1)
            Button($r('app.string.refresh')).height(40).fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
              .onClick((): void => { void this.model.load(this.projectId); })
          }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 8 })
        }
        Swiper(this.pager) {
          ForEach(this.tabOptions, (option: XopcPageTitleOption) => {
            this.sectionPage(option.key)
          }, (option: XopcPageTitleOption): string => option.key)
        }.id('project-pager')
          .index(Math.max(0, this.tabOptions.findIndex((option: XopcPageTitleOption): boolean => option.key === this.tab)))
          .loop(false).indicator(false).cachedCount(1).disableSwipe(this.menuOpen)
          .duration(this.layout.reduceMotion ? 0 : 230)
          .onChange((index: number): void => { this.commitTab(index); })
          .width('100%').layoutWeight(1)
      }.height('100%').width('100%').backgroundColor(this.colors.surface)
        .bindSheet($$this.menuOpen, this.projectMenu, { height: 455, dragBar: true, showClose: false,
          onDisappear: (): void => {
            const page = this.menuDestination; this.menuDestination = '';
            if (page) this.go(page, page === 'project-settings' ? this.projectId : '');
          } })
    }.hideTitleBar(true)
      .onShown((): void => {
        if (this.shownOnce) void this.model.load(this.projectId);
        else this.shownOnce = true;
      })
      .onBackPressed((): boolean => { this.onExit(); return true; })
  }
}
