import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcPageHeader, XopcHubRow, XopcSectionLabel, XopcListSkeleton } from './MobileComponents';
import { XopcProgressViewModel } from '../viewmodel/homeViewModel';
import { XopcHomeAction, XopcHomeItem, XopcMobileRoute } from '../model/home';
import { XopcTask } from '../model/workspace';
import { mobileRoute } from '../common/homeProtocol';

@ComponentV2
export struct XopcProgressView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param activePage: boolean = false;
  @Param bottomInset: number = 0;
  @Local model: XopcProgressViewModel = new XopcProgressViewModel();
  @Local pulling: boolean = false;
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  private refreshTimer: number = -1;
  aboutToAppear(): void { this.updateActivity(); }
  aboutToDisappear(): void { this.stopTimer(); this.model.dispose(); }
  @Monitor('activePage')
  updateActivity(): void {
    this.stopTimer();
    if (this.activePage) { this.model.refresh(); this.refreshTimer = setInterval((): void => { this.model.refresh(); }, 15000); }
  }
  private stopTimer(): void { if (this.refreshTimer >= 0) clearInterval(this.refreshTimer); this.refreshTimer = -1; }
  private openPage(page: string, itemId: string = ''): void { this.onNavigate({ page, itemId }); }
  private automationTime(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  private resolutionLabel(value: string): ResourceStr {
    if (value === 'done') return $r('app.string.closed_done');
    if (value === 'cancelled') return $r('app.string.closed_cancelled');
    if (value === 'wont_do') return $r('app.string.closed_wont_do');
    if (value === 'duplicate') return $r('app.string.closed_duplicate');
    return value;
  }
  private async runAction(action: XopcHomeAction): Promise<void> {
    if (action.type === 'open') {
      const route: XopcMobileRoute | undefined = mobileRoute(action.href ?? '');
      if (route) this.onNavigate(route);
      else this.model.actionError = this.getUIContext().getHostContext()?.resourceManager.getStringSync($r('app.string.unsupported_route').id) ?? '';
      return;
    }
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: action.label, message: $r('app.string.confirm_action_help'),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.confirm'), color: this.colors.accent }]
      });
      if (result.index === 1) await this.model.act(action);
    } catch (error) { this.model.actionError = (error as Error).message; }
  }
  @Builder
  attention(item: XopcHomeItem) {
    Column({ space: 8 }) {
      XopcHubRow({ heading: item.title, summary: item.summary, symbol: $r('sys.symbol.checkmark_circle'),
        navigable: Boolean(item.openAction), onOpen: (): void => { if (item.openAction) this.runAction(item.openAction); } })
      if (item.recommendation) { Text(item.recommendation).fontSize(13).fontColor(this.colors.secondary).width('100%') }
      Column({ space: 4 }) {
        if (item.primaryAction) {
          Button(item.primaryAction.label).width('100%').constraintSize({ minHeight: 44 }).backgroundColor(this.colors.accentSoft)
            .fontColor(this.colors.accent).enabled(!this.model.pending)
            .onClick((): void => { if (item.primaryAction) this.runAction(item.primaryAction); })
        }
        ForEach(item.secondaryActions, (action: XopcHomeAction) => {
          Button(action.label).width('100%').constraintSize({ minHeight: 44 }).backgroundColor(Color.Transparent)
            .fontColor(this.colors.secondary).enabled(!this.model.pending)
            .onClick((): void => { this.runAction(action); })
        }, (action: XopcHomeAction): string => action.type + ':' + action.label)
      }.width('100%')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder
  workTool(label: ResourceStr, icon: Resource, page: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 10 }) {
        Row() { SymbolGlyph(icon).fontSize(20).fontColor([this.colors.accent]) }
          .width(34).height(34).justifyContent(FlexAlign.Center).borderRadius(17).backgroundColor(this.colors.accentSoft)
        Text(label).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1).maxLines(1)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
      }.width('100%').height(64).padding({ left: 12, right: 12 })
    }.layoutWeight(1).padding(0).borderRadius(16).backgroundColor(this.colors.panel)
      .onClick((): void => { this.openPage(page); })
  }
  build() {
    Column() {
      XopcPageHeader({ heading: $r('app.string.progress'), actionLabel: $r('app.string.all_work'), actionIcon: $r('sys.symbol.checkmark_circle'),
        onAction: (): void => { this.openPage('tasks'); } })
      Refresh({ refreshing: this.pulling }) {
        Scroll() {
          Column() {
            Row({ space: 12 }) {
              SymbolGlyph(this.model.needsUser.length ? $r('sys.symbol.exclamationmark_circle') : $r('sys.symbol.checkmark_circle'))
                .fontSize(24).fontColor([this.colors.accent])
              Column({ space: 5 }) {
                Text($r('app.string.progress_summary', this.model.needsUser.length, this.model.background.length))
                  .fontSize(16).lineHeight(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
                Text($r('app.string.progress_hint')).fontSize(13).lineHeight(18).fontColor(this.colors.secondary)
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            }.width('100%').constraintSize({ minHeight: 92 }).padding(16).borderRadius(20)
              .backgroundColor(this.colors.accentSoft)
            XopcSectionLabel({ heading: $r('app.string.frequent_tools') })
            Row({ space: 12 }) {
              this.workTool($r('app.string.tasks'), $r('sys.symbol.checkmark_circle'), 'tasks')
              this.workTool($r('app.string.projects'), $r('sys.symbol.folder'), 'projects')
            }.width('100%')
            Row({ space: 12 }) {
              this.workTool($r('app.string.automations'), $r('sys.symbol.clock'), 'automations')
              this.workTool($r('app.string.workflows'), $r('sys.symbol.arrow_clockwise'), 'workflows')
            }.width('100%').margin({ top: 12 })
            if (this.model.loading) { XopcListSkeleton() }
            else {
              if (this.model.homeError) {
                XopcHubRow({ heading: $r('app.string.load_failed'), summary: this.model.homeError, symbol: $r('sys.symbol.arrow_clockwise'), onOpen: (): void => { this.model.refresh(); } })
              } else {
                if (this.model.needsUser.length) {
                  XopcSectionLabel({ heading: $r('app.string.needs_you') })
                  ForEach(this.model.needsUser, (item: XopcHomeItem) => { this.attention(item) }, (item: XopcHomeItem): string => item.id + JSON.stringify(item))
                }
                if (this.model.background.length) {
                  XopcSectionLabel({ heading: $r('app.string.ongoing') })
                  ForEach(this.model.background.slice(0, 5), (item: XopcHomeItem) => {
                    XopcHubRow({ heading: item.title, summary: [item.statusLabel ?? '', item.summary].filter((text: string): boolean => Boolean(text)).join(' · '),
                      symbol: $r('sys.symbol.clock'), navigable: Boolean(item.openAction),
                      onOpen: (): void => { if (item.openAction) this.runAction(item.openAction); } })
                  }, (item: XopcHomeItem): string => item.id + JSON.stringify(item))
                }
              }
              if (this.model.automationMetrics?.nextRun) {
                XopcSectionLabel({ heading: $r('app.string.upcoming') })
                XopcHubRow({ heading: this.model.automationMetrics.nextRun.name,
                  summary: this.automationTime(this.model.automationMetrics.nextRun.runAtMs), symbol: $r('sys.symbol.clock'),
                  onOpen: (): void => {
                    if (this.model.automationMetrics?.nextRun) this.openPage('automations', this.model.automationMetrics.nextRun.automationId);
                  } })
              }
              if (this.model.tasksError) {
                XopcHubRow({ heading: $r('app.string.load_failed'), summary: this.model.tasksError, symbol: $r('sys.symbol.arrow_clockwise'), onOpen: (): void => { this.model.refresh(); } })
              } else if (this.model.closed.length) {
                XopcSectionLabel({ heading: $r('app.string.recent_closed') })
                ForEach(this.model.closed.slice(0, 2), (task: XopcTask) => {
                  XopcHubRow({ heading: task.title, summary: this.resolutionLabel(task.resolution ?? ''), symbol: $r('sys.symbol.checkmark_circle'),
                    onOpen: (): void => { this.openPage('tasks', task.id); } })
                }, (task: XopcTask): string => task.id + ':' + (task.updatedAt ?? 0))
              }
            }
            if (this.model.actionError) { Text(this.model.actionError).fontColor(this.colors.danger).width('100%').padding(12) }
          }.width('100%').padding({ left: 20, right: 20, bottom: this.bottomInset }).alignItems(HorizontalAlign.Start)
        }.width('100%').height('100%').align(Alignment.Top).scrollBar(BarState.Off)
      }.layoutWeight(1).onRefreshing((): void => {
        this.pulling = true; this.model.refresh().finally((): void => { this.pulling = false; });
      })
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}
