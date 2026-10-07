import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
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
  @Computed get runningItems(): XopcHomeItem[] {
    return this.model.background.filter((item: XopcHomeItem): boolean => item.kind !== 'scheduled');
  }
  @Computed get scheduledItems(): XopcHomeItem[] {
    return this.model.background.filter((item: XopcHomeItem): boolean => item.kind === 'scheduled');
  }
  @Computed get pendingCount(): number { return this.model.loading || this.model.homeError ? 0 : this.model.needsUser.length; }
  @Computed get runningCount(): number { return this.model.loading || this.model.homeError ? 0 : this.runningItems.length; }
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  private refreshTimer: number = -1;
  private contentScroller: Scroller = new Scroller();
  aboutToAppear(): void { this.updateActivity(); }
  aboutToDisappear(): void { this.stopTimer(); this.model.dispose(); }
  @Monitor('activePage')
  updateActivity(): void {
    this.stopTimer();
    if (this.activePage) { this.model.refresh(); this.refreshTimer = setInterval((): void => { this.model.refresh(); }, 15000); }
  }
  private stopTimer(): void { if (this.refreshTimer >= 0) clearInterval(this.refreshTimer); this.refreshTimer = -1; }
  private jumpToNeedsUser(): void { this.contentScroller.scrollToIndex(1, true, ScrollAlign.START); }
  private jumpToRunning(): void {
    this.contentScroller.scrollToIndex(1 + (this.pendingCount > 0 ? this.pendingCount + 1 : 0),
      true, ScrollAlign.START);
  }
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
    Column({ space: 12 }) {
      Button({ type: ButtonType.Normal }) {
        Column({ space: 8 }) {
          Row({ space: 6 }) {
            Column().width(7).height(7).borderRadius(4).backgroundColor(this.colors.accent)
            Text($r('app.string.progress_action_required')).fontSize(12).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.accent)
          }.width('100%')
          Text(item.title).width('100%').fontSize(16).lineHeight(23).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (item.summary && item.summary !== item.title) {
            Text(item.summary).width('100%').fontSize(13).lineHeight(19).fontColor(this.colors.secondary)
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          if (item.openAction) {
            Row({ space: 4 }) {
              Text(item.openAction.label).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
              SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([this.colors.accent])
            }.width('100%').margin({ top: 4 })
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.width('100%').padding(0).backgroundColor(Color.Transparent)
        .onClick((): void => { if (item.openAction) this.runAction(item.openAction); })
      if ((item.primaryAction && item.primaryAction.type !== 'open') || item.secondaryActions.length > 0) {
        if (item.recommendation) {
          Text(item.recommendation).width('100%').fontSize(12).lineHeight(18)
            .fontColor(this.colors.secondary).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Row({ space: 8 }) {
          if (item.primaryAction && item.primaryAction.type !== 'open') {
            Button(item.primaryAction.label).layoutWeight(1).constraintSize({ minHeight: 44 })
              .backgroundColor(this.colors.accentSoft).fontColor(this.colors.accent).enabled(!this.model.pending)
              .onClick((): void => { if (item.primaryAction) this.runAction(item.primaryAction); })
          }
          ForEach(item.secondaryActions, (action: XopcHomeAction) => {
            Button(action.label).constraintSize({ minHeight: 44 }).backgroundColor(Color.Transparent)
              .fontColor(this.colors.secondary).enabled(!this.model.pending)
              .onClick((): void => { this.runAction(action); })
          }, (action: XopcHomeAction): string => action.type + ':' + action.label)
        }.width('100%')
      }
    }.width('100%').padding(16).borderRadius(18).backgroundColor(this.colors.panel)
      .margin({ bottom: 14 }).alignItems(HorizontalAlign.Start)
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
        List({ scroller: this.contentScroller }) {
          ListItem() {
            Column({ space: 8 }) {
              Row() {
                Button({ type: ButtonType.Normal }) {
                  Row({ space: 8 }) {
                    Column({ space: 2 }) {
                      Text(this.pendingCount.toString()).fontSize(24).fontWeight(FontWeight.Bold)
                        .fontColor(this.pendingCount > 0 ? this.colors.accent : this.colors.secondary)
                      Text($r('app.string.progress_action_required')).fontSize(13).fontColor(this.colors.secondary)
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                    if (this.pendingCount > 0) {
                      SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.accent])
                    }
                  }.width('100%')
                }.layoutWeight(1).height(64).padding(10).borderRadius(12).backgroundColor(Color.Transparent)
                  .enabled(this.pendingCount > 0)
                  .onClick((): void => { this.jumpToNeedsUser(); })
                Column().width(1).height(42).backgroundColor(this.colors.border)
                Button({ type: ButtonType.Normal }) {
                  Row({ space: 8 }) {
                    Column({ space: 2 }) {
                      Text(this.runningCount.toString()).fontSize(24).fontWeight(FontWeight.Bold)
                        .fontColor(this.runningCount > 0 ? this.colors.accent : this.colors.secondary)
                      Text($r('app.string.ongoing')).fontSize(13).fontColor(this.colors.secondary)
                    }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                    if (this.runningCount > 0) {
                      SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.accent])
                    }
                  }.width('100%')
                }.layoutWeight(1).height(64).padding(10).borderRadius(12).backgroundColor(Color.Transparent)
                  .enabled(this.runningCount > 0)
                  .onClick((): void => { this.jumpToRunning(); })
              }.width('100%').alignItems(VerticalAlign.Center)
              Text($r('app.string.progress_hint')).fontSize(12).lineHeight(18).fontColor(this.colors.secondary)
                .width('100%').padding({ left: 10, right: 10 })
            }.width('100%').padding(12).borderRadius(20).backgroundColor(this.colors.accentSoft)
              .alignItems(HorizontalAlign.Start)
          }
            if (this.model.loading) { ListItem() { XopcListSkeleton() } }
            else {
              if (this.model.homeError) {
                ListItem() {
                  XopcHubRow({ heading: $r('app.string.load_failed'), summary: this.model.homeError, symbol: $r('sys.symbol.arrow_clockwise'), onOpen: (): void => { this.model.refresh(); } })
                }
              } else {
                if (this.model.needsUser.length) {
                  ListItem() { XopcSectionLabel({ heading: $r('app.string.needs_you') }) }
                  ForEach(this.model.needsUser, (item: XopcHomeItem) => {
                    ListItem() { this.attention(item) }
                  }, (item: XopcHomeItem): string => item.id + JSON.stringify(item))
                }
                if (this.runningItems.length) {
                  ListItem() { XopcSectionLabel({ heading: $r('app.string.ongoing') }) }
                  ForEach(this.runningItems.slice(0, 5), (item: XopcHomeItem) => {
                    ListItem() {
                      XopcHubRow({ heading: item.title, summary: [item.statusLabel ?? '', item.summary].filter((text: string): boolean => Boolean(text)).join(' · '),
                        symbol: $r('sys.symbol.clock'), navigable: Boolean(item.openAction),
                        onOpen: (): void => { if (item.openAction) this.runAction(item.openAction); } })
                    }
                  }, (item: XopcHomeItem): string => item.id + JSON.stringify(item))
                }
              }
              if (this.scheduledItems.length) {
                ListItem() { XopcSectionLabel({ heading: $r('app.string.upcoming') }) }
                ForEach(this.scheduledItems.slice(0, 5), (item: XopcHomeItem) => {
                  ListItem() {
                    XopcHubRow({ heading: item.title, summary: [item.statusLabel ?? '', item.summary].filter((text: string): boolean => Boolean(text)).join(' · '),
                      symbol: $r('sys.symbol.clock'), navigable: Boolean(item.openAction),
                      onOpen: (): void => { if (item.openAction) this.runAction(item.openAction); } })
                  }
                }, (item: XopcHomeItem): string => item.id + JSON.stringify(item))
              } else if (this.model.automationMetrics?.nextRun) {
                ListItem() { XopcSectionLabel({ heading: $r('app.string.upcoming') }) }
                ListItem() {
                  XopcHubRow({ heading: this.model.automationMetrics.nextRun.name,
                    summary: this.automationTime(this.model.automationMetrics.nextRun.runAtMs), symbol: $r('sys.symbol.clock'),
                    onOpen: (): void => {
                      if (this.model.automationMetrics?.nextRun) this.openPage('automations', this.model.automationMetrics.nextRun.automationId);
                    } })
                }
              }
              if (this.model.tasksError) {
                ListItem() {
                  XopcHubRow({ heading: $r('app.string.load_failed'), summary: this.model.tasksError, symbol: $r('sys.symbol.arrow_clockwise'), onOpen: (): void => { this.model.refresh(); } })
                }
              } else if (this.model.closed.length) {
                ListItem() { XopcSectionLabel({ heading: $r('app.string.recent_closed') }) }
                ForEach(this.model.closed.slice(0, 2), (task: XopcTask) => {
                  ListItem() {
                    XopcHubRow({ heading: task.title, summary: this.resolutionLabel(task.resolution ?? ''), symbol: $r('sys.symbol.checkmark_circle'),
                      onOpen: (): void => { this.openPage('tasks', task.id); } })
                  }
                }, (task: XopcTask): string => task.id + ':' + (task.updatedAt ?? 0))
              }
            }
            if (this.model.actionError) {
              ListItem() {
                Text(userErrorMessage(this.model.actionError, 'save')).fontColor(this.colors.danger).width('100%').padding(12)
              }
            }
            ListItem() { XopcSectionLabel({ heading: $r('app.string.frequent_tools') }) }
            ListItem() {
              Row({ space: 12 }) {
                this.workTool($r('app.string.tasks'), $r('sys.symbol.checkmark_circle'), 'tasks')
                this.workTool($r('app.string.projects'), $r('sys.symbol.folder'), 'projects')
              }.width('100%')
            }
            ListItem() {
              Row({ space: 12 }) {
                this.workTool($r('app.string.automations'), $r('sys.symbol.clock'), 'automations')
              }.width('100%').margin({ top: 12 })
            }
            ListItem() { Column().height(this.bottomInset) }
        }.width('100%').height('100%').padding({ left: 20, right: 20 }).scrollBar(BarState.Off)
      }.layoutWeight(1).onRefreshing((): void => {
        this.pulling = true; this.model.refresh().finally((): void => { this.pulling = false; });
      })
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}
