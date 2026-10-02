import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcMobileRoute } from '../model/home';
import { XopcNoteIndexEntry } from '../model/note';
import { XopcWorkspaceItem } from '../model/workspace';
import { XopcProjectSpaceViewModel } from '../viewmodel/projectSpaceViewModel';
import { XopcListSkeleton } from './MobileComponents';

@ComponentV2
export struct XopcProjectSpaceView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param projectId: string = '';
  @Event onExit: () => void = (): void => {};
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local model: XopcProjectSpaceViewModel = new XopcProjectSpaceViewModel();
  @Local tab: string = 'overview';
  private shownOnce: boolean = false;

  aboutToAppear(): void { void this.model.load(this.projectId); }
  aboutToDisappear(): void { this.model.dispose(); }
  @Monitor('projectId')
  onProjectChange(): void { this.tab = 'overview'; void this.model.load(this.projectId); }

  private go(page: string, itemId: string = ''): void {
    this.onNavigate({ page, itemId, projectId: this.projectId });
  }

  private taskStatus(status: string): ResourceStr {
    if (status === 'closed') return $r('app.string.task_phase_closed');
    if (status === 'in_progress') return $r('app.string.task_phase_in_progress');
    if (status === 'ready') return $r('app.string.task_phase_ready');
    if (status === 'review') return $r('app.string.task_phase_review');
    return $r('app.string.task_phase_backlog');
  }

  private projectStatus(status: string): ResourceStr {
    if (status === 'archived') return $r('app.string.project_status_archived');
    if (status === 'planned') return $r('app.string.project_status_planned');
    if (status === 'paused') return $r('app.string.project_status_paused');
    if (status === 'completed') return $r('app.string.project_status_completed');
    if (status === 'cancelled') return $r('app.string.project_status_cancelled');
    return $r('app.string.project_status_active');
  }

  @Builder
  tabChip(id: string, label: ResourceStr, count: number) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 5 }) {
        Text(label).fontSize(14).fontWeight(FontWeight.Medium)
          .fontColor(this.tab === id ? Color.White : this.colors.secondary)
        if (id !== 'overview') {
          Text(count.toString()).fontSize(11).fontColor(this.tab === id ? Color.White : this.colors.tertiary)
        }
      }.padding({ left: 14, right: 14 })
    }.height(38).padding(0).borderRadius(19)
      .backgroundColor(this.tab === id ? this.colors.accent : this.colors.input)
      .onClick((): void => { this.tab = id; })
  }

  @Builder
  taskCard(item: XopcWorkspaceItem) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(22).fontColor([this.colors.accent])
        Column({ space: 5 }) {
          Text(item.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(this.taskStatus(item.status)).fontSize(12).fontColor(this.colors.secondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
      }.width('100%').padding(15)
    }.width('100%').padding(0).borderRadius(15).backgroundColor(this.colors.panel)
      .onClick((): void => { this.go('tasks', item.id); })
  }

  @Builder
  noteCard(item: XopcNoteIndexEntry) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph($r('sys.symbol.doc_text')).fontSize(22).fontColor([this.colors.accent])
        Column({ space: 5 }) {
          Text(item.title || $r('app.string.untitled')).fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(this.colors.foreground).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(item.snippet ?? '').fontSize(12).fontColor(this.colors.secondary)
            .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
      }.width('100%').padding(15)
    }.width('100%').padding(0).borderRadius(15).backgroundColor(this.colors.panel)
      .onClick((): void => { this.go('notes', item.id); })
  }

  @Builder
  automationCard(item: XopcWorkspaceItem) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 12 }) {
        SymbolGlyph($r('sys.symbol.clock')).fontSize(22).fontColor([this.colors.accent])
        Column({ space: 5 }) {
          Text(item.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
          Text(item.enabled ? $r('app.string.enabled') : $r('app.string.paused'))
            .fontSize(12).fontColor(this.colors.secondary)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.tertiary])
      }.width('100%').padding(15)
    }.width('100%').padding(0).borderRadius(15).backgroundColor(this.colors.panel)
      .onClick((): void => { this.go('automations', item.id); })
  }

  @Builder
  sectionHeader(label: ResourceStr, count: number, target: string) {
    Row({ space: 8 }) {
      Text(label).fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).layoutWeight(1)
      Text(count.toString()).fontSize(12).fontColor(this.colors.secondary)
      Button() { SymbolGlyph($r('sys.symbol.plus')).fontSize(18).fontColor([this.colors.accent]) }
        .width(40).height(40).padding(0).backgroundColor(this.colors.accentSoft).borderRadius(20)
        .accessibilityText($r('app.string.project_add_item')).onClick((): void => { this.go(target); })
    }.width('100%')
  }

  build() {
    NavDestination() {
      Column() {
        Row({ space: 8 }) {
          Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground]) }
            .width(44).height(44).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.back')).onClick((): void => { this.onExit(); })
          Text(this.model.project?.name ?? $r('app.string.projects')).fontSize(21).fontWeight(FontWeight.Bold)
            .fontColor(this.colors.foreground).layoutWeight(1).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          Button() { SymbolGlyph($r('sys.symbol.ellipsis_circle')).fontSize(22).fontColor([this.colors.secondary]) }
            .width(44).height(44).padding(0).backgroundColor(Color.Transparent)
            .accessibilityText($r('app.string.project_manage')).onClick((): void => { this.go('project-settings', this.projectId); })
        }.width('100%').padding({ left: 8, right: 16, top: 10, bottom: 8 })
        Scroll() {
          Row({ space: 8 }) {
            this.tabChip('overview', $r('app.string.project_overview'), 0)
            this.tabChip('tasks', $r('app.string.tasks'), this.model.tasksTotal)
            this.tabChip('notes', $r('app.string.notes'), this.model.notesTotal)
            this.tabChip('automations', $r('app.string.automations'), this.model.automations.length)
          }.padding({ left: 20, right: 20 })
        }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%').height(50)
        if (this.model.error) {
          Row({ space: 8 }) {
            Text($r('app.string.project_load_error')).fontSize(13).fontColor(this.colors.danger).layoutWeight(1)
            Button($r('app.string.refresh')).height(40).fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
              .onClick((): void => { void this.model.load(this.projectId); })
          }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 8 })
        }
        List({ space: 12 }) {
          if (this.model.project) {
            ListItem() {
              Column({ space: 10 }) {
                Row({ space: 8 }) {
                  Text(this.projectStatus(this.model.project?.status ?? '')).fontSize(12).fontColor(this.colors.accent)
                    .padding({ left: 9, right: 9, top: 5, bottom: 5 }).backgroundColor(this.colors.accentSoft).borderRadius(10)
                  Blank().layoutWeight(1)
                  Button() { SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(17).fontColor([this.colors.secondary]) }
                    .width(40).height(40).padding(0).backgroundColor(this.colors.input).borderRadius(20)
                    .accessibilityText($r('app.string.refresh')).onClick((): void => { void this.model.load(this.projectId); })
                }.width('100%')
                Text(this.model.project?.brief || this.model.project?.description || $r('app.string.project_empty_description'))
                  .fontSize(14).lineHeight(21).fontColor(this.colors.secondary).width('100%')
              }.width('100%').padding(17).alignItems(HorizontalAlign.Start)
                .backgroundColor(this.colors.panel).borderRadius(18)
            }
          }
          if (this.model.loading && !this.model.project) {
            ListItem() { XopcListSkeleton() }
          }
          if (this.tab === 'overview' || this.tab === 'tasks') {
            ListItem() { this.sectionHeader($r('app.string.tasks'), this.model.tasksTotal, 'task-create') }
            if (this.model.tasksError) {
              ListItem() { Text($r('app.string.project_section_error')).fontSize(13).fontColor(this.colors.danger) }
            } else if (this.model.loading && !this.model.tasks.length) {
              ListItem() { XopcListSkeleton() }
            } else if (!this.model.tasks.length) {
              ListItem() { Text($r('app.string.project_no_tasks')).fontSize(14).fontColor(this.colors.secondary).padding(14) }
            }
            ForEach(this.tab === 'overview' ? this.model.tasks.slice(0, 3) : this.model.tasks, (item: XopcWorkspaceItem) => {
              ListItem() { this.taskCard(item) }
            }, (item: XopcWorkspaceItem): string => item.id)
            if (this.tab === 'tasks' && this.model.tasks.length < this.model.tasksTotal) {
              ListItem() {
                Button($r('app.string.project_load_more')).width('100%').height(44)
                  .fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
                  .enabled(!this.model.loadingTasksMore).onClick((): void => { void this.model.moreTasks(this.projectId); })
              }
            }
          }
          if (this.tab === 'overview' || this.tab === 'notes') {
            ListItem() { this.sectionHeader($r('app.string.notes'), this.model.notesTotal, 'note-create') }
            if (this.model.notesError) {
              ListItem() { Text($r('app.string.project_section_error')).fontSize(13).fontColor(this.colors.danger) }
            } else if (this.model.loading && !this.model.notes.length) {
              ListItem() { XopcListSkeleton() }
            } else if (!this.model.notes.length) {
              ListItem() { Text($r('app.string.project_no_notes')).fontSize(14).fontColor(this.colors.secondary).padding(14) }
            }
            ForEach(this.tab === 'overview' ? this.model.notes.slice(0, 3) : this.model.notes, (item: XopcNoteIndexEntry) => {
              ListItem() { this.noteCard(item) }
            }, (item: XopcNoteIndexEntry): string => item.id)
            if (this.tab === 'notes' && this.model.notes.length < this.model.notesTotal) {
              ListItem() {
                Button($r('app.string.project_load_more')).width('100%').height(44)
                  .fontColor(this.colors.accent).backgroundColor(this.colors.accentSoft)
                  .enabled(!this.model.loadingNotesMore).onClick((): void => { void this.model.moreNotes(this.projectId); })
              }
            }
          }
          if (this.tab === 'overview' || this.tab === 'automations') {
            ListItem() { this.sectionHeader($r('app.string.automations'), this.model.automations.length, 'automation-create') }
            if (this.model.automationsError) {
              ListItem() { Text($r('app.string.project_section_error')).fontSize(13).fontColor(this.colors.danger) }
            } else if (this.model.loading && !this.model.automations.length) {
              ListItem() { XopcListSkeleton() }
            } else if (!this.model.automations.length) {
              ListItem() { Text($r('app.string.project_no_automations')).fontSize(14).fontColor(this.colors.secondary).padding(14) }
            }
            ForEach(this.tab === 'overview' ? this.model.automations.slice(0, 3) : this.model.automations, (item: XopcWorkspaceItem) => {
              ListItem() { this.automationCard(item) }
            }, (item: XopcWorkspaceItem): string => item.id)
          }
        }.layoutWeight(1).width('100%').padding({ left: 20, right: 20, bottom: 24 }).scrollBar(BarState.Off)
      }.height('100%').width('100%').backgroundColor(this.colors.surface)
    }.hideTitleBar(true)
      .onShown((): void => {
        if (this.shownOnce) void this.model.load(this.projectId);
        else this.shownOnce = true;
      })
      .onBackPressed((): boolean => { this.onExit(); return true; })
  }
}
