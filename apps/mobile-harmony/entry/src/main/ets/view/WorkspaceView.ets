import { XopcSection, XopcWorkspaceItem, XopcAutomationRun } from '../model/workspace';
import { XopcWorkspaceViewModel } from '../viewmodel/workspaceViewModel';
import { XopcMarkdownView } from './MarkdownView';
import { XopcHubRow, XopcListSkeleton } from './MobileComponents';
import { XopcJudgmentsView } from './JudgmentsView';
import { XopcShareResult } from '../model/share';
import { shareService } from '../service/shareService';
import { XopcShareResultView } from './ShareResultView';

@ComponentV2
export struct XopcWorkspaceView {
  @Param section: XopcSection = 'tasks';
  @Param heading: ResourceStr = '';
  @Param initialId: string = '';
  @Param noteStatus: string = '';
  @Param judgmentId: string = '';
  @Event onExit: () => void = (): void => {};
  @Local model: XopcWorkspaceViewModel = new XopcWorkspaceViewModel();
  @Local search: string = '';
  @Local agentId: string = '';
  @Local shareResult?: XopcShareResult;
  @Local shareOpen: boolean = false;

  aboutToAppear(): void { this.model.start(this.section, this.initialId, this.noteStatus); }
  @Monitor('initialId')
  onTargetChange(): void { if (this.initialId) this.model.open(this.initialId); }
  aboutToDisappear(): void { this.model.dispose(); }

  private async goBack(): Promise<void> {
    if (this.model.editing) {
      const selected = this.model.selected;
      if (selected && (this.model.title !== selected.title || this.model.body !== selected.body || this.model.cron !== (selected.cron ?? '') || this.model.projectId !== (selected.projectId ?? ''))) {
        try {
          const result = await this.getUIContext().getPromptAction().showDialog({
            title: $r('app.string.back'), message: $r('app.string.discard_changes'),
            buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') }, { text: $r('app.string.confirm'), color: $r('app.color.danger') }]
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

  private async action(action: string): Promise<void> {
    if (['delete', 'archive', 'close', 'run', 'start'].includes(action)) {
      try {
        const result = await this.getUIContext().getPromptAction().showDialog({
          title: this.label(action), message: $r('app.string.confirm_action_help'),
          buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') },
            { text: $r('app.string.confirm'), color: $r('app.color.accent') }]
        });
        if (result.index !== 1) return;
      } catch (error) { this.model.error = (error as Error).message; return; }
    }
    await this.model.action(action, this.agentId);
  }

  private async shareNote(item: XopcWorkspaceItem): Promise<void> {
    if (this.model.busy || !item.id || item.version <= 0) return;
    this.model.busy = true; this.model.error = '';
    try { this.shareResult = await shareService.note(item.id, item.version); this.shareOpen = true; }
    catch (error) { this.model.error = (error as Error).message; }
    finally { this.model.busy = false; }
  }

  @Builder
  shareSheet() {
    if (this.shareResult) { XopcShareResultView({ share: this.shareResult, onClose: (): void => { this.shareOpen = false; } }) }
  }

  @Builder
  list() {
    Row({ space: 8 }) {
      TextInput({ text: this.search, placeholder: $r('app.string.search') }).layoutWeight(1)
        .onChange((text: string): void => { this.search = text; }).onSubmit((): void => { this.model.list(this.search); })
      Button($r('app.string.refresh')).enabled(!this.model.busy).onClick((): void => { this.model.list(this.search); })
    }.padding(12)
    List({ space: 8 }) {
      if (this.noteStatus === 'inbox') { ListItem() { XopcJudgmentsView({ highlightedId: this.judgmentId }) } }
      ForEach(this.model.items, (item: XopcWorkspaceItem) => {
        ListItem() {
          XopcHubRow({ heading: item.title || $r('app.string.untitled'), summary: item.body || item.status,
            symbol: this.section === 'projects' ? $r('sys.symbol.folder') : $r('sys.symbol.doc_text'),
            onOpen: (): void => { this.model.open(item.id); } })
        }
      }, (item: XopcWorkspaceItem): string => item.id + ':' + item.version + ':' + item.title)
      if (this.model.hasMore) {
        ListItem() { Button($r('app.string.load_more')).onClick((): void => { this.model.list(this.search, true); }) }
      }
      if (!this.model.busy && this.model.items.length === 0) {
        ListItem() { Text($r('app.string.empty_list')).fontColor($r('app.color.secondary')).padding(24) }
      }
    }.layoutWeight(1).padding({ left: 20, right: 20 }).width('100%')
  }

  @Builder
  detail(item: XopcWorkspaceItem) {
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
              Text($r('app.string.cron_help')).fontColor($r('app.color.secondary'))
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
        ListItem() { Text(item.title || $r('app.string.untitled')).fontSize(24).fontColor($r('app.color.foreground')) }
        ListItem() { XopcMarkdownView({ content: item.body }) }
        ListItem() { Text(item.status).fontColor($r('app.color.secondary')) }
        if (item.cron) { ListItem() { Text(item.cron).fontColor($r('app.color.secondary')) } }
        if (item.editable) {
          ListItem() { Button($r('app.string.edit')).onClick((): void => { this.model.editing = true; }) }
        }
        if (this.section === 'notes' && item.id && item.version > 0) {
          ListItem() { Button($r('app.string.chat_share')).enabled(!this.model.busy).onClick((): void => { this.shareNote(item); }) }
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
        ForEach(this.model.runs, (run: XopcAutomationRun) => {
          ListItem() { Text(run.status + ' · ' + run.id).fontSize(13).fontColor($r('app.color.secondary')) }
        }, (run: XopcAutomationRun): string => run.id)
      }
    }.layoutWeight(1).width('100%').padding(16)
  }

  build() {
    NavDestination() {
    Column() {
      Row({ space: 12 }) {
        Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([$r('app.color.foreground')]) }
          .width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.back'))
          .enabled(!this.model.busy).onClick((): void => { this.goBack(); })
        Text(this.heading).layoutWeight(1).fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground'))
        if (!this.model.selected) {
          Button($r('app.string.new_chat')).enabled(!this.model.busy).onClick((): void => { this.model.create(); })
        }
      }.width('100%').padding(16)
      if (this.model.error) { Text(this.model.error).fontColor($r('app.color.danger')).padding(12) }
      if (this.model.busy) {
        Column() { XopcListSkeleton() }.padding({ left: 20, right: 20 }).width('100%')
      }
      if (this.model.selected) { this.detail(this.model.selected) } else { this.list() }
    }.height('100%').width('100%').backgroundColor($r('app.color.surface'))
      .bindSheet($$this.shareOpen, this.shareSheet, { height: '92%', dragBar: false })
    }.hideTitleBar(true).onBackPressed((): boolean => { if (!this.model.busy) this.goBack(); return true; })
  }
}
