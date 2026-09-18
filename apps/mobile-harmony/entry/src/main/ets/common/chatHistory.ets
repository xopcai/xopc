import { XopcMessage } from '../model/chat';

export function chatMessageId(message: XopcMessage): string { return message.id || message.messageId || ''; }

export function dedupeChatHistory(messages: XopcMessage[]): XopcMessage[] {
  const output: XopcMessage[] = []; const indices = new Map<string, number>();
  for (const message of messages) {
    const id = chatMessageId(message); const index = id ? indices.get(id) : undefined;
    if (index !== undefined) output[index] = message;
    else { if (id) indices.set(id, output.length); output.push(message); }
  }
  return output;
}

// A latest-page refresh is authoritative from the first shared row onward.
// No overlap means there may be a gap; never silently stitch disconnected pages.
export function chatHistoryOverlap(previous: XopcMessage[], latest: XopcMessage[]): number {
  const first = latest[0]; const id = first ? chatMessageId(first) : '';
  return id ? previous.findIndex((message: XopcMessage): boolean => chatMessageId(message) === id) : -1;
}
