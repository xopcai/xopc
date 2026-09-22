import { XopcFilesViewModel } from '../viewmodel/filesViewModel';
import { XopcFile, XopcFileSpace } from '../model/files';
import { XopcHubRow } from './MobileComponents';
import { createManagedShare } from '../service/chatMediaShare';
import { XopcShareResult } from '../model/share';
import { XopcShareResultView } from './ShareResultView';

@ComponentV2
export struct XopcFilesView {
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
          buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') }, { text: $r('app.string.confirm'), color: $r('app.color.danger') }] });
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
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') },
          { text: $r('app.string.confirm'), color: $r('app.color.danger') }]
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
  private text(resource: Resource): string { return this.getUIContext().getHostContext()?.resourceManager.getStringSync(resource.id) ?? ''; }
  @Builder
  shareSheet() {
    if (this.shareResult) { XopcShareResultView({ share: this.shareResult, onClose: (): void => { this.shareOpen = false; } }) }
  }

  build() {
    NavDestination() {
    Column() {
      Row({ space: 8 }) {
        Button() { SymbolGlyph($r('sys.symbol.chevron_left')).fontSize(22).fontColor([$r('app.color.foreground')]) }
          .width(44).height(44).backgroundColor(Color.Transparent).accessibilityText($r('app.string.back'))
          .enabled(!this.model.busy).onClick((): void => { this.goBack(); })
        Text($r('app.string.files')).fontSize(24).fontWeight(FontWeight.Bold).layoutWeight(1).fontColor($r('app.color.foreground'))
        if (this.model.space?.writable && !this.model.selected) {
          Button($r('app.string.upload')).enabled(!this.model.busy).onClick((): void => {
            const context = this.getUIContext().getHostContext(); if (context) this.model.upload(context);
          })
        }
      }.width('100%').padding(16)
      if (this.model.error) { Text(this.model.error).fontColor($r('app.color.danger')).padding(12) }
      if (this.model.busy) { Column() {}.height(48).width('90%').backgroundColor($r('app.color.panel')).borderRadius(12).margin(12) }
      if (this.model.selected) {
        Text(this.model.selected.name).fontSize(20).fontColor($r('app.color.foreground')).padding(12)
        Text(this.model.selected.mimeType + ' · ' + this.model.selected.size + ' B').fontColor($r('app.color.secondary')).fontSize(12)
        TextArea({ text: this.model.content, placeholder: $r('app.string.file_preview_help') })
          .layoutWeight(1).width('92%').margin(12).enabled(this.model.editable && !this.model.busy)
          .onChange((value: string): void => { this.model.content = value; })
        Row({ space: 12 }) {
          if (this.model.editable) {
            Button($r('app.string.save')).enabled(!this.model.busy).onClick((): void => { this.model.save(); })
          }
          if (this.model.selected.capabilities.includes('download')) {
            Button($r('app.string.download')).enabled(!this.model.busy).onClick((): void => {
              const context = this.getUIContext().getHostContext(); if (context) this.model.download(context);
            })
          }
          Button($r('app.string.chat_share')).enabled(!this.model.busy).onClick((): void => { this.share(); })
          if (this.model.selected.capabilities.includes('delete')) {
            Button($r('app.string.delete')).enabled(!this.model.busy).onClick((): void => { this.remove(); })
          }
        }.padding(12)
      } else {
        Row({ space: 8 }) {
          TextInput({ text: this.search, placeholder: $r('app.string.search') }).layoutWeight(1)
            .onChange((value: string): void => { this.search = value; }).onSubmit((): void => { this.model.load(this.search); })
          Button($r('app.string.refresh')).enabled(!this.model.busy).onClick((): void => { this.model.load(this.search); })
        }.padding(12)
        Text(this.model.space ? this.model.space.title + ' / ' + this.model.directory : $r('app.string.recent_files'))
          .fontColor($r('app.color.secondary')).fontSize(13).padding(8)
        List({ space: 8 }) {
          if (!this.model.space && !this.search.trim()) {
            ForEach(this.model.spaces, (space: XopcFileSpace) => {
              ListItem() { Button(space.title).onClick((): void => { this.model.choose(space); }) }
            }, (space: XopcFileSpace): string => space.id)
          }
          ForEach(this.model.items, (file: XopcFile) => {
            ListItem() {
              XopcHubRow({ heading: file.name, summary: file.relativePath,
                symbol: file.kind === 'directory' ? $r('sys.symbol.folder') : $r('sys.symbol.doc'),
                onOpen: (): void => { this.model.open(file); } })
            }.gesture(LongPressGesture({ duration: 350, repeat: false }).onAction((): void => {
              if (file.kind === 'directory' && file.capabilities.includes('share')) this.confirmDirectoryShare(file);
            }))
          }, (file: XopcFile): string => file.id)
        }.layoutWeight(1).width('100%').padding(12)
        Text($r('app.string.transfer_limits')).fontSize(11).fontColor($r('app.color.secondary')).padding(8)
      }
    }.height('100%').width('100%').backgroundColor($r('app.color.surface'))
      .bindSheet($$this.shareOpen, this.shareSheet, { height: '92%', dragBar: false })
    }.hideTitleBar(true).onBackPressed((): boolean => {
      this.goBack(); return true;
    })
  }
}
