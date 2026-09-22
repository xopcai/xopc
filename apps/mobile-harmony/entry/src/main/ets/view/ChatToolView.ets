import { XopcChatTool } from '../model/chat';
import { common } from '@kit.AbilityKit';
import { XopcChatDisclosure } from '../common/chatDisclosure';
import { chatToolDisplayKind, chatToolFailureSummary, chatToolPreview, chatToolFailed, toolOutputText, chatSearchLinks, XopcSearchLink } from '../common/chatRichContent';

@ComponentV2
export struct XopcChatToolView {
  @Param call: XopcChatTool = { id: '', name: '' };
  @Param live: boolean = false;
  @Param disclosure: XopcChatDisclosure = new XopcChatDisclosure();
  @Param scope: string = '';
  @Computed get expanded(): boolean { return this.disclosure.get(this.scope + ':tool:' + this.call.id) ?? false; }
  @Computed get fullResult(): boolean { return this.disclosure.get(this.scope + ':full:' + this.call.id) ?? false; }
  @Computed get resultText(): string { return toolOutputText(this.call); }
  @Computed get links(): XopcSearchLink[] { return chatSearchLinks(this.call); }
  @Computed get failed(): boolean { return chatToolFailed(this.call); }
  @Computed get failureSummary(): string { return chatToolFailureSummary(this.call); }
  private async openLink(link: XopcSearchLink): Promise<void> {
    try {
      const choice = await this.getUIContext().getPromptAction().showDialog({ title: $r('app.string.chat_open_link'), message: link.url,
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') }, { text: $r('app.string.open'), color: $r('app.color.accent') }] });
      if (choice.index === 1) await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(link.url, { appLinkingOnly: false });
    } catch (_) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_link_failed') }); }
  }
  private title(): ResourceStr {
    const kind = chatToolDisplayKind(this.call.name);
    if (kind === 'search') return $r('app.string.chat_step_search');
    if (kind === 'read') return $r('app.string.chat_step_read');
    if (kind === 'command') return $r('app.string.chat_step_command');
    if (kind === 'write') return $r('app.string.chat_step_write');
    if (kind === 'edit') return $r('app.string.chat_step_edit');
    if (kind === 'fetch') return $r('app.string.chat_step_fetch');
    if (kind === 'share') return $r('app.string.chat_step_share');
    if (kind === 'speech') return $r('app.string.chat_step_speech');
    if (kind === 'publish') return $r('app.string.chat_step_publish');
    if (kind === 'plan') return $r('app.string.chat_step_plan');
    return this.call.name;
  }
  build() {
    Column({ space: 6 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 6 }) {
          Column({ space: 2 }) {
            Text(this.title()).fontSize(13).fontColor(this.failed ? $r('app.color.danger') : $r('app.color.secondary'))
            if (chatToolPreview(this.call)) { Text(chatToolPreview(this.call)).fontSize(12).fontColor($r('app.color.tertiary')).maxLines(1) }
          }.alignItems(HorizontalAlign.Start).layoutWeight(1)
          if (this.failed || this.call.status === 'running') {
            Text(this.failed ? $r('app.string.chat_tool_failed') : $r('app.string.chat_running'))
              .fontSize(11).fontColor(this.failed ? $r('app.color.danger') : $r('app.color.tertiary'))
          }
          SymbolGlyph(this.expanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(12).fontColor([$r('app.color.secondary')])
        }.width('100%')
      }.id('chat-tool-' + this.call.id).width('100%').constraintSize({ minHeight: 36 }).padding({ left: 2, right: 2 }).backgroundColor(Color.Transparent)
        .onClick((): void => { this.disclosure.set(this.scope + ':tool:' + this.call.id, !this.expanded); })
      if (this.failureSummary) {
        Text(this.failureSummary).fontSize(12).lineHeight(18).fontColor($r('app.color.danger')).maxLines(3).padding({ left: 2, right: 2 })
      }
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
              .onClick((): void => { this.disclosure.set(this.scope + ':full:' + this.call.id, true); })
          }
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
