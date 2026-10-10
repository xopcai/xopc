import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcFilesViewModel } from '../viewmodel/filesViewModel';
import { XopcFile, XopcFileSpace } from '../model/files';
import { XopcBrandLoading, XopcHubRow, XopcListSkeleton } from './MobileComponents';
import { createManagedShare } from '../service/chatMediaShare';
import { XopcShareResult } from '../model/share';
import { XopcShareResultView } from './ShareResultView';
import { XopcChatMediaView } from './ChatMediaView';
import { managedFileMedia } from '../viewmodel/fileDocumentViewModel';
import { userErrorMessage } from '../common/userError';

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
      if (this.conversationId && !this.model.directory && !this.model.selected) this.onExit();
      else if (!this.initialId && (this.model.space || this.model.selected)) this.model.parent(); else this.onExit();
    } catch (error) { this.model.error = (error as Error).message; }
  }

  private async remove(file: XopcFile): Promise<void> {
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.delete'), message: $r('app.string.confirm_action_help'),
        buttons: [{ text: $r('app.string.cancel'), color: this.colors.secondary },
          { text: $r('app.string.confirm'), color: this.colors.danger }]
      });
      if (result.index === 1) await this.model.remove(file);
    } catch (error) { this.model.error = (error as Error).message; }
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

  @Builder
  shareSheet() {
    if (this.shareResult) { XopcShareResultView({ share: this.shareResult, onClose: (): void => { this.shareOpen = false; } }) }
  }

  @Builder
  header() {
    Row({ space: 8 }) {
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
  fileDetail(file: XopcFile) {
    XopcChatMediaView({ file: managedFileMedia(file), conversationId: this.conversationId, previewOnly: true,
      onPreviewClosed: (): void => {
        this.model.selected = undefined;
        if (this.initialId) this.onExit(); else this.model.load(this.search);
      } })
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
            else if (file.capabilities.includes('delete')) {
              this.getUIContext().showActionSheet({ title: file.name, message: '', sheets: [
                { title: this.text($r('app.string.delete')), action: (): void => { this.remove(file); } }
              ] });
            }
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
          Text(userErrorMessage(this.model.error, this.model.items.length ? 'generic' : 'collection')).fontSize(13)
            .fontColor(this.colors.secondary).width('100%')
            .padding({ left: 20, right: 20, bottom: 8 })
        }
        if (this.model.busy && !!this.initialId && !this.model.selected) { XopcBrandLoading() }
        else { this.fileList() }
        if (this.model.selected) { this.fileDetail(this.model.selected) }
      }.height('100%').width('100%').backgroundColor(this.colors.surface)
        .bindSheet($$this.shareOpen, this.shareSheet, { height: '92%', dragBar: false })
    }.hideTitleBar(true).onBackPressed((): boolean => {
      this.goBack(); return true;
    })
  }
}
