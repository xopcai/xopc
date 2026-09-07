import { messageKey } from './message-key';
import type { ComposerContextRef, WireAttachment } from './composer.types';
import type { Message, MessageAttachment, MessageContent, TextContent } from './messages.types';
import { stripRuntimeContextForDisplay, stripUserMessageForDisplay } from './wire-text-scrub';

let optimisticMessageSequence = 0;
const OPTIMISTIC_USER_RECONCILE_WINDOW_MS = 120_000;

function isUserMessage(message: Message): boolean {
  return message.role === 'user' || message.role === 'user-with-attachments';
}

function userMessageDisplayText(message: Message): string {
  return message.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => stripUserMessageForDisplay(block.text))
    .join('\n\n')
    .trim();
}

function userMessageMediaCount(message: Message): number {
  if (message.attachments?.length) return message.attachments.length;
  return message.content.filter((block) => block.type === 'image' || block.type === 'audio').length;
}

function serverMessageReplacesOptimistic(server: Message, optimistic: Message): boolean {
  if (!isUserMessage(server) || !isUserMessage(optimistic)) return false;
  if (optimistic.deliveryState === 'failed' || optimistic.deliveryState === 'sending') return false;

  const serverTimestamp = server.timestamp;
  const optimisticTimestamp = optimistic.timestamp;
  if (
    serverTimestamp == null
    || optimisticTimestamp == null
    || Math.abs(serverTimestamp - optimisticTimestamp) > OPTIMISTIC_USER_RECONCILE_WINDOW_MS
  ) {
    return false;
  }

  const optimisticText = userMessageDisplayText(optimistic);
  const serverText = userMessageDisplayText(server);
  const optimisticMediaCount = userMessageMediaCount(optimistic);
  const serverPreservesMedia = userMessageMediaCount(server) >= optimisticMediaCount;

  if (
    serverPreservesMedia
    && optimisticText
    && serverText
    && (serverText === optimisticText || serverText.startsWith(optimisticText))
  ) {
    return true;
  }

  return optimisticMediaCount > 0 && serverPreservesMedia;
}

/**
 * Append local user rows unless the durable transcript tail already contains them.
 * Only the tail can replace an optimistic row so a genuinely repeated prompt stays visible.
 */
export function mergeOptimisticUserMessages(
  sessionMessages: Message[],
  optimisticMessages: Message[],
): Message[] {
  if (optimisticMessages.length === 0) return sessionMessages;

  const merged = [...sessionMessages];
  for (const optimistic of optimisticMessages) {
    const tail = sessionMessages[sessionMessages.length - 1];
    const userIndex = sessionMessages.findLastIndex(isUserMessage);
    const serverUser = sessionMessages[userIndex];
    // An optimistic prompt created after the answer belongs to the next turn.
    const isLaterTurn = tail?.role === 'assistant'
      && optimistic.timestamp != null && tail.timestamp != null
      && optimistic.timestamp > tail.timestamp;
    if (!isLaterTurn && serverUser && serverMessageReplacesOptimistic(serverUser, optimistic)) {
      const index = merged.indexOf(serverUser);
      if (index >= 0) merged[index] = { ...serverUser, renderKey: messageKey(optimistic, index) };
      continue;
    }
    const nextMessage = optimistic.timestamp == null ? -1 : merged.findIndex(message =>
      message.timestamp != null && message.timestamp > optimistic.timestamp!);
    if (nextMessage < 0) merged.push(optimistic);
    else merged.splice(nextMessage, 0, optimistic);
  }
  return merged;
}

export function extractUserMessageText(content: MessageContent[]): string {
  return content
    .filter((b): b is TextContent => b.type === 'text')
    .map((b) => stripRuntimeContextForDisplay(b.text))
    .join('\n\n')
    .trim();
}

export function messageAttachmentsToWire(attachments?: MessageAttachment[]): WireAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  const wire = attachments
    .map((a) => {
      const type = a.type ?? 'document';
      const isAudio = type === 'voice' || a.mimeType?.startsWith('audio/');
      return {
        type,
        mimeType: a.mimeType,
        data: isAudio ? undefined : a.data ?? a.content,
        uri: a.uri,
        localUri: a.localUri,
        name: a.name,
        size: a.size,
        workspaceRelativePath: a.workspaceRelativePath,
        durationSeconds: a.durationSeconds,
      };
    })
    .filter((a) => Boolean(a.data || a.uri || a.localUri || a.workspaceRelativePath));
  return wire.length ? wire : undefined;
}

export function findPrecedingUserMessage(messages: Message[], fromIndex: number): Message | null {
  for (let i = fromIndex - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user' || msg.role === 'user-with-attachments') return msg;
  }
  return null;
}

export function buildUserResendPayload(message: Message): { text: string; attachments?: WireAttachment[]; contextRefs?: ComposerContextRef[] } | null {
  const hasAudio = message.content.some((b) => b.type === 'audio');
  if (hasAudio) return null;
  const text = extractUserMessageText(message.content);
  const attachments = messageAttachmentsToWire(message.attachments);
  if (!text && !attachments?.length) return null;
  return {
    text,
    attachments,
    contextRefs: message.contextRefs?.map((ref) => ({
      kind: ref.kind,
      sourceId: ref.sourceId,
      expectedVersion: ref.version,
      title: ref.title,
    })),
  };
}

export function isLastAssistantMessage(messages: Message[], index: number): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return i === index;
  }
  return false;
}

export function wireAttachmentsToMessageAttachments(wire: WireAttachment[]): MessageAttachment[] {
  return wire.map((w, index) => ({
    id: `pending-${index}-${Date.now()}`,
    name: w.name,
    type: w.type,
    mimeType: w.mimeType,
    size: w.size,
    content: w.data,
    data: w.data,
    uri: w.uri,
    localUri: w.localUri,
    workspaceRelativePath: w.workspaceRelativePath,
    durationSeconds: w.durationSeconds,
    preview: w.type === 'image' || w.mimeType?.startsWith('image/') ? w.data : undefined,
  }));
}

export function buildUserMessageContent(text: string, wire?: WireAttachment[]): MessageContent[] {
  const blocks: MessageContent[] = [];
  const trimmed = text.trim();
  if (trimmed) {
    blocks.push({ type: 'text', text: trimmed });
  }
  for (const att of wire ?? []) {
    if (att.type === 'voice' || att.mimeType?.startsWith('audio/')) {
      blocks.push({ type: 'audio', uri: att.localUri ?? att.uri,
        workspaceRelativePath: att.workspaceRelativePath, mimeType: att.mimeType,
        name: att.name, durationSeconds: att.durationSeconds });
      continue;
    }
    const isImage = att.type === 'image' || att.mimeType?.startsWith('image/') === true;
    if (!isImage || !att.data) continue;
    const mime = att.mimeType || 'image/png';
    const payload = att.data.replace(/\s/g, '');
    blocks.push({
      type: 'image',
      source: {
        data: payload.startsWith('data:') ? payload : `data:${mime};base64,${payload}`,
        media_type: mime,
      },
    });
  }
  return blocks;
}

export function buildOptimisticUserMessage(text: string, wire?: WireAttachment[], contextRefs?: ComposerContextRef[]): Message {
  const attachments = wire?.length ? wireAttachmentsToMessageAttachments(wire) : undefined;
  const content = buildUserMessageContent(text, wire);
  const hasAttachments = Boolean(attachments?.length);
  const timestamp = Date.now();
  return {
    id: `optimistic-${timestamp}-${++optimisticMessageSequence}`,
    role: hasAttachments ? 'user-with-attachments' : 'user',
    content: content.length ? content : [{ type: 'text', text: text.trim() || '' }],
    attachments,
    contextRefs: contextRefs?.map((ref) => ({
      kind: ref.kind,
      sourceId: ref.sourceId,
      version: ref.expectedVersion,
      title: ref.title,
    })),
    timestamp,
  };
}

export function canSendComposerDraft(text: string, attachmentCount: number, contextRefCount = 0): boolean {
  return text.trim().length > 0 || attachmentCount > 0 || contextRefCount > 0;
}
