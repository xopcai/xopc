import { XopcChatContextViewModel } from '../viewmodel/chatContextViewModel';
import { XopcContextRef, XopcContextSource, XopcHostDirectory, XopcReferenceItem } from '../model/chat';
import { XopcProject } from '../model/workspace';
import { XopcHubRow, XopcListSkeleton } from './MobileComponents';

@ComponentV2
export struct XopcChatContext {
  @Param model: XopcChatContextViewModel = new XopcChatContextViewModel();
  @Param initialMode: string = 'context';
  @Param initialReferenceKind: string = 'note';
  @Param refs: XopcContextRef[] = [];
  @Event onScope: (project: string | null, mode?: string) => void = (_project: string | null, _mode?: string): void => {};
  @Event onReference: (item: XopcReferenceItem) => void = (_item: XopcReferenceItem): void => {};
  @Event onClose: () => void = (): void => {};
  @Event onRetry: () => void = (): void => {};
  @Local mode: string = 'context';
  @Local kind: string = 'note';
  @Local search: string = '';
  @Local path: string = '';
  private searchTimer: number = -1;
  aboutToAppear(): void { this.kind = this.initialReferenceKind; this.choose(this.initialMode); }
  aboutToDisappear(): void { clearTimeout(this.searchTimer); }
  private choose(mode: string): void {
    this.mode = mode;
    if (mode === 'project' || mode === 'environment') this.model.choices(mode);
    else if (mode === 'directory') this.model.browse(this.model.config?.effectiveWorkspacePath || '');
    else if (mode === 'references') this.model.searchReferences(this.kind, this.search, this.path);
  }
  private selectKind(kind: string): void {
    clearTimeout(this.searchTimer); this.kind = kind; this.search = ''; this.path = '';
    this.model.searchReferences(kind, '', '');
  }
  private selectScope(projectId: string | null, mode?: string): void {
    if ((this.model.summary?.work.project?.id || null) === projectId
      && (mode === undefined || this.model.summary?.environment?.kind === mode)) { this.onClose(); return; }
    this.onScope(projectId, mode);
  }

  build() {
    Column({ space: 12 }) {
      Row() {
        Text($r('app.string.chat_context')).fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground')).layoutWeight(1)
        Button('×').width(44).height(44).padding(0).fontSize(28).backgroundColor(Color.Transparent)
          .fontColor($r('app.color.secondary')).accessibilityText($r('app.string.chat_close')).onClick((): void => { this.onClose(); })
      }.width('100%')
      if (this.mode === 'references') {
        Row({ space: 8 }) {
          Button($r('app.string.notes')).layoutWeight(1).onClick((): void => { this.selectKind('note'); })
          Button($r('app.string.tasks')).layoutWeight(1).onClick((): void => { this.selectKind('task'); })
          Button($r('app.string.files')).layoutWeight(1).onClick((): void => { this.selectKind('file'); })
        }
        TextInput({ text: this.search, placeholder: $r('app.string.search') }).onChange((value: string): void => {
          this.search = value; clearTimeout(this.searchTimer);
          this.searchTimer = setTimeout((): void => { this.model.searchReferences(this.kind, value, this.path); }, 250);
        })
        if (this.kind === 'file' && this.path) {
          Button('‹ ' + this.path).onClick((): void => {
            const parts = this.path.split('/'); parts.pop(); this.path = parts.join('/');
            this.search = ''; this.model.searchReferences(this.kind, '', this.path);
          })
        }
        if (this.refs.length >= 5 && this.kind !== 'file') { Text($r('app.string.chat_ref_limit')).fontColor($r('app.color.secondary')) }
      }
      if (this.model.error) {
        Text(this.model.error).fontColor($r('app.color.danger'))
        Button($r('app.string.refresh')).onClick((): void => { if (this.mode === 'context') this.onRetry(); else this.choose(this.mode); })
      }
      if (this.model.loading) { XopcListSkeleton() }
      List({ space: 8 }) {
        if (this.mode === 'project') {
          ListItem() { XopcHubRow({ heading: $r('app.string.chat_no_project'), onOpen: (): void => { this.selectScope(null); } }) }
          ForEach(this.model.projects, (project: XopcProject) => {
            ListItem() { XopcHubRow({ heading: (this.model.summary?.work.project?.id === project.id ? '✓ ' : '') + project.name,
              summary: project.description || '', onOpen: (): void => { this.selectScope(project.id); } }) }
          }, (project: XopcProject): string => project.id)
        } else if (this.mode === 'environment') {
          ListItem() {
            Button('Local').width('100%').height(48).enabled(!this.model.loading && !!this.model.environment?.localAvailable)
              .onClick((): void => { if (this.model.summary?.work.project) this.selectScope(this.model.summary.work.project.id, 'local_checkout'); })
          }
          ListItem() {
            Button('Worktree').width('100%').height(48).enabled(!this.model.loading && !!this.model.environment && !this.model.environment.worktreeUnavailableReason)
              .onClick((): void => { if (this.model.summary?.work.project) this.selectScope(this.model.summary.work.project.id, 'managed_worktree'); })
          }
          if (this.model.environment?.worktreeUnavailableReason) { ListItem() { Text(this.model.environment.worktreeUnavailableReason).fontColor($r('app.color.secondary')) } }
        } else if (this.mode === 'directory') {
          if (this.model.config?.workingDirectoryLocked) { ListItem() { Text($r('app.string.chat_directory_locked')).fontColor($r('app.color.secondary')) } }
          else if (this.model.directories) {
            ListItem() { Text(this.model.directories.currentPath).fontColor($r('app.color.secondary')) }
            if (this.model.directories.parentPath !== null && this.model.directories.parentPath !== undefined) {
              ListItem() { Button('↑').onClick((): void => { this.model.browse(this.model.directories?.parentPath || ''); }) }
            }
            ForEach(this.model.directories.entries.filter((item: XopcHostDirectory): boolean => item.isDirectory), (item: XopcHostDirectory) => {
              ListItem() { XopcHubRow({ heading: item.name, symbol: $r('sys.symbol.folder'), onOpen: (): void => { this.model.browse(item.absolutePath); } }) }
            }, (item: XopcHostDirectory): string => item.absolutePath)
          }
        } else if (this.mode === 'references') {
          ForEach(this.model.references, (item: XopcReferenceItem) => {
            ListItem() {
              XopcHubRow({ heading: item.title || $r('app.string.untitled'), summary: item.description,
                symbol: item.kind === 'task' ? $r('sys.symbol.checkmark_circle') : item.directory ? $r('sys.symbol.folder') : $r('sys.symbol.doc'),
                onOpen: (): void => {
                  if (item.directory) { this.path = item.relativePath || ''; this.search = ''; this.model.searchReferences('file', '', this.path); }
                  else this.onReference(item);
                } })
            }.enabled(!this.model.loading && !this.refs.some((ref: XopcContextRef): boolean => ref.kind === item.kind && ref.sourceId === item.id)
              && (item.kind === 'file' || this.refs.length < 5))
          }, (item: XopcReferenceItem): string => item.kind + ':' + item.id)
        } else if (this.model.summary) {
          ListItem() { Text($r('app.string.chat_context_hint')).fontSize(13).fontColor($r('app.color.secondary')).padding(8) }
          ListItem() { XopcHubRow({ heading: this.model.summary.work.project?.title || $r('app.string.chat_no_project'),
            summary: this.model.summary.work.task?.title || '', symbol: $r('sys.symbol.folder'), onOpen: (): void => { this.choose('project'); } }) }
          if (this.model.summary.environment) {
            ListItem() { XopcHubRow({ heading: this.model.summary.environment.kind === 'managed_worktree' ? 'Worktree' : 'Local',
              summary: this.model.summary.environment.rootPath + (this.model.summary.environment.branch ? '\n' + this.model.summary.environment.branch : ''),
              onOpen: (): void => { this.choose(this.model.summary?.work.project ? 'environment' : 'directory'); } }) }
          }
          if (!this.model.summary.work.project && !this.model.summary.work.task && this.model.config && !this.model.config.workingDirectoryLocked) {
            ListItem() { Button($r('app.string.chat_change_directory')).onClick((): void => { this.choose('directory'); }) }
          }
          ForEach(this.model.summary.sources, (source: XopcContextSource) => {
            ListItem() { XopcHubRow({ heading: source.title || $r('app.string.untitled'), summary: source.unavailable ? $r('app.string.chat_source_unavailable') : '', navigable: false }) }
          }, (source: XopcContextSource): string => source.id)
          if (this.model.summary.sourcesHasMore) { ListItem() { Text($r('app.string.chat_more_sources')).fontColor($r('app.color.tertiary')) } }
          ListItem() { Button($r('app.string.chat_add_reference')).onClick((): void => { this.choose('references'); }) }
        }
      }.layoutWeight(1).width('100%')
      if (this.mode === 'directory' && this.model.directories?.currentPath && !this.model.config?.workingDirectoryLocked) {
        Button($r('app.string.chat_use_directory')).width('100%').height(44).enabled(!this.model.loading)
          .onClick(async (): Promise<void> => { if (await this.model.setDirectory()) this.mode = 'context'; })
      }
    }.padding({ left: 24, right: 24, top: 8, bottom: 24 }).height('100%').width('100%').backgroundColor($r('app.color.panel'))
  }
}
