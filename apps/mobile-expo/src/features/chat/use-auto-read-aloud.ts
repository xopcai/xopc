import { useEffect, useMemo, useRef } from 'react';

import type { Language } from '../../stores/preferences-store';
import { buildSpeakableText, detectSpeechLanguage } from '../voice/read-aloud-text';
import { useReadAloudStore, type ReadAloudInput } from '../voice/read-aloud-store';

import { getAssistantFinalResultText } from './assistant-text-presentation';
import type { Message } from './messages.types';

export const AUTO_READ_ALOUD_SOURCE_PREFIX = 'auto-read-aloud:';

export type AutoReadAloudCandidate = {
  key: string;
  input: ReadAloudInput | null;
};

export type AutoReadAloudTracker = {
  sessionKey: string;
  enabled: boolean;
  wasStreaming: boolean;
  lastSeenKey: string | null;
};

function shortTextHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function findLatestAutoReadAloudCandidate({
  messages,
  sessionKey,
  language,
  title,
}: {
  messages: Message[];
  sessionKey: string;
  language: Language;
  title: string;
}): AutoReadAloudCandidate | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;

    const text = buildSpeakableText(getAssistantFinalResultText(message.content));
    const identity = message.id
      ?? message.timestamp?.toString()
      ?? `${index}-${shortTextHash(text)}`;
    const key = `${sessionKey}:${identity}`;
    const hasAudio = message.content.some((block) => block.type === 'audio');
    return {
      key,
      input: text && !hasAudio
        ? {
            source: {
              id: `${AUTO_READ_ALOUD_SOURCE_PREFIX}${key}`,
              sessionKey,
              title,
              preview: text,
            },
            text,
            language: detectSpeechLanguage(text, language),
          }
        : null,
    };
  }
  return null;
}

export function advanceAutoReadAloud(
  previous: AutoReadAloudTracker | undefined,
  current: {
    sessionKey: string;
    enabled: boolean;
    streaming: boolean;
    candidate: AutoReadAloudCandidate | null;
  },
): { tracker: AutoReadAloudTracker; input: ReadAloudInput | null } {
  const { sessionKey, enabled, streaming, candidate } = current;
  if (!previous || previous.sessionKey !== sessionKey) {
    return {
      tracker: {
        sessionKey,
        enabled,
        wasStreaming: streaming,
        lastSeenKey: streaming ? null : (candidate?.key ?? null),
      },
      input: null,
    };
  }

  if (!enabled) {
    return {
      tracker: {
        sessionKey,
        enabled,
        wasStreaming: streaming,
        lastSeenKey: streaming ? previous.lastSeenKey : (candidate?.key ?? previous.lastSeenKey),
      },
      input: null,
    };
  }

  if (!previous.enabled) {
    return {
      tracker: {
        sessionKey,
        enabled,
        wasStreaming: streaming,
        lastSeenKey: streaming ? previous.lastSeenKey : (candidate?.key ?? previous.lastSeenKey),
      },
      input: null,
    };
  }

  const completedNewReply = previous.wasStreaming
    && !streaming
    && candidate
    && candidate.key !== previous.lastSeenKey;
  return {
    tracker: {
      sessionKey,
      enabled,
      wasStreaming: streaming,
      lastSeenKey: completedNewReply ? candidate.key : previous.lastSeenKey,
    },
    input: completedNewReply ? candidate.input : null,
  };
}

export function useAutoReadAloud({
  language,
  messages,
  sessionKey,
  streaming,
  title,
}: {
  language: Language;
  messages: Message[];
  sessionKey: string;
  streaming: boolean;
  title: string;
}): void {
  const trackerRef = useRef<AutoReadAloudTracker | undefined>(undefined);
  const enabled = useReadAloudStore((state) => state.continuousSessionKey === sessionKey);
  const requestStart = useReadAloudStore((state) => state.requestStart);
  const activeSourceId = useReadAloudStore((state) => state.source?.id);
  const stop = useReadAloudStore((state) => state.stop);
  const candidate = useMemo(
    () => findLatestAutoReadAloudCandidate({ messages, sessionKey, language, title }),
    [language, messages, sessionKey, title],
  );

  useEffect(() => {
    const next = advanceAutoReadAloud(trackerRef.current, {
      sessionKey,
      enabled,
      streaming,
      candidate,
    });
    trackerRef.current = next.tracker;
    if (next.input) requestStart(next.input);
  }, [candidate, enabled, requestStart, sessionKey, streaming]);

  useEffect(() => {
    if (!enabled && activeSourceId?.startsWith(AUTO_READ_ALOUD_SOURCE_PREFIX)) stop();
  }, [activeSourceId, enabled, stop]);
}
