import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatRow, XopcExecutionDetail, XopcExecutionStep, XopcLiveActivityTool } from '../model/chat';

function executionTitle(category: string): ResourceStr {
  switch (category) {
    case 'search': return $r('app.string.chat_step_search');
    case 'read': return $r('app.string.chat_step_read');
    case 'command': return $r('app.string.chat_step_command');
    case 'write': return $r('app.string.chat_step_write');
    case 'edit': return $r('app.string.chat_step_edit');
    case 'fetch': return $r('app.string.chat_step_fetch');
    case 'share': return $r('app.string.chat_step_share');
    case 'speech': return $r('app.string.chat_step_speech');
    case 'publish': return $r('app.string.chat_step_publish');
    case 'plan': return $r('app.string.chat_step_plan');
    case 'skill_view': return $r('app.string.chat_step_skill_view');
    case 'tool_manual': return $r('app.string.chat_step_tool_manual');
    case 'inspect_notes': return $r('app.string.chat_step_inspect_notes');
    case 'inspect_tasks': return $r('app.string.chat_step_inspect_tasks');
    case 'inspect_projects': return $r('app.string.chat_step_inspect_projects');
    case 'inspect_automations': return $r('app.string.chat_step_inspect_automations');
    case 'inspect_work': return $r('app.string.chat_step_inspect_work');
    case 'manage_notes': return $r('app.string.chat_step_manage_notes');
    case 'manage_tasks': return $r('app.string.chat_step_manage_tasks');
    case 'manage_projects': return $r('app.string.chat_step_manage_projects');
    case 'manage_automations': return $r('app.string.chat_step_manage_automations');
    case 'manage_work': return $r('app.string.chat_step_manage_work');
    default: return $r('app.string.chat_step_other');
  }
}

@ComponentV2
export struct XopcChatExecutionDetailView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Local expandedToolId: string = '';
  @Param detail: XopcExecutionDetail = { turnId: '', steps: [] };
  @Param row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Param loading: boolean = false;
  @Param error: string = '';
  @Event onRetry: () => void = (): void => {};

  @Computed get runningTool(): XopcLiveActivityTool | undefined {
    return (this.row.activityTools || []).find((tool: XopcLiveActivityTool): boolean => tool.status === 'running');
  }

  private statusText(status: string): ResourceStr {
    if (status === 'error') return $r('app.string.chat_execution_failed');
    if (status === 'done') return $r('app.string.chat_execution_done');
    return $r('app.string.chat_running');
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        if (this.loading && !this.detail.steps.length) {
          Row({ space: 10 }) {
            LoadingProgress().width(20).height(20).color(this.colors.accent)
            Text($r('app.string.chat_execution_loading')).fontSize(14).fontColor(this.colors.secondary)
          }.width('100%').padding(16)
        }
        if (this.error) {
          Column({ space: 8 }) {
            Text($r('app.string.chat_execution_unavailable')).fontSize(14).fontColor(this.colors.secondary)
            Button($r('app.string.refresh')).height(44).fontColor(this.colors.accent)
              .backgroundColor(Color.Transparent).onClick((): void => { this.onRetry(); })
          }.width('100%').padding(16).borderRadius(12).backgroundColor(this.colors.grouped)
        }
        ForEach(this.detail.steps, (step: XopcExecutionStep, index: number) => {
          Column({ space: 6 }) {
            if (step.kind === 'tool') {
              Button({ type: ButtonType.Normal }) {
                Row({ space: 10 }) {
                  Text((index + 1).toString()).fontSize(12).fontColor(this.colors.tertiary).width(22)
                  Text(executionTitle(step.category || '')).fontSize(14).fontWeight(FontWeight.Medium)
                    .fontColor(this.colors.foreground).layoutWeight(1)
                  Text(this.statusText(step.status || '')).fontSize(12)
                    .fontColor(step.status === 'error' ? this.colors.danger : this.colors.secondary)
                  SymbolGlyph(this.expandedToolId === step.id ? $r('sys.symbol.chevron_up') : $r('sys.symbol.chevron_down'))
                    .fontSize(12).fontColor([this.colors.tertiary])
                }.width('100%').alignItems(VerticalAlign.Center)
              }.id('chat-execution-tool-' + step.id).width('100%').height(44).padding(0)
                .backgroundColor(Color.Transparent).onClick((): void => {
                  this.expandedToolId = this.expandedToolId === step.id ? '' : step.id;
                })
              if (this.expandedToolId === step.id) {
                if (step.preview) {
                  Text(step.preview).fontSize(13).lineHeight(19).fontColor(this.colors.secondary)
                    .width('100%').copyOption(CopyOptions.InApp)
                }
                if (step.failure) {
                  Text(step.failure).fontSize(13).lineHeight(19).fontColor(this.colors.danger)
                    .width('100%').copyOption(CopyOptions.InApp)
                }
                Text(this.statusText(step.status || '')).fontSize(12).fontColor(this.colors.tertiary)
              }
            } else {
              Row({ space: 10 }) {
                Text((index + 1).toString()).fontSize(12).fontColor(this.colors.tertiary).width(22)
                Text(step.kind === 'thinking' ? $r('app.string.chat_steps_thinking') : step.text || '')
                  .fontSize(14).lineHeight(20).fontColor(this.colors.secondary).layoutWeight(1)
              }.width('100%').alignItems(VerticalAlign.Top)
            }
          }.width('100%').padding(12).borderRadius(12).backgroundColor(this.colors.grouped)
        }, (step: XopcExecutionStep): string => step.id)
        if (this.row.live) {
          Row({ space: 10 }) {
            LoadingProgress().width(16).height(16).color(this.colors.accent)
            Text(this.runningTool ? executionTitle(this.runningTool.kind) : $r('app.string.chat_steps_working'))
              .fontSize(14).fontColor(this.colors.foreground).layoutWeight(1)
            Text($r('app.string.chat_running')).fontSize(12).fontColor(this.colors.secondary)
          }.width('100%').padding(12).borderRadius(12).backgroundColor(this.colors.grouped)
        }
        if (!this.loading && !this.error && !this.detail.steps.length && !this.row.live) {
          Text($r('app.string.chat_execution_empty')).fontSize(14).fontColor(this.colors.secondary)
            .width('100%').padding(16)
        }
      }.width('100%').padding({ left: 16, right: 16, top: 16, bottom: 32 })
        .alignItems(HorizontalAlign.Start)
    }.id('chat-execution-detail-scroll').width('100%').layoutWeight(1).scrollBar(BarState.Auto)
      .align(Alignment.TopStart)
  }
}
