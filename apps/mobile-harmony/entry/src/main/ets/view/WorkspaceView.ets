import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import {
  XopcSection, XopcWorkspaceItem, XopcAutomationRun, XopcMobileTaskDetail,
  XopcMobileTaskReceipt, XopcMobileTaskCheck, XopcMobileTaskEvidence,
  XopcMobileTaskReview, XopcMobileTaskContext, XopcMobileTaskSession, XopcMobileTaskDependency,
  XopcMobileTaskRun, XopcMobileTaskAttention
} from '../model/workspace';
import { XopcWorkspaceViewModel } from '../viewmodel/workspaceViewModel';
import { XopcMarkdownView } from './MarkdownView';
import { XopcBrandLoading, XopcHubRow, XopcListSkeleton } from './MobileComponents';
import { XopcMobileRoute } from '../model/home';
import { userErrorMessage } from '../common/userError';
import { XopcChatRepository } from '../repository/chatRepository';
import { XopcChatAgent, XopcChatAgents } from '../model/chat';

@ComponentV2
export struct XopcWorkspaceView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param section: XopcSection = 'tasks';
  @Param heading: ResourceStr = '';
  @Param initialId: string = '';
  @Param createOnAppear: boolean = false;
  @Param projectId: string = '';
  @Event onExit: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onCreateWithChat: (section: XopcSection) => Promise<void> = async (_section: XopcSection): Promise<void> => {};
  @Local model: XopcWorkspaceViewModel = new XopcWorkspaceViewModel();
  @Local search: string = '';
  @Local filter: string = 'all';
  @Local agentId: string = '';
  @Local agents: XopcChatAgent[] = [];
  @Local defaultAgent: string = '';
  @Local agentsLoading: boolean = false;
  @Local agentsError: string = '';
  @Local agentPickerOpen: boolean = false;
  @Local agentQuery: string = '';
  private chatRepository: XopcChatRepository = new XopcChatRepository();
  @Local automationDefinitionExpanded: boolean = false;
  @Local creatingChat: boolean = false;

  aboutToAppear(): void {
    this.model.start(this.section, this.initialId, this.createOnAppear, this.projectId);
    if (this.section === 'tasks') this.loadAgents();
  }
  @Monitor('initialId')
  onTargetChange(): void {
    this.automationDefinitionExpanded = false;
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
        .backgroundColor(this.colors.input).borderRadius(14).padding({ left: 14, right: 14 })
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
            }.width('100%').padding(0).borderRadius(14).backgroundColor(this.colors.input)
              .onClick((): void => { this.agentId = agent.id; this.agentPickerOpen = false; this.agentQuery = ''; })
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

  private async goBack(): Promise<void> {
    if (this.model.openingId) {
      this.model.cancelOpening();
      if (this.initialId) this.onExit();
      return;
    }
    if (this.model.editing) {
      const selected = this.model.selected;
      if (selected && (this.model.title !== selected.title || this.model.body !== selected.body || this.model.cron !== (selected.cron ?? '') || this.model.projectId !== (selected.projectId ?? ''))) {
        try {
          const result = await this.getUIContext().getPromptAction().showDialog({
            title: $r('app.string.back'), message: $r('app.string.discard_changes'),
            buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary }, { text: $r('app.string.confirm'), color: this.colors.danger }]
          });
          if (result.index !== 1) return;
        } catch (_error) { return; }
      }
    }
    if (this.createOnAppear) this.onExit();
    else if (this.model.selected && !this.initialId) this.model.back(); else this.onExit();
  }

  private label(action: string): ResourceStr {
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

  private async createWithChat(): Promise<void> {
    if (this.model.busy || this.creatingChat) return;
    this.creatingChat = true;
    try { await this.onCreateWithChat(this.section); }
    finally { this.creatingChat = false; }
  }

  private statusLabel(status: string): ResourceStr {
    if (status === 'enabled') return $r('app.string.enabled');
    if (status === 'paused') return $r('app.string.paused');
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

  private sectionHint(): ResourceStr {
    if (this.section === 'projects') return $r('app.string.workspace_project_hint');
    if (this.section === 'automations') return $r('app.string.workspace_automation_hint');
    return $r('app.string.workspace_task_hint');
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
    if (filter === 'all') return true;
    if (this.section === 'tasks') return filter === 'primary' ? item.status !== 'closed' : item.status === 'closed';
    if (this.section === 'projects') return filter === 'primary' ? item.status !== 'archived' : item.status === 'archived';
    return filter === 'primary' ? item.enabled === true : item.enabled !== true;
  }

  private filteredItems(): XopcWorkspaceItem[] {
    return this.model.items.filter((item: XopcWorkspaceItem): boolean => this.matchesFilter(item));
  }

  private filterCount(filter: string): number {
    return this.model.items.filter((item: XopcWorkspaceItem): boolean => this.matchesFilter(item, filter)).length;
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

  private automationTiming(item: XopcWorkspaceItem): string {
    const next = this.formatTime(item.automation?.state?.nextRunAtMs);
    if (next) return next;
    return item.cron || '';
  }

  private criterionState(info: XopcMobileTaskDetail, criterion: string, index: number): string {
    const review = info.criterionReviews.find((entry: XopcMobileTaskReview): boolean =>
      entry.contractVersion === info.latestContractVersion && entry.criterionIndex === index);
    if (review && info.contract?.acceptancePolicy !== 'verified_auto') return review.status;
    if (info.contract?.acceptancePolicy === 'manual') return 'pending';
    const currentRunIds = info.runs.filter((run: XopcMobileTaskRun): boolean =>
      run.contractVersion === info.latestContractVersion).map((run: XopcMobileTaskRun): string => run.id);
    const receipts = info.receipts.filter((receipt: XopcMobileTaskReceipt): boolean => currentRunIds.includes(receipt.runId))
      .sort((left: XopcMobileTaskReceipt, right: XopcMobileTaskReceipt): number => right.finalizedAt - left.finalizedAt);
    for (const receipt of receipts) {
      const check = receipt.verification.checks.find((entry: XopcMobileTaskCheck): boolean => entry.criterion === criterion);
      if (!check || check.status === 'unverified') continue;
      if (check.status === 'failed') return 'failed';
      return receipt.evidence.some((evidence: XopcMobileTaskEvidence): boolean =>
        evidence.strength === 'verified' && (check.evidenceTitles ?? []).includes(evidence.title)) ? 'passed' : 'pending';
    }
    return 'pending';
  }

  private passedCount(info: XopcMobileTaskDetail): number {
    return (info.contract?.acceptanceCriteria ?? []).filter((criterion: string, index: number): boolean =>
      this.criterionState(info, criterion, index) === 'passed').length;
  }

  private hasHumanReview(info: XopcMobileTaskDetail, index: number): boolean {
    return info.contract?.acceptancePolicy !== 'verified_auto' && info.criterionReviews.some(
      (review: XopcMobileTaskReview): boolean => review.contractVersion === info.latestContractVersion
        && review.criterionIndex === index);
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
    for (const action of ['start', 'mark_ready', 'request_review', 'close']) {
      if (item.actions.includes(action)) {
        if (action === 'close' && (!item.taskDetail?.contract?.acceptanceCriteria.length
          || this.passedCount(item.taskDetail) !== item.taskDetail.contract.acceptanceCriteria.length)) continue;
        return action;
      }
    }
    return '';
  }

  private async action(action: string): Promise<void> {
    if (['delete', 'archive', 'close', 'run', 'start'].includes(action)) {
      try {
        const result = await this.getUIContext().getPromptAction().showDialog({
          title: this.label(action), message: $r('app.string.confirm_action_help'),
          buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
            { text: $r('app.string.confirm'), color: this.colors.accent }]
        });
        if (result.index !== 1) return;
      } catch (error) { this.model.error = (error as Error).message; return; }
    }
    await this.model.action(action, this.agentId);
  }

  @Builder
  filterChip(filter: string, label: ResourceStr) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 6 }) {
        Text(label).fontSize(13).fontWeight(FontWeight.Medium)
          .fontColor(this.filter === filter ? this.colors.accent : this.colors.secondary)
        Text(this.filterCount(filter).toString()).fontSize(11)
          .fontColor(this.filter === filter ? this.colors.accent : this.colors.tertiary)
      }.padding({ left: 14, right: 14 })
    }.height(36).padding(0).borderRadius(18)
      .backgroundColor(this.filter === filter ? this.colors.accentSoft : this.colors.panel)
      .onClick((): void => { this.filter = filter; })
  }

  @Builder
  workspaceCard(item: XopcWorkspaceItem) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 10 }) {
        Row({ space: 10 }) {
          Row() {
            SymbolGlyph(this.section === 'projects' ? $r('sys.symbol.folder')
              : this.section === 'automations' ? $r('sys.symbol.clock') : $r('sys.symbol.doc_text'))
              .fontSize(21).fontColor([this.colors.accent])
          }.width(40).height(40).justifyContent(FlexAlign.Center).borderRadius(20).backgroundColor(this.colors.accentSoft)
          Column({ space: 4 }) {
            Text(item.title || $r('app.string.untitled')).fontSize(16).lineHeight(22).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground).width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.statusLabel(item.status)).fontSize(12).fontWeight(FontWeight.Medium)
              .fontColor(item.status === 'failed' ? this.colors.danger : item.enabled || item.status === 'active'
                || item.status === 'in_progress' || item.status === 'ready' ? this.colors.accent : this.colors.secondary)
          }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
        }.width('100%')
        if (this.itemSummary(item)) {
          Text(this.itemSummary(item)).fontSize(14).lineHeight(20).fontColor(this.colors.secondary)
            .width('100%').maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        if ((this.section === 'tasks' && !!(item.projectId || item.priority))
          || (this.section === 'projects' && !!item.outcome) || this.section === 'automations') {
          Row({ space: 8 }) {
            if (this.section === 'tasks' && item.projectId) {
              SymbolGlyph($r('sys.symbol.folder')).fontSize(13).fontColor([this.colors.tertiary])
              Text(item.projectId).fontSize(12).fontColor(this.colors.tertiary).maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
            }
            if (this.section === 'tasks' && item.priority) {
              Text(item.priority).fontSize(11).fontColor(this.colors.secondary).backgroundColor(this.colors.input)
                .borderRadius(9).padding({ left: 8, right: 8, top: 2, bottom: 2 })
            }
            if (this.section === 'projects' && item.outcome) {
              SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(13).fontColor([this.colors.tertiary])
              Text(item.outcome).fontSize(12).fontColor(this.colors.tertiary).maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
            }
            if (this.section === 'automations') {
              SymbolGlyph($r('sys.symbol.calendar')).fontSize(13).fontColor([this.colors.tertiary])
              Text(this.automationTiming(item) || $r('app.string.manual_trigger')).fontSize(12).fontColor(this.colors.tertiary)
                .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
              if (item.automation?.state?.lastRunStatus) {
                Text(this.statusLabel(item.automation?.state?.lastRunStatus ?? '')).fontSize(11)
                  .fontColor(item.automation?.state?.lastRunStatus === 'failed' ? this.colors.danger : this.colors.secondary)
              }
            }
          }.width('100%')
        }
      }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
    }.width('100%').padding(0).borderRadius(18).backgroundColor(this.colors.panel)
      .onClick((): void => {
        if (this.section === 'projects') this.onNavigate({ page: 'project-detail', itemId: item.id });
        else { this.automationDefinitionExpanded = false; this.model.open(item.id); }
      })
  }

  @Builder
  list() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        TextInput({ text: this.search, placeholder: $r('app.string.search') }).layoutWeight(1).height(44)
          .backgroundColor(this.colors.input).borderRadius(22).padding({ left: 16, right: 16 })
          .onChange((text: string): void => { this.search = text; }).onSubmit((): void => { this.model.list(this.search); })
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(20).fontColor([this.colors.foreground])
        }.width(44).height(44).padding(0).backgroundColor(this.colors.panel).enabled(!this.model.busy)
          .accessibilityText($r('app.string.refresh')).onClick((): void => { this.model.list(this.search); })
      }.width('100%')
      Row({ space: 8 }) {
        this.filterChip('all', $r('app.string.filter_all'))
        this.filterChip('primary', this.firstFilterLabel())
        this.filterChip('secondary', this.secondFilterLabel())
      }.width('100%')
    }.width('100%').padding({ left: 20, right: 20, bottom: 8 }).alignItems(HorizontalAlign.Start)
    List({ space: 12 }) {
      ListItem() {
        Column({ space: 6 }) {
          Text(this.sectionHint()).fontSize(15).lineHeight(21).fontColor(this.colors.foreground).width('100%')
          Text($r('app.string.workspace_item_count', this.model.items.length)).fontSize(12)
            .fontColor(this.colors.secondary).width('100%')
        }.width('100%').padding({ left: 16, right: 16, top: 14, bottom: 14 })
          .borderRadius(16).backgroundColor(this.colors.accentSoft).alignItems(HorizontalAlign.Start)
      }
      if (this.model.busy && !this.model.items.length) {
        ListItem() { XopcListSkeleton() }
      }
      ForEach(this.filteredItems(), (item: XopcWorkspaceItem) => {
        ListItem() { this.workspaceCard(item) }
      }, (item: XopcWorkspaceItem): string => item.id + ':' + item.version + ':' + item.title + ':' + item.status)
      if (this.model.hasMore) {
        ListItem() {
          Button($r('app.string.load_more')).width('100%').height(44).backgroundColor(this.colors.input)
            .fontColor(this.colors.foreground).onClick((): void => { this.model.list(this.search, true); })
        }
      }
      if (!this.model.busy && this.filteredItems().length === 0) {
        ListItem() {
          Column({ space: 10 }) {
            SymbolGlyph($r('sys.symbol.list_bullet')).fontSize(30).fontColor([this.colors.tertiary])
            Text(this.model.items.length ? $r('app.string.workspace_no_matches') : $r('app.string.empty_list'))
              .fontSize(14).fontColor(this.colors.secondary).textAlign(TextAlign.Center)
          }.width('100%').padding({ top: 32, bottom: 32 })
        }
      }
    }.layoutWeight(1).padding({ left: 20, right: 20, bottom: 20 }).width('100%').scrollBar(BarState.Off)
  }

  @Builder
  automationDetail(item: XopcWorkspaceItem) {
    List({ space: 12 }) {
      ListItem() {
        Column({ space: 12 }) {
          Row({ space: 12 }) {
            Row() { SymbolGlyph($r('sys.symbol.clock')).fontSize(23).fontColor([this.colors.accent]) }
              .width(44).height(44).justifyContent(FlexAlign.Center).borderRadius(22).backgroundColor(this.colors.accentSoft)
            Column({ space: 4 }) {
              Text(item.title || $r('app.string.untitled')).fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
              Text(this.statusLabel(item.status)).fontSize(13).fontWeight(FontWeight.Medium)
                .fontColor(item.enabled ? this.colors.accent : this.colors.tertiary)
            }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.width('100%')
          Row({ space: 8 }) {
            if (item.actions.includes('run')) {
              Button($r('app.string.run_now')).layoutWeight(1).constraintSize({ minHeight: 48 })
                .backgroundColor(this.colors.accent).fontColor(Color.White).enabled(!this.model.busy)
                .onClick((): void => { this.action('run'); })
            }
            if (item.actions.includes('pause')) {
              Button($r('app.string.pause')).layoutWeight(1).constraintSize({ minHeight: 48 })
                .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.model.busy)
                .onClick((): void => { this.action('pause'); })
            }
            if (item.actions.includes('resume')) {
              Button($r('app.string.resume')).layoutWeight(1).constraintSize({ minHeight: 48 })
                .backgroundColor(this.colors.input).fontColor(this.colors.foreground).enabled(!this.model.busy)
                .onClick((): void => { this.action('resume'); })
            }
          }.width('100%')
        }.width('100%').padding(16).alignItems(HorizontalAlign.Start).borderRadius(18).backgroundColor(this.colors.panel)
      }
      ListItem() { Text($r('app.string.automation_definition')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary) }
      ListItem() {
        Column({ space: 12 }) {
          Row({ space: 12 }) {
            Text($r('app.string.schedule')).fontSize(13).fontColor(this.colors.tertiary)
            Text(item.cron || $r('app.string.manual_trigger')).fontSize(14).fontColor(this.colors.foreground)
              .layoutWeight(1).textAlign(TextAlign.End)
          }.width('100%')
          if (item.automation?.state?.nextRunAtMs) {
            Row({ space: 8 }) {
              Text($r('app.string.workspace_next_run')).fontSize(13).fontColor(this.colors.tertiary)
              Text(this.formatTime(item.automation?.state?.nextRunAtMs)).fontSize(14).fontColor(this.colors.foreground)
                .layoutWeight(1).textAlign(TextAlign.End)
            }.width('100%')
          }
          if (item.automation?.state?.lastRunAtMs) {
            Row({ space: 8 }) {
              Text($r('app.string.workspace_last_run')).fontSize(13).fontColor(this.colors.tertiary)
              Text(this.formatTime(item.automation?.state?.lastRunAtMs)).fontSize(14).fontColor(this.colors.foreground)
                .layoutWeight(1).textAlign(TextAlign.End)
              if (item.automation?.state?.lastRunStatus) {
                Text(this.statusLabel(item.automation?.state?.lastRunStatus ?? '')).fontSize(12)
                  .fontColor(item.automation?.state?.lastRunStatus === 'failed' ? this.colors.danger : this.colors.secondary)
              }
            }.width('100%')
          }
          if (item.body) {
            Text(item.body).fontSize(15).lineHeight(22).fontColor(this.colors.foreground).width('100%')
              .maxLines(this.automationDefinitionExpanded ? 100 : 6)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Button(this.automationDefinitionExpanded ? $r('app.string.automation_hide_definition') : $r('app.string.automation_show_definition'))
              .width('100%').constraintSize({ minHeight: 40 }).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
              .onClick((): void => { this.automationDefinitionExpanded = !this.automationDefinitionExpanded; })
          }
        }.width('100%').padding(16).alignItems(HorizontalAlign.Start).borderRadius(16).backgroundColor(this.colors.panel)
      }
      if (item.editable) {
        ListItem() {
          Button($r('app.string.edit_automation')).width('100%').constraintSize({ minHeight: 46 })
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground).onClick((): void => { this.model.editing = true; })
        }
      }
      ListItem() { Text($r('app.string.recent_runs')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary).margin({ top: 8 }) }
      if (!this.model.runs.length) {
        ListItem() { Text($r('app.string.no_runs')).fontSize(14).fontColor(this.colors.tertiary).padding({ top: 8, bottom: 8 }) }
      }
      ForEach(this.model.runs, (run: XopcAutomationRun) => {
        ListItem() {
          XopcHubRow({ heading: this.statusLabel(run.status), summary: run.error ?? run.summary ?? '',
            symbol: run.status === 'succeeded' ? $r('sys.symbol.checkmark_circle') : run.status === 'failed' || run.status === 'timeout'
              ? $r('sys.symbol.exclamationmark_circle') : $r('sys.symbol.clock'),
            onOpen: (): void => { this.onNavigate({ page: 'automation-run', itemId: run.id }); } })
        }
      }, (run: XopcAutomationRun): string => run.id + ':' + run.status)
      if (item.actions.includes('delete')) {
        ListItem() {
          Button($r('app.string.delete')).width('100%').constraintSize({ minHeight: 46 })
            .backgroundColor(Color.Transparent).fontColor(this.colors.danger).enabled(!this.model.busy)
            .onClick((): void => { this.action('delete'); })
        }
      }
    }.layoutWeight(1).width('100%').padding(16).scrollBar(BarState.Off)
  }

  @Builder
  taskDetailView(item: XopcWorkspaceItem, info: XopcMobileTaskDetail) {
    List({ space: 12 }) {
      ListItem() {
        Column({ space: 12 }) {
          Text(this.statusLabel(item.status)).fontSize(12).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.accent).padding({ left: 10, right: 10, top: 5, bottom: 5 })
            .borderRadius(10).backgroundColor(this.colors.accentSoft)
          Text(item.title || $r('app.string.untitled')).fontSize(21).lineHeight(29).fontWeight(FontWeight.Bold)
            .fontColor(this.colors.foreground).width('100%')
          if (item.projectId) {
            Text(item.projectId).fontSize(13).fontColor(this.colors.secondary).width('100%')
          }
          Row({ space: 8 }) {
            Button($r('app.string.task_open_conversation')).layoutWeight(1).height(48)
              .backgroundColor(this.colors.accentSoft).fontColor(this.colors.accent)
              .onClick((): void => { this.onNavigate({ page: 'task-chat', itemId: item.id, title: item.title, projectId: item.projectId }); })
            if (item.editable) {
              Button($r('app.string.edit')).height(48).backgroundColor(this.colors.input)
                .fontColor(this.colors.foreground).onClick((): void => { this.model.editing = true; })
            }
          }.width('100%')
          if (this.primaryTaskAction(item) === 'start') {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 10 }) {
                Text(this.selectedAgentName() || $r('app.string.loading')).fontSize(14)
                  .fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
                SymbolGlyph($r('sys.symbol.chevron_down')).fontSize(14).fontColor([this.colors.secondary])
              }.width('100%').padding({ left: 16, right: 16 })
            }.width('100%').height(44).padding(0).borderRadius(12).backgroundColor(this.colors.input)
              .enabled(!this.agentsLoading && this.agents.length > 0)
              .onClick((): void => { this.agentQuery = ''; this.agentPickerOpen = true; })
          }
          if (this.primaryTaskAction(item)) {
            Button(this.label(this.primaryTaskAction(item))).width('100%').height(48)
              .backgroundColor(this.colors.accent).fontColor(Color.White)
              .enabled(!this.model.busy && (this.primaryTaskAction(item) !== 'start' || !!this.agentId))
              .onClick((): void => { this.action(this.primaryTaskAction(item)); })
          }
        }.width('100%').padding(18).alignItems(HorizontalAlign.Start)
          .borderRadius(20).backgroundColor(this.colors.panel)
      }
      ListItem() {
        Column({ space: 12 }) {
          Row({ space: 8 }) {
            Text($r('app.string.task_goal_acceptance')).fontSize(16).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground).layoutWeight(1)
            if ((info.contract?.acceptanceCriteria.length ?? 0) > 0) {
              Text(this.passedCount(info).toString() + '/' + (info.contract?.acceptanceCriteria.length ?? 0).toString())
                .fontSize(12).fontColor(this.colors.secondary).padding({ left: 9, right: 9, top: 4, bottom: 4 })
                .borderRadius(10).backgroundColor(this.colors.input)
            }
          }.width('100%')
          Text(info.contract?.objective || item.title).fontSize(15).lineHeight(23).fontColor(this.colors.foreground)
            .width('100%')
          if ((info.contract?.acceptanceCriteria.length ?? 0) > 0) {
            ForEach(info.contract?.acceptanceCriteria ?? [], (criterion: string, index: number) => {
              Row({ space: 10 }) {
                SymbolGlyph(this.criterionState(info, criterion, index) === 'passed' ? $r('sys.symbol.checkmark_circle')
                  : this.criterionState(info, criterion, index) === 'failed' ? $r('sys.symbol.exclamationmark_circle')
                  : $r('sys.symbol.circle')).fontSize(18)
                  .fontColor([this.criterionState(info, criterion, index) === 'passed' ? this.colors.accent
                    : this.criterionState(info, criterion, index) === 'failed' ? this.colors.danger : this.colors.tertiary])
                Column({ space: 3 }) {
                  Text(criterion).fontSize(14).lineHeight(20).fontColor(this.colors.foreground).width('100%')
                  Text(this.criterionState(info, criterion, index) === 'passed' ? $r('app.string.task_criterion_passed')
                    : this.criterionState(info, criterion, index) === 'failed' ? $r('app.string.task_criterion_failed')
                    : $r('app.string.task_criterion_pending')).fontSize(12).fontColor(this.colors.secondary)
                  if (this.hasHumanReview(info, index)) {
                    Text($r('app.string.task_human_review')).fontSize(11).fontColor(this.colors.tertiary)
                  } else if (this.criterionState(info, criterion, index) === 'passed') {
                    Text($r('app.string.task_verified_evidence')).fontSize(11).fontColor(this.colors.tertiary)
                  }
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              }.width('100%').alignItems(VerticalAlign.Top)
            }, (criterion: string, index: number): string => info.latestContractVersion.toString() + ':' + index.toString() + ':' + criterion)
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
          .borderRadius(18).backgroundColor(this.colors.panel)
      }
      if (info.attention.length > 0) {
        ListItem() {
          Column({ space: 9 }) {
            Text($r('app.string.task_needs_attention')).fontSize(15).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.foreground)
            ForEach(info.attention, (attention: XopcMobileTaskAttention) => {
              Text(attention.summary).fontSize(14).lineHeight(21).fontColor(this.colors.foreground).width('100%')
            }, (attention: XopcMobileTaskAttention, index: number): string => attention.kind + ':' + index.toString())
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
            .borderRadius(16).backgroundColor(this.colors.accentSoft)
        }
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
            .borderRadius(16).backgroundColor(this.colors.panel)
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
            .borderRadius(16).backgroundColor(this.colors.panel)
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
                }.width('100%').height(44).padding(0).borderRadius(12).backgroundColor(this.colors.input)
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
            .borderRadius(16).backgroundColor(this.colors.panel)
        }
      }
      if (item.body && item.body !== info.contract?.objective) {
        ListItem() {
          Column({ space: 8 }) {
            Text($r('app.string.workspace_description')).fontSize(14).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary)
            XopcMarkdownView({ content: item.body })
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
            .borderRadius(16).backgroundColor(this.colors.panel)
        }
      }
      if (item.priority || item.updatedAt) {
        ListItem() {
          Column({ space: 8 }) {
            Text($r('app.string.workspace_details')).fontSize(14).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary)
            if (item.priority) { Text(item.priority).fontSize(13).fontColor(this.colors.foreground) }
            if (item.updatedAt) { Text(this.formatTime(item.updatedAt)).fontSize(13).fontColor(this.colors.secondary) }
          }.width('100%').padding(16).alignItems(HorizontalAlign.Start)
            .borderRadius(16).backgroundColor(this.colors.panel)
        }
      }
      ForEach(this.supportedActions(item).filter((action: string): boolean => action !== this.primaryTaskAction(item)
        && action !== 'close' && action !== 'start'), (action: string) => {
        ListItem() {
          Button(this.label(action)).width('100%').height(44).borderRadius(14)
            .backgroundColor(this.colors.input).fontColor(this.colors.foreground)
            .enabled(!this.model.busy).onClick((): void => { this.action(action); })
        }
      }, (action: string): string => action)
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
              .backgroundColor(this.colors.input).borderRadius(14).padding({ left: 14, right: 14 })
            .onChange((text: string): void => { this.model.title = text; })
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        ListItem() {
          Column({ space: 8 }) {
            Text($r('app.string.workspace_description')).fontSize(13).fontColor(this.colors.secondary).width('100%')
            TextArea({ text: this.model.body, placeholder: $r('app.string.description') }).height(220)
              .backgroundColor(this.colors.input).borderRadius(14).padding(14)
              .onChange((text: string): void => { this.model.body = text; })
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        if (this.section === 'automations') {
          ListItem() {
            Column({ space: 8 }) {
              Text($r('app.string.cron_help')).fontColor(this.colors.secondary)
              TextInput({ text: this.model.cron }).onChange((text: string): void => { this.model.cron = text; })
            }.alignItems(HorizontalAlign.Start)
          }
        }
        if (this.section === 'tasks') {
          ListItem() {
            Column({ space: 8 }) {
              Text($r('app.string.workspace_project')).fontSize(13).fontColor(this.colors.secondary).width('100%')
              TextInput({ text: this.model.projectId, placeholder: $r('app.string.project_id') }).height(48)
                .backgroundColor(this.colors.input).borderRadius(14).padding({ left: 14, right: 14 })
                .onChange((text: string): void => { this.model.projectId = text; })
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
        }
        ListItem() {
          Button($r('app.string.save')).width('100%').height(48).backgroundColor(this.colors.accent)
            .fontColor(Color.White).enabled(!this.model.busy && !!this.model.title.trim())
            .onClick(async (): Promise<void> => {
              await this.model.save();
              if (this.createOnAppear && !this.model.error) this.onExit();
            })
        }
      } else {
        ListItem() {
          Column({ space: 12 }) {
            if (this.section === 'tasks') {
              Text(this.statusLabel(item.status)).fontSize(12).fontWeight(FontWeight.Medium)
                .fontColor(item.status === 'active' || item.status === 'in_progress' || item.status === 'ready'
                  ? this.colors.accent : this.colors.secondary)
                .padding({ left: 10, right: 10, top: 5, bottom: 5 }).borderRadius(10).backgroundColor(this.colors.accentSoft)
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
                Text(item.projectId).fontSize(13).fontColor(this.colors.secondary).layoutWeight(1)
              }.width('100%')
            }
          }.width('100%').padding(18).alignItems(HorizontalAlign.Start).borderRadius(20).backgroundColor(this.colors.panel)
        }
        if (item.body || this.section !== 'tasks') {
          ListItem() { Text($r('app.string.workspace_description')).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary) }
          ListItem() {
            Column() {
              if (item.body) { XopcMarkdownView({ content: item.body }) }
              else { Text($r('app.string.workspace_no_description')).fontSize(14).fontColor(this.colors.tertiary).width('100%') }
            }
              .width('100%').padding(16).alignItems(HorizontalAlign.Start).borderRadius(16).backgroundColor(this.colors.panel)
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
            }.width('100%').padding(16).alignItems(HorizontalAlign.Start).borderRadius(16).backgroundColor(this.colors.panel)
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
              }.layoutWeight(1).height(48).backgroundColor(this.colors.accentSoft).borderRadius(14)
                .onClick((): void => { this.onNavigate({ page: 'task-chat', itemId: item.id, title: item.title, projectId: item.projectId }); })
              if (item.editable) {
                Button($r('app.string.edit')).height(48).backgroundColor(this.colors.input)
                  .fontColor(this.colors.foreground).borderRadius(14)
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
              }.width('100%').height(48).padding(0).borderRadius(14).backgroundColor(this.colors.input)
                .enabled(!this.agentsLoading && this.agents.length > 0)
                .onClick((): void => { this.agentQuery = ''; this.agentPickerOpen = true; })
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
            Button(this.label(action)).width('100%').height(action === 'close' ? 52 : 46).borderRadius(14)
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

  build() {
    NavDestination() {
    Column() {
      Row({ space: 12 }) {
        Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground]) }
          .width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.back'))
          .enabled(!this.model.busy || !!this.model.openingId).onClick((): void => { this.goBack(); })
        Text(this.heading).layoutWeight(1).fontSize(22).lineHeight(30).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        if (!this.model.selected && !this.model.openingId) {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.plus')).fontSize(21).fontColor([this.colors.accent])
          }.width(44).height(44).padding(0).backgroundColor(this.colors.accentSoft)
            .accessibilityText(this.createLabel()).enabled(!this.model.busy && !this.creatingChat)
            .onClick((): void => { this.createWithChat(); })
        }
      }.width('100%').padding({ left: 12, right: 20, top: 10, bottom: 10 })
      if (this.model.error) { Text(userErrorMessage(this.model.error, 'collection')).fontColor(this.colors.secondary).padding(12) }
      if (this.model.selected) { this.detail(this.model.selected) }
      else if (this.model.openingId) { XopcBrandLoading() }
      else { this.list() }
    }.height('100%').width('100%').backgroundColor(this.colors.surface)
      .bindSheet($$this.agentPickerOpen, this.agentPicker, {
        height: '70%', dragBar: true, backgroundColor: this.colors.panel,
        onDisappear: (): void => { this.agentQuery = ''; }
      })
    }.hideTitleBar(true).onBackPressed((): boolean => {
      if (!this.model.busy || !!this.model.openingId) this.goBack(); return true;
    })
  }
}
