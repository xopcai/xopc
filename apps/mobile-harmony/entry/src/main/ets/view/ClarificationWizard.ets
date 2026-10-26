import { appThemeColors, XopcThemeColors } from '../common/themePalette';
import { XopcClarification, XopcClarificationQuestion, XopcClarificationChoice, XopcClarificationDraft,
  XopcClarificationBatchAnswer, XopcClarificationCommand, validClarificationAnswers } from '../model/clarification';

@ComponentV2
export struct XopcClarificationWizard {
  @Require @Param prompt: XopcClarification;
  @Param submitting: boolean = false;
  @Param errorMessage: string = '';
  @Param draftRecord: string = '';
  @Event onDraft: (record: string) => void = (_record: string): void => {};
  @Event onRespond: (command: XopcClarificationCommand) => void = (_command: XopcClarificationCommand): void => {};
  @Local colors: XopcThemeColors = appThemeColors;
  @Local now: number = Date.now();
  private timer: number = -1;
  aboutToAppear(): void { this.timer = setInterval((): void => { this.now = Date.now(); }, 1000); }
  aboutToDisappear(): void { clearInterval(this.timer); }
  private draft(): XopcClarificationDraft {
    try { return this.draftRecord ? JSON.parse(this.draftRecord) as XopcClarificationDraft : { index: 0, answers: [] }; }
    catch (_error) { return { index: 0, answers: [] }; }
  }
  private questions(): XopcClarificationQuestion[] { return this.prompt.questions ?? []; }
  private index(): number { return Math.max(0, Math.min(this.questions().length - 1, this.draft().index)); }
  private current(): XopcClarificationQuestion | undefined { return this.questions()[this.index()]; }
  private answer(): XopcClarificationBatchAnswer | undefined {
    return this.draft().answers.find((answer: XopcClarificationBatchAnswer): boolean => answer.questionId === this.current()?.id);
  }
  private expired(): boolean { return this.prompt.expiresAt !== undefined && this.prompt.expiresAt <= this.now; }
  private disabled(): boolean { return this.submitting || this.expired(); }
  private locked(): boolean { return this.disabled() || !!this.draft().pendingAction; }
  private complete(): boolean { return validClarificationAnswers(this.prompt, this.draft().answers); }
  private allAnswered(): boolean {
    return this.questions().every((question: XopcClarificationQuestion): boolean => this.draft().answers.some(
      (answer: XopcClarificationBatchAnswer): boolean => answer.questionId === question.id && (!!answer.choiceId || !!answer.text?.trim())));
  }
  private update(choiceId: string, text: string): void {
    if (this.locked()) return;
    const question = this.current(); if (!question) return;
    const draft = this.draft();
    draft.answers = draft.answers.filter((answer: XopcClarificationBatchAnswer): boolean => answer.questionId !== question.id);
    draft.answers.push({ questionId: question.id, choiceId: choiceId || undefined, text: text || undefined });
    this.onDraft(JSON.stringify(draft));
  }
  private navigate(delta: number): void {
    const draft = this.draft(); draft.index = this.index() + delta; this.onDraft(JSON.stringify(draft));
  }
  private submit(action: string): void {
    if (this.disabled() || (action === 'answer' && !this.complete())) return;
    const draft = this.draft(); draft.pendingAction = action;
    this.onDraft(JSON.stringify(draft));
    const command: XopcClarificationCommand = { action, schemaVersion: 2 };
    if (action === 'answer') command.answers = this.questions().map((question: XopcClarificationQuestion): XopcClarificationBatchAnswer => {
      const answer = draft.answers.find((entry: XopcClarificationBatchAnswer): boolean => entry.questionId === question.id);
      return { questionId: question.id, choiceId: answer?.choiceId, text: answer?.text?.trim() || undefined };
    });
    this.onRespond(command);
  }
  build() {
    Scroll() {
      Column({ space: 8 }) {
        Text($r('app.string.clarify_title')).fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.colors.foreground).width('100%')
        Text((this.index() + 1) + '/' + this.questions().length + ' · ' + (this.current()?.header ?? '')).fontSize(12).fontColor(this.colors.secondary).width('100%')
        Text(this.current()?.question ?? '').fontSize(14).fontColor(this.colors.foreground).width('100%')
        ForEach(this.current()?.choices ?? [], (choice: XopcClarificationChoice) => {
          Button() {
            Column({ space: 4 }) {
              Text((this.answer()?.choiceId === choice.id ? '✓ ' : '') + choice.label).fontColor(this.colors.foreground).width('100%')
              if (choice.id === this.current()?.recommendedChoiceId) { Text($r('app.string.clarify_recommended')).fontSize(12).fontColor(this.colors.accent).width('100%') }
              if (choice.description) { Text(choice.description).fontSize(12).fontColor(this.colors.secondary).width('100%') }
            }.padding(8).width('100%')
          }.width('100%').constraintSize({ minHeight: 44 }).backgroundColor(this.colors.grouped).enabled(!this.locked())
            .onClick((): void => { this.update(choice.id, this.answer()?.text ?? ''); })
        }, (choice: XopcClarificationChoice): string => choice.id)
        if (this.answer()?.choiceId) {
          Button($r('app.string.clarify_clear')).enabled(!this.locked()).onClick((): void => { this.update('', this.answer()?.text ?? ''); })
        }
        Text(this.answer()?.choiceId ? $r('app.string.clarify_supplement') : $r('app.string.clarify_custom')).fontSize(12).fontColor(this.colors.secondary).width('100%')
        TextArea({ text: this.answer()?.text ?? '', placeholder: $r('app.string.message_hint') }).height(96).width('100%').enabled(!this.locked())
          .onChange((text: string): void => { this.update(this.answer()?.choiceId ?? '', text); })
        Text((this.answer()?.text?.trim().length ?? 0) + '/2000').fontSize(12).fontColor(this.colors.secondary).width('100%')
        if (!this.complete() && this.allAnswered()) { Text($r('app.string.clarify_too_long')).fontSize(12).fontColor(this.colors.danger).width('100%') }
        Flex({ wrap: FlexWrap.Wrap }) {
          Button($r('app.string.clarify_previous')).enabled(!this.disabled() && this.index() > 0).onClick((): void => { this.navigate(-1); })
          if (this.index() < this.questions().length - 1) {
            Button($r('app.string.clarify_next')).enabled(!this.disabled()).onClick((): void => { this.navigate(1); })
          }
          Button(this.draft().pendingAction ? $r('app.string.clarify_retry') : $r('app.string.send'))
            .enabled(!this.disabled() && (this.complete() || !!this.draft().pendingAction)).onClick((): void => { this.submit(this.draft().pendingAction ?? 'answer'); })
        }
        if (!this.draft().pendingAction) {
          Flex({ wrap: FlexWrap.Wrap }) {
            Button($r('app.string.chat_agent_decide')).enabled(!this.disabled()).onClick((): void => { this.submit('agent_decide'); })
            Button($r('app.string.clarify_cancel')).enabled(!this.disabled()).onClick((): void => { this.submit('cancel'); })
          }
        }
        if (this.expired()) { Text($r('app.string.clarify_expired')).fontSize(12).fontColor(this.colors.secondary) }
        if (this.submitting) { Text($r('app.string.clarify_submitting')).fontSize(12).fontColor(this.colors.secondary) }
        if (this.errorMessage) { Text(this.errorMessage).fontSize(12).fontColor(this.colors.danger).width('100%') }
      }.padding(12).width('100%')
    }.constraintSize({ maxHeight: 420 }).width('100%').borderRadius(16).backgroundColor(this.colors.grouped)
  }
}
