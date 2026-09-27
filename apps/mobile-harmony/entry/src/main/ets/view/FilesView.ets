import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcFilesViewModel } from '../viewmodel/filesViewModel';
import { XopcFile, XopcFileSpace } from '../model/files';
import { XopcHubRow, XopcListSkeleton } from './MobileComponents';
import { createManagedShare } from '../service/chatMediaShare';
import { XopcShareResult } from '../model/share';
import { XopcShareResultView } from './ShareResultView';

@ComponentV2
export struct XopcFilesView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param initialId: string = '';
  @Param conversationId: string = '';
  @Event onExit: () => void = (): void => {};
  @Local model: XopcFilesViewModel = new XopcFilesViewModel();
  @Local search: string = '';
  @Local shareResult?: XopcShareResult;
  @Local shareOpen: boolean = false;

  aboutToAppear(): void { this.model.start(this.initialId, this.conversationId); }
  aboutToDisappear(): void { this.model.dispose(); }

  private async goBack(): Promise<void> {
    if (this.model.busy) return;
    try {
      if (this.model.selected && this.model.editable && this.model.content !== this.model.savedContent) {
        const result = await this.getUIContext().getPromptAction().showDialog({ message: $r('app.string.discard_changes'),
          buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary }, { text: $r('app.string.confirm'), color: this.colors.danger }] });
        if (result.index !== 1) return;
      }
      if (this.conversationId && !this.model.directory && !this.model.selected) this.onExit();
      else if (!this.initialId && (this.model.space || this.model.selected)) this.model.parent(); else this.onExit();
    } catch (error) { this.model.error = (error as Error).message; }
  }

  private async remove(): Promise<void> {
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.delete'), message: $r('app.string.confirm_action_help'),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.confirm'), color: this.colors.danger }]
      });
      if (result.index === 1) await this.model.remove();
    } catch (error) { this.model.error = (error as Error).message; }
  }

  private async share(): Promise<void> {
    const file = this.model.selected;
    if (!file || this.model.busy) return;
    this.model.busy = true; this.model.error = '';
    try {
      const payload = await createManagedShare({ fileId: file.id, audience: 'friend' });
      this.shareResult = payload.share; this.shareOpen = true;
    } catch (error) { this.model.error = (error as Error).message; }
    finally { this.model.busy = false; }
  }

  private async shareDirectory(file: XopcFile, zipOnly: boolean): Promise<void> {
    if (this.model.busy) return;
    this.model.busy = true; this.model.error = '';
    try {
      const payload = await createManagedShare({ fileId: file.id, audience: 'friend', mode: zipOnly ? 'force-zip' : 'auto' });
      this.shareResult = payload.share; this.shareOpen = true;
    } catch (error) { this.model.error = (error as Error).message; }
    finally { this.model.busy = false; }
  }

  private confirmDirectoryShare(file: XopcFile): void {
    this.getUIContext().showActionSheet({ title: $r('app.string.share_directory_title'), message: $r('app.string.share_directory_confirm'), sheets: [
      { title: this.text($r('app.string.share_directory_browse')), action: (): void => { this.shareDirectory(file, false); } },
      { title: this.text($r('app.string.share_directory_zip')), action: (): void => { this.shareDirectory(file, true); } }
    ] });
  }

  private text(resource: Resource): string {
    return this.getUIContext().getHostContext()?.resourceManager.getStringSync(resource.id) ?? '';
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes.toString() + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  private fileSummary(file: XopcFile): string {
    if (file.kind === 'directory') return file.relativePath;
    const metadata = this.formatSize(file.size) + ' · ' + new Date(file.modifiedAt).toLocaleDateString();
    return file.relativePath ? file.relativePath + ' · ' + metadata : metadata;
  }

  private canPreview(file: XopcFile): boolean {
    const text = file.mimeType.startsWith('text/') || ['application/json', 'application/xml'].includes(file.mimeType);
    return text && file.size <= 1024 * 1024 && file.capabilities.includes('preview');
  }

  @Builder
  shareSheet() {
    if (this.shareResult) { XopcShareResultView({ share: this.shareResult, onClose: (): void => { this.shareOpen = false; } }) }
  }

  @Builder
  header() {
    Row({ space: 8 }) {
      Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([this.colors.foreground]) }
        .width(44).height(44).padding(0).backgroundColor(Color.Transparent).accessibilityText($r('app.string.back'))
        .enabled(!this.model.busy).onClick((): void => { this.goBack(); })
      Text($r('app.string.files')).fontSize(24).fontWeight(FontWeight.Bold).layoutWeight(1).fontColor(this.colors.foreground)
      if (this.model.space?.writable && !this.model.selected) {
        Button() {
          Row({ space: 5 }) {
            SymbolGlyph($r('sys.symbol.plus')).fontSize(17).fontColor([this.colors.accent])
            Text($r('app.string.upload')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
          }
        }.height(40).padding({ left: 13, right: 13 }).borderRadius(12).backgroundColor(this.colors.accentSoft)
          .enabled(!this.model.busy).onClick((): void => {
            const context = this.getUIContext().getHostContext(); if (context) this.model.upload(context);
          })
      }
    }.width('100%').padding({ left: 12, right: 16, top: 10, bottom: 8 })
  }

  @Builder
  fileAction(label: ResourceStr, symbol: Resource, danger: boolean, handleTap: () => void) {
    Button() {
      Column({ space: 5 }) {
        SymbolGlyph(symbol).fontSize(20).fontColor([danger ? this.colors.danger : this.colors.secondary])
        Text(label).fontSize(12).fontColor(danger ? this.colors.danger : this.colors.foreground)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%').justifyContent(FlexAlign.Center)
    }.layoutWeight(1).height(64).padding(0).borderRadius(14).backgroundColor(this.colors.input)
      .enabled(!this.model.busy).onClick((): void => { handleTap(); })
  }

  @Builder
  fileDetail(file: XopcFile) {
    Column({ space: 0 }) {
      Column({ space: 7 }) {
        Text(file.name).fontSize(24).lineHeight(31).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
          .width('100%').maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(file.mimeType + ' · ' + this.formatSize(file.size)).fontColor(this.colors.secondary).fontSize(13).width('100%')
      }.width('100%').padding({ left: 20, right: 20, top: 8, bottom: 16 }).alignItems(HorizontalAlign.Start)

      if (this.model.busy) {
        Column() {
          Column() {}.height(96).width('100%').backgroundColor(this.colors.panel).borderRadius(14)
        }.width('100%').padding({ left: 20, right: 20, bottom: 12 })
      } else if (this.canPreview(file)) {
        Column() {
          TextArea({ text: this.model.content, placeholder: $r('app.string.file_preview_help') })
            .width('100%').height('100%').fontSize(15).lineHeight(22).fontColor(this.colors.foreground)
            .padding(16).backgroundColor(this.colors.panel).borderRadius(16)
            .enabled(this.model.editable && !this.model.busy)
            .onChange((content: string): void => { this.model.content = content; })
        }.layoutWeight(1).width('100%').padding({ left: 20, right: 20 })
      } else {
        Column({ space: 12 }) {
          Row() {
            SymbolGlyph($r('sys.symbol.doc')).fontSize(34).fontColor([this.colors.accent])
          }.width(60).height(60).justifyContent(FlexAlign.Center).borderRadius(18).backgroundColor(this.colors.accentSoft)
          Text($r('app.string.file_preview_help')).fontSize(14).lineHeight(21).textAlign(TextAlign.Center)
            .fontColor(this.colors.secondary).width('80%')
        }.layoutWeight(1).width('100%').justifyContent(FlexAlign.Center)
      }

      if (this.model.editable && this.model.content !== this.model.savedContent) {
        Row() {
          Button($r('app.string.save')).width('100%').height(46).fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(Color.White).backgroundColor(this.colors.accent).borderRadius(14)
            .enabled(!this.model.busy).onClick((): void => { this.model.save(); })
        }.width('100%').padding({ left: 20, right: 20, top: 12 })
      }
      Row({ space: 8 }) {
        if (file.capabilities.includes('download')) {
          this.fileAction($r('app.string.download'), $r('sys.symbol.square_and_arrow_down'), false, (): void => {
            const context = this.getUIContext().getHostContext(); if (context) this.model.download(context);
          })
        }
        this.fileAction($r('app.string.chat_share'), $r('sys.symbol.share'), false, (): void => { void this.share(); })
        if (file.capabilities.includes('delete')) {
          this.fileAction($r('app.string.delete'), $r('sys.symbol.trash'), true, (): void => { void this.remove(); })
        }
      }.width('100%').padding({ left: 20, right: 20, top: 12, bottom: 16 })
    }.layoutWeight(1).width('100%')
  }

  @Builder
  fileList() {
    Column({ space: 0 }) {
      Row({ space: 8 }) {
        TextInput({ text: this.search, placeholder: $r('app.string.search') }).layoutWeight(1).height(44)
          .backgroundColor(this.colors.input).borderRadius(14)
          .onChange((query: string): void => { this.search = query; }).onSubmit((): void => { this.model.load(this.search); })
        Button() { SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(20).fontColor([this.colors.secondary]) }
          .width(44).height(44).padding(0).backgroundColor(this.colors.input).borderRadius(14).enabled(!this.model.busy)
          .accessibilityText($r('app.string.refresh')).onClick((): void => { this.model.load(this.search); })
      }.width('100%').padding({ left: 20, right: 20, top: 6, bottom: 16 })

      Row({ space: 6 }) {
        if (this.model.space) {
          SymbolGlyph($r('sys.symbol.folder')).fontSize(15).fontColor([this.colors.secondary])
        }
        Text(this.model.space ? this.model.space.title + (this.model.directory ? ' / ' + this.model.directory : '') : $r('app.string.recent_files'))
          .fontColor(this.colors.secondary).fontSize(13).fontWeight(FontWeight.Medium)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%').padding({ left: 20, right: 20, bottom: 10 })

      List({ space: 0 }) {
        if (this.model.busy && !this.model.items.length) {
          ListItem() { XopcListSkeleton() }
        }
        if (!this.model.space && !this.search.trim()) {
          ForEach(this.model.spaces, (space: XopcFileSpace) => {
            ListItem() {
              XopcHubRow({ heading: space.title, symbol: $r('sys.symbol.folder'),
                compact: true,
                onOpen: (): void => { this.model.choose(space); } })
            }
          }, (space: XopcFileSpace): string => space.id)
        }
        ForEach(this.model.items, (file: XopcFile) => {
          ListItem() {
            XopcHubRow({ heading: file.name, summary: this.fileSummary(file),
              compact: true,
              symbol: file.kind === 'directory' ? $r('sys.symbol.folder') : $r('sys.symbol.doc'),
              onOpen: (): void => { this.model.open(file); } })
          }.gesture(LongPressGesture({ duration: 350, repeat: false }).onAction((): void => {
            if (file.kind === 'directory' && file.capabilities.includes('share')) this.confirmDirectoryShare(file);
          }))
        }, (file: XopcFile): string => file.id)
      }.layoutWeight(1).width('100%').padding({ left: 20, right: 20 }).scrollBar(BarState.Off)

      Row({ space: 6 }) {
        SymbolGlyph($r('sys.symbol.info_circle')).fontSize(13).fontColor([this.colors.tertiary])
        Text($r('app.string.transfer_limits')).fontSize(11).fontColor(this.colors.tertiary)
      }.height(36).width('100%').justifyContent(FlexAlign.Center)
        .backgroundColor(this.colors.grouped)
    }.layoutWeight(1).width('100%')
  }

  build() {
    NavDestination() {
      Column() {
        this.header()
        if (this.model.error) {
          Text(this.model.error).fontSize(13).fontColor(this.colors.danger).width('100%')
            .padding({ left: 20, right: 20, bottom: 8 })
        }
        if (this.model.selected) {
          this.fileDetail(this.model.selected)
        } else {
          this.fileList()
        }
      }.height('100%').width('100%').backgroundColor(this.colors.surface)
        .bindSheet($$this.shareOpen, this.shareSheet, { height: '92%', dragBar: false })
    }.hideTitleBar(true).onBackPressed((): boolean => {
      this.goBack(); return true;
    })
  }
}
