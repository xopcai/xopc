import { gatewaySession } from '../service/gatewaySession';
import { XopcMobileRoute } from '../model/home';
import { XopcHubRow, XopcListSkeleton, XopcEmptyHint } from './MobileComponents';
import { XopcMarkdownView } from './MarkdownView';

interface XopcRunDetail {
  id: string; automationId: string; automationName: string; status: string;
  summary?: string; error?: string; conversationId?: string; workflowRunId?: string;
}
interface XopcRunEnvelope { run: XopcRunDetail; }
interface XopcRunEvent { id: string; message: string; }
interface XopcRunEvents { events: XopcRunEvent[]; }

@ComponentV2
export struct XopcAutomationRunView {
  @Param runId: string = '';
  @Event onNavigate: (route: XopcMobileRoute) => void = (_route: XopcMobileRoute): void => {};
  @Local run: XopcRunDetail | undefined = undefined;
  @Local events: XopcRunEvent[] = [];
  @Local error: string = '';
  @Local eventError: string = '';
  @Local busy: boolean = false;
  private generation: number = 0;
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.generation++; }
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
  build() {
    NavDestination() {
      Column() {
        Button($r('app.string.refresh')).backgroundColor(Color.Transparent).fontColor($r('app.color.accent'))
          .enabled(!this.busy).onClick((): void => { this.load(); })
        Scroll() {
          Column({ space: 12 }) {
            if (this.busy && !this.run) { XopcListSkeleton() }
            if (this.error) { Text(this.error).fontColor($r('app.color.danger')) }
            if (this.run) {
              Text(this.run.automationName).fontSize(24).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground'))
              XopcEmptyHint({ message: this.run.status })
              if (this.run.summary) { XopcMarkdownView({ content: this.run.summary }) }
              if (this.run.error) { Text(this.run.error).fontColor($r('app.color.danger')) }
              XopcHubRow({ heading: $r('app.string.automations'), onOpen: (): void => {
                if (this.run) this.onNavigate({ page: 'automations', itemId: this.run.automationId });
              } })
              if (this.run.conversationId) {
                XopcHubRow({ heading: $r('app.string.chat'), symbol: $r('sys.symbol.message'), onOpen: (): void => {
                  if (this.run?.conversationId) this.onNavigate({ page: 'chat', itemId: this.run.conversationId });
                } })
              }
              if (this.run.workflowRunId) {
                XopcHubRow({ heading: $r('app.string.workflows'), onOpen: (): void => {
                  if (this.run?.workflowRunId) this.onNavigate({ page: 'workflows', itemId: this.run.workflowRunId });
                } })
              }
              if (this.eventError) { Text(this.eventError).fontColor($r('app.color.danger')) }
              ForEach(this.events, (event: XopcRunEvent) => {
                XopcHubRow({ heading: event.message, navigable: false })
              }, (event: XopcRunEvent): string => event.id)
            }
          }.width('100%').padding(20).alignItems(HorizontalAlign.Start)
        }.layoutWeight(1).width('100%')
      }.width('100%').height('100%')
    }.title($r('app.string.automations')).backgroundColor($r('app.color.surface'))
  }
}
