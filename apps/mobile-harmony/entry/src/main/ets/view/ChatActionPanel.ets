import { appThemeColors, XopcThemeColors } from '../common/themePalette';

export const CHAT_ACTION_PANEL_OPEN_MS: number = 220;
export const CHAT_ACTION_PANEL_CLOSE_MS: number = 180;

@ComponentV2
export struct XopcChatActionPanel {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param open: boolean = false;
  @Param idPrefix: string = 'chat-action';
  @Param disabledIds: string[] = [];
  @Event onSelect: (id: string) => void = (_id: string): void => {};

  @Builder
  private actionTile(id: string, label: Resource, symbol: Resource) {
    Button({ type: ButtonType.Normal }) {
      Column({ space: 6 }) {
        Row() {
          SymbolGlyph(symbol).fontSize(24).fontColor([this.colors.foreground])
        }.width(48).height(48).justifyContent(FlexAlign.Center).alignItems(VerticalAlign.Center)
          .borderRadius(14).backgroundColor(this.colors.input)
        Text(label).fontSize(12).fontColor(this.colors.secondary).maxLines(2).textAlign(TextAlign.Center)
      }.width('100%')
    }.id(this.idPrefix + '-' + id).width('25%').height(84).padding(2).backgroundColor(Color.Transparent)
      .accessibilityText(label).enabled(!this.disabledIds.includes(id))
      .onClick((): void => { this.onSelect(id); })
  }

  build() {
    Column() {
      Swiper() {
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
            this.actionTile('new-chat', $r('app.string.new_chat'), $r('sys.symbol.square_and_pencil'))
          }.width('100%')
        }.width('100%').padding({ left: 6, right: 6, top: 4, bottom: 20 })
        Column({ space: 4 }) {
          Row() {
            this.actionTile('voice-no-tools', $r('app.string.voice_call_action_natural'), $r('sys.symbol.waveform'))
            this.actionTile('voice-with-tools', $r('app.string.voice_call_action_assistant'), $r('sys.symbol.speaker_wave_2'))
          }.width('100%')
        }.width('100%').padding({ left: 6, right: 6, top: 4, bottom: 20 })
      }.id(this.idPrefix + '-panel').width('100%').height(196).loop(false).autoPlay(false)
        .indicator(new DotIndicator().itemWidth(6).itemHeight(6).selectedItemWidth(6).selectedItemHeight(6)
          .color(this.colors.border).selectedColor(this.colors.secondary))
        .backgroundColor(this.colors.panel).borderRadius(18).clip(true).margin({ bottom: 8 })
    }.width('100%').height(this.open ? 204 : 0).clip(true)
      .opacity(this.open ? 1 : 0)
      .translate({ x: 0, y: this.open ? 0 : 12 })
      .enabled(this.open)
  }
}
