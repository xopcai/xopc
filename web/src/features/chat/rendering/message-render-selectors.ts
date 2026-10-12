import type { Message, MessageContent } from '@/features/chat/messages/messages.types';
import { mergeConsecutiveAssistantMessages } from '@/features/chat/messages/agent-messages';
import type { ChatSessionSlice } from '@/features/chat/session/chat-session-store';
import { knownPartRenderKey } from './part-identity';

const rowIndexes = new WeakMap<Message[], Map<string, Message>>();
const mergedTails = new WeakMap<Message, { previous: Message; row: Message }>();
const partIndexes = new WeakMap<Message, Map<string, MessageContent>>();
const committedPartIndexes = new WeakMap<Message[], Map<string, MessageContent>>();

export function selectContentPart(slice: ChatSessionSlice | undefined, partId: string): MessageContent | undefined {
  if (!slice) return undefined;
  const indexFor = (message: Message) => {
    let index = partIndexes.get(message);
    if (!index) {
      index = new Map(message.content.flatMap(part => {
        const key = knownPartRenderKey(part);
        return key ? [[key, part] as const] : [];
      }));
      partIndexes.set(message, index);
    }
    return index;
  };
  const live = slice.streamingMsg && indexFor(slice.streamingMsg).get(partId);
  if (live) return live;
  let committed = committedPartIndexes.get(slice.messages);
  if (!committed) {
    committed = new Map();
    for (const message of slice.messages) for (const [key, part] of indexFor(message)) committed.set(key, part);
    committedPartIndexes.set(slice.messages, committed);
  }
  return committed.get(partId);
}

function sameMessageShell(a: Message | null, b: Message | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.content.length !== b.content.length) return false;
  if (!a.content.every((part, i) => {
    const next = b.content[i];
    return part === next || (part.type === 'text' && next.type === 'text'
      && knownPartRenderKey(part) === knownPartRenderKey(next)
      && part.segmentId === next.segmentId && part.presentation === next.presentation
      && Boolean(part.text.trim()) === Boolean(next.text.trim())
      && (part.text === next.text || ![part.text, next.text].some(text => {
        const value = text.trimStart();
        return value.startsWith('NO_REPLY') || (value.length > 0 && 'NO_REPLY'.startsWith(value));
      })));
  })) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Message)[]);
  return [...keys].every(key => key === 'content' || a[key] === b[key]);
}

export function createMessageShellSelector() {
  let previous: Message | undefined;
  return (next: Message | undefined) => {
    if (!sameMessageShell(previous ?? null, next ?? null)) previous = next;
    return previous;
  };
}

/** Index committed rows once; live text changes neither the list nor this index. */
export function selectMessageRow(slice: ChatSessionSlice | undefined, rowId: string): Message | undefined {
  if (!slice) return undefined;
  const live = slice.streamingMsg;
  if (live?.renderKey === rowId) {
    const previous = slice.messages.at(-1);
    if (previous?.role !== 'assistant') return live;
    const cached = mergedTails.get(live);
    if (cached?.previous === previous) return cached.row;
    const rows = mergeConsecutiveAssistantMessages([previous, live]);
    const row = rows.at(-1)!;
    mergedTails.set(live, { previous, row });
    return row;
  }
  let index = rowIndexes.get(slice.messages);
  if (!index) {
    index = new Map(slice.messages.filter(row => row.renderKey).map(row => [row.renderKey!, row]));
    rowIndexes.set(slice.messages, index);
  }
  return index.get(rowId);
}

/** Page chrome subscribes to metadata/structure; row readers own live content. */
export function createSessionShellSelector() {
  let previous: ChatSessionSlice | undefined;
  return (next: ChatSessionSlice | undefined): ChatSessionSlice | undefined => {
    if (!next || !previous) { previous = next; return next; }
    const sameLiveIdentity = sameMessageShell(previous.streamingMsg, next.streamingMsg);
    const unchanged = sameLiveIdentity && (Object.keys(next) as (keyof ChatSessionSlice)[])
      .every(key => key === 'streamingMsg' || previous![key] === next[key]);
    if (unchanged) return previous;
    previous = sameLiveIdentity ? { ...next, streamingMsg: previous.streamingMsg } : next;
    return previous;
  };
}
