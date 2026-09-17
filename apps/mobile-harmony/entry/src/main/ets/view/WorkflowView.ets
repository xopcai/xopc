import { gatewaySession } from '../service/gatewaySession';
import { XopcHubRow, XopcListSkeleton, XopcEmptyHint } from './MobileComponents';
import { XopcMarkdownView } from './MarkdownView';

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
  @Param initialId: string = '';
  @Local runs: XopcWorkflowSummary[] = [];
  @Local selected: XopcWorkflowDetail | undefined = undefined;
  @Local busy: boolean = false;
  @Local error: string = '';
  private generation: number = 0;
  aboutToAppear(): void { this.load(this.initialId); }
  aboutToDisappear(): void { this.generation++; }
  private async load(runId: string = ''): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.error = ''; const generation = ++this.generation;
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
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.busy = false; }
  }
  private async cancelRun(): Promise<void> {
    const detail = this.selected;
    if (!detail?.controls.canCancel || this.busy) return;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({
        title: $r('app.string.cancel'), message: $r('app.string.confirm_action_help'),
        buttons: [{ text: $r('app.string.back'), color: $r('app.color.secondary') }, { text: $r('app.string.confirm'), color: $r('app.color.danger') }]
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
        Button($r('app.string.refresh')).enabled(!this.busy).backgroundColor(Color.Transparent).fontColor($r('app.color.accent'))
          .onClick((): void => { this.load(this.selected?.run.id ?? this.initialId); })
        Scroll() {
          Column() {
            if (this.error) { Text(this.error).fontColor($r('app.color.danger')).padding(12) }
            if (this.busy) { XopcListSkeleton() }
            if (this.selected) {
              Text(this.selected.run.title).fontSize(22).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground'))
              XopcEmptyHint({ message: this.selected.run.status })
              XopcMarkdownView({ content: this.selected.run.goal ?? '' })
              if (this.selected.run.result) { XopcMarkdownView({ content: this.selected.run.result.summary }) }
              ForEach(this.selected.phases, (step: XopcWorkflowStep) => {
                XopcHubRow({ heading: step.title ?? step.id, summary: step.status, navigable: false })
              }, (step: XopcWorkflowStep): string => step.id + ':' + step.status)
              ForEach(this.selected.agents, (step: XopcWorkflowStep) => {
                XopcHubRow({ heading: step.label ?? step.id, summary: step.resultPreview || step.error || step.status, navigable: false })
              }, (step: XopcWorkflowStep): string => step.id + ':' + step.status)
              if (this.selected.controls.canCancel) { Button($r('app.string.cancel')).enabled(!this.busy).onClick((): void => { this.cancelRun(); }) }
            } else {
              if (!this.busy && !this.error && !this.runs.length) { XopcEmptyHint({ message: $r('app.string.empty_list') }) }
              ForEach(this.runs, (run: XopcWorkflowSummary) => {
                XopcHubRow({ heading: run.title, summary: run.status, symbol: $r('sys.symbol.arrow_clockwise'), onOpen: (): void => { this.load(run.id); } })
              }, (run: XopcWorkflowSummary): string => run.id + ':' + run.status)
            }
          }.width('100%').padding(20).alignItems(HorizontalAlign.Start)
        }.layoutWeight(1).width('100%')
      }.width('100%').height('100%')
    }.title($r('app.string.workflows')).backgroundColor($r('app.color.surface'))
      .onBackPressed((): boolean => {
        if (this.selected && !this.initialId) { this.selected = undefined; this.load(); return true; }
        return false;
      })
  }
}
