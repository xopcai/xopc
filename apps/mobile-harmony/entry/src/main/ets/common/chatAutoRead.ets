import { XopcChatRow } from '../model/chat';
import { chatAnswerText } from './chatRichContent';
import { chatSpeakableText } from './speechText';

export interface XopcChatSpeechReply { id: string; text: string; }

export function chatSpeechReplies(rows: XopcChatRow[], runId: string): XopcChatSpeechReply[] {
  const replies: XopcChatSpeechReply[] = [];
  for (const row of rows) {
    if (row.role !== 'assistant' || row.live || (runId && row.turnId === runId)
      || row.media?.some((file): boolean => file.mimeType.startsWith('audio/'))) continue;
    const text = chatSpeakableText(chatAnswerText(row));
    if (text) replies.push({ id: row.id, text });
  }
  return replies;
}
