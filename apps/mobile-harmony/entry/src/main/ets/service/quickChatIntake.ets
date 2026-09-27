import { XopcChatAttachment } from '../model/chat';

export interface XopcQuickChatSubmission {
  conversationId: string;
  text: string;
  files: XopcChatAttachment[];
}

@ObservedV2
export class XopcQuickChatIntake {
  @Trace revision: number = 0;
  private pending: XopcQuickChatSubmission[] = [];

  enqueue(conversationId: string, text: string, files: XopcChatAttachment[]): void {
    this.pending.push({ conversationId, text, files: files.slice() }); this.revision++;
  }
  consume(conversationId: string): XopcQuickChatSubmission | undefined {
    const index = this.pending.findIndex((item: XopcQuickChatSubmission): boolean => item.conversationId === conversationId);
    if (index < 0) return undefined;
    return this.pending.splice(index, 1)[0];
  }
  clear(): void { this.pending = []; this.revision++; }
}

export const quickChatIntake: XopcQuickChatIntake = new XopcQuickChatIntake();
