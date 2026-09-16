import { XopcFilesViewModel } from '../viewmodel/filesViewModel';
import { XopcFile, XopcFileSpace } from '../model/files';

@ComponentV2
export struct XopcFilesView {
  @Local model: XopcFilesViewModel = new XopcFilesViewModel();
  @Local search: string = '';

  aboutToAppear(): void { this.model.load(); }
  aboutToDisappear(): void { this.model.dispose(); }

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

  build() {
    Column() {
      Row({ space: 8 }) {
        if (this.model.space || this.model.selected) {
          Button($r('app.string.back')).enabled(!this.model.busy).onClick((): void => { this.model.parent(); })
        }
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
              Column({ space: 6 }) {
                Text((file.kind === 'directory' ? '▸ ' : '') + file.name).fontSize(16).fontColor($r('app.color.foreground')).maxLines(2)
                Text(file.relativePath).fontSize(12).fontColor($r('app.color.secondary')).maxLines(2)
              }.padding(16).width('100%').alignItems(HorizontalAlign.Start).backgroundColor($r('app.color.panel')).borderRadius(12)
                .onClick((): void => { this.model.open(file); })
            }
          }, (file: XopcFile): string => file.id)
        }.layoutWeight(1).width('100%').padding(12)
        Text($r('app.string.transfer_limits')).fontSize(11).fontColor($r('app.color.secondary')).padding(8)
      }
    }.height('100%').width('100%').backgroundColor($r('app.color.surface'))
  }
}
