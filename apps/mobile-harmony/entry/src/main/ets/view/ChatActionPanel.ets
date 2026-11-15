import { appThemeColors, XopcThemeColors } from '../common/themePalette';

export const CHAT_ACTION_PANEL_OPEN_MS: number = 220;
export const CHAT_ACTION_PANEL_CLOSE_MS: number = 180;
const CHAT_ACTION_GRID_HEIGHT: number = 184;

@ComponentV2
export struct XopcChatActionPanel {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param open: boolean = false;
  @Param disabledIds: string[] = [];
  @Event onSelect: (id: string) => void = (_id: string): void => {};

  @Builder
  private actionTile(id: string, label: Resource, symbol: Resource) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 6 }) {
        Row() {
          SymbolGlyph(symbol).fontSize(24).fontColor([this.colors.foreground])
        }.width(48).height(48).justifyContent(FlexAlign.Center).borderRadius(this.colors.corner(14)).backgroundColor(this.colors.input)
        Text(label).fontSize(12).fontColor(this.colors.secondary).maxLines(2)
          .textAlign(TextAlign.Center).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%')
    }.id('chat-action-' + id).width('25%').height(84).padding(2).backgroundColor(Color.Transparent)
      .accessibilityText(label).enabled(!this.disabledIds.includes(id))
      .onClick((): void => { this.onSelect(id); })
  }

  build() {
    Column() {
      Column({ space: 4 }) {
        Row() {
          this.actionTile('photos', $r('app.string.chat_photos'), $r('sys.symbol.picture'))
          this.actionTile('camera', $r('app.string.chat_camera'), $r('sys.symbol.camera'))
          this.actionTile('document', $r('app.string.chat_local_files'), $r('sys.symbol.folder'))
          this.actionTile('record-voice', $r('app.string.record_voice'), $r('sys.symbol.mic'))
        }.width('100%')
        Row() {
          this.actionTile('reference-note', $r('app.string.chat_reference_note'), $r('sys.symbol.doc'))
          this.actionTile('reference-task', $r('app.string.chat_reference_task'), $r('sys.symbol.checkmark_circle'))
          this.actionTile('reference-file', $r('app.string.chat_reference_file'), $r('sys.symbol.folder'))
        }.width('100%')
      }.width('100%').height(CHAT_ACTION_GRID_HEIGHT).padding({ left: 6, right: 6, top: 2, bottom: 10 })
    }.id('chat-action-panel').width('100%').height(this.open ? CHAT_ACTION_GRID_HEIGHT : 0).clip(true)
      .opacity(this.open ? 1 : 0).enabled(this.open)
      .accessibilityLevel(this.open ? 'auto' : 'no-hide-descendants')
  }
}
