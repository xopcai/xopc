import { XopcClarificationWizard } from './ClarificationWizard';
import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcClarification, XopcClarificationChoice, XopcClarificationCommand } from '../model/clarification';

@ComponentV2
export struct XopcClarificationCard {
  @Local colors: XopcThemeColors = appThemeColors;
  @Require @Param prompt: XopcClarification;
  @Param submitting: boolean = false;
  @Param errorMessage: string = '';
  @Event onRespond: (command: XopcClarificationCommand) => void = (command: XopcClarificationCommand): void => {};
  @Param draftRecord: string = '';
  @Event onDraft: (record: string) => void = (_record: string): void => {};
  @Local draft: string = '';
  @Local selectedId: string = '';
  @Local editing: boolean = false;
  @Local expanded: boolean = false;
  @Local now: number = Date.now();
  private timer: number = -1;
  aboutToAppear(): void { this.questionId = this.prompt.id; this.timer = setInterval((): void => { this.now = Date.now(); }, 1000); }
  aboutToDisappear(): void { clearInterval(this.timer); }
  private questionId: string = '';
  @Monitor('prompt')
  onQuestionChange(): void { if (this.questionId === this.prompt.id) return; this.questionId = this.prompt.id; this.draft = ''; this.selectedId = ''; this.editing = false; this.expanded = false; }
  private disabled(): boolean { return this.submitting || (this.prompt.expiresAt !== undefined && this.prompt.expiresAt <= this.now); }
  private send(action: string, choiceId: string = '', text: string = '', decision: string = ''): void {
    if (this.disabled()) return;
    const command: XopcClarificationCommand = { action };
    if (decision) command.decision = decision;
    else if (action === 'answer') {
      if ((!choiceId && !text.trim()) || text.trim().length > 8000) return;
      command.response = { choiceId: choiceId || undefined, text: text.trim() || undefined };
    }
    this.onRespond(command);
  }
  build() {
    if (this.prompt.schemaVersion === 2) {
      XopcClarificationWizard({ prompt: this.prompt, submitting: this.submitting, errorMessage: this.errorMessage,
        draftRecord: this.draftRecord, onDraft: this.onDraft, onRespond: this.onRespond })
    } else { this.legacyCard() }
  }
  @Builder
  legacyCard() {
    Scroll() {
      Column({ space: 8 }) {
        Text(this.prompt.kind === 'approval' ? $r('app.string.clarify_approval_title') : $r('app.string.clarify_title'))
          .fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
        Text(this.prompt.question).fontSize(14).fontColor(this.colors.foreground).width('100%')
        if (this.prompt.expiresAt !== undefined) {
          Text(this.prompt.expiresAt <= this.now ? $r('app.string.clarify_expired') : $r('app.string.clarify_remaining', Math.max(0, Math.ceil((this.prompt.expiresAt - this.now) / 1000))))
            .fontSize(12).fontColor(this.colors.secondary).width('100%')
        }
        if (this.prompt.kind === 'approval') {
          if (this.prompt.approval) {
            Text(this.prompt.approval.operation).fontColor(this.colors.foreground).width('100%')
            if (this.prompt.approval.target) { Text(this.prompt.approval.target).fontColor(this.colors.secondary).width('100%') }
            if (this.prompt.approval.impact) { Text(this.prompt.approval.impact).fontColor(this.colors.secondary).width('100%') }
            if (this.prompt.approval.argumentsPreview) {
              Button($r('app.string.clarify_details')).onClick((): void => { this.expanded = !this.expanded; })
              if (this.expanded) { Text(JSON.stringify(this.prompt.approval.argumentsPreview)).fontSize(12).fontColor(this.colors.secondary).width('100%') }
            }
          }
          Text($r('app.string.clarify_once')).fontSize(12).fontColor(this.colors.secondary).width('100%')
          Row({ space: 8 }) {
            Button($r('app.string.clarify_deny')).height(44).enabled(!this.disabled()).onClick((): void => { this.send('answer', '', '', 'deny'); })
            Button($r('app.string.clarify_approve')).height(44).enabled(!this.disabled()).onClick((): void => { this.send('answer', '', '', 'approve'); })
          }
        } else {
          if (this.prompt.interactionMode !== 'compose' && !this.editing && (this.prompt.choiceDetails?.length ?? 0) > 0) {
            Text($r('app.string.clarify_quick_hint')).fontSize(12).fontColor(this.colors.secondary).width('100%')
            Button($r('app.string.clarify_compose')).enabled(!this.disabled()).onClick((): void => { this.editing = true; })
          }
          ForEach(this.prompt.choiceDetails ?? [], (choice: XopcClarificationChoice) => {
            Button() {
              Column({ space: 4 }) {
                Text((this.selectedId === choice.id ? '✓ ' : '') + choice.label + (this.prompt.recommendedChoiceId === choice.id ? ' · ' : ''))
                  .fontColor(this.colors.foreground).width('100%')
                if (this.prompt.recommendedChoiceId === choice.id) { Text($r('app.string.clarify_recommended')).fontSize(12).fontColor(this.colors.accent).width('100%') }
                if (choice.description) { Text(choice.description).fontSize(12).fontColor(this.colors.secondary).width('100%') }
              }.padding(8).width('100%')
            }.width('100%').constraintSize({ minHeight: 44 }).backgroundColor(this.colors.grouped).enabled(!this.disabled())
              .onClick((): void => {
                if (this.prompt.interactionMode === 'compose' || this.editing || this.draft) { this.editing = true; this.selectedId = choice.id; }
                else this.send('answer', choice.id);
              })
          }, (choice: XopcClarificationChoice): string => choice.id)
          if (this.selectedId) { Button($r('app.string.clarify_clear')).enabled(!this.disabled()).onClick((): void => { this.selectedId = ''; }) }
          Text(this.selectedId ? $r('app.string.clarify_supplement') : $r('app.string.clarify_custom')).fontSize(12).fontColor(this.colors.secondary).width('100%')
          TextArea({ text: this.draft, placeholder: $r('app.string.message_hint') }).height(96).width('100%').enabled(!this.disabled())
            .onChange((text: string): void => { this.draft = text; if (text) this.editing = true; })
          Text(this.draft.trim().length + '/8000').fontSize(12).fontColor(this.draft.trim().length > 8000 ? this.colors.danger : this.colors.secondary).width('100%')
          Row({ space: 8 }) {
            Button($r('app.string.chat_agent_decide')).enabled(!this.disabled()).onClick((): void => { this.send('agent_decide'); })
            Button($r('app.string.clarify_cancel')).enabled(!this.disabled()).onClick((): void => { this.send('cancel'); })
            Button($r('app.string.send')).enabled(!this.disabled() && this.draft.trim().length <= 8000 && (!!this.selectedId || !!this.draft.trim()))
              .onClick((): void => { this.send('answer', this.selectedId, this.draft); })
          }
        }
        if (this.submitting) { Text($r('app.string.clarify_submitting')).fontSize(12).fontColor(this.colors.secondary) }
        if (this.errorMessage) { Text(this.errorMessage).fontSize(12).fontColor(this.colors.danger).width('100%') }
      }.padding(12).width('100%')
    }.constraintSize({ maxHeight: 400 }).width('100%').borderRadius(16).backgroundColor(this.colors.grouped)
  }
}
