import { XopcChatTool } from '../model/chat';
import { common } from '@kit.AbilityKit';
import { chatToolKey, chatToolPreview, toolOutputText, chatSearchLinks, XopcSearchLink } from '../common/chatRichContent';

@ComponentV2
export struct XopcChatToolView {
  @Param call: XopcChatTool = { id: '', name: '' };
  @Param live: boolean = false;
  @Local expanded: boolean = false;
  @Local fullResult: boolean = false;
  @Computed get resultText(): string { return toolOutputText(this.call); }
  @Computed get links(): XopcSearchLink[] { return chatSearchLinks(this.call); }
  private async openLink(link: XopcSearchLink): Promise<void> {
    try {
      const choice = await this.getUIContext().getPromptAction().showDialog({ title: $r('app.string.chat_open_link'), message: link.url,
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') }, { text: $r('app.string.open'), color: $r('app.color.accent') }] });
      if (choice.index === 1) await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(link.url, { appLinkingOnly: false });
    } catch (_) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_link_failed') }); }
  }
  private title(): ResourceStr {
    const key = chatToolKey(this.call.name);
    if (key.includes('search')) return $r('app.string.chat_step_search');
    if (key === 'read_file') return $r('app.string.chat_step_read');
    if (key === 'exec_command') return $r('app.string.chat_step_command');
    if (key === 'write_file') return $r('app.string.chat_step_write');
    if (key === 'apply_patch' || key === 'edit_file') return $r('app.string.chat_step_edit');
    if (key === 'web_fetch' || key === 'open_url') return $r('app.string.chat_step_fetch');
    return this.call.name;
  }
  build() {
    Column({ space: 8 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 8 }) {
          Column({ space: 3 }) {
            Text(this.title()).fontSize(14).fontColor($r('app.color.foreground'))
            if (chatToolPreview(this.call)) { Text(chatToolPreview(this.call)).fontSize(12).fontColor($r('app.color.secondary')).maxLines(2) }
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
            Text(this.call.isError || this.call.status === 'error' ? $r('app.string.chat_tool_failed') : this.call.status === 'pending' ? $r('app.string.chat_tool_pending') : this.call.status === 'running' ? $r('app.string.chat_running') : $r('app.string.chat_tool_done'))
              .fontSize(12).fontColor(this.call.isError || this.call.status === 'error' ? $r('app.color.danger') : $r('app.color.secondary'))
          SymbolGlyph(this.expanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(12).fontColor([$r('app.color.secondary')])
        }.width('100%')
      }.id('chat-tool-' + this.call.id).width('100%').constraintSize({ minHeight: 44 }).padding(8).borderRadius(10).backgroundColor($r('app.color.grouped'))
        .onClick((): void => { this.expanded = !this.expanded; })
      if (this.expanded) {
        ForEach(this.links, (link: XopcSearchLink) => {
          Button(link.title).constraintSize({ minHeight: 44 }).width('100%').fontSize(13)
            .fontColor($r('app.color.accent')).backgroundColor($r('app.color.accent_soft'))
            .onClick((): void => { this.openLink(link); })
        }, (link: XopcSearchLink): string => link.url)
        if (this.call.input !== undefined) {
          Text($r('app.string.chat_tool_input')).fontSize(12).fontColor($r('app.color.secondary'))
          Scroll() {
            Text(typeof this.call.input === 'string' ? this.call.input : JSON.stringify(this.call.input, null, 2)).fontSize(13).fontFamily('monospace').fontColor($r('app.color.secondary'))
              .width('100%').copyOption(CopyOptions.InApp)
          }.width('100%').constraintSize({ maxHeight: 220 }).align(Alignment.TopStart)
        }
        if (this.call.result !== undefined || !this.live || this.call.status !== 'running') {
          Text($r('app.string.chat_tool_output')).fontSize(12).fontColor($r('app.color.secondary'))
          Scroll() {
            Text(this.resultText ? this.fullResult ? this.resultText : this.resultText.slice(0, 6000) : $r('app.string.chat_tool_no_output')).fontSize(13).fontFamily('monospace')
              .fontColor($r('app.color.foreground')).width('100%').copyOption(CopyOptions.InApp)
          }.width('100%').constraintSize({ maxHeight: 280 }).align(Alignment.TopStart)
          if (!this.fullResult && this.resultText.length > 6000) {
            Button($r('app.string.chat_tool_show_all')).height(44).backgroundColor(Color.Transparent).fontColor($r('app.color.accent'))
              .onClick((): void => { this.fullResult = true; })
          }
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
