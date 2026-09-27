import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcSection, XopcWorkspaceItem, XopcAutomationRun } from '../model/workspace';
import { XopcWorkspaceViewModel } from '../viewmodel/workspaceViewModel';
import { XopcMarkdownView } from './MarkdownView';
import { XopcHubRow, XopcListSkeleton } from './MobileComponents';
import { XopcMobileRoute } from '../model/home';

@ComponentV2
export struct XopcWorkspaceView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param section: XopcSection = 'tasks';
  @Param heading: ResourceStr = '';
  @Param initialId: string = '';
  @Event onExit: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Event onCreateWithChat: (section: XopcSection) => Promise<void> = async (_section: XopcSection): Promise<void> => {};
  @Local model: XopcWorkspaceViewModel = new XopcWorkspaceViewModel();
  @Local search: string = '';
  @Local agentId: string = '';
  @Local automationDefinitionExpanded: boolean = false;
  @Local creatingChat: boolean = false;

  aboutToAppear(): void { this.model.start(this.section, this.initialId); }
  @Monitor('initialId')
  onTargetChange(): void {
    this.automationDefinitionExpanded = false;
    if (this.initialId) this.model.open(this.initialId);
  }
  aboutToDisappear(): void { this.model.dispose(); }

  private async goBack(): Promise<void> {
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
    if (this.model.selected && !this.initialId) this.model.back(); else this.onExit();
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

  private createLabel(): ResourceStr {
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
    return status;
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
  list() {
    Row({ space: 8 }) {
      TextInput({ text: this.search, placeholder: $r('app.string.search') }).layoutWeight(1)
        .onChange((text: string): void => { this.search = text; }).onSubmit((): void => { this.model.list(this.search); })
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(20).fontColor([this.colors.foreground])
      }.width(44).height(44).padding(0).backgroundColor(Color.Transparent).enabled(!this.model.busy)
        .accessibilityText($r('app.string.refresh')).onClick((): void => { this.model.list(this.search); })
    }.padding(12)
    List({ space: 8 }) {
      if (this.model.busy && !this.model.items.length) {
        ListItem() { XopcListSkeleton() }
      }
      ForEach(this.model.items, (item: XopcWorkspaceItem) => {
        ListItem() {
          if (this.section === 'automations') {
            Button({ type: ButtonType.Normal }) {
              Row({ space: 12 }) {
                Row() { SymbolGlyph($r('sys.symbol.clock')).fontSize(21).fontColor([this.colors.accent]) }
                  .width(38).height(38).justifyContent(FlexAlign.Center).borderRadius(19).backgroundColor(this.colors.accentSoft)
                Column({ space: 5 }) {
                  Row({ space: 8 }) {
                    Text(item.title || $r('app.string.untitled')).fontSize(16).fontWeight(FontWeight.Medium)
                      .fontColor(this.colors.foreground).layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(this.statusLabel(item.status)).fontSize(11).fontWeight(FontWeight.Medium)
                      .fontColor(item.enabled ? this.colors.accent : this.colors.tertiary)
                      .backgroundColor(item.enabled ? this.colors.accentSoft : this.colors.input).borderRadius(10)
                      .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                  }.width('100%')
                  Text(item.cron || $r('app.string.manual_trigger')).fontSize(13).fontColor(this.colors.secondary)
                    .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (item.body) {
                    Text(item.body).fontSize(13).fontColor(this.colors.tertiary).maxLines(2)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                  }
                }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(15).fontColor([this.colors.tertiary])
              }.width('100%').constraintSize({ minHeight: 88 }).padding({ left: 14, right: 14, top: 12, bottom: 12 })
            }.width('100%').padding(0).borderRadius(16).backgroundColor(this.colors.panel)
              .onClick((): void => { this.automationDefinitionExpanded = false; this.model.open(item.id); })
          } else {
            XopcHubRow({ heading: item.title || $r('app.string.untitled'), summary: item.body || item.status,
              symbol: this.section === 'projects' ? $r('sys.symbol.folder') : $r('sys.symbol.doc_text'),
              onOpen: (): void => { this.model.open(item.id); } })
          }
        }
      }, (item: XopcWorkspaceItem): string => item.id + ':' + item.version + ':' + item.title)
      if (this.model.hasMore) {
        ListItem() { Button($r('app.string.load_more')).onClick((): void => { this.model.list(this.search, true); }) }
      }
      if (!this.model.busy && this.model.items.length === 0) {
        ListItem() { Text($r('app.string.empty_list')).fontColor(this.colors.secondary).padding(24) }
      }
    }.layoutWeight(1).padding({ left: 20, right: 20 }).width('100%')
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
  detail(item: XopcWorkspaceItem) {
    if (this.section === 'automations' && !this.model.editing) {
      this.automationDetail(item)
    } else {
    List({ space: 12 }) {
      if (this.model.editing) {
        ListItem() {
          TextInput({ text: this.model.title, placeholder: $r('app.string.name') })
            .onChange((text: string): void => { this.model.title = text; })
        }
        ListItem() {
          TextArea({ text: this.model.body, placeholder: $r('app.string.description') }).height(260)
            .onChange((text: string): void => { this.model.body = text; })
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
            TextInput({ text: this.model.projectId, placeholder: $r('app.string.project_id') })
              .onChange((text: string): void => { this.model.projectId = text; })
          }
        }
        ListItem() { Button($r('app.string.save')).enabled(!this.model.busy).onClick((): void => { this.model.save(); }) }
      } else {
        ListItem() { Text(item.title || $r('app.string.untitled')).fontSize(24).fontColor(this.colors.foreground) }
        ListItem() { XopcMarkdownView({ content: item.body }) }
        ListItem() { Text(item.status).fontColor(this.colors.secondary) }
        if (item.cron) { ListItem() { Text(item.cron).fontColor(this.colors.secondary) } }
        if (item.editable) {
          ListItem() { Button($r('app.string.edit')).onClick((): void => { this.model.editing = true; }) }
        }
        if (this.section === 'tasks' && item.actions.includes('start')) {
          ListItem() {
            TextInput({ text: this.agentId, placeholder: $r('app.string.agent_id') })
              .onChange((text: string): void => { this.agentId = text; })
          }
        }
        ForEach(this.supportedActions(item), (action: string) => {
          ListItem() {
            Button(this.label(action)).enabled(!this.model.busy && (action !== 'start' || this.agentId.trim().length > 0))
              .onClick((): void => { this.action(action); })
          }
        }, (action: string): string => action)
      }
    }.layoutWeight(1).width('100%').padding(16)
    }
  }

  build() {
    NavDestination() {
    Column() {
      Row({ space: 12 }) {
        Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground]) }
          .width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.back'))
          .enabled(!this.model.busy).onClick((): void => { this.goBack(); })
        Text(this.heading).layoutWeight(1).fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
        if (!this.model.selected) {
          Button(this.createLabel()).enabled(!this.model.busy && !this.creatingChat)
            .onClick((): void => { this.createWithChat(); })
        }
      }.width('100%').padding(16)
      if (this.model.error) { Text(this.model.error).fontColor(this.colors.danger).padding(12) }
      if (this.model.selected) { this.detail(this.model.selected) } else { this.list() }
    }.height('100%').width('100%').backgroundColor(this.colors.surface)
    }.hideTitleBar(true).onBackPressed((): boolean => { if (!this.model.busy) this.goBack(); return true; })
  }
}
