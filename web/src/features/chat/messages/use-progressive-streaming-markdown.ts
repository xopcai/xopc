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
} from '@/components/markdown/streaming-render-metrics';
import { graphemeCommitBoundary } from '@/features/chat/rendering/markdown/text-segments';

const TERMINAL_DRAIN_MS = 240;

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
  const terminalDrainRef = useRef<{ startedAt: number; fromLength: number } | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

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
    const complete = () => {
      if (hasStreamedRef.current && !completedRef.current) {
        completedRef.current = true;
        hasStreamedRef.current = false;
        onCompleteRef.current?.();
      }
    };
    if (streaming) {
      terminalDrainRef.current = null;
      hasStreamedRef.current = true;
      completedRef.current = false;
      recordStreamingDelta(metricsKey, content.length);
    }
    const immediate = replacing || !content.startsWith(visibleContentRef.current)
      || document.visibilityState === 'hidden'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (immediate || (!streaming && (!hasStreamedRef.current || content === visibleContentRef.current))) {
      terminalDrainRef.current = null;
      showImmediately();
      if (!streaming) complete();
      return;
    }
    if (!streaming && !terminalDrainRef.current) {
      cancel();
      terminalDrainRef.current = { startedAt: performance.now(), fromLength: visibleContentRef.current.length };
    }
    if (streaming && immediateFirstCommit && visibleContentRef.current.length === 0) {
      recordStreamingCommit(metricsKey, content.length);
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
          const drain = terminalDrainRef.current;
          const terminalLength = drain ? graphemeCommitBoundary(pending, Math.min(pending.length,
            drain.fromLength + Math.ceil((pending.length - drain.fromLength)
              * Math.min(1, (performance.now() - drain.startedAt) / TERMINAL_DRAIN_MS)))) : null;
          const length = document.visibilityState === 'hidden' ? pending.length
            : terminalLength ?? pacer.nextLength(visibleContentRef.current.length, pending, performance.now());
          const next = pending.slice(0, length);
          if (next !== visibleContentRef.current) {
            visibleContentRef.current = next;
            recordStreamingCommit(metricsKey, next.length);
            setVisibleContent(next);
          }
          // Keep draining even when fractional progress has not produced a character yet.
          if (next !== pending) schedule();
          else if (drain) {
            terminalDrainRef.current = null;
            complete();
          }
        };
        if (document.visibilityState === 'hidden') commit();
        else frameRef.current = window.requestAnimationFrame(commit);
      }, intervalRef.current);
    };
    schedule();
  }, [content, metricsKey, streaming, immediateFirstCommit, pacer]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    timerRef.current = null;
    frameRef.current = null;
  }, []);

  // History and replacement snapshots are immediate; a live response keeps its paced tail.
  if (!content.startsWith(visibleContent) || (!streaming && !hasStreamedRef.current)) return content;
  return streaming && immediateFirstCommit && !visibleContent ? content : visibleContent;
}
