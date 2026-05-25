import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export type ClarifyPromptState = {
  requestId: string;
  question: string;
  choices?: string[];
  default?: string;
};

/** Must match `CLARIFY_USER_RESPONSE_TIMEOUT_MS` in `src/gateway/clarify-bridge.ts`. */
const CLARIFY_PROMPT_COUNTDOWN_MS = 5 * 60 * 1000;

const CLARIFY_TIMEOUT_MINUTES = Math.round(CLARIFY_PROMPT_COUNTDOWN_MS / 60_000);

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type ClarifyPromptCopy = Pick<
  ChatMessages,
  | 'clarifyRegionAria'
  | 'clarifyResumeHint'
  | 'clarifyServerTimeout'
  | 'clarifyDefaultTimeoutNote'
  | 'clarifySkipNote'
  | 'clarifyChoicesGroupAria'
  | 'clarifyCustomLabel'
  | 'clarifyPlaceholder'
  | 'clarifySend'
  | 'clarifyUseDefault'
  | 'clarifyDefaultChoice'
  | 'clarifySkip'
  | 'clarifyTimeRemaining'
>;

type ClarifyPromptProps = {
  prompt: ClarifyPromptState | null;
  submitting: boolean;
  submitError: string | null;
  labels: ClarifyPromptCopy;
  onSubmit: (answer: string) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
};

export function ClarifyPrompt({
  prompt,
  submitting,
  submitError,
  labels,
  onSubmit,
  onCancel,
}: ClarifyPromptProps) {
  const [customDraft, setCustomDraft] = useState('');
  const [deadlineMs, setDeadlineMs] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!prompt) {
      setDeadlineMs(null);
      setCustomDraft('');
      return;
    }
    setDeadlineMs(Date.now() + CLARIFY_PROMPT_COUNTDOWN_MS);
    setCustomDraft('');
  }, [prompt?.requestId]);

  useEffect(() => {
    if (!prompt || !deadlineMs) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [prompt?.requestId, deadlineMs, prompt]);

  useEffect(() => {
    if (!prompt) return;
    regionRef.current?.focus();
  }, [prompt?.requestId, prompt]);

  const pick = useCallback(
    (answer: string) => {
      void onSubmit(answer);
    },
    [onSubmit],
  );

  const remainingSeconds = useMemo(() => {
    if (!deadlineMs) return 0;
    void tick;
    return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
  }, [deadlineMs, tick]);

  const metaId = prompt ? `clarify-meta-${prompt.requestId}` : undefined;
  const errId = submitError && prompt ? `clarify-err-${prompt.requestId}` : undefined;

  const onKeyDownRegion = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault();
        e.stopPropagation();
        void onCancel();
      }
    },
    [onCancel, submitting],
  );

  if (!prompt) {
    return null;
  }

  const hasChoices = Array.isArray(prompt.choices) && prompt.choices.length >= 2;
  const defaultLabel = prompt.default
    ? labels.clarifyDefaultChoice.replace('{{text}}', prompt.default)
    : null;

  const timeoutLine = labels.clarifyServerTimeout.replace('{{minutes}}', String(CLARIFY_TIMEOUT_MINUTES));
  const timeLeftLine = labels.clarifyTimeRemaining.replace('{{time}}', formatClock(remainingSeconds));

  return (
    <div
      ref={regionRef}
      tabIndex={-1}
      role="region"
      aria-label={labels.clarifyRegionAria}
      aria-describedby={metaId}
      aria-invalid={submitError ? true : undefined}
      aria-errormessage={errId}
      onKeyDown={onKeyDownRegion}
      className={cn(
        'mb-4 rounded-lg border border-edge bg-surface-elevated px-4 py-3 text-sm text-fg shadow-sm outline-none',
        interaction.focusRingPanel,
      )}
    >
      <p className="mb-2 text-xs text-fg-muted">{labels.clarifyResumeHint}</p>
      <MarkdownView content={prompt.question} compact className="mb-3" />

      <ul id={metaId} className="mb-3 list-inside list-disc space-y-1 text-xs text-fg-muted">
        <li>{timeoutLine}</li>
        {prompt.default ? <li>{labels.clarifyDefaultTimeoutNote}</li> : null}
        <li>{labels.clarifySkipNote}</li>
        <li>{timeLeftLine}</li>
      </ul>

      {submitError ? (
        <div
          id={errId}
          role="alert"
          className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
        >
          {submitError}
        </div>
      ) : null}

      {hasChoices ? (
        <>
          <div
            className="max-h-[min(40vh,16rem)] overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]"
            role="group"
            aria-label={labels.clarifyChoicesGroupAria}
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {prompt.choices!.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant="secondary"
                  disabled={submitting}
                  className={cn(
                    'min-h-9 w-full justify-start rounded-lg px-3 py-2 text-left text-sm font-normal shadow-none',
                    'hover:border-edge',
                  )}
                  onClick={() => pick(c)}
                >
                  {c}
                </Button>
              ))}
              {prompt.default ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={submitting}
                  className={cn(
                    'min-h-9 w-full justify-start rounded-lg border border-dashed border-edge px-3 py-2 text-left text-sm font-normal text-fg-muted',
                    'hover:border-edge hover:text-fg',
                  )}
                  onClick={() => pick(prompt.default!)}
                >
                  {defaultLabel}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-3 border-t border-edge-subtle pt-3">
            <p className="mb-2 text-xs font-medium text-fg-muted">{labels.clarifyCustomLabel}</p>
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                const t = customDraft.trim();
                if (!t) return;
                void onSubmit(t);
              }}
            >
              <input
                type="text"
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                disabled={submitting}
                placeholder={labels.clarifyPlaceholder}
                className="min-w-0 flex-1 rounded-md border border-edge bg-surface-panel px-3 py-2 text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
              />
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || !customDraft.trim()}
                className="shrink-0 rounded-lg px-4 py-2 shadow-surface"
              >
                {labels.clarifySend}
              </Button>
            </form>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const t = customDraft.trim();
            if (!t) return;
            void onSubmit(t);
            setCustomDraft('');
          }}
        >
          <input
            type="text"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            disabled={submitting}
            placeholder={labels.clarifyPlaceholder}
            className="min-w-0 flex-1 rounded-md border border-edge bg-surface-panel px-3 py-2 text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || !customDraft.trim()}
            className="shrink-0 rounded-lg px-4 py-2 shadow-surface"
          >
            {labels.clarifySend}
          </Button>
          {prompt.default ? (
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              className="shrink-0 rounded-lg px-3 py-2 text-sm font-normal text-fg-muted shadow-none hover:text-fg"
              onClick={() => pick(prompt.default!)}
            >
              {labels.clarifyUseDefault}
            </Button>
          ) : null}
        </form>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-edge-subtle pt-3">
        <Button
          type="button"
          variant="ghost"
          disabled={submitting}
          className="text-fg-muted hover:text-fg"
          onClick={() => void onCancel()}
        >
          {labels.clarifySkip}
        </Button>
      </div>
    </div>
  );
}
