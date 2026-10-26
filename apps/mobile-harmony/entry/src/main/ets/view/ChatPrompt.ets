import { XopcChatPromptViewModel } from '../viewmodel/chatPromptViewModel';
import { XopcClarificationCard } from './ClarificationCard';
import { XopcClarificationCommand } from '../model/clarification';

@ComponentV2
export struct XopcChatPrompt {
  @Param model: XopcChatPromptViewModel = new XopcChatPromptViewModel();
  build() {
    Column() {
      if (this.model.prompt) {
        XopcClarificationCard({ prompt: this.model.prompt, draftRecord: this.model.draftRecord,
          onDraft: (record: string): void => { this.model.updateDraft(record); }, submitting: this.model.busy, errorMessage: this.model.error,
          onRespond: (command: XopcClarificationCommand): void => { this.model.respond(command); } })
      }
    }.width('92%').margin({ bottom: 8 })
  }
}
