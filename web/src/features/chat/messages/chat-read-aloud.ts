import { useLayoutEffect, useRef } from 'react';

import { buildSpeakableText, detectSpeechLanguage } from '@/features/voice/read-aloud-text';
import { bindChatReadAloud, type ReadAloudInput } from '@/features/voice/read-aloud-store';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { assistantAnswerContent } from './assistant-turn-content';
import { assistantVisibleMessage } from './assistant-visible-message';
import type { Message } from './messages.types';
import { usesConversationText } from './personal-text-surface';
import { messageRowKey } from './thinking-blocks';

const speechText = new WeakMap<Message, { personal: boolean; text: string }>();

function getSpeechText(message: Message, personal: boolean): string {
  const cached = speechText.get(message);
  if (cached?.personal === personal) return cached.text;
  const visible = assistantVisibleMessage(message, { hideSilentReply: usesConversationText(message, personal), streaming: false });
  const text = buildSpeakableText(assistantAnswerContent(visible.content ?? [])
    .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n'));
  speechText.set(message, { personal, text });
  return text;
}

export function chatReadAloudInput(message: Message, index: number, conversationId: string | null | undefined,
  language: 'zh' | 'en', fallbackTitle: string, personal: boolean): ReadAloudInput | undefined {
  if (message.role !== 'assistant' || message.pendingResponseStatus
    || message.attachments?.some(attachment => attachment.mimeType?.startsWith('audio/'))) return;
  const text = getSpeechText(message, personal);
  if (!text) return;
  const key = message.turnId && !message.beforeSteer && !message.startsNewBubble
    ? `turn:${message.turnId}`
    : `row:${message.renderKey ?? message.transcriptEntryId ?? messageRowKey(message, index)}`;
  return {
    source: {
      type: 'chat-message',
      id: `${conversationId ?? 'chat'}:${key}`,
      conversationId: conversationId ?? undefined,
      title: text.split('\n')[0]?.slice(0, 48) || fallbackTitle,
      href: conversationId ? `#/chat/${encodeURIComponent(conversationId)}` : undefined,
      targetId: `chat-message-${index}`,
    },
    text,
    language: detectSpeechLanguage(text, language),
  };
}

export function useChatReadAloud(conversationId: string | null | undefined, list: Message[], running: boolean, personal = false) {
  const language = useLocaleStore(state => state.language);
  const fallbackTitle = messages(language).chat.messageReadAloudTitle;
  const readAloud = useRef<ReturnType<typeof bindChatReadAloud>>(null);
  useLayoutEffect(() => {
    if (!conversationId) return;
    const binding = bindChatReadAloud(conversationId);
    readAloud.current = binding;
    return () => {
      readAloud.current = null;
      binding.dispose();
    };
  }, [conversationId]);
  useLayoutEffect(() => {
    if (!readAloud.current) return;
    const lastCommittedIndex = running ? list.findLastIndex(message => !message.pendingSteer) : -1;
    readAloud.current.update(list.flatMap((message, index) => {
      if (index === lastCommittedIndex) return [];
      const input = chatReadAloudInput(message, index, conversationId, language, fallbackTitle, personal);
      return input ? [input] : [];
    }));
  }, [conversationId, fallbackTitle, language, list, personal, running]);
}
