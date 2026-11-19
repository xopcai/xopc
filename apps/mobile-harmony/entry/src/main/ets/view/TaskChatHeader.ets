import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { taskCriterionState } from '../common/taskManagement';
import { userErrorMessage } from '../common/userError';
import { XopcWorkspaceRepository } from '../repository/workspaceRepository';
import { XopcWorkspaceItem, XopcMobileTaskReceipt, XopcMobileTaskAttention, XopcMobileTaskDependency, XopcTaskPhaseChange } from '../model/workspace';
import { XopcMobileRoute } from '../model/home';
import { XopcListSkeleton } from './MobileComponents';
import { layoutState } from '../service/layoutState';

@ComponentV2
export struct XopcTaskChatHeader {
  @Param taskId: string = '';
  @Param detailsRequest: number = 0;
  @Param topInset: number = 0;
  @Event onClose: () => void = (): void => {};
  @Event onSearch: () => void = (): void => {};
  @Event onOptions: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local item?: XopcWorkspaceItem;
  @Local error: string = '';
  @Local busy: boolean = false;
  @Local propertiesOpen: boolean = false;
  @Local historyOpen: boolean = false;
  @Local detailsOpen: boolean = false;
  @Local headerVisible: boolean = true;
  private repository: XopcWorkspaceRepository = new XopcWorkspaceRepository();
  private timer: number = -1;
  private generation: number = 0;

  aboutToAppear(): void {
    void this.refresh();
    this.timer = setInterval((): void => { if (this.headerVisible && layoutState.foreground) void this.refresh(); }, 8000);
  }
  aboutToDisappear(): void { clearInterval(this.timer); this.generation++; }
  private async refresh(): Promise<void> {
    if (this.busy || !this.taskId) return;
    const generation = this.generation;
    this.busy = true;
    try {
      const item = await this.repository.detail('tasks', this.taskId);
      if (generation === this.generation) { this.item = item; this.error = ''; }
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  @Monitor('detailsRequest')
  openDetails(): void {
    this.detailsOpen = true;
    void this.refresh();
  }
  private phaseLabel(): ResourceStr {
    if (this.item?.resolution === 'done') return $r('app.string.complete');
    if (this.item?.resolution === 'cancelled') return $r('app.string.status_cancelled');
    if (this.item?.status === 'backlog') return $r('app.string.task_phase_backlog');
    if (this.item?.status === 'ready') return $r('app.string.task_phase_ready');
    if (this.item?.status === 'active') return $r('app.string.task_phase_in_progress');
    if (this.item?.status === 'review') return $r('app.string.task_phase_review');
    return $r('app.string.task_phase_closed');
  }
  private latestReceipt(): XopcMobileTaskReceipt | undefined {
    return this.item?.taskDetail?.receipts.slice().sort((left: XopcMobileTaskReceipt, right: XopcMobileTaskReceipt): number =>
      right.finalizedAt - left.finalizedAt)[0];
  }
  private objective(): string { return this.item?.taskDetail?.contract?.objective || this.item?.body || ''; }
  private criterionSymbol(criterion: string, index: number): string {
    if (!this.item?.taskDetail) return '○';
    const state = taskCriterionState(this.item.taskDetail, criterion, index);
    return state === 'passed' ? '✓' : state === 'failed' ? '!' : '○';
  }
  private manage(action: string): void {
    this.onNavigate({ page: action === 'edit' ? 'task-edit' : 'task-status', itemId: this.taskId });
  }
  private async cancelTask(): Promise<void> {
    const item = this.item;
    if (!item || this.busy) return;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.task_cancel'), message: $r('app.string.task_cancel_help'),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.confirm'), color: this.colors.danger }]
      });
      if (result.index !== 1) return;
      this.busy = true;
      await this.repository.action('tasks', item, 'cancel_task', '', this.repository.uuid());
      this.busy = false;
      await this.refresh();
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }

  @Builder
  taskMenu() {
    Menu() {
      MenuItem({ content: $r('app.string.edit') }).enabled(!!this.item && !this.busy)
        .onClick((): void => { this.manage('edit'); })
      MenuItem({ content: $r('app.string.task_adjust_status') }).enabled(!!this.item && !this.busy)
        .onClick((): void => { this.manage('status'); })
      if (this.item?.actions.includes('close')) {
        MenuItem({ content: $r('app.string.task_cancel') }).contentFontColor(this.colors.danger).enabled(!this.busy)
          .onClick((): void => { void this.cancelTask(); })
      }
      MenuItem({ content: $r('app.string.search') }).onClick((): void => { this.onSearch(); })
      MenuItem({ content: $r('app.string.chat_actions') }).onClick((): void => { this.onOptions(); })
    }
  }

  @Builder
  overview() {
    Scroll() {
      Column({ space: 20 }) {
        if (this.error) {
          Text(userErrorMessage(this.error, 'collection')).fontSize(13).fontColor(this.colors.danger)
          Button($r('app.string.refresh')).onClick((): void => { void this.refresh(); })
        }
        if (!this.item) { XopcListSkeleton() }
        if (this.item) {
          Text(this.phaseLabel()).fontSize(13).fontColor(this.colors.secondary)
        }
        if (this.item?.taskDetail?.attention.length) {
          Column({ space: 8 }) {
            Text($r('app.string.task_needs_attention')).fontSize(13).fontColor(this.colors.secondary)
            ForEach(this.item?.taskDetail?.attention ?? [], (attention: XopcMobileTaskAttention) => {
              Text(attention.summary).fontSize(14).fontColor(this.colors.foreground).width('100%')
            }, (attention: XopcMobileTaskAttention): string => attention.kind + ':' + attention.summary)
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        if (this.latestReceipt()?.summary) {
          Column({ space: 8 }) {
            Text($r('app.string.task_latest_result')).fontSize(13).fontColor(this.colors.secondary)
            Text(this.latestReceipt()?.summary ?? '').fontSize(14).fontColor(this.colors.foreground).copyOption(CopyOptions.LocalDevice)
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        if (this.objective()) {
          Column({ space: 8 }) {
            Text($r('app.string.task_goal_acceptance')).fontSize(13).fontColor(this.colors.secondary)
            Text(this.objective()).fontSize(14).fontColor(this.colors.foreground).copyOption(CopyOptions.LocalDevice)
            ForEach(this.item?.taskDetail?.contract?.acceptanceCriteria ?? [], (criterion: string, index: number) => {
              Text(this.criterionSymbol(criterion, index) + ' ' + criterion).fontSize(14).fontColor(this.colors.foreground).width('100%')
            }, (criterion: string): string => criterion)
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        if (this.item?.taskDetail?.contract?.expectedOutputs.length) {
          Column({ space: 8 }) {
            Text($r('app.string.task_expected_outputs')).fontSize(13).fontColor(this.colors.secondary)
            ForEach(this.item?.taskDetail?.contract?.expectedOutputs ?? [], (output: string) => {
              Text(output).fontSize(14).fontColor(this.colors.foreground)
            }, (output: string): string => output)
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        if (this.item?.taskDetail?.dependencies.length) {
          Column({ space: 8 }) {
            Text($r('app.string.task_dependencies')).fontSize(13).fontColor(this.colors.secondary)
            ForEach(this.item?.taskDetail?.dependencies ?? [], (dependency: XopcMobileTaskDependency) => {
              Button(dependency.title).width('100%').height(44).backgroundColor(this.colors.input)
                .fontColor(this.colors.foreground).onClick((): void => {
                  this.detailsOpen = false;
                  this.onNavigate({ page: 'task-chat', itemId: dependency.id });
                })
            }, (dependency: XopcMobileTaskDependency): string => dependency.id)
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        Column({ space: 8 }) {
          Button($r('app.string.workspace_details')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.foreground)
            .onClick((): void => { this.propertiesOpen = !this.propertiesOpen; })
          if (this.propertiesOpen) {
            if (this.item?.projectId) { Text(this.item?.projectId ?? '').fontColor(this.colors.foreground) }
            if (this.item?.priority) { Text(this.item?.priority ?? '').fontColor(this.colors.foreground) }
            if (this.item?.dueAt) { Text(new Date(this.item?.dueAt ?? 0).toLocaleString()).fontColor(this.colors.foreground) }
            if (this.item?.body && this.item.body !== this.objective()) { Text(this.item.body).fontColor(this.colors.foreground) }
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
        Column({ space: 8 }) {
          Button($r('app.string.task_change_log')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.foreground)
            .onClick((): void => { this.historyOpen = !this.historyOpen; })
          if (this.historyOpen) {
            ForEach(this.item?.taskDetail?.phaseChanges ?? [], (change: XopcTaskPhaseChange) => {
              Text(change.fromPhase + ' → ' + change.toPhase).fontSize(13).fontColor(this.colors.secondary)
            }, (change: XopcTaskPhaseChange): string => change.id)
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.width('100%').padding(20).alignItems(HorizontalAlign.Start)
    }.id('task-chat-overview').width('100%').layoutWeight(1).scrollBar(BarState.Auto)
  }

  @Builder
  detailsSheet() {
    Column() {
      Row() {
        Text(this.item?.title || $r('app.string.task_detail_title')).fontSize(18).fontWeight(FontWeight.Bold)
          .fontColor(this.colors.foreground).layoutWeight(1).maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.xmark')).fontSize(16).fontColor([this.colors.secondary])
        }.id('task-chat-details-close').width(44).height(44).padding(0).backgroundColor(this.colors.input)
          .accessibilityText($r('app.string.close')).onClick((): void => { this.detailsOpen = false; })
      }.width('100%').padding({ left: 20, right: 16, top: 8 })
      this.overview()
    }.width('100%').height('100%')
  }

  build() {
    Row({ space: 10 }) {
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(18).fontColor([this.colors.foreground])
      }.id('task-chat-close').width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
        .accessibilityText($r('app.string.back')).onClick((): void => { this.onClose(); })
      Text(this.item?.title || $r('app.string.task_detail_title')).fontSize(16).fontWeight(FontWeight.Medium)
        .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.slider_horizontal_2')).fontSize(20).fontColor([this.colors.foreground])
      }.id('task-chat-menu').width(44).height(44).padding(0).backgroundColor(this.colors.chat.card)
        .accessibilityText($r('app.string.more')).bindMenu(this.taskMenu)
    }.id('task-chat-header').width('100%').height(this.topInset + 64).padding({ left: 12, right: 12, top: this.topInset })
      .backgroundColor(this.colors.chat.canvas)
      .bindSheet($$this.detailsOpen, this.detailsSheet, {
        height: '74%', dragBar: true, showClose: false, backgroundColor: this.colors.panel })
      .onVisibleAreaChange([0, 0.1], (visible: boolean, ratio: number): void => {
        const returning = !this.headerVisible && visible && ratio > 0;
        this.headerVisible = visible && ratio > 0;
        if (returning) void this.refresh();
      })
  }
}
