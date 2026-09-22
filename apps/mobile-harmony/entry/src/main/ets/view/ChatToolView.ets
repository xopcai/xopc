import { XopcChatTool } from '../model/chat';
import { common } from '@kit.AbilityKit';
import { XopcChatDisclosure } from '../common/chatDisclosure';
import { chatToolDisplayKind, chatToolFailureSummary, chatToolPreview, chatToolFailed, chatToolSemanticKind, toolOutputText, chatSearchLinks, XopcSearchLink } from '../common/chatRichContent';

function chatToolTitle(call: XopcChatTool): ResourceStr {
  const semantic = chatToolSemanticKind(call);
  if (semantic === 'skill_view') return $r('app.string.chat_step_skill_view');
  if (semantic === 'tool_manual') return $r('app.string.chat_step_tool_manual');
  if (semantic === 'inspect_notes') return $r('app.string.chat_step_inspect_notes');
  if (semantic === 'inspect_tasks') return $r('app.string.chat_step_inspect_tasks');
  if (semantic === 'inspect_projects') return $r('app.string.chat_step_inspect_projects');
  if (semantic === 'inspect_automations') return $r('app.string.chat_step_inspect_automations');
  if (semantic === 'inspect_work') return $r('app.string.chat_step_inspect_work');
  if (semantic === 'manage_notes') return $r('app.string.chat_step_manage_notes');
  if (semantic === 'manage_tasks') return $r('app.string.chat_step_manage_tasks');
  if (semantic === 'manage_projects') return $r('app.string.chat_step_manage_projects');
  if (semantic === 'manage_automations') return $r('app.string.chat_step_manage_automations');
  if (semantic === 'manage_work') return $r('app.string.chat_step_manage_work');
  const kind = chatToolDisplayKind(call.name);
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
  return $r('app.string.chat_step_other');
}

@ComponentV2
export struct XopcChatToolGroupView {
  @Param calls: XopcChatTool[] = [];
  @Param disclosure: XopcChatDisclosure = new XopcChatDisclosure();
  @Param scope: string = '';
  @Computed get first(): XopcChatTool { return this.calls[0] || { id: '', name: '' }; }
  @Computed get expanded(): boolean { return this.disclosure.get(this.scope + ':tool-group:' + this.first.id) ?? false; }
  build() {
    Column({ space: 4 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 6 }) {
          Text(chatToolTitle(this.first)).fontSize(13).fontColor($r('app.color.secondary')).layoutWeight(1)
          Text('×' + this.calls.length.toString()).fontSize(11).fontColor($r('app.color.tertiary'))
          SymbolGlyph(this.expanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(12).fontColor([$r('app.color.secondary')])
        }.width('100%')
      }.id('chat-tool-group-' + this.first.id).width('100%').constraintSize({ minHeight: 36 }).padding({ left: 2, right: 2 }).backgroundColor(Color.Transparent)
        .onClick((): void => { this.disclosure.set(this.scope + ':tool-group:' + this.first.id, !this.expanded); })
      if (this.expanded) {
        Column({ space: 2 }) {
          ForEach(this.calls, (call: XopcChatTool) => {
            XopcChatToolView({ call: call, disclosure: this.disclosure, scope: this.scope + ':group:' + this.first.id })
          }, (call: XopcChatTool): string => call.id)
        }.width('100%').padding({ left: 8 }).border({ width: { left: 1 }, color: $r('app.color.border_subtle') })
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}

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
  @Computed get semantic(): string { return chatToolSemanticKind(this.call); }
  @Computed get hasDetails(): boolean { return !this.semantic && (this.links.length > 0 || this.call.input !== undefined || this.call.result !== undefined); }
  private async openLink(link: XopcSearchLink): Promise<void> {
    try {
      const choice = await this.getUIContext().getPromptAction().showDialog({ title: $r('app.string.chat_open_link'), message: link.url,
        buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') }, { text: $r('app.string.open'), color: $r('app.color.accent') }] });
      if (choice.index === 1) await (this.getUIContext().getHostContext() as common.UIAbilityContext).openLink(link.url, { appLinkingOnly: false });
    } catch (_) { this.getUIContext().getPromptAction().showToast({ message: $r('app.string.chat_link_failed') }); }
  }
  private title(): ResourceStr {
    return chatToolTitle(this.call);
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
          if (this.hasDetails) {
            SymbolGlyph(this.expanded ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down')).fontSize(12).fontColor([$r('app.color.secondary')])
          }
        }.width('100%')
      }.id('chat-tool-' + this.call.id).width('100%').constraintSize({ minHeight: 36 }).padding({ left: 2, right: 2 }).backgroundColor(Color.Transparent)
        .onClick((): void => { if (this.hasDetails) this.disclosure.set(this.scope + ':tool:' + this.call.id, !this.expanded); })
      if (this.failureSummary) {
        Text(this.failureSummary).fontSize(12).lineHeight(18).fontColor($r('app.color.danger')).maxLines(3).padding({ left: 2, right: 2 })
      }
      if (this.expanded && this.hasDetails) {
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
