import { XopcContextRef } from '../model/chat';

export interface XopcChatDraftHandoff {
  conversationId: string;
  text: string;
  refs: XopcContextRef[];
}

@ObservedV2
export class XopcChatDraftIntake {
  @Trace revision: number = 0;
  private pending: XopcChatDraftHandoff[] = [];

  stage(conversationId: string, text: string, refs: XopcContextRef[]): void {
    this.pending.push({ conversationId, text, refs: refs.slice() }); this.revision++;
  }
  consume(conversationId: string): XopcChatDraftHandoff | undefined {
    const index = this.pending.findIndex((item: XopcChatDraftHandoff): boolean => item.conversationId === conversationId);
    if (index < 0) return undefined;
    return this.pending.splice(index, 1)[0];
  }
  clear(): void { this.pending = []; this.revision++; }
}

export const chatDraftIntake: XopcChatDraftIntake = new XopcChatDraftIntake();
