import { gatewaySession } from '../service/gatewaySession';
import { XopcListSkeleton, XopcSectionLabel } from './MobileComponents';
import { XopcMarkdownView } from './MarkdownView';

interface XopcJudgmentOption { id: string; label: string; consequence: string; }
interface XopcJudgmentDecision { question: string; options: XopcJudgmentOption[]; }
interface XopcJudgmentInsight {
  title: string; summary: string; workDone: string; recommendation: string; decision?: XopcJudgmentDecision;
}
interface XopcJudgment { id: string; status: string; updatedAt: string; insight: XopcJudgmentInsight; }
interface XopcJudgments { items: XopcJudgment[]; }
interface XopcJudgmentChoice { choice: string; }
interface XopcJudgmentTransition { status: string; snoozedUntil?: string; resolution?: string; }

@ComponentV2
export struct XopcJudgmentsView {
  @Param highlightedId: string = '';
  @Local items: XopcJudgment[] = [];
  @Local loading: boolean = true;
  @Local pending: string = '';
  @Local error: string = '';
  private generation: number = 0;
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.generation++; }
  private async load(): Promise<void> {
    const generation = ++this.generation;
    this.loading = true;
    try {
      const result = JSON.parse(await gatewaySession.request('/api/inbox/judgments?limit=20')) as XopcJudgments;
      if (!Array.isArray(result.items)) throw new Error('INVALID_JUDGMENTS');
      if (generation !== this.generation) return;
      this.items = result.items.filter((item: XopcJudgment): boolean => ['unread', 'read'].includes(item.status));
      this.error = '';
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  private async act(item: XopcJudgment, choice: string, status: string = ''): Promise<void> {
    if (this.pending) return;
    const generation = this.generation;
    try {
      const result = await this.getUIContext().getPromptAction().showDialog({ title: item.insight.title,
        message: $r('app.string.confirm_action_help'), buttons: [{ text: $r('app.string.cancel'), color: $r('app.color.secondary') },
          { text: $r('app.string.confirm'), color: $r('app.color.accent') }] });
      if (result.index !== 1 || generation !== this.generation || this.pending) return;
      this.pending = item.id;
      const path = '/api/inbox/judgments/' + encodeURIComponent(item.id);
      if (status) {
        const body: XopcJudgmentTransition = status === 'snoozed'
          ? { status, snoozedUntil: new Date(Date.now() + 86400000).toISOString() } : { status: 'resolved', resolution: 'dismissed' };
        await gatewaySession.request(path + '/transition', 'POST', JSON.stringify(body));
      } else {
        const body: XopcJudgmentChoice = { choice };
        await gatewaySession.request(path + '/decisions', 'POST', JSON.stringify(body));
      }
      if (generation === this.generation) await this.load();
    } catch (error) { if (generation === this.generation) this.error = (error as Error).message; }
    finally { this.pending = ''; }
  }
  build() {
    Column({ space: 12 }) {
      if (this.loading) { XopcListSkeleton() }
      if (this.error) {
        Text(this.error).fontColor($r('app.color.danger'))
        Button($r('app.string.refresh')).onClick((): void => { this.load(); })
      }
      if (this.items.length) { XopcSectionLabel({ heading: $r('app.string.needs_you') }) }
      ForEach(this.items, (item: XopcJudgment) => {
        Column({ space: 12 }) {
          Text(item.insight.title).fontSize(18).fontWeight(FontWeight.Bold).fontColor($r('app.color.foreground'))
          XopcMarkdownView({ content: item.insight.summary })
          if (item.insight.workDone && item.insight.workDone !== item.insight.summary) { XopcMarkdownView({ content: item.insight.workDone }) }
          XopcMarkdownView({ content: item.insight.recommendation })
          if (item.insight.decision) {
            Text(item.insight.decision.question).fontSize(16).fontColor($r('app.color.foreground'))
            ForEach(item.insight.decision.options, (option: XopcJudgmentOption) => {
              Button({ type: ButtonType.Normal }) {
                Column({ space: 4 }) {
                  Text(option.label).fontSize(16).fontColor($r('app.color.accent'))
                  Text(option.consequence).fontSize(13).fontColor($r('app.color.secondary'))
                }.width('100%').padding(12).alignItems(HorizontalAlign.Start)
              }.width('100%').borderRadius(12).backgroundColor($r('app.color.accent_soft')).enabled(!this.pending)
                .onClick((): void => { this.act(item, option.id); })
            }, (option: XopcJudgmentOption): string => option.id)
          }
          Row({ space: 12 }) {
            Button($r('app.string.tomorrow')).fontColor($r('app.color.secondary')).backgroundColor(Color.Transparent)
              .enabled(!this.pending).onClick((): void => { this.act(item, '', 'snoozed'); })
            Button($r('app.string.dismiss')).fontColor($r('app.color.secondary')).backgroundColor(Color.Transparent)
              .enabled(!this.pending).onClick((): void => { this.act(item, '', 'resolved'); })
          }
        }.width('100%').padding(16).borderRadius(16).alignItems(HorizontalAlign.Start).backgroundColor($r('app.color.panel'))
          .border({ width: 1, color: item.id === this.highlightedId ? $r('app.color.accent') : $r('app.color.border_subtle') })
      }, (item: XopcJudgment): string => item.id + ':' + item.updatedAt)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
