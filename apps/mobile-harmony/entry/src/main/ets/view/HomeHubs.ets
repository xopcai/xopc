import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { userErrorMessage } from '../common/userError';
import { XopcPageHeader, XopcHubRow, XopcListSkeleton, XopcEmptyHint, XopcPageTitleOption } from './MobileComponents';
import { XopcProgressViewModel } from '../viewmodel/homeViewModel';
import { XopcHomeAction, XopcHomeDelivery, XopcHomeItem, XopcMobileRoute } from '../model/home';
import { dispatchHomeAction } from '../common/homeProtocol';

export const WORK_PAGE_OPTIONS: XopcPageTitleOption[] = [
  { key: 'progress', label: $r('app.string.progress'), id: 'work-page-progress' },
  { key: 'automations', label: $r('app.string.automations'), id: 'work-page-automations' },
  { key: 'projects', label: $r('app.string.projects'), id: 'work-page-projects' },
  { key: 'tasks', label: $r('app.string.tasks'), id: 'work-page-tasks' }
];

@ComponentV2
export struct XopcProgressView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param activePage: boolean = false;
  @Param model: XopcProgressViewModel = new XopcProgressViewModel();
  @Local pulling: boolean = false;
  @Local actionInFlight: boolean = false;
  @Computed get runningItems(): XopcHomeItem[] {
    return this.model.background.filter((item: XopcHomeItem): boolean => item.kind !== 'scheduled');
  }
  @Computed get scheduledItems(): XopcHomeItem[] {
    return this.model.background.filter((item: XopcHomeItem): boolean => item.kind === 'scheduled');
  }
  @Event onExit: () => void = (): void => {};
  @Event onSelectWorkPage: (page: string) => void = (_page: string): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  aboutToAppear(): void { if (this.activePage) void this.model.refresh(); }
  private openPage(page: string, itemId: string = ''): void { this.onNavigate({ page, itemId }); }
  private automationTime(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  private async runAction(action: XopcHomeAction): Promise<void> {
    if (this.model.pending || this.actionInFlight) return;
    this.actionInFlight = true; this.model.actionError = '';
    try {
      await dispatchHomeAction(action, {
        navigate: (route: XopcMobileRoute): void => { this.onNavigate(route); },
        confirm: async (command: XopcHomeAction): Promise<boolean> => {
          const result = await this.getUIContext().getPromptAction().showDialog({
            title: command.label, message: $r('app.string.confirm_action_help'),
            buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
              { text: $r('app.string.confirm'), color: this.colors.accent }]
          });
          return result.index === 1;
        },
        mutate: async (command: XopcHomeAction): Promise<void> => { await this.model.act(command); }
      });
    } catch (error) { this.model.actionError = (error as Error).message; }
    finally { this.actionInFlight = false; }
  }
  private attentionSummary(summary: string): ResourceStr {
    if (summary.includes('provider_setup_required')) return $r('app.string.progress_provider_setup');
    if (summary.includes('run was still active') && summary.includes('automatic recovery')) {
      return $r('app.string.progress_run_interrupted');
    }
    return summary;
  }

  @Builder
  attention(item: XopcHomeItem) {
    Column({ space: 10 }) {
      Button({ type: ButtonType.Normal }) {
        Column({ space: 8 }) {
          Row({ space: 6 }) {
            Circle().width(6).height(6).fill(this.colors.attentionForeground).accessibilityLevel('no')
            Text($r('app.string.progress_action_required')).fontSize(12).fontWeight(FontWeight.Medium)
              .fontColor(this.colors.secondary)
          }.padding({ left: 8, right: 8, top: 4, bottom: 4 }).borderRadius(this.colors.corner(10)).backgroundColor(this.colors.grouped)
          Text(item.title).width('100%').fontSize(16).lineHeight(23).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
          if (item.summary && item.summary !== item.title) {
            Text(this.attentionSummary(item.summary)).width('100%').fontSize(13).lineHeight(19).fontColor(this.colors.secondary)
              .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          if (item.openAction && !item.secondaryActions.some((action: XopcHomeAction): boolean =>
            !!action.href && action.href === item.openAction?.href)) {
            Row({ space: 4 }) {
              Text(item.openAction.label).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
              SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([this.colors.accent])
            }.width('100%')
          }
        }.width('100%').alignItems(HorizontalAlign.Start)
      }.width('100%').padding(0).backgroundColor(Color.Transparent)
        .onClick((): void => { if (item.openAction) this.runAction(item.openAction); })
      if ((item.primaryAction && item.primaryAction.type !== 'open') || item.secondaryActions.length > 0) {
        if (item.recommendation && !item.summary.includes('provider_setup_required')) {
          Text(item.recommendation).width('100%').fontSize(12).lineHeight(18)
            .fontColor(this.colors.secondary).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Row({ space: 8 }) {
          if (item.primaryAction && item.primaryAction.type !== 'open') {
            Button(item.primaryAction.label).constraintSize({ minHeight: 44 })
              .padding({ left: 18, right: 18 }).fontSize(14)
              .backgroundColor(this.colors.grouped).fontColor(this.colors.foreground).enabled(!this.model.pending && !this.actionInFlight)
              .onClick((): void => { if (item.primaryAction) this.runAction(item.primaryAction); })
          }
          ForEach(item.secondaryActions, (action: XopcHomeAction) => {
            Button(action.label).constraintSize({ minHeight: 44 }).backgroundColor(Color.Transparent).fontSize(14)
              .fontColor(this.colors.accent).enabled(!this.model.pending && !this.actionInFlight)
              .onClick((): void => { this.runAction(action); })
          }, (action: XopcHomeAction): string => action.type + ':' + action.label)
        }.width('100%')
      }
    }.width('100%').padding(16).backgroundColor(this.colors.panel)
      .borderRadius(this.colors.corner(16))
      .margin({ bottom: 8 }).alignItems(HorizontalAlign.Start)
  }
  @Builder
  sectionHeading(heading: ResourceStr, trailing: ResourceStr = '', page: string = '') {
    Row({ space: 12 }) {
      Text(heading).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1)
      if (page) {
        Button(trailing, { type: ButtonType.Normal }).fontSize(13).fontColor(this.colors.accent)
          .height(44).padding({ left: 8, right: 8 }).backgroundColor(Color.Transparent)
          .onClick((): void => {
            if (page === 'automations') this.onSelectWorkPage(page);
            else this.openPage(page);
          })
      } else if (trailing !== '') {
        Text(trailing).fontSize(13).fontColor(this.colors.secondary)
      }
    }.width('100%').constraintSize({ minHeight: 44 }).margin({ top: 16, bottom: 6 })
  }

  build() {
    Column() {
      XopcPageHeader({ heading: $r('app.string.progress'), titleOptions: WORK_PAGE_OPTIONS, selectedTitle: 'progress',
        titleMenuId: 'work-page-menu', onSelectTitle: this.onSelectWorkPage,
        backVisible: true, onBack: (): void => { this.onExit(); } })
      if (this.model.actionError) {
        Text(this.model.actionError === 'UNSUPPORTED_ROUTE' ? $r('app.string.unsupported_route')
          : this.model.actionError === 'TASK_RETRY_UNAVAILABLE' ? $r('app.string.progress_retry_unavailable')
          : userErrorMessage(this.model.actionError, 'save')).fontColor(this.colors.danger).fontSize(14).lineHeight(20)
          .width('100%').padding({ left: 20, right: 20, bottom: 12 })
      }
      Refresh({ refreshing: this.pulling }) {
        List() {
          if (this.model.loading) { ListItem() { XopcListSkeleton() } }
          else {
            if (this.model.homeError) {
              ListItem() {
                XopcHubRow({ heading: $r('app.string.load_failed'), summary: this.model.homeError, symbol: $r('sys.symbol.arrow_clockwise'), onOpen: (): void => { this.model.refresh(); } })
              }
            } else {
              if (this.model.needsUser.length) {
                ListItem() { this.sectionHeading($r('app.string.needs_you'), $r('app.string.progress_item_count', this.model.pendingCount)) }
                ForEach(this.model.needsUser, (item: XopcHomeItem) => {
                  ListItem() { this.attention(item) }
                }, (item: XopcHomeItem): string => item.id + JSON.stringify(item))
              }
              if (this.model.deliveries.length) {
                ListItem() { this.sectionHeading($r('app.string.progress_delivered'), $r('app.string.progress_view_library'), 'library') }
                ForEach(this.model.deliveries.slice(0, 5), (item: XopcHomeDelivery) => {
                  ListItem() {
                    XopcHubRow({ heading: item.title, summary: item.summary, symbol: $r('sys.symbol.checkmark_circle'),
                      onOpen: (): void => { this.runAction({ type: 'open', label: item.title, href: item.href }); } })
                  }
                }, (item: XopcHomeDelivery): string => item.id + ':' + item.summary)
              }
              if (this.runningItems.length) {
                ListItem() { this.sectionHeading($r('app.string.ongoing')) }
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
              ListItem() { this.sectionHeading($r('app.string.upcoming'), $r('app.string.progress_view_automations'), 'automations') }
              ForEach(this.scheduledItems.slice(0, 5), (item: XopcHomeItem) => {
                ListItem() {
                  XopcHubRow({ heading: item.title, summary: [item.statusLabel ?? '', item.summary].filter((text: string): boolean => Boolean(text)).join(' · '),
                    symbol: $r('sys.symbol.clock'), navigable: Boolean(item.openAction),
                    onOpen: (): void => { if (item.openAction) this.runAction(item.openAction); } })
                }
              }, (item: XopcHomeItem): string => item.id + JSON.stringify(item))
            } else if (this.model.automationMetrics?.nextRun) {
              ListItem() { this.sectionHeading($r('app.string.upcoming'), $r('app.string.progress_view_automations'), 'automations') }
              ListItem() {
                XopcHubRow({ heading: this.model.automationMetrics.nextRun.name,
                  summary: this.automationTime(this.model.automationMetrics.nextRun.runAtMs), symbol: $r('sys.symbol.clock'),
                  onOpen: (): void => {
                    if (this.model.automationMetrics?.nextRun) this.openPage('automations', this.model.automationMetrics.nextRun.automationId);
                  } })
              }
            }
            if (!this.model.homeError && this.model.needsUser.length === 0 && this.model.deliveries.length === 0
              && this.model.background.length === 0 && !this.model.automationMetrics?.nextRun) {
              ListItem() { XopcEmptyHint({ message: $r('app.string.progress_empty') }) }
            }
          }
        }.width('100%').height('100%').padding({ left: 20, right: 20 }).scrollBar(BarState.Off)
      }.layoutWeight(1).onRefreshing((): void => {
        this.pulling = true; this.model.refresh().finally((): void => { this.pulling = false; });
      })
    }.width('100%').height('100%').backgroundColor(this.colors.surface)
  }
}
