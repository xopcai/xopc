import { useEffect, useRef, useState } from 'react';

import {
  AdaptiveStreamingMarkdownPacer,
  classifyStreamingMarkdownTail,
  streamingMarkdownCommitIntervalMs,
} from '@/components/markdown/streaming-markdown-scheduler';
import {
  getLatestStreamingParseMs,
  recordStreamingCommit,
  recordStreamingDelta,
  recordStreamingTerminalFlush,
} from '@/components/markdown/streaming-render-metrics';

export function useProgressiveStreamingMarkdown(
  content: string,
  streaming: boolean,
  metricsKey: string,
  animateInitialContent = false,
  onComplete?: () => void,
  immediateFirstCommit = false,
): string {
  // Opening an existing response shows its snapshot immediately; only later additions are paced.
  const [visibleContent, setVisibleContent] = useState(() => content);
  const [pacer] = useState(() => new AdaptiveStreamingMarkdownPacer(content.length));
  const pendingContentRef = useRef(content);
  const visibleContentRef = useRef(visibleContent);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const intervalRef = useRef(50);
  const hasStreamedRef = useRef(streaming || animateInitialContent);
  const completedRef = useRef(false);

  useEffect(() => {
    const replacing = !content.startsWith(pendingContentRef.current);
    pendingContentRef.current = content;
    const cancel = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      timerRef.current = null;
      frameRef.current = null;
    };
    const showImmediately = () => {
      cancel();
      pacer.reset(content.length);
      visibleContentRef.current = content;
      setVisibleContent(content);
    };
    if (streaming) {
      hasStreamedRef.current = true;
      completedRef.current = false;
      recordStreamingDelta(metricsKey, content.length);
    }
    if (!streaming) {
      if (hasStreamedRef.current && visibleContentRef.current !== content) {
        recordStreamingTerminalFlush(metricsKey, content.length - visibleContentRef.current.length);
      }
      showImmediately();
      if (hasStreamedRef.current && !completedRef.current) {
        completedRef.current = true;
        hasStreamedRef.current = false;
        onComplete?.();
      }
      return;
    }
    if (replacing || !content.startsWith(visibleContentRef.current)
      || (immediateFirstCommit && visibleContentRef.current.length === 0)
      || document.visibilityState === 'hidden'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      if (content !== visibleContentRef.current) recordStreamingCommit(metricsKey, content.length);
      showImmediately();
      return;
    }
    pacer.observe(content.length, performance.now());
    intervalRef.current = streamingMarkdownCommitIntervalMs({
      tailKind: classifyStreamingMarkdownTail(content.slice(-8_192)),
      latestParseMs: getLatestStreamingParseMs(metricsKey),
    });
    if (content === visibleContentRef.current || timerRef.current !== null || frameRef.current !== null) return;

    const schedule = () => {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const commit = () => {
          frameRef.current = null;
          const pending = pendingContentRef.current;
          const length = document.visibilityState === 'hidden' ? pending.length
            : pacer.nextLength(visibleContentRef.current.length, pending, performance.now());
          const next = pending.slice(0, length);
          if (next !== visibleContentRef.current) {
            visibleContentRef.current = next;
            recordStreamingCommit(metricsKey, next.length);
            setVisibleContent(next);
          }
          // Keep draining even when fractional progress has not produced a character yet.
          if (next !== pending) schedule();
        };
        if (document.visibilityState === 'hidden') commit();
        else frameRef.current = window.requestAnimationFrame(commit);
      }, intervalRef.current);
    };
    schedule();
  }, [content, metricsKey, onComplete, streaming, immediateFirstCommit, pacer]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    timerRef.current = null;
    frameRef.current = null;
  }, []);

  // First text and terminal text must be visible before layout effects see the message shell.
  return !streaming || (immediateFirstCommit && !visibleContent) ? content : visibleContent;
}
