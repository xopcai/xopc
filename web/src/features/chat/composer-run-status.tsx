import { CircleDot } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';

import { useComposerProgress } from '@/features/chat/composer-progress-context';
import type { ProgressState } from '@/features/chat/messages.types';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

function runStatusLabel(
  progress: ProgressState | null,
  sending: boolean,
  streaming: boolean,
  chat: ReturnType<typeof messages>['chat'],
): string {
  if (sending && !streaming) return chat.composerRunStatusSending;
  if (progress?.message) return progress.message;
  if (progress?.toolName) return interpolate(chat.composerRunningTool, { name: progress.toolName });
  const stage = progress?.stage ?? '';
  switch (stage) {
    case 'thinking':
      return chat.composerStageThinking;
    case 'searching':
      return chat.composerStageSearching;
    case 'reading':
      return chat.composerStageReading;
    case 'writing':
      return chat.composerStageWriting;
    case 'executing':
      return chat.composerStageExecuting;
    case 'analyzing':
      return chat.composerStageAnalyzing;
    default:
      return chat.composerRunStatusDefault;
  }
}

function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function useRunElapsedMs(active: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!active) {
      setMs(0);
      return;
    }
    const t0 = Date.now();
    const id = window.setInterval(() => setMs(Date.now() - t0), 100);
    return () => window.clearInterval(id);
  }, [active]);
  return ms;
}

type DisplaySnap = { text: string; detail?: string };

/**
 * Run status row: subscribes to `ComposerProgressContext` so `ChatComposer` can stay memoized
 * when only `progress` changes. Coalesces label + tooltip updates to one `setState` per animation frame.
 */
export const ComposerRunStatus = memo(function ComposerRunStatus({
  sending,
  streaming,
}: {
  sending: boolean;
  streaming: boolean;
}) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const progress = useComposerProgress();

  const busy = sending || streaming;
  const elapsedMs = useRunElapsedMs(busy);

  const latestRef = useRef({ progress, sending, streaming, chat: m.chat });
  latestRef.current = { progress, sending, streaming, chat: m.chat };

  const [display, setDisplay] = useState<DisplaySnap>(() => ({
    text: runStatusLabel(progress, sending, streaming, m.chat),
    detail: progress?.detail,
  }));

  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const L = latestRef.current;
      setDisplay({
        text: runStatusLabel(L.progress, L.sending, L.streaming, L.chat),
        detail: L.progress?.detail,
      });
    });
  }, [progress, sending, streaming, language]);

  useEffect(
    () => () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [],
  );

  if (!busy) return null;

  return (
    <div
      className="flex min-h-9 w-full min-w-0 items-center justify-between gap-3 border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs dark:border-blue-900/40 dark:bg-blue-950/50"
      title={display.detail}
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <CircleDot className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />
        <span className="min-w-0 truncate font-medium text-blue-600 dark:text-blue-400">{display.text}</span>
      </div>
      <span className="shrink-0 tabular-nums text-blue-600/90 dark:text-blue-400/90">{formatElapsed(elapsedMs)}</span>
    </div>
  );
});
