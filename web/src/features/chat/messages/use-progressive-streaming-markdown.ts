import { useEffect, useRef, useState } from 'react';

import {
  classifyStreamingMarkdownTail,
  nextStreamingMarkdownCommitLength,
  streamingMarkdownCommitDelayMs,
  streamingMarkdownCommitIntervalMs,
} from '@/components/markdown/streaming-markdown-scheduler';
import {
  getLatestStreamingParseMs,
  recordStreamingCommit,
  recordStreamingDelta,
} from '@/components/markdown/streaming-render-metrics';

export function useProgressiveStreamingMarkdown(
  content: string,
  streaming: boolean,
  metricsKey: string,
): string {
  const [visibleContent, setVisibleContent] = useState(() => streaming ? '' : content);
  const pendingContentRef = useRef(content);
  const visibleContentRef = useRef(visibleContent);
  const timerRef = useRef<number | null>(null);
  const lastCommitAtRef = useRef<number | null>(null);
  const hasStreamedRef = useRef(streaming);

  useEffect(() => {
    pendingContentRef.current = content;
    if (streaming) {
      hasStreamedRef.current = true;
      recordStreamingDelta(metricsKey, content.length);
    }
    if (!hasStreamedRef.current) {
      visibleContentRef.current = content;
      setVisibleContent(content);
      return;
    }
    if (visibleContent === content) {
      if (!streaming) {
        hasStreamedRef.current = false;
        lastCommitAtRef.current = null;
      }
      return;
    }
    if (!content.startsWith(visibleContent)) {
      visibleContentRef.current = content;
      setVisibleContent(content);
      return;
    }
    if (timerRef.current !== null) return;

    const tail = content.slice(-8_192);
    const intervalMs = streamingMarkdownCommitIntervalMs({
      tailKind: classifyStreamingMarkdownTail(tail),
      latestParseMs: getLatestStreamingParseMs(metricsKey),
    });
    const now = performance.now();
    const lastCommitAt = lastCommitAtRef.current;
    const waitMs = streamingMarkdownCommitDelayMs({
      intervalMs,
      elapsedMs: lastCommitAt === null ? 0 : now - lastCommitAt,
      firstCommit: lastCommitAt === null,
    });
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const pendingContent = pendingContentRef.current;
      const nextLength = nextStreamingMarkdownCommitLength({
        visibleLength: visibleContentRef.current.length,
        pendingContent,
      });
      const nextContent = pendingContent.slice(0, nextLength);
      visibleContentRef.current = nextContent;
      lastCommitAtRef.current = performance.now();
      recordStreamingCommit(metricsKey, nextContent.length);
      setVisibleContent(nextContent);
    }, waitMs);
  }, [content, metricsKey, streaming, visibleContent]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return visibleContent;
}
