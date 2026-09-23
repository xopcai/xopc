import { XopcChatPromptViewModel } from '../viewmodel/chatPromptViewModel';

@ComponentV2
export struct XopcChatPrompt {
  @Param model: XopcChatPromptViewModel = new XopcChatPromptViewModel();
  @Local answer: string = '';
  @Monitor('model.prompt.id')
  onQuestionChange(): void { this.answer = ''; }
  build() {
    Column({ space: 8 }) {
      if (this.model.prompt) {
        Text(this.model.prompt.question).fontSize(15).fontWeight(FontWeight.Medium).fontColor($r('app.color.foreground')).width('100%')
        if (this.model.prompt.suggestedAnswer) { Text(this.model.prompt.suggestedAnswer).fontSize(12).fontColor($r('app.color.secondary')).width('100%') }
        Scroll() {
          Column({ space: 4 }) {
            ForEach(this.model.prompt.choices || [], (choice: string) => {
              Button(choice).height(44).width('100%').enabled(!this.model.busy)
                .backgroundColor($r('app.color.grouped')).fontColor($r('app.color.foreground'))
                .onClick((): void => { this.model.respond('answer', choice); })
            }, (choice: string): string => choice)
          }.width('100%')
        }.constraintSize({ maxHeight: 144 }).width('100%')
        Row({ space: 8 }) {
          TextInput({ text: this.answer, placeholder: $r('app.string.message_hint') }).layoutWeight(1).enabled(!this.model.busy)
            .onChange((value: string): void => { this.answer = value; })
          Button($r('app.string.send')).enabled(!this.model.busy && !!this.answer.trim()).onClick((): void => { this.model.respond('answer', this.answer.trim()); })
        }
        Row({ space: 8 }) {
          Button($r('app.string.chat_agent_decide')).height(44).enabled(!this.model.busy).onClick((): void => { this.model.respond('agent_decide'); })
          Button($r('app.string.cancel')).height(44).enabled(!this.model.busy).onClick((): void => { this.model.respond('cancel'); })
        }
        if (this.model.error) { Text(this.model.error).fontSize(12).fontColor($r('app.color.danger')) }
      }
    }.padding(12).width('92%').borderRadius(16).backgroundColor($r('app.color.grouped')).margin({ bottom: 8 })
  }
}
