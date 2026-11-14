import { appThemeColors, XopcThemeColors } from '../common/themePalette';

export const CHAT_ACTION_PANEL_OPEN_MS: number = 220;
export const CHAT_ACTION_PANEL_CLOSE_MS: number = 180;

@ComponentV2
export struct XopcChatActionPanel {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param open: boolean = false;
  @Param disabledIds: string[] = [];
  @Event onSelect: (id: string) => void = (_id: string): void => {};

  @Builder
  private attachmentTile(id: string, label: Resource, symbol: Resource) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 5 }) {
        SymbolGlyph(symbol).fontSize(21).fontColor([this.colors.chat.action])
        Text(label).fontSize(13).fontColor(this.colors.foreground).maxLines(2).textAlign(TextAlign.Center)
      }.width('100%')
    }.id('chat-action-' + id).layoutWeight(1).height(64).padding(6).borderRadius(14).backgroundColor(this.colors.input)
      .accessibilityText(label).enabled(!this.disabledIds.includes(id))
      .onClick((): void => { this.onSelect(id); })
  }

  @Builder
  private actionRow(id: string, label: Resource, symbol: Resource) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 10 }) {
        SymbolGlyph(symbol).fontSize(20).fontColor([this.colors.secondary]).width(24)
        Text(label).fontSize(15).fontColor(this.colors.foreground).layoutWeight(1).textAlign(TextAlign.Start)
        SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(14).fontColor([this.colors.secondary])
      }.width('100%').constraintSize({ minHeight: 44 })
    }.id('chat-action-' + id).width('100%').padding({ left: 6, right: 6 }).backgroundColor(Color.Transparent)
      .accessibilityText(label).enabled(!this.disabledIds.includes(id))
      .onClick((): void => { this.onSelect(id); })
  }

  build() {
    Column() {
      if (this.open) {
        Scroll() {
          Column({ space: 4 }) {
            Text($r('app.string.chat_add_content')).fontSize(13).fontColor(this.colors.secondary)
              .width('100%').padding({ bottom: 4 })
            Row({ space: 8 }) {
              this.attachmentTile('camera', $r('app.string.chat_camera'), $r('sys.symbol.camera'))
              this.attachmentTile('photos', $r('app.string.chat_photos'), $r('sys.symbol.picture'))
              this.attachmentTile('document', $r('app.string.chat_local_files'), $r('sys.symbol.folder'))
            }.width('100%')
            Text($r('app.string.chat_add_references')).fontSize(13).fontColor(this.colors.secondary)
              .width('100%').padding({ top: 10, bottom: 2 })
            this.actionRow('reference-file', $r('app.string.chat_reference_file'), $r('sys.symbol.folder'))
            this.actionRow('reference-note', $r('app.string.chat_reference_note'), $r('sys.symbol.doc'))
            this.actionRow('reference-task', $r('app.string.chat_reference_task'), $r('sys.symbol.checkmark_circle'))
            this.actionRow('record-voice', $r('app.string.record_voice'), $r('sys.symbol.mic'))
          }.width('100%').padding({ left: 14, right: 14, top: 6, bottom: 8 }).alignItems(HorizontalAlign.Start)
        }.id('chat-action-panel').width('100%').height('100%').scrollBar(BarState.Auto)
      }
    }.width('100%').height(this.open ? 314 : 0).clip(true)
  }
}
