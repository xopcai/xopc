import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Loader2, Pencil, X } from 'lucide-react';
import { normalizeClarificationSubmission, type ClarificationQuestionAnswer } from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { ClarificationChoice } from './clarification-choice';
import type { ClarifyPromptProps } from '../composer/clarify-prompt';
import { clarificationDraftStorage } from './clarification-draft-storage';

type Draft = { index: number; answers: Record<string, ClarificationQuestionAnswer> };

const ANSWER_LIMIT = 2000;
const COUNTER_THRESHOLD = 1600;

export function ClarificationWizard({
  prompt,
  focusRequestKey,
  submitting,
  submitError,
  labels,
  onSubmit,
  onAgentDecide,
  onCancel,
}: ClarifyPromptProps) {
  const language = useLocaleStore(s => s.language);
  const t = messages(language).chat;
  const [draft, setDraft] = useState<Draft>({ index: 0, answers: {} });
  const [ready, setReady] = useState(false);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const edited = useRef(false);
  const sending = useRef(false);
  const [customQuestion, setCustomQuestion] = useState<string>();
  const currentDraft = useRef(draft);
  const section = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const questions = prompt?.questions ?? [];
  const question = questions[Math.min(draft.index, questions.length - 1)];
  const answer = question ? draft.answers[question.id] : undefined;
  const storage = useRef(
    clarificationDraftStorage<Draft>(prompt!.requestId, prompt!.version ?? 1, 'draft', prompt!.conversationId),
  );
  const disabled = submitting || busy;
  const editingDisabled = disabled || pending;
  const answered = questions.filter(q => {
    const a = draft.answers[q.id];
    return a && (a.choiceId || a.text?.trim());
  }).length;

  useEffect(() => {
    let alive = true;
    void clarificationDraftStorage(prompt!.requestId, prompt!.version ?? 1, 'submission', prompt!.conversationId)
      .read()
      .then(saved => { if (alive) setPending(Boolean(saved)); })
      .catch(() => {});
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId: string; pending: boolean }>).detail;
      if (detail.requestId === prompt!.requestId) setPending(detail.pending);
    };
    window.addEventListener('clarification-submission-state', listener);
    return () => { alive = false; window.removeEventListener('clarification-submission-state', listener); };
  }, [prompt]);

  useEffect(() => {
    let cancelled = false;
    void storage.current.read().then(saved => {
      if (cancelled) return;
      if (saved && !edited.current && saved.index >= 0 && saved.index < questions.length && saved.answers) {
        currentDraft.current = saved;
        setDraft(saved);
      }
      setReady(true);
    }).catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [questions.length]);

  useEffect(() => {
    if (!ready || !edited.current) return;
    const timer = window.setTimeout(() => { void storage.current.write(draft).catch(() => {}); }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, ready]);

  useEffect(() => { if (customQuestion) input.current?.focus(); }, [customQuestion]);
  useEffect(() => {
    if (!ready || !focusRequestKey) return;
    setCollapsed(false);
    section.current?.scrollIntoView?.({ block: 'nearest' });
    section.current?.focus({ preventScroll: true });
  }, [focusRequestKey, ready]);

  function update(next: Draft, flush = false) {
    edited.current = true;
    currentDraft.current = next;
    setDraft(next);
    setLocalError('');
    if (flush) void storage.current.write(next).catch(() => {});
  }

  function move(index: number) {
    setCustomQuestion(undefined);
    update({ ...draft, index }, true);
    section.current?.focus();
  }

  async function submit(next = currentDraft.current) {
    if (disabled || sending.current || !prompt) return;
    sending.current = true;
    setBusy(true);
    try {
      const submission = {
        schemaVersion: 2 as const,
        answers: questions.map(q => next.answers[q.id] ?? { questionId: q.id }),
      };
      normalizeClarificationSubmission(prompt, submission);
      await storage.current.write(next);
      await onSubmit(submission);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function pick(choiceId: string) {
    if (editingDisabled || sending.current || !question) return;
    const existingText = currentDraft.current.answers[question.id]?.text;
    const next: Draft = {
      ...currentDraft.current,
      answers: {
        ...currentDraft.current.answers,
        [question.id]: {
          questionId: question.id,
          choiceId,
          ...(existingText?.trim() ? { text: existingText } : {}),
        },
      },
    };
    update(next, true);

    if (questions.length === 1 && !existingText?.trim() && customQuestion !== question.id) {
      void submit(next);
      return;
    }

    const unanswered = questions.findIndex(q => {
      const a = next.answers[q.id];
      return !a?.choiceId && !a?.text?.trim();
    });
    if (unanswered !== -1) {
      setCustomQuestion(undefined);
      update({ ...next, index: unanswered }, true);
      section.current?.focus();
    }
  }

  function clearChoice() {
    if (editingDisabled || !question) return;
    const existingText = currentDraft.current.answers[question.id]?.text ?? '';
    update({
      ...currentDraft.current,
      answers: {
        ...currentDraft.current.answers,
        [question.id]: { questionId: question.id, ...(existingText ? { text: existingText } : {}) },
      },
    }, true);
  }

  if (!ready) {
    return (
      <div className="mb-3 space-y-2.5 rounded-2xl border border-edge bg-surface-overlay p-4 shadow-elevated">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }
  if (!question) return null;

  const textLength = answer?.text?.trim().length ?? 0;
  const tooLong = textLength > ANSWER_LIMIT;
  const validCurrent = Boolean(answer?.choiceId || answer?.text?.trim()) && !tooLong;
  const allAnswered = answered === questions.length;
  const showCustom = question.type !== 'single_choice' || customQuestion === question.id || Boolean(answer?.text);
  const textareaId = `clarify-${prompt!.requestId}-${question.id}`;
  const isMulti = questions.length > 1;

  const summaryItems = isMulti && allAnswered
    ? questions.map(q => {
        const a = draft.answers[q.id];
        const choiceLabel = q.type === 'single_choice'
          ? q.choices.find(c => c.id === a?.choiceId)?.label
          : undefined;
        const textPreview = a?.text?.trim();
        return choiceLabel && textPreview
          ? `${choiceLabel} · ${textPreview}`
          : choiceLabel ?? textPreview ?? '';
      }).filter(Boolean)
    : [];

  if (collapsed) {
    return (
      <section
        ref={section}
        tabIndex={-1}
        aria-label={labels.clarifyRegionAria}
        data-clarification-id={prompt!.requestId}
        className={cn(
          'mb-3 flex items-center gap-2.5 rounded-2xl border border-edge bg-surface-overlay px-3.5 py-2.5 text-sm text-fg shadow-surface outline-none',
          interaction.focusRingPanel,
        )}
      >
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-fg">{question.header || labels.clarifyPendingLabel}</span>
          {isMulti ? (
            <span className="ml-2 text-xs tabular-nums text-fg-muted">
              {t.clarifyProgress.replace('{{answered}}', String(answered)).replace('{{total}}', String(questions.length))}
            </span>
          ) : null}
        </span>
        <Button variant="tonal" className="h-8 rounded-lg px-3 text-xs" onClick={() => setCollapsed(false)}>
          {labels.clarifyExpand}
          <ChevronUp aria-hidden="true" className="size-3.5" />
        </Button>
      </section>
    );
  }

  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-label={labels.clarifyRegionAria}
      aria-busy={disabled}
      data-clarification-id={prompt!.requestId}
      onKeyDown={event => {
        if (editingDisabled || question.type !== 'single_choice') return;
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const digit = Number(event.key);
        if (digit >= 1 && digit <= Math.min(9, question.choices.length)) {
          event.preventDefault();
          pick(question.choices[digit - 1].id);
        }
      }}
      className={cn(
        'mb-3 flex max-h-[min(34rem,72dvh)] min-h-0 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay text-sm text-fg shadow-elevated outline-none',
        interaction.focusRingPanel,
      )}
    >
      <header className="shrink-0 px-4 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          {isMulti ? (
            <nav aria-label={t.clarifyQuestions} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {questions.map((q, index) => {
                const done = Boolean(draft.answers[q.id]?.choiceId || draft.answers[q.id]?.text?.trim());
                const active = index === draft.index;
                return (
                  <button
                    key={q.id}
                    type="button"
                    disabled={editingDisabled}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => move(index)}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      'disabled:pointer-events-none disabled:opacity-50',
                      active
                        ? 'bg-accent-soft text-accent-fg'
                        : done
                          ? 'bg-surface-inset text-fg'
                          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                    )}
                  >
                    <span className="tabular-nums">{index + 1}.</span>
                    <span className="max-w-28 truncate">{q.header}</span>
                    {done ? <Check aria-hidden="true" className="size-3 text-accent-fg" /> : null}
                  </button>
                );
              })}
            </nav>
          ) : (
            <span className="text-xs font-medium text-fg-muted">{question.header}</span>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {isMulti ? (
              <span role="status" className="text-xs font-medium tabular-nums text-fg-subtle">
                {disabled
                  ? labels.clarifySubmitting
                  : t.clarifyProgress.replace('{{answered}}', String(answered)).replace('{{total}}', String(questions.length))}
              </span>
            ) : disabled ? (
              <span role="status" className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                {labels.clarifySubmitting}
              </span>
            ) : null}
            <button
              type="button"
              aria-label={labels.clarifyCollapse}
              onClick={() => setCollapsed(true)}
              className="inline-flex size-7 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronDown aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
        {isMulti ? (
          <div aria-hidden="true" className="mt-2 flex gap-1">
            {questions.map((q, index) => {
              const done = Boolean(draft.answers[q.id]?.choiceId || draft.answers[q.id]?.text?.trim());
              const active = index === draft.index;
              return (
                <span
                  key={q.id}
                  className={cn(
                    'h-0.5 flex-1 rounded-full transition-colors duration-200',
                    done ? 'bg-accent' : active ? 'bg-accent/45' : 'bg-surface-hover',
                  )}
                />
              );
            })}
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pt-1 pb-3">
        <MarkdownView content={question.question} compact className="text-[15px] leading-snug text-fg [&_p]:font-medium" />

        {question.type === 'single_choice' ? (
          <div
            role="group"
            aria-label={question.header}
            className="overflow-hidden rounded-xl bg-surface-inset divide-y divide-edge-subtle"
          >
            {question.choices.map((choice, index) => (
              <ClarificationChoice
                key={choice.id}
                {...choice}
                index={index}
                recommended={question.recommendedChoiceId === choice.id}
                recommendedLabel={labels.clarifyRecommended}
                selected={answer?.choiceId === choice.id}
                disabled={editingDisabled}
                onClick={() => pick(choice.id)}
              />
            ))}
            <button
              type="button"
              disabled={editingDisabled}
              aria-expanded={showCustom}
              aria-controls={textareaId}
              onClick={() => setCustomQuestion(showCustom ? undefined : question.id)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm text-fg-muted transition-colors duration-150',
                'hover:bg-surface-hover/70 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <Pencil aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle sm:ml-0.5" />
              <span className="min-w-0 flex-1 truncate">
                {answer?.choiceId ? labels.clarifySupplement : labels.clarifyCustomLabel}
              </span>
              <ChevronRight
                aria-hidden="true"
                className={cn('size-4 shrink-0 text-fg-subtle transition-transform duration-150', showCustom && 'rotate-90')}
              />
            </button>
          </div>
        ) : null}

        {showCustom ? (
          <div className="space-y-1.5">
            {question.type === 'single_choice' && answer?.choiceId ? (
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span className="truncate">
                  {question.choices.find(c => c.id === answer.choiceId)?.label}
                </span>
                <button
                  type="button"
                  disabled={editingDisabled}
                  onClick={clearChoice}
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-fg-subtle hover:bg-surface-hover hover:text-fg"
                >
                  <X aria-hidden="true" className="size-3" />
                  {labels.clarifyClearChoice}
                </button>
              </div>
            ) : null}
            <label htmlFor={textareaId} className="sr-only">
              {answer?.choiceId ? labels.clarifySupplement : labels.clarifyCustomLabel}
            </label>
            <textarea
              ref={input}
              id={textareaId}
              rows={2}
              disabled={editingDisabled}
              value={answer?.text ?? ''}
              placeholder={answer?.choiceId ? labels.clarifySupplement : labels.clarifyPlaceholder}
              aria-invalid={tooLong}
              onChange={event => {
                const nextText = event.target.value;
                update({
                  ...draft,
                  answers: {
                    ...draft.answers,
                    [question.id]: {
                      questionId: question.id,
                      ...(answer?.choiceId ? { choiceId: answer.choiceId } : {}),
                      ...(nextText ? { text: nextText } : {}),
                    },
                  },
                });
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (allAnswered && validCurrent) void submit();
                  else if (draft.index < questions.length - 1 && validCurrent) move(draft.index + 1);
                }
              }}
              className="min-h-16 w-full resize-y rounded-xl border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            {tooLong || textLength >= COUNTER_THRESHOLD ? (
              <p className={cn('flex justify-between text-xs', tooLong ? 'text-danger' : 'text-fg-subtle')}>
                <span>{tooLong ? labels.clarifyAnswerTooLong : ''}</span>
                <span className="tabular-nums">{textLength}/{ANSWER_LIMIT}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        {summaryItems.length > 0 ? (
          <div className="flex items-center gap-2 rounded-xl bg-surface-inset/70 px-3 py-2 text-xs text-fg-muted">
            <Check aria-hidden="true" className="size-3.5 shrink-0 text-accent-fg" />
            <span className="min-w-0 flex-1 truncate">{summaryItems.join(' · ')}</span>
          </div>
        ) : null}

        {submitError || localError ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
            {submitError || localError}
          </p>
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-edge-subtle px-4 py-2.5">
        <div className="flex items-center gap-1">
          {onAgentDecide ? (
            <Button
              variant="ghost"
              className="h-8 rounded-lg px-2.5 text-xs"
              disabled={editingDisabled}
              onClick={() => void onAgentDecide()}
            >
              {labels.clarifyAgentDecide}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="h-8 rounded-lg px-2.5 text-xs text-fg-subtle hover:text-fg"
            disabled={editingDisabled}
            onClick={() => void onCancel()}
          >
            {labels.clarifyCancel}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {isMulti && draft.index > 0 ? (
            <Button
              variant="tonal"
              className="h-8 rounded-lg px-3 text-xs"
              disabled={editingDisabled}
              onClick={() => move(draft.index - 1)}
            >
              {t.clarifyPrevious}
            </Button>
          ) : null}
          {pending || submitError || localError || allAnswered || showCustom ? (
            !allAnswered && draft.index < questions.length - 1 && !pending ? (
              <Button
                variant="primary"
                className="h-8 rounded-lg px-3.5 text-xs"
                disabled={editingDisabled || !validCurrent}
                onClick={() => move(draft.index + 1)}
              >
                {t.clarifyNext}
              </Button>
            ) : (
              <Button
                variant="primary"
                className="h-8 rounded-lg px-3.5 text-xs"
                disabled={disabled || (!pending && (!allAnswered || !validCurrent))}
                onClick={() => void submit()}
              >
                {disabled ? (
                  <>
                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                    {labels.clarifySubmitting}
                  </>
                ) : pending ? (
                  t.clarifyRetrySubmission
                ) : (
                  t.clarifySubmitAll
                )}
              </Button>
            )
          ) : null}
        </div>
      </footer>
    </section>
  );
}
