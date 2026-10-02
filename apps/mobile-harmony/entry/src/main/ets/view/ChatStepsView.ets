import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcChatRow, XopcLiveActivityTool } from '../model/chat';
import { chatLiveCompletedCount, chatLiveElapsedSeconds, chatLiveNarration } from '../common/chatLiveActivity';

@ComponentV2
export struct XopcChatStepsView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param row: XopcChatRow = { id: '', role: 'assistant', text: '' };
  @Param runStartedAtMs: number = 0;
  @Param connection: string = 'connected';
  @Event onShowDetail: (row: XopcChatRow) => void = (_row: XopcChatRow): void => {};
  @Local nowMs: number = Date.now();
  private clockTimer: number = -1;
  private syncClock(): void {
    if (this.row.live && this.clockTimer === -1) {
      this.nowMs = Date.now();
      this.clockTimer = setInterval((): void => { this.nowMs = Date.now(); }, 1000);
    } else if (!this.row.live && this.clockTimer !== -1) {
      clearInterval(this.clockTimer);
      this.clockTimer = -1;
    }
  }
  aboutToAppear(): void { this.syncClock(); }
  @Monitor('row') onRowChange(): void { this.syncClock(); }
  aboutToDisappear(): void { clearInterval(this.clockTimer); this.clockTimer = -1; }
  @Computed get elapsedSeconds(): number { return chatLiveElapsedSeconds(this.runStartedAtMs, this.nowMs); }
  @Computed get completedCount(): number { return chatLiveCompletedCount(this.row); }
  @Computed get narration(): string { return chatLiveNarration(this.row); }
  private statusLabel(): ResourceStr {
    if (this.connection !== 'connected') return $r('app.string.chat_activity_reconnecting');
    if (this.nowMs - (this.row.activityUpdatedAtMs || this.runStartedAtMs || this.nowMs) > 30000
      && this.row.activity !== 'responding' && !(this.row.activityTools || []).some((tool: XopcLiveActivityTool): boolean => tool.status === 'running')) {
      return $r('app.string.chat_activity_still_working');
    }
    switch (this.row.activity) {
      case 'thinking': return $r('app.string.chat_steps_thinking');
      case 'search': return $r('app.string.chat_steps_searching');
      case 'read': return $r('app.string.chat_steps_reading');
      case 'command': return $r('app.string.chat_steps_commanding');
      case 'write': return $r('app.string.chat_steps_writing');
      case 'edit': return $r('app.string.chat_steps_editing');
      case 'fetch': return $r('app.string.chat_steps_fetching');
      case 'responding': return this.narration || $r('app.string.chat_activity_responding');
      case 'working':
      case 'other': return $r('app.string.chat_steps_working');
      default: return this.elapsedSeconds >= 2 ? $r('app.string.chat_steps_working')
        : $r('app.string.chat_activity_preparing');
    }
  }
  build() {
    Column({ space: 6 }) {
      Button({ type: ButtonType.Normal }) {
        Row({ space: 8 }) {
          if (this.row.live) {
            LoadingProgress().width(16).height(16).color(this.colors.accent)
          } else {
            SymbolGlyph($r('sys.symbol.checkmark_circle')).fontSize(16).fontColor([this.colors.secondary])
          }
          Text(this.row.live ? this.statusLabel() : $r('app.string.chat_steps'))
            .fontSize(13).fontWeight(FontWeight.Medium)
            .fontColor(this.row.live ? this.colors.foreground : this.colors.secondary)
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
          if (this.row.live && this.completedCount > 0) {
            Text($r('app.string.chat_activity_completed', this.completedCount.toString()))
              .fontSize(12).fontColor(this.colors.secondary).maxLines(1).flexShrink(0)
          }
          if (this.row.live && this.elapsedSeconds >= 8) {
            Text($r('app.string.chat_activity_elapsed', this.elapsedSeconds.toString()))
              .fontSize(12).fontColor(this.colors.tertiary).flexShrink(0)
          }
          SymbolGlyph($r('sys.symbol.chevron_right')).fontSize(12).fontColor([this.colors.tertiary])
        }.width('100%').height('100%').alignItems(VerticalAlign.Center)
      }.id('chat-steps-' + this.row.id).width('100%').height(36).padding(0)
        .backgroundColor(Color.Transparent)
        .onClick((): void => {
          this.onShowDetail(this.row);
        })
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
