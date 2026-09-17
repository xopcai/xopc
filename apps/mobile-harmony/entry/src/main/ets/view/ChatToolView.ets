import { XopcChatTool } from '../model/chat';

@ComponentV2
export struct XopcChatToolView {
  @Param call: XopcChatTool = { id: '', name: '' };
  @Local expanded: boolean = false;
  @Local fullResult: boolean = false;
  build() {
    Column({ space: 8 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 8 }) {
          Text(this.call.name).fontSize(14).fontColor($r('app.color.foreground')).layoutWeight(1)
          if (this.call.result !== undefined) {
            Text(this.call.isError ? $r('app.string.chat_tool_failed') : $r('app.string.chat_tool_done'))
              .fontSize(12).fontColor(this.call.isError ? $r('app.color.danger') : $r('app.color.secondary'))
          }
          Text(this.expanded ? '−' : '+').fontSize(18).fontColor($r('app.color.secondary'))
        }.width('100%')
      }.width('100%').constraintSize({ minHeight: 44 }).padding(8).backgroundColor($r('app.color.grouped'))
        .onClick((): void => { this.expanded = !this.expanded; })
      if (this.expanded) {
        if (this.call.input !== undefined) {
          Text(JSON.stringify(this.call.input, null, 2)).fontSize(13).fontFamily('monospace').fontColor($r('app.color.secondary'))
            .width('100%').copyOption(CopyOptions.InApp)
        }
        if (this.call.result !== undefined) {
          Text(this.fullResult ? this.call.result : this.call.result.slice(0, 6000)).fontSize(13).fontFamily('monospace')
            .fontColor($r('app.color.foreground')).width('100%').copyOption(CopyOptions.InApp)
          if (!this.fullResult && this.call.result.length > 6000) {
            Button($r('app.string.chat_tool_show_all')).height(44).backgroundColor(Color.Transparent).fontColor($r('app.color.accent'))
              .onClick((): void => { this.fullResult = true; })
          }
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
