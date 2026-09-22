import { XopcChatRow } from '../model/chat';
import { chatAnswerText } from './chatRichContent';
import { chatSpeakableText } from './speechText';

export interface XopcAutoReadCandidate { key: string; text: string; }
export interface XopcAutoReadState { conversationId: string; enabled: boolean; wasStreaming: boolean; lastSeenKey: string; }
export interface XopcAutoReadResult { state: XopcAutoReadState; candidate?: XopcAutoReadCandidate; }

export function latestChatAutoRead(rows: XopcChatRow[], conversationId: string): XopcAutoReadCandidate | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]; if (row.role !== 'assistant') continue;
    return { key: conversationId + ':' + row.id, text: row.media?.some((file): boolean => file.mimeType.startsWith('audio/')) ? '' : chatSpeakableText(chatAnswerText(row)) };
  }
  return undefined;
}

// Same completion-edge contract as Expo use-auto-read-aloud: never replay a history load.
export function advanceChatAutoRead(previous: XopcAutoReadState | undefined, conversationId: string, enabled: boolean,
  streaming: boolean, candidate?: XopcAutoReadCandidate): XopcAutoReadResult {
  if (!previous || previous.conversationId !== conversationId) {
    return { state: { conversationId, enabled, wasStreaming: streaming, lastSeenKey: streaming ? '' : candidate?.key || '' } };
  }
  if (!enabled || !previous.enabled) {
    return { state: { conversationId, enabled, wasStreaming: streaming, lastSeenKey: streaming ? previous.lastSeenKey : candidate?.key || previous.lastSeenKey } };
  }
  const awaiting = previous.wasStreaming || streaming;
  const completed = awaiting && !streaming && !!candidate && candidate.key !== previous.lastSeenKey;
  return { state: { conversationId, enabled, wasStreaming: completed ? false : awaiting, lastSeenKey: completed ? candidate!.key : previous.lastSeenKey },
    candidate: completed && candidate?.text ? candidate : undefined };
}
