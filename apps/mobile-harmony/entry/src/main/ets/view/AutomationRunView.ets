import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { gatewaySession } from '../service/gatewaySession';
import { XopcMobileRoute } from '../model/home';
import { XopcHubRow, XopcListSkeleton, XopcSectionLabel } from './MobileComponents';
import { XopcMarkdownView } from './MarkdownView';
import { userErrorMessage } from '../common/userError';

interface XopcRunDetail {
  id: string; automationId: string; automationName: string; status: string;
  summary?: string; error?: string; conversationId?: string; workflowRunId?: string;
  createdAtMs?: number; startedAtMs?: number; durationMs?: number;
}
interface XopcRunEnvelope { run: XopcRunDetail; }
interface XopcRunEvent { id: string; message: string; createdAtMs?: number; }
interface XopcRunEvents { events: XopcRunEvent[]; }

@ComponentV2
export struct XopcAutomationRunView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param runId: string = '';
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local run: XopcRunDetail | undefined = undefined;
  @Local events: XopcRunEvent[] = [];
  @Local error: string = '';
  @Local eventError: string = '';
  @Local busy: boolean = false;
  private generation: number = 0;
  private refreshTimer: number = -1;
  aboutToAppear(): void {
    this.load();
    this.refreshTimer = setInterval((): void => { if (this.run && this.active(this.run.status)) this.load(); }, 4000);
  }
  aboutToDisappear(): void { this.generation++; if (this.refreshTimer >= 0) clearInterval(this.refreshTimer); this.refreshTimer = -1; }
  private active(status: string): boolean { return status === 'queued' || status === 'running' || status === 'cancelling'; }
  private problem(status: string): boolean { return status === 'failed' || status === 'timeout'; }
  private statusLabel(status: string): ResourceStr {
    if (status === 'queued') return $r('app.string.status_queued');
    if (status === 'running') return $r('app.string.status_running');
    if (status === 'cancelling') return $r('app.string.status_cancelling');
    if (status === 'succeeded') return $r('app.string.status_succeeded');
    if (status === 'failed') return $r('app.string.status_failed');
    if (status === 'cancelled') return $r('app.string.status_cancelled');
    if (status === 'timeout') return $r('app.string.status_timeout');
    return status;
  }
  private timeLabel(timestamp: number | undefined): string {
    return timestamp ? new Date(timestamp).toLocaleString() : '';
  }
  private async load(): Promise<void> {
    if (this.busy) return;
    const generation = ++this.generation; this.busy = true; this.error = ''; this.eventError = '';
    const path = '/api/automation-runs/' + encodeURIComponent(this.runId);
    try {
      const result = JSON.parse(await gatewaySession.request(path)) as XopcRunEnvelope;
      if (!result.run?.id || typeof result.run.automationName !== 'string') throw new Error('INVALID_AUTOMATION_RUN');
      if (generation !== this.generation) return;
      this.run = result.run;
      try {
        const history = JSON.parse(await gatewaySession.request(path + '/events')) as XopcRunEvents;
        if (!Array.isArray(history.events)) throw new Error('INVALID_RUN_EVENTS');
        if (generation === this.generation) this.events = history.events;
      } catch (error) { if (generation === this.generation) this.eventError = (error as Error).message; }
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private async cancelRun(): Promise<void> {
    if (!this.run || !this.active(this.run.status) || this.busy) return;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.cancel_run'), message: $r('app.string.cancel_run_help'),
        buttons: [{ text: $r('app.string.back'), color: this.colors.secondary },
          { text: $r('app.string.confirm'), color: this.colors.danger }]
      });
      if (result.index !== 1) return;
      this.busy = true; this.error = '';
      await gatewaySession.request('/api/automation-runs/' + encodeURIComponent(this.run.id) + '/cancel', 'POST', '{}');
      this.busy = false; await this.load();
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }
  private async rerun(): Promise<void> {
    if (!this.run || this.busy) return;
    try {
      this.busy = true; this.error = '';
      const result = JSON.parse(await gatewaySession.request('/api/automation-runs/' + encodeURIComponent(this.run.id) + '/rerun', 'POST', '{}')) as XopcRunEnvelope;
      if (!result.run?.id) throw new Error('INVALID_AUTOMATION_RUN');
      this.onNavigate({ page: 'automation-run', itemId: result.run.id });
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }
  build() {
    NavDestination() {
      Column() {
        Scroll() {
          Column({ space: 12 }) {
            if (this.busy && !this.run) { XopcListSkeleton() }
            if (this.error) { Text(userErrorMessage(this.error, 'detail')).fontColor(this.colors.danger) }
            if (this.run) {
              Column({ space: 12 }) {
                Row({ space: 12 }) {
                  SymbolGlyph(this.problem(this.run.status) ? $r('sys.symbol.exclamationmark_circle')
                    : this.run.status === 'succeeded' ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.clock'))
                    .fontSize(26).fontColor([this.problem(this.run.status) ? this.colors.danger : this.colors.accent])
                  Column({ space: 4 }) {
                    Text(this.statusLabel(this.run.status)).fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
                    Text(this.timeLabel(this.run.startedAtMs ?? this.run.createdAtMs)).fontSize(13).fontColor(this.colors.tertiary)
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                }.width('100%')
                if (this.run.summary) { XopcMarkdownView({ content: this.run.summary }) }
                if (this.run.error) { Text(userErrorMessage(this.run.error, 'detail')).fontSize(14).lineHeight(21).fontColor(this.colors.danger).width('100%') }
                if (this.active(this.run.status)) {
                  Button($r('app.string.cancel_run')).width('100%').constraintSize({ minHeight: 46 })
                    .backgroundColor(this.colors.input).fontColor(this.colors.danger).enabled(!this.busy)
                    .onClick((): void => { this.cancelRun(); })
                } else if (this.problem(this.run.status) || this.run.status === 'cancelled') {
                  Button($r('app.string.rerun')).width('100%').constraintSize({ minHeight: 46 })
                    .backgroundColor(this.colors.accent).fontColor(Color.White).enabled(!this.busy)
                    .onClick((): void => { this.rerun(); })
                }
              }.width('100%').padding(16).alignItems(HorizontalAlign.Start).borderRadius(18).backgroundColor(this.colors.panel)
              XopcSectionLabel({ heading: $r('app.string.result') })
              if (this.run.conversationId) {
                XopcHubRow({ heading: $r('app.string.open_chat'), symbol: $r('sys.symbol.message'), onOpen: (): void => {
                  if (this.run?.conversationId) this.onNavigate({ page: 'chat', itemId: this.run.conversationId });
                } })
              }
              if (this.run.workflowRunId) {
                XopcHubRow({ heading: $r('app.string.open_workflow'), symbol: $r('sys.symbol.arrow_clockwise'), onOpen: (): void => {
                  if (this.run?.workflowRunId) this.onNavigate({ page: 'workflows', itemId: this.run.workflowRunId });
                } })
              }
              XopcHubRow({ heading: $r('app.string.view_automation'), symbol: $r('sys.symbol.clock'), onOpen: (): void => {
                if (this.run) this.onNavigate({ page: 'automations', itemId: this.run.automationId });
              } })
              XopcSectionLabel({ heading: $r('app.string.timeline') })
              if (this.eventError) { Text(userErrorMessage(this.eventError, 'detail')).fontColor(this.colors.danger) }
              if (!this.eventError && !this.events.length) { Text($r('app.string.no_events')).fontColor(this.colors.tertiary).width('100%') }
              ForEach(this.events, (event: XopcRunEvent) => {
                Row({ space: 12 }) {
                  Column().width(8).height(8).borderRadius(4).backgroundColor(this.colors.accent)
                  Column({ space: 3 }) {
                    Text(event.message).fontSize(14).lineHeight(20).fontColor(this.colors.foreground).width('100%')
                    if (event.createdAtMs) { Text(this.timeLabel(event.createdAtMs)).fontSize(12).fontColor(this.colors.tertiary) }
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                }.width('100%').padding({ top: 10, bottom: 10 }).alignItems(VerticalAlign.Top)
              }, (event: XopcRunEvent): string => event.id)
            }
          }.width('100%').padding(20).alignItems(HorizontalAlign.Start)
        }.layoutWeight(1).width('100%').align(Alignment.Top)
      }.width('100%').height('100%')
    }.title(this.run?.automationName ?? $r('app.string.automation_run')).backgroundColor(this.colors.surface)
  }
}
