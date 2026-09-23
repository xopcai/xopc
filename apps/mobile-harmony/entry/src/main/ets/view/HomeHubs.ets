import { XopcPageHeader, XopcHubRow, XopcSectionLabel, XopcEmptyHint, XopcListSkeleton } from './MobileComponents';
import { XopcProgressViewModel, XopcLibraryViewModel } from '../viewmodel/homeViewModel';
import { XopcHomeAction, XopcHomeItem, XopcMobileRoute } from '../model/home';
import { XopcTask, XopcNote } from '../model/workspace';
import { XopcFile } from '../model/files';
import { mobileRoute } from '../common/homeProtocol';

@ComponentV2
export struct XopcProgressView {
  @Param activePage: boolean = false;
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
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') },
          { text: $r('app.string.confirm'), color: $r('app.color.accent') }]
      });
      if (result.index === 1) await this.model.act(action);
    } catch (error) { this.model.actionError = (error as Error).message; }
  }
  @Builder
  attention(item: XopcHomeItem) {
    Column({ space: 8 }) {
      XopcHubRow({ heading: item.title, summary: item.summary, symbol: $r('sys.symbol.checkmark_circle'),
        navigable: Boolean(item.openAction), onOpen: (): void => { if (item.openAction) this.runAction(item.openAction); } })
      if (item.recommendation) { Text(item.recommendation).fontSize(13).fontColor($r('app.color.secondary')).width('100%') }
      Column({ space: 4 }) {
        if (item.primaryAction) {
          Button(item.primaryAction.label).width('100%').constraintSize({ minHeight: 44 }).backgroundColor($r('app.color.accent_soft'))
            .fontColor($r('app.color.accent')).enabled(!this.model.pending)
            .onClick((): void => { if (item.primaryAction) this.runAction(item.primaryAction); })
        }
        ForEach(item.secondaryActions, (action: XopcHomeAction) => {
          Button(action.label).width('100%').constraintSize({ minHeight: 44 }).backgroundColor(Color.Transparent)
            .fontColor($r('app.color.secondary')).enabled(!this.model.pending)
            .onClick((): void => { this.runAction(action); })
        }, (action: XopcHomeAction): string => action.type + ':' + action.label)
      }.width('100%')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
  @Builder
  workTool(label: ResourceStr, icon: Resource, page: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 10 }) {
        Row() { SymbolGlyph(icon).fontSize(20).fontColor([$r('app.color.accent')]) }
          .width(34).height(34).justifyContent(FlexAlign.Center).borderRadius(17).backgroundColor($r('app.color.accent_soft'))
        Text(label).fontSize(14).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).layoutWeight(1).maxLines(1)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([$r('app.color.tertiary')])
      }.width('100%').height(64).padding({ left: 12, right: 12 })
    }.layoutWeight(1).padding(0).borderRadius(16).backgroundColor($r('app.color.panel'))
      .border({ width: 0.5, color: $r('app.color.border_subtle') })
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
                .fontSize(24).fontColor([$r('app.color.accent')])
              Column({ space: 5 }) {
                Text($r('app.string.progress_summary', this.model.needsUser.length, this.model.background.length))
                  .fontSize(16).lineHeight(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground'))
                Text($r('app.string.progress_hint')).fontSize(13).lineHeight(18).fontColor($r('app.color.secondary'))
              }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            }.width('100%').constraintSize({ minHeight: 92 }).padding(16).borderRadius(20)
              .backgroundColor($r('app.color.accent_soft')).border({ width: 0.5, color: $r('app.color.border_subtle') })
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
            if (this.model.actionError) { Text(this.model.actionError).fontColor($r('app.color.danger')).width('100%').padding(12) }
            XopcSectionLabel({ heading: $r('app.string.work_tools') })
            Row({ space: 12 }) {
              this.workTool($r('app.string.workflows'), $r('sys.symbol.arrow_clockwise'), 'workflows')
              this.workTool($r('app.string.automations'), $r('sys.symbol.clock'), 'automations')
            }.width('100%')
          }.width('100%').padding({ left: 20, right: 20, bottom: 28 }).alignItems(HorizontalAlign.Start)
        }.width('100%').height('100%').align(Alignment.Top).scrollBar(BarState.Off)
      }.layoutWeight(1).onRefreshing((): void => {
        this.pulling = true; this.model.refresh().finally((): void => { this.pulling = false; });
      })
    }.width('100%').height('100%').backgroundColor($r('app.color.surface'))
  }
}

@ComponentV2
export struct XopcLibraryView {
  @Param activePage: boolean = false;
  @Local model: XopcLibraryViewModel = new XopcLibraryViewModel();
  @Local pulling: boolean = false;
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  private refreshTimer: number = -1;
  aboutToAppear(): void { this.updateActivity(); }
  aboutToDisappear(): void { this.stopTimer(); this.model.dispose(); }
  @Monitor('activePage')
  updateActivity(): void {
    this.stopTimer();
    if (this.activePage) { this.model.refresh(); this.refreshTimer = setInterval((): void => { this.model.refresh(); }, 60000); }
  }
  private stopTimer(): void { if (this.refreshTimer >= 0) clearInterval(this.refreshTimer); this.refreshTimer = -1; }
  private openPage(page: string, itemId: string = ''): void { this.onNavigate({ page, itemId }); }
  @Builder
  shortcut(label: ResourceStr, icon: Resource, page: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 10 }) {
        Row() { SymbolGlyph(icon).fontSize(21).fontColor([$r('app.color.accent')]) }
          .width(36).height(36).justifyContent(FlexAlign.Center).borderRadius(18).backgroundColor($r('app.color.accent_soft'))
        Text(label).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).layoutWeight(1).maxLines(1)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([$r('app.color.tertiary')])
      }.width('100%').height(68).padding({ left: 12, right: 12 })
    }.layoutWeight(1).padding(0).borderRadius(16).backgroundColor($r('app.color.panel'))
      .border({ width: 0.5, color: $r('app.color.border_subtle') }).onClick((): void => { this.openPage(page); })
  }
  build() {
    Column() {
      XopcPageHeader({ heading: $r('app.string.library') })
      Refresh({ refreshing: this.pulling }) {
        Scroll() {
          Column() {
            Text($r('app.string.library_hint')).fontSize(15).lineHeight(22).fontColor($r('app.color.secondary')).width('100%')
            XopcSectionLabel({ heading: $r('app.string.quick_access') })
            Row({ space: 12 }) {
              this.shortcut($r('app.string.notes'), $r('sys.symbol.doc_text'), 'notes')
              this.shortcut($r('app.string.files'), $r('sys.symbol.folder'), 'files')
            }.width('100%')
            Row({ space: 12 }) {
              this.shortcut($r('app.string.inbox'), $r('sys.symbol.doc'), 'inbox')
              Blank().layoutWeight(1)
            }.width('100%').margin({ top: 12 })
            XopcSectionLabel({ heading: $r('app.string.library_recent_files') })
            if (this.model.loading) { XopcListSkeleton() }
            else if (this.model.filesError) {
              XopcHubRow({ heading: $r('app.string.load_failed'), summary: this.model.filesError, symbol: $r('sys.symbol.arrow_clockwise'), onOpen: (): void => { this.model.refresh(); } })
            } else if (!this.model.files.length) { XopcEmptyHint({ message: $r('app.string.no_files') }) }
            ForEach(this.model.files, (file: XopcFile) => {
              XopcHubRow({ heading: file.name, summary: file.relativePath, symbol: $r('sys.symbol.doc'), onOpen: (): void => { this.openPage('files', file.id); } })
            }, (file: XopcFile): string => file.id + ':' + file.revision)
            XopcSectionLabel({ heading: $r('app.string.recent_notes') })
            if (this.model.loading) { XopcListSkeleton() }
            else if (this.model.notesError) {
              XopcHubRow({ heading: $r('app.string.load_failed'), summary: this.model.notesError, symbol: $r('sys.symbol.arrow_clockwise'), onOpen: (): void => { this.model.refresh(); } })
            } else if (!this.model.notes.length) { XopcEmptyHint({ message: $r('app.string.no_notes') }) }
            ForEach(this.model.notes, (note: XopcNote) => {
              XopcHubRow({ heading: note.title || $r('app.string.untitled'), summary: note.snippet ?? '', symbol: $r('sys.symbol.doc_text'), onOpen: (): void => { this.openPage('notes', note.id); } })
            }, (note: XopcNote): string => note.id + ':' + (note.remoteVersion ?? 0))
          }.width('100%').padding({ left: 20, right: 20, bottom: 28 }).alignItems(HorizontalAlign.Start)
        }.width('100%').height('100%').align(Alignment.Top).scrollBar(BarState.Off)
      }.layoutWeight(1).onRefreshing((): void => {
        this.pulling = true; this.model.refresh().finally((): void => { this.pulling = false; });
      })
    }.width('100%').height('100%').backgroundColor($r('app.color.surface'))
  }
}
