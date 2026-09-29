import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { gatewaySession } from '../service/gatewaySession';
import { XopcBrandLoading, XopcHubRow, XopcListSkeleton, XopcEmptyHint, XopcSectionLabel } from './MobileComponents';
import { XopcMarkdownView } from './MarkdownView';
import { userErrorMessage } from '../common/userError';

interface XopcWorkflowSummary { id: string; title: string; status: string; goal?: string; }
interface XopcWorkflowPage { runs: XopcWorkflowSummary[]; }
interface XopcWorkflowStep { id: string; title?: string; label?: string; status: string; resultPreview?: string; error?: string; }
interface XopcWorkflowResult { summary: string; }
interface XopcWorkflowDetailRun extends XopcWorkflowSummary { result?: XopcWorkflowResult; }
interface XopcWorkflowControls { canCancel: boolean; }
interface XopcWorkflowDetail {
  run: XopcWorkflowDetailRun; phases: XopcWorkflowStep[]; agents: XopcWorkflowStep[]; controls: XopcWorkflowControls;
}
interface XopcWorkflowEnvelope { view: XopcWorkflowDetail; }

@ComponentV2
export struct XopcWorkflowView {
  @Local colors: XopcThemeColors = appThemeColors;
  @Param initialId: string = '';
  @Event onCreateWithChat: () => Promise<void> = async (): Promise<void> => {};
  @Local runs: XopcWorkflowSummary[] = [];
  @Local selected: XopcWorkflowDetail | undefined = undefined;
  @Local busy: boolean = false;
  @Local error: string = '';
  @Local creatingChat: boolean = false;
  @Local openingId: string = '';
  private generation: number = 0;
  private refreshTimer: number = -1;
  aboutToAppear(): void {
    this.load(this.initialId);
    this.refreshTimer = setInterval((): void => {
      if (this.selected && this.active(this.selected.run.status)) this.load(this.selected.run.id);
    }, 4000);
  }
  aboutToDisappear(): void { this.generation++; if (this.refreshTimer >= 0) clearInterval(this.refreshTimer); this.refreshTimer = -1; }
  private active(status: string): boolean { return status === 'queued' || status === 'running'; }
  private statusLabel(status: string): ResourceStr {
    if (status === 'queued') return $r('app.string.status_queued');
    if (status === 'running') return $r('app.string.status_running');
    if (status === 'succeeded' || status === 'done') return $r('app.string.status_succeeded');
    if (status === 'failed') return $r('app.string.status_failed');
    if (status === 'cancelled') return $r('app.string.status_cancelled');
    return status;
  }
  private completedSteps(): number {
    return this.selected?.agents.filter((step: XopcWorkflowStep): boolean => step.status === 'done' || step.status === 'succeeded').length ?? 0;
  }
  private async createWithChat(): Promise<void> {
    if (this.busy || this.creatingChat) return;
    this.creatingChat = true;
    try { await this.onCreateWithChat(); }
    finally { this.creatingChat = false; }
  }
  private async load(runId: string = ''): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.error = ''; const generation = ++this.generation;
    if (runId && this.selected?.run.id !== runId) { this.openingId = runId; this.selected = undefined; }
    try {
      if (runId) {
        const result = JSON.parse(await gatewaySession.request('/api/workflows/runs/' + encodeURIComponent(runId))) as XopcWorkflowEnvelope;
        if (!result.view?.run?.id || !Array.isArray(result.view.phases) || !Array.isArray(result.view.agents)) throw new Error('INVALID_WORKFLOW');
        if (generation === this.generation) this.selected = result.view;
      } else {
        const result = JSON.parse(await gatewaySession.request('/api/workflows/runs?limit=50')) as XopcWorkflowPage;
        if (!Array.isArray(result.runs)) throw new Error('INVALID_WORKFLOWS');
        if (generation === this.generation) this.runs = result.runs;
      }
    } catch (error) {
      if (generation === this.generation) this.error = (error as Error).message;
    }
    finally { if (generation === this.generation) { this.busy = false; this.openingId = ''; } }
  }
  private async cancelRun(): Promise<void> {
    const detail = this.selected;
    if (!detail?.controls.canCancel || this.busy) return;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.cancel'), message: $r('app.string.confirm_action_help'),
        buttons: [{ text: $r('app.string.back'), color: this.colors.secondary }, { text: $r('app.string.confirm'), color: this.colors.danger }]
      });
      if (result.index !== 1 || this.busy) return;
      this.busy = true;
      await gatewaySession.request('/api/workflows/runs/' + encodeURIComponent(detail.run.id) + '/cancel', 'POST', '{}');
      this.busy = false; await this.load(detail.run.id);
    } catch (error) { this.error = (error as Error).message; }
    finally { this.busy = false; }
  }
  build() {
    NavDestination() {
      Column() {
        Row() {
          Text(this.selected || this.openingId ? $r('app.string.workflow_overview') : $r('app.string.recent_runs'))
            .fontSize(14).fontWeight(FontWeight.Medium).fontColor(this.colors.secondary).layoutWeight(1)
          if (!this.selected && !this.openingId) {
            Button($r('app.string.new_workflow')).height(44).backgroundColor(Color.Transparent).fontColor(this.colors.accent)
              .enabled(!this.busy && !this.creatingChat).onClick((): void => { this.createWithChat(); })
          }
          Button({ type: ButtonType.Circle }) {
            SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(20).fontColor([this.colors.accent])
          }.width(44).height(44).padding(0).backgroundColor(Color.Transparent).enabled(!this.busy)
            .accessibilityText($r('app.string.refresh')).onClick((): void => { this.load(this.selected?.run.id ?? this.initialId); })
        }.width('100%').padding({ left: 20, right: 12 })
        Scroll() {
          Column() {
            if (this.error) { Text(userErrorMessage(this.error, 'collection')).fontColor(this.colors.secondary).padding(12) }
            if (this.openingId) { XopcBrandLoading() }
            else if (this.busy && !this.runs.length) { XopcListSkeleton() }
            if (this.selected) {
              Column({ space: 10 }) {
                Row({ space: 12 }) {
                  Row() { SymbolGlyph($r('sys.symbol.arrow_clockwise')).fontSize(22).fontColor([this.colors.accent]) }
                    .width(42).height(42).justifyContent(FlexAlign.Center).borderRadius(21).backgroundColor(this.colors.accentSoft)
                  Column({ space: 4 }) {
                    Text(this.selected.run.title).fontSize(22).fontWeight(FontWeight.Bold).fontColor(this.colors.foreground)
                    Text(this.statusLabel(this.selected.run.status)).fontSize(13).fontWeight(FontWeight.Medium).fontColor(this.colors.accent)
                  }.layoutWeight(1).alignItems(HorizontalAlign.Start)
                }.width('100%')
                Text($r('app.string.workflow_progress', this.completedSteps(), this.selected.agents.length))
                  .fontSize(13).fontColor(this.colors.secondary).width('100%')
                if (this.selected.controls.canCancel) {
                  Button($r('app.string.cancel_run')).width('100%').constraintSize({ minHeight: 46 })
                    .backgroundColor(this.colors.input).fontColor(this.colors.danger).enabled(!this.busy)
                    .onClick((): void => { this.cancelRun(); })
                }
              }.width('100%').padding(16).alignItems(HorizontalAlign.Start).borderRadius(18).backgroundColor(this.colors.panel)
              if (this.selected.run.goal) {
                XopcSectionLabel({ heading: $r('app.string.goal') })
                XopcMarkdownView({ content: this.selected.run.goal })
              }
              if (this.selected.run.result) {
                XopcSectionLabel({ heading: $r('app.string.result') })
                XopcMarkdownView({ content: this.selected.run.result.summary })
              }
              if (this.selected.phases.length) { XopcSectionLabel({ heading: $r('app.string.phases') }) }
              ForEach(this.selected.phases, (step: XopcWorkflowStep) => {
                XopcHubRow({ heading: step.title ?? step.id, summary: this.statusLabel(step.status),
                  symbol: step.status === 'done' || step.status === 'succeeded' ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.clock'), navigable: false })
              }, (step: XopcWorkflowStep): string => step.id + ':' + step.status)
              if (this.selected.agents.length) { XopcSectionLabel({ heading: $r('app.string.agent_work') }) }
              ForEach(this.selected.agents, (step: XopcWorkflowStep) => {
                XopcHubRow({ heading: step.label ?? step.id, summary: step.resultPreview || step.error || this.statusLabel(step.status),
                  symbol: step.error ? $r('sys.symbol.exclamationmark_circle') : step.status === 'done' || step.status === 'succeeded'
                    ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.clock'), navigable: false })
              }, (step: XopcWorkflowStep): string => step.id + ':' + step.status)
            } else if (!this.openingId) {
              if (!this.busy && !this.error && !this.runs.length) { XopcEmptyHint({ message: $r('app.string.empty_list') }) }
              ForEach(this.runs, (run: XopcWorkflowSummary) => {
                XopcHubRow({ heading: run.title, summary: this.statusLabel(run.status),
                  symbol: run.status === 'succeeded' || run.status === 'done' ? $r('sys.symbol.checkmark_circle') : $r('sys.symbol.arrow_clockwise'),
                  onOpen: (): void => { this.load(run.id); } })
              }, (run: XopcWorkflowSummary): string => run.id + ':' + run.status)
            }
          }.width('100%').padding(20).alignItems(HorizontalAlign.Start)
        }.layoutWeight(1).width('100%').align(Alignment.Top)
      }.width('100%').height('100%')
    }.title($r('app.string.workflows')).backgroundColor(this.colors.surface)
      .onBackPressed((): boolean => {
        if (this.selected && !this.initialId) { this.selected = undefined; this.load(); return true; }
        return false;
      })
  }
}
