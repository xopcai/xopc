import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';

import type { Config } from '../../config/schema.js';
import { extractProfileAgentId } from '../../config/agent-profile.js';
import {
  isImageInboundAttachment,
  type MediaRef,
} from '../../channels/attachments/inbound-persist.js';
import { readMediaReferenceBase64 } from '../../media/media-reference.js';
import { expandAtFileMentionsInPlainText } from '../context/expand-at-file-mentions.js';
import { readAgentMessageContent } from '../memory/agent-message-access.js';
import { resolveInboundImageContentParts } from '../image/inbound-image-handling.js';
import { resolveImageHandlingStrategy } from '../image/vision-detection.js';
import type { AgentInstanceGateway } from '../agent-instance-gateway.js';

export type TranscriptUserMessage = AgentMessage & {
  media?: MediaRef[];
  MediaPath?: string;
  MediaPaths?: string[];
  MediaTypes?: string[];
};

export type LlmUserTurn = {
  text: string;
  images: ImageContent[];
};

const VISION_INLINE_MAX_BYTES = 2 * 1024 * 1024;

function textBlocksFromContent(content: unknown): string[] {
  if (typeof content === 'string') {
    return content.trim() ? [content] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const out: string[] = [];
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
      const t = (block as { text?: string }).text;
      if (typeof t === 'string' && t.trim()) {
        out.push(t);
      }
    }
  }
  return out;
}

function joinTextBlocks(parts: string[]): string {
  return parts.join('\n').trim();
}

function buildMediaPathFields(media: MediaRef[]): Pick<TranscriptUserMessage, 'MediaPath' | 'MediaPaths' | 'MediaTypes'> {
  if (!media.length) return {};
  return {
    MediaPath: media[0]!.path,
    MediaPaths: media.map((m) => m.path),
    MediaTypes: media.map((m) => m.mimeType),
  };
}

function assertUserContentHasNoInlineMedia(content: unknown): void {
  if (!Array.isArray(content)) {
    return;
  }
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const type = (block as { type?: string }).type;
    if (type === 'image') {
      throw new Error('User transcript content must not contain image blocks');
    }
  }
}

export function assertTranscriptUserMessage(message: AgentMessage): void {
  if ((message as { role?: string }).role !== 'user') {
    return;
  }
  assertUserContentHasNoInlineMedia((message as { content?: unknown }).content);
  const media = (message as TranscriptUserMessage).media;
  if (!media?.length) {
    return;
  }
  for (const ref of media) {
    if (!ref.uri?.trim()) {
      throw new Error('User transcript media ref missing uri');
    }
    if ('data' in ref && typeof (ref as { data?: unknown }).data === 'string') {
      throw new Error('User transcript media ref must not include data');
    }
  }
}

async function readImageBase64FromRef(ref: MediaRef): Promise<{ data: string; mimeType: string }> {
  const loaded = await readMediaReferenceBase64(ref.uri, VISION_INLINE_MAX_BYTES);
  return {
    data: loaded.data,
    mimeType: ref.mimeType || loaded.mimeType,
  };
}

function appendMediaAttachedLines(textParts: string[], media: MediaRef[]): void {
  for (const ref of media) {
    if (!isImageInboundAttachment(ref)) {
      textParts.push(
        [
          `[media attached: ${ref.name} (${ref.mimeType}, ${ref.size} bytes)]`,
          `xopc-media-uri:${ref.uri}`,
          `xopc-media-path:${ref.path}`,
          'Use the read_media tool with the xopc-media-uri value when you need to inspect this attachment.',
        ].join('\n'),
      );
    }
  }
}

async function expandUserText(
  text: string,
  sessionKey: string,
  agentManager: AgentInstanceGateway,
): Promise<string> {
  if (!text.trim()) {
    return '';
  }
  let out = text;
  if (/@file:/.test(out)) {
    const wsKey = sessionKey || 'agent:main:main';
    const root = agentManager.getResolvedWorkspaceForSession(wsKey);
    out = await expandAtFileMentionsInPlainText(out, root);
  }
  return out.trim();
}

/**
 * Build the transcript row for a user turn (text + media metadata only).
 */
export async function buildTranscriptUserMessage(opts: {
  text: string;
  prepared: MediaRef[] | undefined;
  sessionKey: string;
  modelRef: string;
  config: Config | undefined;
  agentManager: AgentInstanceGateway;
}): Promise<TranscriptUserMessage> {
  const expandedText = await expandUserText(opts.text, opts.sessionKey, opts.agentManager);
  const prepared = opts.prepared ?? [];
  const imageRefs = prepared.filter(isImageInboundAttachment);

  const textParts: string[] = [];
  if (expandedText) {
    textParts.push(expandedText);
  }

  const strategy = resolveImageHandlingStrategy(opts.modelRef);

  appendMediaAttachedLines(textParts, prepared.filter((m) => !isImageInboundAttachment(m)));

  if (imageRefs.length > 0 && strategy !== 'native') {
    const images = await Promise.all(imageRefs.map((ref) => readImageBase64FromRef(ref)));
    const agentId = opts.config ? extractProfileAgentId(opts.sessionKey, opts.config) : undefined;
    const parts = await resolveInboundImageContentParts({
      modelRef: opts.modelRef,
      cfg: opts.config,
      agentId,
      userTextForContext: expandedText,
      images,
    });
    for (const part of parts) {
      if (part.type === 'text' && part.text.trim()) {
        textParts.push(part.text.trim());
      }
    }
  }

  if (textParts.length === 0 && prepared.length > 0) {
    textParts.push('Please analyze the attachment(s) I sent.');
  }

  const content = joinTextBlocks(textParts);
  const message: TranscriptUserMessage = {
    role: 'user',
    content,
    timestamp: Date.now(),
    ...(prepared.length > 0 ? { media: prepared, ...buildMediaPathFields(prepared) } : {}),
  };
  assertTranscriptUserMessage(message);
  return message;
}

/** Hydrate images from media store for the current LLM prompt. */
export async function hydrateUserTurnForLlm(opts: {
  message: TranscriptUserMessage;
  modelRef: string;
}): Promise<LlmUserTurn> {
  const text = joinTextBlocks(textBlocksFromContent(readAgentMessageContent(opts.message)));
  const media = opts.message.media ?? [];
  const images: ImageContent[] = [];

  if (resolveImageHandlingStrategy(opts.modelRef) === 'native') {
    for (const ref of media.filter(isImageInboundAttachment)) {
      const loaded = await readImageBase64FromRef(ref);
      images.push({ type: 'image', data: loaded.data, mimeType: loaded.mimeType });
    }
  }

  return { text, images };
}

const pendingTranscriptBySession = new Map<string, TranscriptUserMessage>();

function messageTextForPendingCompare(message: AgentMessage): string {
  return joinTextBlocks(textBlocksFromContent(readAgentMessageContent(message)));
}

function pendingMatchesMessage(pending: TranscriptUserMessage, message: AgentMessage): boolean {
  const pendingText = messageTextForPendingCompare(pending);
  const actualText = messageTextForPendingCompare(message);
  if (!pendingText) {
    return true;
  }
  if (!actualText) {
    return false;
  }
  return actualText.includes(pendingText) || pendingText.includes(actualText);
}

export function setPendingTranscriptUserMessage(sessionKey: string, message: TranscriptUserMessage): void {
  assertTranscriptUserMessage(message);
  pendingTranscriptBySession.set(sessionKey, message);
}

export function takePendingTranscriptUserMessage(sessionKey: string): TranscriptUserMessage | undefined {
  const msg = pendingTranscriptBySession.get(sessionKey);
  pendingTranscriptBySession.delete(sessionKey);
  return msg;
}

export function clearPendingTranscriptUserMessage(sessionKey: string, message?: TranscriptUserMessage): void {
  const existing = pendingTranscriptBySession.get(sessionKey);
  if (!existing) {
    return;
  }
  if (message && existing !== message) {
    return;
  }
  pendingTranscriptBySession.delete(sessionKey);
}

export function pendingTranscriptReferencesMediaUri(sessionKey: string, uri: string): boolean {
  const pending = pendingTranscriptBySession.get(sessionKey);
  return pending?.media?.some((ref) => ref.uri === uri.trim()) === true;
}

export function transformUserMessageForPersistence(
  sessionKey: string | undefined,
  message: AgentMessage,
): AgentMessage {
  if ((message as { role?: string }).role !== 'user') {
    return message;
  }
  if (sessionKey) {
    const pending = pendingTranscriptBySession.get(sessionKey);
    if (pending && pendingMatchesMessage(pending, message)) {
      pendingTranscriptBySession.delete(sessionKey);
      return pending;
    }
  }
  assertTranscriptUserMessage(message);
  return message;
}
