import { appSettings } from '../service/settings';
import { SEGMENTED_PAGE_TAP_SLOP_VP, XopcSegmentedTabs, XopcSegmentOption } from './SegmentedTabs';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import {
  XopcSection, XopcWorkspaceItem, XopcAutomationRun, XopcMobileTaskDetail,
  XopcMobileTaskReceipt, XopcMobileTaskEvidence,
  XopcMobileTaskReview, XopcMobileTaskContext, XopcMobileTaskSession, XopcMobileTaskDependency,
  XopcMobileTaskAttention, XopcTaskAcceptanceCheck
} from '../model/workspace';
import type { XopcTaskPhaseChange } from '../model/workspace';
import { taskCriterionState, taskPhaseAction, taskReviewAction, taskSignoffResult } from '../common/taskManagement';
import { XopcWorkspaceRepository } from '../repository/workspaceRepository';
import { XopcWorkspaceViewModel } from '../viewmodel/workspaceViewModel';
import { XopcMarkdownView } from './MarkdownView';
import { XopcBrandLoading, XopcHubRow, XopcListSkeleton, XopcPageSearchButton, XopcPageSearchField, XopcPageTitleMenu,
  XopcPaginationFooter } from './MobileComponents';
import { WORK_PAGE_OPTIONS } from './HomeHubs';
import { automationCronLabel } from '../common/workspaceProtocol';
import { XopcMobileRoute } from '../model/home';
import { userErrorMessage } from '../common/userError';
import { XopcChatRepository } from '../repository/chatRepository';
import { XopcChatAgent, XopcChatAgents } from '../model/chat';
import { XopcAutomationIdeas } from './AutomationIdeas';

@ComponentV2
struct XopcAutomationActionMenu {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param menuId: string = '';
  @Param inList: boolean = false;
  @Param busy: boolean = false;
  @Param editable: boolean = false;
  @Param toggleable: boolean = false;
  @Param enabledAutomation: boolean = false;
  @Param deletable: boolean = false;
  @Event onEdit: () => void = (): void => {};
  @Event onToggle: () => void = (): void => {};
  @Event onDelete: () => void = (): void => {};

  @Builder
  menu() {
    Menu() {
      if (this.editable) {
        MenuItem({ content: $r('app.string.edit_automation') }).id('automation-menu-edit')
          .contentFontColor(this.colors.foreground).onClick(this.onEdit)
      }
      if (this.inList && this.toggleable) {
        MenuItem({ content: this.enabledAutomation ? $r('app.string.pause') : $r('app.string.resume') })
          .id('automation-menu-toggle').contentFontColor(this.colors.foreground).onClick(this.onToggle)
      }
      if (this.deletable) {
        MenuItem({ content: $r('app.string.delete') }).id('automation-menu-delete')
          .contentFontColor(this.colors.danger).onClick(this.onDelete)
      }
    }.width(196).borderRadius(this.colors.corner(18)).backgroundColor(this.colors.panel)
  }

  build() {
    Button({ type: ButtonType.Circle }) {
      Row({ space: 3 }) {
        Circle().width(3).height(3).fill(this.colors.foreground)
        Circle().width(3).height(3).fill(this.colors.foreground)
        Circle().width(3).height(3).fill(this.colors.foreground)
      }
    }.id(this.menuId).width(44).height(44).padding(0).backgroundColor(this.inList ? Color.Transparent : this.colors.panel)
      .accessibilityText($r('app.string.more')).enabled(!this.busy)
      .bindMenu(this.menu, { placement: Placement.BottomRight })
  }
}

@ComponentV2
export struct XopcWorkspaceView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param section: XopcSection = 'tasks';
  @Param heading: ResourceStr = '';
  @Param initialId: string = '';
  @Param initialTaskAction: string = '';
  @Param createOnAppear: boolean = false;
  @Param projectId: string = '';
  @Param embeddedInWorkbench: boolean = false;
  @Param workbenchRefresh: number = 0;
  @Event onExit: () => void = (): void => {};
  @Event onSelectWorkPage: (page: string) => void = (_page: string): void => {};
  @Event onCreated: (page: string, id: string) => void = (_page: string, _id: string): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local model: XopcWorkspaceViewModel = new XopcWorkspaceViewModel();
  @Local search: string = '';
  @Local searchOpen: boolean = false;
  @Local filter: string = 'all';
  @Local agentId: string = '';
  @Local agents: XopcChatAgent[] = [];
  @Local defaultAgent: string = '';
  @Local agentsLoading: boolean = false;
  @Local agentsError: string = '';
  @Local sheetOpen: boolean = false;
  @Local sheetKind: string = 'agent';
  @Local projects: XopcWorkspaceItem[] = [];
  @Local projectsLoading: boolean = false;
  @Local projectsError: string = '';
  @Local projectQuery: string = '';
  private workspaceRepository: XopcWorkspaceRepository = new XopcWorkspaceRepository();
  @Local agentQuery: string = '';
  private chatRepository: XopcChatRepository = new XopcChatRepository();
  @Local expandedInstructionId: string = '';
  @Local automationAdvancedSchedule: boolean = false;

  aboutToAppear(): void {
    if (this.section === 'automations') {
      this.filter = appSettings.pageSelection('automation-filter', ['all', 'primary', 'secondary', 'attention'], 'all');
    }
    if (this.initialTaskAction) void this.openTaskAction();
    else this.model.start(this.section, this.initialId, this.createOnAppear, this.projectId);
    if (this.section === 'tasks') this.loadAgents();
    if (this.section === 'tasks' || this.section === 'automations') this.loadProjects();
  }
  @Monitor('workbenchRefresh')
  private refreshWorkbenchList(): void {
    if (this.embeddedInWorkbench) void this.model.list(this.section === 'tasks' ? this.search : '');
  }

  private async openTaskAction(): Promise<void> {
    await this.model.open(this.initialId);
    if (this.initialTaskAction === 'edit' && this.model.selected) this.model.editing = true;
  }
  @Monitor('initialId')
  onTargetChange(): void {
    this.agentId = this.defaultAgentId();
    if (this.initialId) this.model.open(this.initialId);
  }
  aboutToDisappear(): void { this.model.dispose(); }

  private defaultAgentId(): string { return this.defaultAgent || this.agents[0]?.id || ''; }

  private async loadAgents(): Promise<void> {
    this.agentsLoading = true; this.agentsError = '';
    try {
      const result: XopcChatAgents = await this.chatRepository.agents();
      this.agents = result.agents;
      this.defaultAgent = result.agents.some((item: XopcChatAgent): boolean => item.id === result.defaultId)
        ? result.defaultId : result.agents[0]?.id || '';
      this.agentId = result.agents.some((item: XopcChatAgent): boolean => item.id === this.agentId)
        ? this.agentId : this.defaultAgentId();
    } catch (error) { this.agentsError = (error as Error).message; }
    finally { this.agentsLoading = false; }
  }

  private selectedAgentName(): string {
    const agent = this.agents.find((item: XopcChatAgent): boolean => item.id === this.agentId);
    return agent?.name || agent?.id || '';
  }

  private matchingAgents(): XopcChatAgent[] {
    const query = this.agentQuery.trim().toLowerCase();
    return this.agents.filter((item: XopcChatAgent): boolean =>
      !query || (item.name + ' ' + item.id + ' ' + (item.description ?? '')).toLowerCase().includes(query));
  }

  @Builder
  agentPicker() {
    Column({ space: 12 }) {
      Text($r('app.string.chat_agent')).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        .width('100%').padding({ top: 12 })
      TextInput({ text: this.agentQuery, placeholder: $r('app.string.search') }).height(48)
        .backgroundColor(this.colors.input).borderRadius(this.colors.corner(14)).padding({ left: 14, right: 14 })
        .onChange((text: string): void => { this.agentQuery = text; })
      List({ space: 8 }) {
        ForEach(this.matchingAgents(), (agent: XopcChatAgent) => {
          ListItem() {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 10 }) {
                Column({ space: 4 }) {
                  Text(agent.name || agent.id).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(agent.description || agent.id).fontSize(12).fontColor(this.colors.secondary)
                    .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                if (agent.id === this.agentId) {
                  SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(20).fontColor([this.colors.accent])
                }
              }.width('100%').padding(14)
            }.width('100%').padding(0).borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14)).backgroundColor(this.colors.input)
              .onClick((): void => { this.agentId = agent.id; this.sheetOpen = false; this.agentQuery = ''; })
          }
        }, (agent: XopcChatAgent): string => agent.id)
        if (!this.matchingAgents().length) {
          ListItem() {
            Text($r('app.string.workspace_no_matches')).fontSize(14).fontColor(this.colors.secondary)
              .width('100%').padding(20).textAlign(TextAlign.Center)
          }
        }
      }.layoutWeight(1).width('100%')
    }.width('100%').height('100%').padding({ left: 20, right: 20, bottom: 20 })
      .backgroundColor(this.colors.panel).alignItems(HorizontalAlign.Start)
  }

  private toggleSearch(): void {
    this.searchOpen = !this.searchOpen;
    if (!this.searchOpen) {
      this.getUIContext().getFocusController().clearFocus();
      this.search = '';
    }
  }

  private async goBack(): Promise<void> {
    if (!this.model.selected && !this.model.openingId && this.searchOpen) {
      this.toggleSearch();
      return;
    }
    if (this.model.openingId) {
      this.model.cancelOpening();
      if (this.initialId) this.onExit();
      return;
    }
    if (this.model.editing) {
      const selected = this.model.selected;
      if (selected && (this.model.title !== selected.title || this.model.body !== selected.body || this.model.cron !== (selected.cron ?? '') || this.model.automationTimeZone !== (selected.automationTimeZone ?? '') || this.model.projectId !== (selected.projectId ?? '') || this.model.priority !== (selected.priority || 'normal') || this.model.dueAt !== selected.dueAt)) {
        try {
          const result = await this.getUIContext().getPromptAction().showDialog({
            title: $r('app.string.back'), message: $r('app.string.discard_changes'),
            buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary }, { text: $r('app.string.confirm'), color: this.colors.danger }]
          });
          if (result.index !== 1) return;
        } catch (_error) { return; }
      }
    }
    if (this.initialTaskAction) { this.onExit(); return; }
    if (this.model.editing && this.model.selected?.id) { this.model.cancelEdit(); return; }
    if (this.createOnAppear) this.onExit();
    else if (this.model.selected && !this.initialId) this.model.back(); else this.onExit();
  }

  private label(action: string): ResourceStr {
    if (action.startsWith('signoff:')) return $r('app.string.task_signoff');
    if (action.startsWith('move:') || action.startsWith('reopen:')) return this.statusLabel(action.split(':')[1]);
    if (action === 'cancel_task') return $r('app.string.task_cancel');
    if (action === 'mark_ready') return $r('app.string.mark_ready');
    if (action === 'request_review') return $r('app.string.request_review');
    if (action === 'close') return $r('app.string.complete');
    if (action === 'reopen') return $r('app.string.reopen');
    if (action === 'start') return $r('app.string.start_task');
    if (action === 'run') return $r('app.string.run_now');
    if (action === 'pause') return $r('app.string.pause');
    if (action === 'resume' || action === 'activate') return $r('app.string.resume');
    if (action === 'delete') return $r('app.string.delete');
    if (action === 'pin') return $r('app.string.pin');
    if (action === 'unpin') return $r('app.string.unpin');
    if (action === 'archive') return $r('app.string.archive');
    return action;
  }

  private supportedActions(item: XopcWorkspaceItem): string[] {
    return item.actions.filter((action: string): boolean => ['mark_ready', 'request_review', 'close', 'reopen', 'start',
      'run', 'pause', 'resume', 'activate', 'delete', 'pin', 'unpin', 'archive'].includes(action));
  }

  private createLabel(): Resource {
    if (this.section === 'automations') return $r('app.string.new_automation');
    if (this.section === 'tasks') return $r('app.string.new_task');
    if (this.section === 'projects') return $r('app.string.new_project');
    return $r('app.string.new_task');
  }

  private openCreate(prompt: string = ''): void {
    if (!this.model.busy) this.onNavigate({ page: this.section === 'projects' ? 'project-create'
      : this.section === 'automations' ? 'automation-setup' : 'task-create', itemId: '', projectId: this.projectId, prompt });
  }

  private statusLabel(status: string): ResourceStr {
    if (status === 'enabled') return $r('app.string.enabled');
    if (status === 'paused') return $r('app.string.paused');
    if (status === 'idle') return $r('app.string.task_execution_idle');
    if (status === 'waiting') return $r('app.string.task_execution_waiting');
    if (status === 'verifying') return $r('app.string.task_execution_verifying');
    if (status === 'blocked') return $r('app.string.task_execution_blocked');
    if (status === 'queued') return $r('app.string.status_queued');
    if (status === 'running') return $r('app.string.status_running');
    if (status === 'succeeded') return $r('app.string.status_succeeded');
    if (status === 'failed') return $r('app.string.status_failed');
    if (status === 'cancelled') return $r('app.string.status_cancelled');
    if (status === 'timeout') return $r('app.string.status_timeout');
    if (status === 'backlog') return $r('app.string.task_phase_backlog');
    if (status === 'ready') return $r('app.string.task_phase_ready');
    if (status === 'in_progress' || status === 'active') return this.section === 'projects'
      ? $r('app.string.project_status_active') : $r('app.string.task_phase_in_progress');
    if (status === 'review') return $r('app.string.task_phase_review');
    if (status === 'closed') return $r('app.string.task_phase_closed');
    if (status === 'archived') return $r('app.string.project_status_archived');
    return status;
  }

  private firstFilterLabel(): ResourceStr {
    if (this.section === 'projects') return $r('app.string.filter_active');
    if (this.section === 'automations') return $r('app.string.filter_enabled');
    return $r('app.string.filter_open');
  }

  private secondFilterLabel(): ResourceStr {
    if (this.section === 'projects') return $r('app.string.filter_archived');
    if (this.section === 'automations') return $r('app.string.filter_paused');
    return $r('app.string.filter_closed');
  }

  private matchesFilter(item: XopcWorkspaceItem, filter: string = this.filter): boolean {
    if (this.section !== 'tasks' && !item.title.toLowerCase().includes(this.search.trim().toLowerCase())) return false;
    if (filter === 'all') return true;
    if (this.section === 'tasks') return filter === 'primary' ? item.status !== 'closed' : item.status === 'closed';
    if (this.section === 'projects') return filter === 'primary' ? item.status !== 'archived' : item.status === 'archived';
    if (filter === 'attention') {
      const status = item.automation?.state?.lastRunStatus;
      return status === 'failed' || status === 'timeout';
    }
    return filter === 'primary' ? item.enabled === true : item.enabled !== true;
  }

  private filteredItems(): XopcWorkspaceItem[] {
    return this.model.items.filter((item: XopcWorkspaceItem): boolean => this.matchesFilter(item));
  }

  private filterCount(filter: string): number {
    return this.model.items.filter((item: XopcWorkspaceItem): boolean => this.matchesFilter(item, filter)).length;
  }

  private filterOptions(): XopcSegmentOption[] {
    const options: XopcSegmentOption[] = [
      { key: 'all', label: $r('app.string.filter_all'), count: this.filterCount('all') },
      { key: 'primary', label: this.firstFilterLabel(), count: this.filterCount('primary') },
      { key: 'secondary', label: this.secondFilterLabel(), count: this.filterCount('secondary') }
    ];
    if (this.section === 'automations') {
      options.push({ key: 'attention', label: $r('app.string.progress_action_required'), count: this.filterCount('attention') });
    }
    return options;
  }

  private formatTime(timestamp?: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const pad = (part: number): string => part.toString().padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private itemSummary(item: XopcWorkspaceItem): string {
    if (this.section === 'projects') return item.brief || item.body || item.outcome || '';
    return item.body;
  }

  private criterionState(info: XopcMobileTaskDetail, criterion: string, index: number): string {
    return taskCriterionState(info, criterion, index);
  }

  private passedCount(info: XopcMobileTaskDetail): number {
    return (info.acceptanceChecks ?? []).filter((criterion: XopcTaskAcceptanceCheck, index: number): boolean =>
      this.criterionState(info, criterion.criterion, index) === 'passed').length;
  }

  private hasHumanReview(info: XopcMobileTaskDetail, index: number): boolean {
    return info.criterionReviews.some((review: XopcMobileTaskReview): boolean =>
      review.checkId === info.acceptanceChecks?.[index]?.id);
  }

  private taskArtifacts(info: XopcMobileTaskDetail): XopcMobileTaskEvidence[] {
    return (this.latestTaskReceipt(info)?.evidence ?? []).filter((evidence: XopcMobileTaskEvidence): boolean =>
      evidence.kind === 'artifact');
  }

  private latestTaskReceipt(info: XopcMobileTaskDetail): XopcMobileTaskReceipt | undefined {
    return info.receipts.reduce((latest: XopcMobileTaskReceipt | undefined, receipt: XopcMobileTaskReceipt): XopcMobileTaskReceipt =>
      !latest || receipt.finalizedAt > latest.finalizedAt ? receipt : latest, undefined);
  }

  private primaryTaskAction(item: XopcWorkspaceItem): string {
    const resultId = taskSignoffResult(item);
    if (resultId) return 'signoff:' + resultId;
    for (const action of ['start', 'mark_ready', 'request_review', 'close', 'reopen']) {
      if (item.actions.includes(action) && (action !== 'close' || item.taskDetail?.runs.length === 0)) {
        return action;
      }
    }
    return '';
  }

  private async action(action: string, listItem?: XopcWorkspaceItem): Promise<void> {
    if (this.model.busy || !action) return;
    if (['delete', 'archive', 'cancel_task', 'run', 'start'].includes(action)) {
      try {
        const result = await this.getUIContext().getPromptAction().showDialog({
          title: this.label(action), message: action === 'cancel_task' ? $r('app.string.task_cancel_help') : $r('app.string.confirm_action_help'),
          buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
            { text: $r('app.string.confirm'), color: this.colors.accent }]
        });
        if (result.index !== 1) return;
      } catch (error) { this.model.error = (error as Error).message; return; }
    }
    if (listItem) {
      await this.model.automationListAction(listItem, action);
    } else if (action === 'run' && this.section === 'automations') {
      const runId = await this.model.startAutomation();
      if (runId) this.onNavigate({ page: 'automation-run', itemId: runId });
    } else {
      await this.model.action(action, this.agentId);
    }
  }

  private openSheet(kind: string): void {
    this.sheetKind = kind; this.sheetOpen = true;
  }

  private taskStatusLabel(item: XopcWorkspaceItem): ResourceStr {
    if (item.status === 'closed' && item.resolution === 'done') return $r('app.string.complete');
    if (item.status === 'closed' && item.resolution === 'cancelled') return $r('app.string.status_cancelled');
    return this.statusLabel(item.status);
  }

  private priorityLabel(priority: string): ResourceStr {
    if (priority === 'low') return $r('app.string.task_priority_low');
    if (priority === 'high') return $r('app.string.task_priority_high');
    if (priority === 'critical') return $r('app.string.task_priority_critical');
    return $r('app.string.task_priority_normal');
  }

  private projectName(id?: string): ResourceStr {
    if (!id) return $r('app.string.task_no_project');
    return this.projects.find((project: XopcWorkspaceItem): boolean => project.id === id)?.title || id;
  }

  private async loadProjects(): Promise<void> {
    if (this.projectsLoading) return;
    this.projectsLoading = true; this.projectsError = '';
    try { this.projects = (await this.workspaceRepository.list('projects', '')).items; }
    catch (error) { this.projectsError = (error as Error).message; }
    finally { this.projectsLoading = false; }
  }

  private matchingProjects(): XopcWorkspaceItem[] {
    const query = this.projectQuery.trim().toLowerCase();
    return this.projects.filter((project: XopcWorkspaceItem): boolean => !query || project.title.toLowerCase().includes(query));
  }

  private pickDueDate(): void {
    this.getUIContext().showDatePickerDialog({ selected: new Date(this.model.dueAt ?? Date.now()),
      onDateAccept: (date: Date): void => {
        date.setHours(23, 59, 59, 999); this.model.dueAt = date.getTime();
      } });
  }


  private async applySheetAction(action: string): Promise<void> {
    await this.action(action);
    if (!this.model.error) this.sheetOpen = false;
  }

  @Builder
  taskActionBar(item: XopcWorkspaceItem) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Button($r('app.string.task_adjust_status')).layoutWeight(1).height(48)
          .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.model.busy)
          .onClick((): void => { this.openSheet('status'); })
        Button($r('app.string.edit')).layoutWeight(1).height(48)
          .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.model.busy && item.editable)
          .onClick((): void => { this.model.editing = true; })
        Button($r('app.string.task_conversation_short')).layoutWeight(1).height(48)
          .backgroundColor(this.colors.accentSoft).fontColor(this.colors.accent).enabled(!this.model.busy)
          .onClick((): void => { this.onNavigate({ page: 'task-chat', itemId: item.id, title: item.title, projectId: item.projectId }); })
      }.width('100%')
      if (this.primaryTaskAction(item)) {
        Button(this.label(this.primaryTaskAction(item))).width('100%').height(48)
          .backgroundColor(this.colors.accent).fontColor(this.colors.onAccent).enabled(!this.model.busy)
          .onClick((): void => {
            if (this.primaryTaskAction(item) === 'start') this.openSheet('status');
            else this.action(this.primaryTaskAction(item));
          })
      }
    }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 12 }).backgroundColor(this.colors.panel)
  }

  @Builder
  taskStatusSheet(item: XopcWorkspaceItem) {
    Column({ space: 12 }) {
      Text($r('app.string.task_adjust_status')).fontSize(20).fontWeight(FontWeight.Bold)
        .fontColor(this.colors.foreground).width('100%')
      Text($r('app.string.task_phase_help')).fontSize(13).lineHeight(20).fontColor(this.colors.secondary).width('100%')
      if (this.model.error) {
        Text(userErrorMessage(this.model.error, 'collection')).fontSize(13).fontColor(this.colors.danger).width('100%')
        Button($r('app.string.refresh')).width('100%').height(44).backgroundColor(this.colors.input)
          .fontColor(this.colors.foreground).enabled(!this.model.busy).onClick((): void => { this.model.refreshDetail(); })
      }
      List({ space: 8 }) {
        if (taskSignoffResult(item)) {
          ListItem() {
            Button($r('app.string.task_signoff')).width('100%').height(48)
              .backgroundColor(this.colors.accent).enabled(!this.model.busy)
              .onClick((): void => { this.applySheetAction('signoff:' + taskSignoffResult(item)); })
          }
        }
        ForEach(['backlog', 'ready', 'active', 'review', 'closed'], (phase: string) => {
          ListItem() {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 8 }) {
                Text(this.statusLabel(phase)).fontSize(16).fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
                if (phase === item.status) {
                  SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(20).fontColor([this.colors.accent])
                }
              }.width('100%').padding({ left: 16, right: 16 })
            }.width('100%').height(48).padding(0).borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12)).backgroundColor(this.colors.input)
              .enabled(!this.model.busy && !!taskPhaseAction(item, phase))
              .onClick((): void => { this.applySheetAction(taskPhaseAction(item, phase)); })
          }
        }, (phase: string): string => phase)
        if (item.status !== 'closed' && !item.actions.includes('move')) {
          ListItem() { Text($r('app.string.task_phase_blocked')).fontSize(13).lineHeight(20).fontColor(this.colors.secondary) }
        }
        if (item.actions.includes('mark_ready') && !item.actions.includes('move')) {
          ListItem() {
            Button(this.label('mark_ready')).width('100%').height(48).backgroundColor(this.colors.input)
              .fontColor(this.colors.foreground).enabled(!this.model.busy)
              .onClick((): void => { this.applySheetAction('mark_ready'); })
          }
        }
        if (item.actions.includes('start')) {
          ListItem() {
            Column({ space: 8 }) {
              Text($r('app.string.start_task')).fontSize(16).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
              Text($r('app.string.task_execution_help')).fontSize(13).lineHeight(20).fontColor(this.colors.secondary)
              if (this.agentsError) {
                Button($r('app.string.refresh')).width('100%').height(44).backgroundColor(this.colors.input)
                  .fontColor(this.colors.foreground).onClick((): void => { this.loadAgents(); })
              }
              Select(this.agents.map((agent: XopcChatAgent): SelectOption => ({ value: agent.name || agent.id })))
                .value(this.selectedAgentName()).width('100%').height(48).fontColor(this.colors.foreground)
                .backgroundColor(this.colors.input).enabled(!this.model.busy && !this.agentsLoading)
                .onSelect((index: number): void => { this.agentId = this.agents[index]?.id || ''; })
              Button(this.label('start')).width('100%').height(48).backgroundColor(this.colors.accent).fontColor(this.colors.onAccent)
                .enabled(!this.model.busy && !this.agentsLoading && this.agents.some((agent: XopcChatAgent): boolean => agent.id === this.agentId))
                .onClick((): void => { this.applySheetAction('start'); })
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
        }
        if (item.actions.includes('close')) {
          ListItem() {
            Column({ space: 8 }) {
              if (item.taskDetail?.runs.length === 0) {
                Button(this.label('close')).width('100%').height(48).backgroundColor(this.colors.input)
                  .fontColor(this.colors.foreground).enabled(!this.model.busy)
                  .onClick((): void => { this.applySheetAction('close'); })
              }

              Button($r('app.string.task_cancel')).width('100%').height(48).backgroundColor(Color.Transparent)
                .fontColor(this.colors.danger).enabled(!this.model.busy)
                .onClick((): void => { this.applySheetAction('cancel_task'); })
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
        }
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
    }.width('100%').height('100%').padding(20).alignItems(HorizontalAlign.Start).backgroundColor(this.colors.panel)
  }

  @Builder
  projectPicker() {
    Column({ space: 12 }) {
      Text($r('app.string.workspace_project')).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
      TextInput({ text: this.projectQuery, placeholder: $r('app.string.search') }).height(48)
        .backgroundColor(this.colors.input).onChange((text: string): void => { this.projectQuery = text; })
      List({ space: 8 }) {
        ListItem() {
          Button($r('app.string.task_no_project')).width('100%').height(48).backgroundColor(this.colors.input)
            .fontColor(this.colors.foreground).onClick((): void => { this.model.projectId = ''; this.sheetOpen = false; })
        }
        if (this.projectsLoading) { ListItem() { XopcListSkeleton() } }
        if (this.projectsError) {
          ListItem() {
            Text(userErrorMessage(this.projectsError, 'collection')).fontSize(13).fontColor(this.colors.secondary)
          }
          ListItem() {
            Button($r('app.string.refresh')).width('100%').height(44).backgroundColor(this.colors.input)
              .fontColor(this.colors.foreground).onClick((): void => { this.loadProjects(); })
          }
        }
        ForEach(this.matchingProjects(), (project: XopcWorkspaceItem) => {
          ListItem() {
            Button(project.title).width('100%').constraintSize({ minHeight: 48 }).backgroundColor(this.colors.input)
              .fontColor(this.colors.foreground).onClick((): void => { this.model.projectId = project.id; this.sheetOpen = false; })
          }
        }, (project: XopcWorkspaceItem): string => project.id)
        if (!this.projectsLoading && !this.projectsError && !this.matchingProjects().length) {
          ListItem() { Text($r('app.string.workspace_no_matches')).fontSize(14).fontColor(this.colors.secondary) }
        }
      }.layoutWeight(1).width('100%')
    }.width('100%').height('100%').padding(20).alignItems(HorizontalAlign.Start).backgroundColor(this.colors.panel)
  }

  @Builder
  workspaceSheet() {
    if (this.sheetKind === 'status' && this.model.selected) { this.taskStatusSheet(this.model.selected) }
    else if (this.sheetKind === 'project') { this.projectPicker() }
    else { this.agentPicker() }
  }

  @Builder
  automationFilterMenu() {
    Menu() {
      ForEach(this.filterOptions(), (option: XopcSegmentOption) => {
        MenuItem({ content: option.label }).id('automation-filter-' + option.key)
          .selected(this.filter === option.key).selectIcon(true).contentFontColor(this.colors.foreground)
          .onChange((): void => {
            this.filter = option.key;
            appSettings.rememberPageSelection('automation-filter', option.key);
          })
      }, (option: XopcSegmentOption): string => option.key)
    }.width(196).borderRadius(this.colors.corner(18)).backgroundColor(this.colors.panel)
  }

  @Builder
  automationCard(item: XopcWorkspaceItem) {
    Stack({ alignContent: Alignment.TopEnd }) {
      Button({ type: ButtonType.Normal }) {
        Column({ space: 8 }) {
          Text(this.statusLabel(item.status)).fontSize(12).fontWeight(FontWeight.Medium)
            .fontColor(item.enabled ? this.colors.accent : this.colors.secondary).width('100%')
          Text(item.title || $r('app.string.untitled')).fontSize(17).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (item.body.trim()) {
            Text(item.body).fontSize(14).fontColor(this.colors.secondary).width('100%')
              .maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          Row({ space: 8 }) {
            SymbolGlyph($r('sys.symbol.clock')).fontSize(14).fontColor([this.colors.secondary]).accessibilityLevel('no')
            Text(this.automationScheduleLabel(item))
              .fontSize(12).fontColor(this.colors.secondary).layoutWeight(1)
              .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
            if (item.enabled && item.automation?.state?.nextRunAtMs) {
              Text(this.formatTime(item.automation?.state?.nextRunAtMs)).fontSize(12).fontColor(this.colors.secondary)
            }
          }.width('100%').padding({ top: 5 })
        }.width('100%').padding({ left: 16, right: 55, top: 14, bottom: 16 }).alignItems(HorizontalAlign.Start)
      }.id('automation-' + item.id).width('100%').padding(0)
        .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(18)).clipShape(this.colors.cornerClip(18))
        .onClick((): void => { void this.model.open(item.id); }, SEGMENTED_PAGE_TAP_SLOP_VP)
      if (item.editable || item.actions.some((action: string): boolean => ['pause', 'resume', 'delete'].includes(action))) {
        this.automationMore(item, true)
      }
    }.width('100%')
  }

  @Builder
  workspaceCard(item: XopcWorkspaceItem) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 10 }) {
        Row({ space: 10 }) {
          Row() {
            SymbolGlyph(this.section === 'projects' ? $r('sys.symbol.folder')
              : $r('sys.symbol.doc_text'))
              .fontSize(21).fontColor([this.colors.accent])
          }.width(40).height(40).justifyContent(FlexAlign.Center).borderRadius(20).backgroundColor(this.colors.accentSoft)
          Column({ space: 4 }) {
            Text(item.title || $r('app.string.untitled')).fontSize(16).lineHeight(22).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground).width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.statusLabel(item.status)).fontSize(12).fontWeight(FontWeight.Medium)
              .fontColor(item.status === 'failed' ? this.colors.danger : item.status === 'review' ? this.colors.attentionForeground
                : item.enabled || item.status === 'active'
                || item.status === 'in_progress' || item.status === 'ready' ? this.colors.accent : this.colors.secondary)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
        }.width('100%')
        if (this.itemSummary(item)) {
          Text(this.itemSummary(item)).fontSize(14).lineHeight(20).fontColor(this.colors.secondary)
            .width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        if ((this.section === 'tasks' && !!(item.projectId || item.priority))
          || (this.section === 'projects' && !!item.outcome)) {
          Row({ space: 8 }) {
            if (this.section === 'tasks' && item.projectId) {
              SymbolGlyph($r('sys.symbol.folder')).fontSize(13).fontColor([this.colors.tertiary])
              Text(item.projectId).fontSize(12).fontColor(this.colors.tertiary).maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
            }
            if (this.section === 'tasks' && item.priority) {
              Text(item.priority).fontSize(11).fontColor(this.colors.secondary).backgroundColor(this.colors.input)
                .borderRadius(this.colors.corner(9)).padding({ left: 8, right: 8, top: 2, bottom: 2 })
            }
            if (this.section === 'projects' && item.outcome) {
              SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(13).fontColor([this.colors.tertiary])
              Text(item.outcome).fontSize(12).fontColor(this.colors.tertiary).maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
            }
          }.width('100%')
        }
      }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
    }.width('100%').padding(0).backgroundColor(this.colors.panel).borderRadius(this.colors.corner(18)).clipShape(this.colors.cornerClip(18))
      .onClick((): void => {
        if (this.section === 'projects') this.onNavigate({ page: 'project-detail', itemId: item.id });
        else if (this.embeddedInWorkbench) this.onNavigate({ page: 'tasks', itemId: item.id });
        else { this.model.open(item.id); }
      }, SEGMENTED_PAGE_TAP_SLOP_VP)
  }

  @Builder
  list() {
    Column({ space: 12 }) {
      if (this.section === 'tasks') {
        Row({ space: 8 }) {
          TextInput({ text: this.search, placeholder: $r('app.string.search') }).layoutWeight(1).height(44)
            .backgroundColor(this.colors.input).borderRadius(this.colors.corner(22)).padding({ left: 16, right: 16 })
            .onChange((text: string): void => { this.search = text; }).onSubmit((): void => { this.model.list(this.search); })
        }.width('100%')
      } else if (this.searchOpen) {
        XopcPageSearchField({ searchId: this.section + '-search', text: this.search,
          onChange: (text: string): void => { this.search = text; },
          onSubmit: (): void => { this.getUIContext().getFocusController().clearFocus(); } })
      }
      if (this.section !== 'automations') {
        XopcSegmentedTabs({ options: this.filterOptions(), selectedKey: this.filter,
          onSelect: (key: string): void => { this.filter = key; } })
      }
    }.width('100%').padding({ left: 20, right: 20, bottom: 8 }).alignItems(HorizontalAlign.Start)
    List({ space: 12 }) {
      if (this.model.busy && !this.model.items.length) {
        ListItem() { XopcListSkeleton() }
      }
      ForEach(this.filteredItems(), (item: XopcWorkspaceItem) => {
        ListItem() { if (this.section === 'automations') this.automationCard(item); else this.workspaceCard(item); }
      }, (item: XopcWorkspaceItem): string => item.id + ':' + item.version + ':' + item.title + ':' + item.status)
      if (!this.model.busy && this.section === 'automations' && !this.model.error && !this.model.hasMore
        && this.filter === 'all' && !this.search.trim() && !this.model.loadedSearch) {
        ListItem() {
          Column({ space: 14 }) {
            if (!this.model.items.length) {
              Column({ space: 7 }) {
                SymbolGlyph($r('sys.symbol.clock')).fontSize(30).fontColor([this.colors.secondary])
              Text($r('app.string.automation_setup_heading')).fontSize(20).fontWeight(FontWeight.Bold)
                .fontColor(this.colors.foreground).textAlign(TextAlign.Center)
              Text($r('app.string.automation_setup_hint')).fontSize(14).lineHeight(20)
                .fontColor(this.colors.secondary).textAlign(TextAlign.Center)
              }.width('100%').padding({ top: 20, bottom: 10 })
            }
            XopcAutomationIdeas({ projectScoped: !!this.projectId, onChoose: (prompt: string): void => { this.openCreate(prompt); } })
          }.width('100%')
        }
      } else if (!this.model.busy && !this.model.hasMore && this.filteredItems().length === 0) {
        ListItem() {
          Column({ space: 10 }) {
            SymbolGlyph($r('sys.symbol.list_bullet')).fontSize(30).fontColor([this.colors.tertiary])
            Text(this.model.items.length || (this.section !== 'tasks' && this.search.trim())
              ? $r('app.string.workspace_no_matches') : $r('app.string.empty_list'))
              .fontSize(14).fontColor(this.colors.secondary).textAlign(TextAlign.Center)
          }.width('100%').padding({ top: 32, bottom: 32 })
        }
      }
      if (this.model.hasMore) {
        ListItem() {
          XopcPaginationFooter({ loadingPage: this.model.busy, failedPage: !!this.model.error,
            onLoad: (): void => { void this.model.list(this.model.loadedSearch, true); } })
        }
      }
    }.layoutWeight(1).padding({ left: 20, right: 20, bottom: 20 }).width('100%').scrollBar(BarState.Off)
  }

  private async editAutomation(item: XopcWorkspaceItem, fromList: boolean): Promise<void> {
    if (fromList) await this.model.open(item.id);
    if (this.model.selected?.id === item.id && this.model.selected?.editable) {
      this.automationAdvancedSchedule = false;
      this.model.editing = true;
    }
  }

  @Builder
  automationMore(item: XopcWorkspaceItem, fromList: boolean) {
    XopcAutomationActionMenu({
      menuId: fromList ? 'automation-card-menu-' + item.id : 'automation-detail-menu',
      inList: fromList, busy: this.model.busy, editable: item.editable,
      toggleable: item.actions.includes('pause') || item.actions.includes('resume'),
      enabledAutomation: item.enabled === true, deletable: item.actions.includes('delete'),
      onEdit: (): void => { void this.editAutomation(item, fromList); },
      onToggle: (): void => { void this.action(item.enabled ? 'pause' : 'resume', item); },
      onDelete: (): void => { void this.action('delete', fromList ? item : undefined); }
    }).margin(fromList ? { top: 4, right: 5 } : 0)
  }

  private automationScheduleLabel(item: XopcWorkspaceItem, expression: string = item.cron ?? ''): ResourceStr {
    const schedule = item.automation?.trigger.schedule;
    if (!expression) {
      if (schedule?.kind === 'once' && schedule.at) {
        const time = this.formatTime(Date.parse(schedule.at));
        return time ? $r('app.string.automation_once_at', time) : $r('app.string.automation_custom_schedule');
      }
      if (schedule?.kind === 'interval' && schedule.everyMs) {
        if (schedule.everyMs % 3600000 === 0) return $r('app.string.automation_every_hours', schedule.everyMs / 3600000);
        if (schedule.everyMs % 60000 === 0) return $r('app.string.automation_every_minutes', schedule.everyMs / 60000);
        return $r('app.string.automation_custom_schedule');
      }
      return item.automation?.trigger.kind === 'manual' ? $r('app.string.manual_trigger') : $r('app.string.automation_custom_schedule');
    }
    const summary = automationCronLabel(expression);
    const time = summary.time ?? '';
    const value = summary.value ?? 0;
    if (summary.cadence === 'daily') return $r('app.string.automation_daily_at', time);
    if (summary.cadence === 'workdays') return $r('app.string.automation_workday_at', time);
    if (summary.cadence === 'weekday') {
      const weekdays: Resource[] = [$r('app.string.automation_weekday_sun'), $r('app.string.automation_weekday_mon'),
        $r('app.string.automation_weekday_tue'), $r('app.string.automation_weekday_wed'), $r('app.string.automation_weekday_thu'),
        $r('app.string.automation_weekday_fri'), $r('app.string.automation_weekday_sat')];
      const day = this.getUIContext().getHostContext()?.resourceManager.getStringSync(weekdays[value].id) ?? '';
      return $r('app.string.automation_weekly_at', day, time);
    }
    if (summary.cadence === 'monthly') return $r('app.string.automation_monthly_at', value, time);
    if (summary.cadence === 'minutes') return $r('app.string.automation_every_minutes', value);
    if (summary.cadence === 'hours') return $r('app.string.automation_every_hours', value);
    return $r('app.string.automation_custom_schedule');
  }

  @Builder
  automationDetail(item: XopcWorkspaceItem) {
    List({ space: 12 }) {
      ListItem() {
        Column({ space: 9 }) {
          Text(item.title || $r('app.string.untitled')).id('automation-detail-title')
            .fontSize(24).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground).width('100%')
          Row({ space: 10 }) {
            Row({ space: 6 }) {
              Circle().width(6).height(6).fill(item.enabled ? this.colors.success : this.colors.tertiary)
                .accessibilityLevel('no')
              Text(this.statusLabel(item.status)).fontSize(12).fontWeight(FontWeight.Medium)
                .fontColor(this.colors.foreground)
            }.padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
            if (item.projectId) Text(this.projectName(item.projectId)).fontSize(13).fontColor(this.colors.secondary)
              .layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          }.width('100%')
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 6, bottom: 8 })
      }
      ListItem() {
        Column({ space: 9 }) {
          Row({ space: 9 }) {
            SymbolGlyph($r('sys.symbol.clock')).fontSize(18).fontColor([this.colors.secondary]).accessibilityLevel('no')
            if (item.enabled && item.automation?.state?.nextRunAtMs) {
              Text($r('app.string.workspace_next_run')).fontSize(14).fontColor(this.colors.secondary).layoutWeight(1)
              Text(this.formatTime(item.automation?.state?.nextRunAtMs)).fontSize(16).fontWeight(FontWeight.Medium)
                .fontColor(this.colors.foreground)
            } else {
              Text(!item.enabled ? $r('app.string.automation_pause_notice')
                : item.automation?.trigger.kind === 'manual' ? $r('app.string.manual_trigger') : $r('app.string.schedule'))
                .fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1)
            }
          }.width('100%')
          if (item.automation?.trigger.kind !== 'manual') {
            Text(this.automationScheduleLabel(item)).id('automation-detail-schedule')
              .fontSize(14).fontColor(this.colors.secondary).width('100%')
          }
          if (item.automationTimeZone) {
            Text(item.automationTimeZone).fontSize(12).fontColor(this.colors.tertiary).width('100%')
          }
        }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
          .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(17))
      }
      ListItem() {
        Row({ space: 12 }) {
          if (item.actions.includes('run')) {
            Button($r('app.string.run_now')).id('automation-run-now').layoutWeight(1).height(48)
              .backgroundColor(this.colors.chat.action).fontColor(this.colors.chat.onAction).enabled(!this.model.busy)
              .onClick((): void => { void this.action('run'); })
          }
          if (item.actions.includes('pause') || item.actions.includes('resume')) {
            Button(item.enabled ? $r('app.string.pause') : $r('app.string.resume')).id('automation-toggle').layoutWeight(1).height(48)
              .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.model.busy)
              .onClick((): void => { void this.action(item.enabled ? 'pause' : 'resume'); })
          }
        }.width('100%').margin({ top: 5 })
      }
      if (item.body.trim()) {
        ListItem() {
          Button({ type: ButtonType.Normal }) {
            Column({ space: 8 }) {
              Row() {
                Text($r('app.string.automation_instruction')).fontSize(14).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.foreground).layoutWeight(1)
                SymbolGlyph(this.expandedInstructionId === item.id ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
                  .fontSize(14).fontColor([this.colors.secondary]).accessibilityLevel('no')
              }.width('100%')
              if (this.expandedInstructionId === item.id) {
                Text(item.body).fontSize(14).lineHeight(21).fontColor(this.colors.foreground).width('100%')
              } else {
                Text(item.body).fontSize(14).lineHeight(21).fontColor(this.colors.secondary).width('100%')
                  .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
              }
            }.width('100%').alignItems(HorizontalAlign.Start).padding(16)
          }.id('automation-instruction-toggle').width('100%').padding(0)
            .backgroundColor(this.colors.panel).borderRadius(this.colors.corner(17)).clipShape(this.colors.cornerClip(17))
            .accessibilityDescription(this.expandedInstructionId === item.id
              ? $r('app.string.chat_collapse_content') : $r('app.string.chat_view_more'))
            .onClick((): void => { this.expandedInstructionId = this.expandedInstructionId === item.id ? '' : item.id; })
        }
      }
      ListItem() {
        Text($r('app.string.recent_runs')).fontSize(15).fontWeight(FontWeight.Medium)
          .fontColor(this.colors.foreground).width('100%').padding({ top: 10, bottom: 2 })
      }
      if (!this.model.runs.length) {
        ListItem() { Text($r('app.string.no_runs')).fontSize(14).fontColor(this.colors.tertiary).width('100%') }
      }
      ForEach(this.model.runs, (run: XopcAutomationRun) => {
        ListItem() {
          XopcHubRow({ heading: this.statusLabel(run.status),
            summary: [this.formatTime(run.startedAtMs ?? run.createdAtMs), run.error ?? run.summary ?? ''].filter((part: string): boolean => !!part).join(' · '),
            symbol: run.status === 'succeeded' ? $r('sys.symbol.checkmark_circle') : run.status === 'failed' || run.status === 'timeout'
              ? $r('sys.symbol.exclamationmark_circle') : $r('sys.symbol.clock'),
            onOpen: (): void => { this.onNavigate({ page: 'automation-run', itemId: run.id }); } })
        }.id('automation-run-' + run.id)
      }, (run: XopcAutomationRun): string => run.id + ':' + run.status)
    }.layoutWeight(1).width('100%').padding({ left: 20, right: 20 }).scrollBar(BarState.Off)
  }

  @Builder
  taskDetailView(item: XopcWorkspaceItem, info: XopcMobileTaskDetail) {
    List({ space: 12 }) {
      ListItem() {
        Column({ space: 12 }) {
          Button({ type: ButtonType.Normal }) {
            Row({ space: 8 }) {
              Text(this.taskStatusLabel(item)).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
              SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(13).fontColor([this.colors.accent])
            }.padding({ left: 12, right: 12 })
          }.height(44).padding(0).borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12)).backgroundColor(this.colors.accentSoft)
            .accessibilityText($r('app.string.task_adjust_status')).enabled(!this.model.busy)
            .onClick((): void => { this.openSheet('status'); })
          Text(item.title || $r('app.string.untitled')).fontSize(21).lineHeight(29).fontWeight(FontWeight.Bold)
            .fontColor(this.colors.foreground).width('100%')
          if (item.projectId) {
            Text(this.projectName(item.projectId)).fontSize(13).fontColor(this.colors.secondary).width('100%')
          }
          Row({ space: 8 }) {
            Text($r('app.string.workspace_priority')).fontSize(13).fontColor(this.colors.secondary)
            Text(this.priorityLabel(item.priority || 'normal')).fontSize(13).fontColor(this.colors.foreground)
          }
          if (item.dueAt !== undefined) {
            Row({ space: 8 }) {
              Text($r('app.string.task_due_date')).fontSize(13).fontColor(this.colors.secondary)
              Text(this.formatTime(item.dueAt)).fontSize(13).fontColor(this.colors.foreground)
            }
          }
        }.width('100%').padding(18).alignItems(HorizontalAlign.Start)
          .borderRadius(this.colors.corner(20)).backgroundColor(this.colors.panel)
      }
      if ((info.phaseChanges?.length ?? 0) > 0) {
        ForEach(info.phaseChanges ?? [], (change: XopcTaskPhaseChange) => {
          ListItem() {
            Column({ space: 8 }) {
              Text($r('app.string.task_change_log')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
              Row({ space: 6 }) {
                Text(this.statusLabel(change.fromPhase)).fontColor(this.colors.foreground)
                if (change.fromResolution) { Text(change.fromResolution).fontSize(12).fontColor(this.colors.secondary) }
                Text('→').fontColor(this.colors.secondary)
                Text(this.statusLabel(change.toPhase)).fontColor(this.colors.foreground)
              }
              Text(change.actor.kind + ' · ' + (change.actor.id ?? '') + ' · ' + change.source + ' · ' + this.formatTime(change.createdAt))
                .fontSize(12).fontColor(this.colors.secondary)
              if (change.toResolution) { Text(change.toResolution).fontSize(12).fontColor(this.colors.secondary) }
            }.width('100%').padding(16).alignItems(HorizontalAlign.Start).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
          }
        }, (change: XopcTaskPhaseChange): string => change.id)
      }
      if (info.attention.length > 0) {
        ListItem() {
          Column({ space: 9 }) {
            Text($r('app.string.task_needs_attention')).fontSize(15).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.attentionForeground)
            ForEach(info.attention, (attention: XopcMobileTaskAttention) => {
              Text(attention.summary).fontSize(14).lineHeight(21).fontColor(this.colors.foreground).width('100%')
            }, (attention: XopcMobileTaskAttention, index: number): string => attention.kind + ':' + index.toString())
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
            .backgroundColor(this.colors.attentionFill).borderRadius(this.colors.corner(16))
        }
      }
      ListItem() {
        Column({ space: 12 }) {
          Row({ space: 8 }) {
            Text($r('app.string.task_goal_acceptance')).fontSize(16).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground).layoutWeight(1)
            if ((info.acceptanceChecks?.length ?? 0) > 0) {
              Text(this.passedCount(info).toString() + '/' + (info.acceptanceChecks?.length ?? 0).toString())
                .fontSize(12).fontColor(this.colors.secondary).padding({ left: 9, right: 9, top: 4, bottom: 4 })
                .borderRadius(this.colors.corner(10)).backgroundColor(this.colors.input)
            }
          }.width('100%')
          Text(info.contract?.objective || item.title).fontSize(15).lineHeight(23).fontColor(this.colors.foreground)
            .width('100%')
          if (info.presentation?.reason) {
            Text(info.presentation?.reason ?? '').fontSize(14).fontColor(this.colors.secondary).width('100%')
          }
          if ((info.acceptanceChecks?.length ?? 0) > 0) {
            ForEach(info.acceptanceChecks ?? [], (check: XopcTaskAcceptanceCheck, index: number) => {
              Row({ space: 10 }) {
                SymbolGlyph(this.criterionState(info, check.criterion, index) === 'passed' ? $r('sys.symbol.checkmark_circle')
                  : this.criterionState(info, check.criterion, index) === 'failed' ? $r('sys.symbol.exclamationmark_circle')
                  : $r('sys.symbol.circle')).fontSize(18)
                  .fontColor([this.criterionState(info, check.criterion, index) === 'passed' ? this.colors.accent
                    : this.criterionState(info, check.criterion, index) === 'failed' ? this.colors.danger : this.colors.tertiary])
                Column({ space: 3 }) {
                  Text(check.criterion).fontSize(14).lineHeight(20).fontColor(this.colors.foreground).width('100%')
                  Text(this.criterionState(info, check.criterion, index) === 'passed' ? $r('app.string.task_criterion_passed')
                    : this.criterionState(info, check.criterion, index) === 'failed' ? $r('app.string.task_criterion_failed')
                    : $r('app.string.task_criterion_pending')).fontSize(12).fontColor(this.colors.secondary)
                  if (this.hasHumanReview(info, index)) {
                    Text($r('app.string.task_human_review')).fontSize(11).fontColor(this.colors.tertiary)
                  } else if (this.criterionState(info, check.criterion, index) === 'passed') {
                    Text($r('app.string.task_verified_evidence')).fontSize(11).fontColor(this.colors.tertiary)
                  }
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                if (taskReviewAction(item, check.id, this.criterionState(info, check.criterion, index))) {
                  Button(this.criterionState(info, check.criterion, index) === 'passed'
                    ? $r('app.string.task_criterion_clear_review') : $r('app.string.task_criterion_mark_passed'))
                    .buttonStyle(ButtonStyleMode.TEXTUAL).enabled(!this.model.busy)
                    .onClick((): void => { this.action(taskReviewAction(item, check.id, this.criterionState(info, check.criterion, index))); })
                }
              }.width('100%').alignItems(VerticalAlign.Top)
            }, (check: XopcTaskAcceptanceCheck): string => check.id)
          } else {
            Text($r('app.string.task_no_acceptance')).fontSize(13).fontColor(this.colors.secondary)
          }
          if ((info.contract?.expectedOutputs.length ?? 0) > 0) {
            Text($r('app.string.task_expected_outputs')).fontSize(13).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary).margin({ top: 4 })
            ForEach(info.contract?.expectedOutputs ?? [], (output: string, index: number) => {
              Text('• ' + output).fontSize(14).lineHeight(20).fontColor(this.colors.foreground).width('100%')
            }, (output: string, index: number): string => index.toString() + ':' + output)
          }
        }.width('100%').padding(18).alignItems(HorizontalAlign.Start)
          .borderRadius(this.colors.corner(18)).backgroundColor(this.colors.panel)
      }
      if (this.latestTaskReceipt(info)) {
        ListItem() {
          Column({ space: 9 }) {
            Text($r('app.string.task_latest_result')).fontSize(15).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground)
            Text(this.latestTaskReceipt(info)?.summary ?? '').fontSize(14).lineHeight(21)
              .fontColor(this.colors.foreground).width('100%')
            if ((this.latestTaskReceipt(info)?.remainingWork.length ?? 0) > 0) {
              Text($r('app.string.task_remaining_work')).fontSize(12).fontColor(this.colors.secondary)
              ForEach(this.latestTaskReceipt(info)?.remainingWork ?? [], (work: string, index: number) => {
                Text('• ' + work).fontSize(13).lineHeight(19).fontColor(this.colors.secondary).width('100%')
              }, (work: string, index: number): string => index.toString() + ':' + work)
            }
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
            .borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
        }
      }
      if (info.context.some((edge: XopcMobileTaskContext): boolean => edge.role === 'deliverable' || edge.role === 'evidence')
        || this.taskArtifacts(info).length > 0) {
        ListItem() {
          Column({ space: 10 }) {
            Text($r('app.string.task_deliverables')).fontSize(15).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground)
            ForEach(info.context.filter((edge: XopcMobileTaskContext): boolean =>
              edge.role === 'deliverable' || edge.role === 'evidence'), (edge: XopcMobileTaskContext) => {
              Row({ space: 9 }) {
                SymbolGlyph($r('sys.symbol.doc_text')).fontSize(17).fontColor([this.colors.accent])
                Text(edge.title || edge.targetId).fontSize(14).lineHeight(20).fontColor(this.colors.foreground)
                  .layoutWeight(1)
              }.width('100%')
            }, (edge: XopcMobileTaskContext): string => edge.id)
            ForEach(this.taskArtifacts(info), (evidence: XopcMobileTaskEvidence) => {
              Row({ space: 9 }) {
                SymbolGlyph($r('sys.symbol.doc_text')).fontSize(17).fontColor([this.colors.accent])
                Text(evidence.title).fontSize(14).lineHeight(20).fontColor(this.colors.foreground)
                  .layoutWeight(1)
              }.width('100%')
            }, (evidence: XopcMobileTaskEvidence): string => evidence.title + ':' + (evidence.uri ?? ''))
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
            .borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
        }
      }
      if (info.sessions.length > 0 || info.runs.length > 0 || info.dependencies.length > 0 || info.dependents.length > 0) {
        ListItem() {
          Column({ space: 10 }) {
            Text($r('app.string.task_related_work')).fontSize(15).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground)
            if (info.sessions.length > 0) {
              Text($r('app.string.task_conversations')).fontSize(12).fontColor(this.colors.secondary)
              ForEach(info.sessions, (session: XopcMobileTaskSession) => {
                Button({ type: ButtonType.Normal }) {
                  Row({ space: 8 }) {
                    SymbolGlyph($r('sys.symbol.message')).fontSize(16).fontColor([this.colors.accent])
                    Text(session.conversationId === info.activeConversationId
                      ? $r('app.string.task_current_conversation') : $r('app.string.task_previous_conversation'))
                      .fontSize(14).fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
                    SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(13).fontColor([this.colors.tertiary])
                  }.width('100%').padding({ left: 12, right: 12 })
                }.width('100%').height(44).padding(0).borderRadius(this.colors.corner(12)).clipShape(this.colors.cornerClip(12)).backgroundColor(this.colors.input)
                  .onClick((): void => {
                    if (session.conversationId === info.activeConversationId) {
                      this.onNavigate({ page: 'task-chat', itemId: item.id, title: item.title, projectId: item.projectId });
                    } else {
                      this.onNavigate({ page: 'chat', itemId: session.conversationId });
                    }
                  })
              }, (session: XopcMobileTaskSession): string => session.id)
            }
            if (info.runs.length > 0) {
              Row({ space: 6 }) {
                Text($r('app.string.task_run_count')).fontSize(13).fontColor(this.colors.secondary)
                Text(info.runs.length.toString()).fontSize(13).fontColor(this.colors.foreground)
              }
            }
            if (info.dependencies.length > 0 || info.dependents.length > 0) {
              Text($r('app.string.task_dependencies')).fontSize(12).fontColor(this.colors.secondary)
              ForEach(info.dependencies, (dependency: XopcMobileTaskDependency) => {
                Button(dependency.title).width('100%').height(44).backgroundColor(this.colors.input)
                  .fontColor(this.colors.foreground).onClick((): void => {
                    this.onNavigate({ page: 'tasks', itemId: dependency.id });
                  })
              }, (dependency: XopcMobileTaskDependency): string => dependency.id)
              if (info.dependents.length > 0) {
                Row({ space: 6 }) {
                  Text($r('app.string.task_dependent_count')).fontSize(13).fontColor(this.colors.secondary)
                  Text(info.dependents.length.toString()).fontSize(13).fontColor(this.colors.foreground)
                }
              }
            }
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
            .borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
        }
      }
      if (item.body && item.body !== info.contract?.objective) {
        ListItem() {
          Column({ space: 8 }) {
            Text($r('app.string.workspace_description')).fontSize(14).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary)
            XopcMarkdownView({ content: item.body })
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
            .borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
        }
      }
      if (item.priority || item.updatedAt || info.operationalState) {
        ListItem() {
          Column({ space: 8 }) {
            Text($r('app.string.workspace_details')).fontSize(14).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary)
            if (info.operationalState) {
              Row({ space: 8 }) {
                Text($r('app.string.task_execution_state')).fontSize(13).fontColor(this.colors.secondary)
                Text(this.statusLabel(info.operationalState)).fontSize(13).fontColor(this.colors.foreground)
              }
            }
            if (item.priority) { Text(this.priorityLabel(item.priority)).fontSize(13).fontColor(this.colors.foreground) }
            if (item.updatedAt) { Text(this.formatTime(item.updatedAt)).fontSize(13).fontColor(this.colors.secondary) }
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
            .borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
        }
      }
      ListItem() { Column().height(24) }
    }.layoutWeight(1).width('100%').padding({ left: 20, right: 20, bottom: 20 }).scrollBar(BarState.Off)
  }

  @Builder
  detail(item: XopcWorkspaceItem) {
    if (this.section === 'automations' && !this.model.editing) {
      this.automationDetail(item)
    } else if (this.section === 'tasks' && !this.model.editing && item.taskDetail) {
      this.taskDetailView(item, item.taskDetail)
    } else {
    List({ space: 12 }) {
      if (this.model.editing) {
        ListItem() {
          Column({ space: 8 }) {
            Text($r('app.string.name')).fontSize(13).fontColor(this.colors.secondary).width('100%')
            TextInput({ text: this.model.title, placeholder: $r('app.string.name') }).height(48)
              .backgroundColor(this.colors.input).borderRadius(this.colors.corner(14)).padding({ left: 14, right: 14 })
            .onChange((text: string): void => { this.model.title = text; })
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        ListItem() {
          Column({ space: 8 }) {
            Text($r('app.string.workspace_description'))
              .fontSize(13).fontColor(this.colors.secondary).width('100%')
            TextArea({ text: this.model.body, placeholder: $r('app.string.description') }).height(220)
              .backgroundColor(this.colors.input).borderRadius(this.colors.corner(14)).padding(14)
              .onChange((text: string): void => { this.model.body = text; })
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        if (this.section === 'automations') {
          ListItem() {
            Column({ space: 8 }) {
              Text($r('app.string.schedule')).fontSize(14).fontColor(this.colors.secondary).width('100%')
              Text(this.automationScheduleLabel(item, this.model.cron)).width('100%')
                .fontSize(16).fontColor(this.colors.foreground)
              Button($r('app.string.automation_advanced_schedule')).id('automation-edit-advanced').height(44)
                .backgroundColor(this.colors.panel).fontColor(this.colors.accent)
                .onClick((): void => { this.automationAdvancedSchedule = !this.automationAdvancedSchedule; })
              if (this.automationAdvancedSchedule) {
                TextInput({ text: this.model.cron, placeholder: $r('app.string.cron_help') }).id('automation-edit-cron')
                  .height(50).backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
                  .onChange((text: string): void => { this.model.cron = text; })
              }
            }.width('100%')
          }
          ListItem() {
            Column({ space: 8 }) {
              Text($r('app.string.automation_timezone')).fontSize(14).fontColor(this.colors.secondary).width('100%')
              TextInput({ text: this.model.automationTimeZone, placeholder: $r('app.string.automation_gateway_timezone') })
                .id('automation-edit-timezone').height(50).backgroundColor(this.colors.input).borderRadius(this.colors.corner(14))
                .onChange((text: string): void => { this.model.automationTimeZone = text; })
            }.width('100%')
          }
          if (this.model.projectId) {
            ListItem() {
              XopcHubRow({ heading: $r('app.string.automation_delivery'), summary: this.projectName(this.model.projectId),
                symbol: $r('sys.symbol.folder'), navigable: false })
            }
          }
        }
        if (this.section === 'tasks') {
          ListItem() {
            Column({ space: 8 }) {
              Text($r('app.string.workspace_project')).fontSize(13).fontColor(this.colors.secondary).width('100%')
              Button(this.projectName(this.model.projectId)).width('100%').height(48)
                .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.model.busy)
                .onClick((): void => { this.projectQuery = ''; this.openSheet('project'); })
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
        }
        if (this.section === 'tasks') {
          ListItem() {
            Column({ space: 8 }) {
              Text($r('app.string.workspace_priority')).fontSize(13).fontColor(this.colors.secondary)
              Select([{ value: $r('app.string.task_priority_low') }, { value: $r('app.string.task_priority_normal') },
                { value: $r('app.string.task_priority_high') }, { value: $r('app.string.task_priority_critical') }])
                .value(this.priorityLabel(this.model.priority)).width('100%').height(48)
                .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.model.busy)
                .onSelect((index: number): void => { this.model.priority = ['low', 'normal', 'high', 'critical'][index]; })
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
          ListItem() {
            Column({ space: 8 }) {
              Text($r('app.string.task_due_date')).fontSize(13).fontColor(this.colors.secondary)
              Button(this.model.dueAt !== undefined ? this.formatTime(this.model.dueAt) : $r('app.string.task_no_due_date'))
                .width('100%').height(48).backgroundColor(this.colors.input).fontColor(this.colors.foreground)
                .enabled(!this.model.busy).onClick((): void => { this.pickDueDate(); })
              if (this.model.dueAt !== undefined) {
                Button($r('app.string.task_clear_due_date')).width('100%').height(44)
                  .backgroundColor(Color.Transparent).fontColor(this.colors.accent).enabled(!this.model.busy)
                  .onClick((): void => { this.model.dueAt = undefined; })
              }
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
        }
        ListItem() {
          Button(this.section === 'automations' ? $r('app.string.automation_save_rule') : $r('app.string.save'))
            .id('workspace-save').width('100%').height(48).backgroundColor(this.colors.accent)
            .fontColor(this.colors.onAccent).enabled(!this.model.busy && !!this.model.title.trim())
            .onClick(async (): Promise<void> => {
              const id = await this.model.save();
              if (!id || this.model.error) return;
              if (this.createOnAppear) this.onCreated(this.section === 'projects' ? 'project-detail' : this.section, id);
              else if (this.initialTaskAction) this.onExit();
            })
        }
      } else {
        ListItem() {
          Column({ space: 12 }) {
            if (this.section === 'tasks') {
              Text(this.statusLabel(item.status)).fontSize(12).fontWeight(FontWeight.Medium)
                .fontColor(item.status === 'active' || item.status === 'in_progress' || item.status === 'ready'
                  ? this.colors.accent : this.colors.secondary)
                .padding({ left: 10, right: 10, top: 5, bottom: 5 }).borderRadius(this.colors.corner(10)).backgroundColor(this.colors.accentSoft)
              Text(item.title || $r('app.string.untitled')).fontSize(20).lineHeight(28).fontWeight(FontWeight.Bold)
                .fontColor(this.colors.foreground).width('100%')
            } else {
              Row({ space: 12 }) {
                Row() { SymbolGlyph($r('sys.symbol.folder')).fontSize(24).fontColor([this.colors.accent]) }
                  .width(48).height(48).justifyContent(FlexAlign.Center).borderRadius(24).backgroundColor(this.colors.accentSoft)
                Column({ space: 5 }) {
                  Text(item.title || $r('app.string.untitled')).fontSize(21).lineHeight(28).fontWeight(FontWeight.Bold)
                    .fontColor(this.colors.foreground).width('100%')
                  Text(this.statusLabel(item.status)).fontSize(13).fontWeight(FontWeight.Medium)
                    .fontColor(item.status === 'active' ? this.colors.accent : this.colors.secondary)
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              }.width('100%')
            }
            if (this.section === 'tasks' && item.projectId) {
              Row({ space: 8 }) {
                SymbolGlyph($r('sys.symbol.folder')).fontSize(15).fontColor([this.colors.tertiary])
                Text(this.projectName(item.projectId)).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1)
              }.width('100%')
            }
          }.width('100%').padding(18).alignItems(HorizontalAlign.Start).borderRadius(this.colors.corner(20)).backgroundColor(this.colors.panel)
        }
        if (item.body || this.section !== 'tasks') {
          ListItem() { Text($r('app.string.workspace_description')).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary) }
          ListItem() {
            Column() {
              if (item.body) { XopcMarkdownView({ content: item.body }) }
              else { Text($r('app.string.workspace_no_description')).fontSize(14).fontColor(this.colors.tertiary).width('100%') }
            }
              .width('100%').padding(16).alignItems(HorizontalAlign.Start).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
          }
        }
        if (item.projectId || item.priority || item.updatedAt || item.outcome) {
          ListItem() { Text($r('app.string.workspace_details')).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary).margin({ top: 8 }) }
          ListItem() {
            Column({ space: 14 }) {
              if (item.projectId) {
                Row({ space: 10 }) {
                  Text($r('app.string.workspace_project')).fontSize(13).fontColor(this.colors.tertiary)
                  Text(item.projectId).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.End)
                }.width('100%')
              }
              if (item.priority) {
                Row({ space: 10 }) {
                  Text($r('app.string.workspace_priority')).fontSize(13).fontColor(this.colors.tertiary)
                  Text(item.priority).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.End)
                }.width('100%')
              }
              if (item.updatedAt) {
                Row({ space: 10 }) {
                  Text($r('app.string.workspace_updated')).fontSize(13).fontColor(this.colors.tertiary)
                  Text(this.formatTime(item.updatedAt)).fontSize(14).fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.End)
                }.width('100%')
              }
              if (item.outcome) {
                Text(item.outcome).fontSize(14).lineHeight(20).fontColor(this.colors.foreground).width('100%')
              }
            }.width('100%').padding(16).alignItems(HorizontalAlign.Start).borderRadius(this.colors.corner(16)).backgroundColor(this.colors.panel)
          }
        }
        if (this.section === 'tasks' && item.id) {
          ListItem() {
            Row({ space: 10 }) {
              Button() {
                Row({ space: 8 }) {
                  SymbolGlyph($r('sys.symbol.message')).fontSize(18).fontColor([this.colors.accent])
                  Text($r('app.string.task_open_conversation')).fontSize(14).fontWeight(FontWeight.Medium)
                    .fontColor(this.colors.accent)
                }
              }.layoutWeight(1).height(48).backgroundColor(this.colors.accentSoft).borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14))
                .onClick((): void => { this.onNavigate({ page: 'task-chat', itemId: item.id, title: item.title, projectId: item.projectId }); })
              if (item.editable) {
                Button($r('app.string.edit')).height(48).backgroundColor(this.colors.input)
                  .fontColor(this.colors.foreground).borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14))
                  .onClick((): void => { this.model.editing = true; })
              }
            }.width('100%')
          }
        } else if (item.editable) {
          ListItem() {
            Button($r('app.string.edit')).width('100%').height(46).backgroundColor(this.colors.input)
              .fontColor(this.colors.foreground).onClick((): void => { this.model.editing = true; })
          }
        }
        if (this.section === 'tasks' && item.actions.includes('start')) {
          ListItem() {
            Column({ space: 8 }) {
              Text($r('app.string.chat_agent')).fontSize(13).fontColor(this.colors.secondary)
              Button({ type: ButtonType.Normal }) {
                Row({ space: 10 }) {
                  Text(this.selectedAgentName() || $r('app.string.loading')).fontSize(15)
                    .fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
                  SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(14).fontColor([this.colors.secondary])
                }.width('100%').padding({ left: 16, right: 16 })
              }.width('100%').height(48).padding(0).borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14)).backgroundColor(this.colors.input)
                .enabled(!this.agentsLoading && this.agents.length > 0)
                .onClick((): void => { this.agentQuery = ''; this.openSheet('agent'); })
              if (this.agentsError) {
                Button({ type: ButtonType.Circle }) {
                  SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(18).fontColor([this.colors.accent])
                }.width(40).height(40).padding(0).backgroundColor(Color.Transparent)
                  .accessibilityText($r('app.string.refresh'))
                  .onClick((): void => { this.loadAgents(); })
              }
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
        }
        ForEach(this.supportedActions(item), (action: string) => {
          ListItem() {
            Button(this.label(action)).width('100%').height(action === 'close' ? 52 : 46).borderRadius(this.colors.corner(14)).clipShape(this.colors.cornerClip(14))
              .backgroundColor(action === 'start' || action === 'mark_ready' || action === 'request_review' || action === 'close'
                ? this.colors.accent : action === 'delete' ? Color.Transparent : this.colors.input)
              .fontColor(action === 'start' || action === 'mark_ready' || action === 'request_review' || action === 'close'
                ? Color.White : action === 'delete' ? this.colors.danger : this.colors.foreground)
              .enabled(!this.model.busy && (action !== 'start' || this.agents.some((agent: XopcChatAgent): boolean => agent.id === this.agentId)))
              .onClick((): void => { this.action(action); })
          }
        }, (action: string): string => action)
        if (this.section === 'tasks') { ListItem() { Column().height(32) } }
      }
    }.layoutWeight(1).width('100%').padding({ left: 20, right: 20, bottom: 20 }).scrollBar(BarState.Off)
    }
  }

  @Builder
  header() {
    Stack({ alignContent: Alignment.Center }) {
      Row({ space: 12 }) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.arrow_left')).fontSize(20).fontColor([this.colors.foreground])
        }.width(44).height(44).padding(0).backgroundColor(this.colors.panel)
          .accessibilityText($r('app.string.back')).enabled(!this.model.busy || !!this.model.openingId || (!this.model.selected && this.searchOpen))
          .onClick((): void => { this.goBack(); })
        Blank().layoutWeight(1)
        if (!this.model.selected && !this.model.openingId) {
          if (this.section !== 'tasks') {
            XopcPageSearchButton({ searchId: this.section + '-open-search', open: this.searchOpen,
              onToggle: (): void => { this.toggleSearch(); } })
          }
          if (this.section === 'automations') {
            Button({ type: ButtonType.Circle }) {
              SymbolGlyph($r('sys.symbol.slider_horizontal_2')).fontSize(21)
                .fontColor([this.filter === 'all' ? this.colors.foreground : this.colors.accent])
            }.id('automation-filter-menu').width(44).height(44).padding(0).backgroundColor(this.colors.panel)
              .accessibilityText($r('app.string.automation_filter_title'))
              .bindMenu(this.automationFilterMenu, { placement: Placement.BottomRight })
          } else {
            Button({ type: ButtonType.Circle }) {
              SymbolGlyph($r('sys.symbol.plus')).fontSize(21).fontColor([this.colors.accent])
            }.width(44).height(44).padding(0).backgroundColor(this.colors.accentSoft)
              .accessibilityText(this.createLabel()).enabled(!this.model.busy)
              .onClick((): void => { this.openCreate(); })
          }
        }
        if (this.section === 'automations' && !this.model.editing && this.model.selected &&
          (this.model.selected.editable || this.model.selected.actions.includes('delete'))) {
          this.automationMore(this.model.selected, false)
        }
      }.width('100%').height(44)
      if (this.embeddedInWorkbench) {
        XopcPageTitleMenu({ heading: this.heading, options: WORK_PAGE_OPTIONS, selected: this.section,
          menuId: 'work-page-menu', onSelect: this.onSelectWorkPage }).constraintSize({ maxWidth: '54%' })
      } else if (!this.model.selected && !this.model.openingId) {
        Text(this.heading).fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).constraintSize({ maxWidth: '54%' })
          .accessibilityGroup(true).hitTestBehavior(HitTestMode.None)
      }
    }.width('100%').padding({ left: 16, right: 16, top: 8, bottom: 8 })
  }

  @Builder
  workspaceContent() {
    Column() {
      this.header()
      if (this.model.error) {
        Text(userErrorMessage(this.model.error, 'collection')).fontColor(this.colors.secondary).padding(12)
        if (!this.model.busy && !this.model.selected && !this.model.openingId && !this.model.hasMore) {
          Button($r('app.string.retry')).onClick((): void => {
            void this.model.list(this.section === 'tasks' ? this.search : '');
          })
        }
      }
      if (this.model.selected) {
        if (this.initialTaskAction === 'status') { this.taskStatusSheet(this.model.selected) }
        else { this.detail(this.model.selected) }
        if (!this.initialTaskAction && this.section === 'tasks' && !this.model.editing && this.model.selected.taskDetail) {
          this.taskActionBar(this.model.selected)
        }
      }
      else if (this.model.openingId) { XopcBrandLoading() }
      else {
        this.list()
        if (this.section === 'automations') {
          Column() {
            Button(this.createLabel()).id('automation-create').width('100%').height(48)
              .borderRadius(this.colors.corner(24)).clipShape(this.colors.cornerClip(24)).backgroundColor(this.colors.chat.action).fontColor(this.colors.chat.onAction)
              .enabled(!this.model.busy).onClick((): void => { this.openCreate(); })
          }.width('100%').padding({ left: 20, right: 20, top: 4, bottom: 10 })
        }
      }
    }.height('100%').width('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.sheetOpen, this.workspaceSheet, {
        height: '70%', dragBar: true, showClose: true, backgroundColor: this.colors.panel,
        onDisappear: (): void => { this.agentQuery = ''; this.projectQuery = ''; }
      })
  }

  build() {
    if (this.embeddedInWorkbench) {
      this.workspaceContent()
    } else {
      NavDestination() {
        this.workspaceContent()
      }.hideTitleBar(true).onShown((): void => {
        if (this.section === 'automations' && !this.model.selected && !this.model.openingId) void this.model.list('');
      }).onBackPressed((): boolean => {
        if (!this.model.busy || !!this.model.openingId || (!this.model.selected && this.searchOpen)) this.goBack();
        return true;
      })
    }
  }
}
