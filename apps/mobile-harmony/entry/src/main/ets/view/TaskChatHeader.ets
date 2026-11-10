import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { taskCriterionState } from '../common/taskManagement';
import { userErrorMessage } from '../common/userError';
import { XopcWorkspaceRepository } from '../repository/workspaceRepository';
import { XopcWorkspaceItem, XopcMobileTaskReceipt, XopcMobileTaskAttention, XopcTaskPhaseChange } from '../model/workspace';
import { XopcMobileRoute } from '../model/home';
import { XopcListSkeleton } from './MobileComponents';
import { layoutState } from '../service/layoutState';

@ComponentV2
export struct XopcTaskChatHeader {
  @Param taskId: string = '';
  @Param expanded: boolean = false;
  @Param topInset: number = 0;
  @Param bottomClearance: number = 0;
  @Event onToggle: () => void = (): void => {};
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
  @Local availableHeight: number = 0;
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
    }.id('task-chat-overview').width('100%').height(Math.max(0, Math.min(this.availableHeight * 0.5, this.availableHeight - this.topInset - this.bottomClearance - 64)))
      .scrollBar(BarState.Auto).backgroundColor(this.colors.panel).borderRadius({ bottomLeft: 14, bottomRight: 14 })
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      if (this.expanded) {
        Column().id('task-chat-scrim').width('100%')
          .height(Math.max(0, this.availableHeight - this.topInset - 64 - this.bottomClearance))
          .position({ x: 0, y: this.topInset + 64 }).backgroundColor('#18000000')
          .onClick((): void => { this.onToggle(); })
      }
      Column() {
        Row({ space: 4 }) {
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.xmark')).fontSize(18).fontColor([this.colors.foreground])
          }.id('task-chat-close').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.chat_close')).onClick((): void => { this.onClose(); })
          Button({ type: ButtonType.Normal }) {
            Row({ space: 8 }) {
              Column({ space: 2 }) {
                Text(this.item?.title || $r('app.string.task_detail_title')).fontSize(15).fontWeight(FontWeight.Medium)
                  .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
                Row({ space: 4 }) {
                  Text(this.item ? this.phaseLabel() : $r('app.string.task_detail_title')).fontSize(12).fontColor(this.colors.secondary)
                  if (this.latestReceipt()?.summary) {
                    Text('· ' + (this.latestReceipt()?.summary ?? '')).fontSize(12).fontColor(this.colors.secondary)
                      .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
                  }
                }.width('100%')
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
              SymbolGlyph(this.expanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(14).fontColor([this.colors.secondary])
            }.width('100%')
          }.id('task-chat-summary-toggle').layoutWeight(1).height(48).padding(0).backgroundColor(Color.Transparent)
            .onClick((): void => { this.onToggle(); })
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.ellipsis_circle')).fontSize(20).fontColor([this.colors.foreground])
          }.id('task-chat-menu').width(44).height(44).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.more')).bindMenu(this.taskMenu)
        }.id('task-chat-header').width('100%').height(64).padding({ left: 8, right: 8 }).backgroundColor(this.colors.surface)
        if (this.expanded) { this.overview() }
      }.width('100%').padding({ top: this.topInset }).backgroundColor(Color.Transparent)
    }.width('100%').height('100%').hitTestBehavior(HitTestMode.Transparent)
      .onAreaChange((_previous: Area, current: Area): void => { this.availableHeight = Number(current.height); })
      .onVisibleAreaChange([0, 0.1], (visible: boolean, ratio: number): void => {
        const returning = !this.headerVisible && visible && ratio > 0;
        this.headerVisible = visible && ratio > 0;
        if (returning) void this.refresh();
      })
  }
}
