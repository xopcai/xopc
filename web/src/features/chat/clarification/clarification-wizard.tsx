import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
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

export function ClarificationWizard({ prompt, submitting, submitError, labels, onSubmit, onAgentDecide, onCancel }: ClarifyPromptProps) {
  const language = useLocaleStore(s => s.language);
  const t = messages(language).chat;
  const [draft, setDraft] = useState<Draft>({ index: 0, answers: {} });
  const [ready, setReady] = useState(false);
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const edited = useRef(false);
  const sending = useRef(false);
  const [customQuestion, setCustomQuestion] = useState<string>();
  const currentDraft = useRef(draft);
  const section = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const questions = prompt?.questions ?? [];
  const question = questions[Math.min(draft.index, questions.length - 1)];
  const answer = question ? draft.answers[question.id] : undefined;
  const storage = useRef(clarificationDraftStorage<Draft>(prompt!.requestId, prompt!.version ?? 1, 'draft', prompt!.conversationId));
  const disabled = submitting || busy;
  const editingDisabled = disabled || pending;
  const answered = questions.filter(q => {
    const a = draft.answers[q.id];
    return a && (a.choiceId || a.text?.trim());
  }).length;

  useEffect(() => {
    let alive = true;
    void clarificationDraftStorage(prompt!.requestId, prompt!.version ?? 1, 'submission', prompt!.conversationId).read()
      .then(saved => { if (alive) setPending(Boolean(saved)); }).catch(() => {});
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

  function update(next: Draft, flush = false) {
    edited.current = true;
    currentDraft.current = next;
    setDraft(next);
    setLocalError('');
    if (flush) void storage.current.write(next).catch(() => {});
  }
  function move(index: number) {
    update({ ...draft, index }, true);
    section.current?.focus();
  }
  async function submit(next = currentDraft.current) {
    if (disabled || sending.current || !prompt) return;
    sending.current = true;
    setBusy(true);
    try {
      const submission = { schemaVersion: 2 as const, answers: questions.map(q => next.answers[q.id] ?? { questionId: q.id }) };
      normalizeClarificationSubmission(prompt, submission);
      await storage.current.write(next);
      await onSubmit(submission);
    } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)); }
    finally { sending.current = false; setBusy(false); }
  }
  function pick(choiceId: string) {
    if (editingDisabled || sending.current || !question) return;
    const next: Draft = { ...currentDraft.current, answers: { ...currentDraft.current.answers,
      [question.id]: { questionId: question.id, choiceId } } };
    update(next);
    const unanswered = questions.findIndex(q => {
      const a = next.answers[q.id];
      return !a?.choiceId && !a?.text?.trim();
    });
    if (unanswered === -1) void submit(next);
    else { update({ ...next, index: unanswered }, true); section.current?.focus(); }
  }
  if (!ready) return <div className="mb-4 space-y-3 rounded-lg border border-edge p-4"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-24 w-full" /></div>;
  if (!question) return null;
  const validCurrent = Boolean(answer?.choiceId || answer?.text?.trim()) && (answer?.text?.length ?? 0) <= 2000;
  const showCustom = question.type !== 'single_choice' || customQuestion === question.id || Boolean(answer?.text);
  const textareaId = `clarify-${prompt!.requestId}-${question.id}`;
  return <section ref={section} tabIndex={-1} aria-label={labels.clarifyRegionAria} aria-busy={disabled}
    data-clarification-id={prompt!.requestId} className={cn("mb-4 flex max-h-[min(36rem,75dvh)] min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-surface-overlay text-sm text-fg outline-none", interaction.focusRingPanel)}>
    <header className="shrink-0 border-b border-edge-subtle px-4 py-3">
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-fg-muted">{labels.clarifyRegionAria}</span><span role="status" className="text-xs text-fg-muted">{disabled ? labels.clarifySubmitting : t.clarifyProgress.replace('{{answered}}', String(answered)).replace('{{total}}', String(questions.length))}</span></div>
      {questions.length > 1 ? <nav aria-label={t.clarifyQuestions} className="mt-2 flex flex-wrap gap-1">
        {questions.map((q, index) => <Button key={q.id} variant={index === draft.index ? 'secondary' : 'ghost'} disabled={editingDisabled} aria-current={index === draft.index ? 'step' : undefined}
          onClick={() => move(index)}>{index + 1}. {q.header}{draft.answers[q.id]?.choiceId || draft.answers[q.id]?.text?.trim() ? ' ✓' : ''}</Button>)}
      </nav> : null}
    </header>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
      <MarkdownView content={question.question} compact className="text-fg [&_p]:font-medium" />
      {question.type === 'single_choice' ? <p className="text-xs text-fg-muted">{questions.length > 1 ? t.clarifyBatchQuickHint : labels.clarifyQuickHint}</p> : null}
      {question.type === 'single_choice' ? <>
        <div role="group" aria-label={question.header} className="space-y-0.5 rounded-lg border border-edge p-1">
          {question.choices.map((choice, index) => <ClarificationChoice key={choice.id} {...choice} index={index}
            recommended={question.recommendedChoiceId === choice.id} recommendedLabel={labels.clarifyRecommended}
            selected={answer?.choiceId === choice.id} disabled={editingDisabled} onClick={() => pick(choice.id)} />)}
        </div>
        <Button variant="ghost" disabled={editingDisabled} aria-expanded={showCustom} aria-controls={textareaId}
          className="min-h-11 justify-start gap-1 px-1 text-xs" onClick={() => setCustomQuestion(showCustom ? undefined : question.id)}>
          <ChevronRight aria-hidden="true" className={cn('size-3.5', showCustom && 'rotate-90')} />{labels.clarifyCustomLabel}
        </Button>
      </> : null}
      {showCustom ? <div className="space-y-2">
      <label htmlFor={textareaId} className="sr-only">{labels.clarifyCustomLabel}</label>
      <textarea ref={input} id={textareaId} rows={3} disabled={editingDisabled} value={answer?.text ?? ''} aria-invalid={(answer?.text?.length ?? 0) > 2000}
        onChange={event => update({ ...draft, answers: { ...draft.answers, [question.id]: { questionId: question.id, text: event.target.value } } })}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); if (draft.index === questions.length - 1) void submit(); else if (validCurrent) move(draft.index + 1); } }}
        className="min-h-20 w-full resize-y rounded-md border border-edge bg-surface-panel px-3 py-2 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
      <p className="flex justify-between gap-2 text-xs text-fg-muted"><span>{labels.clarifyKeyboardHint}</span><span>{answer?.text?.length ?? 0}/2000</span></p>
      </div> : null}
      {submitError || localError ? <p role="alert" className="text-red-600">{submitError || localError}</p> : null}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-edge-subtle px-4 py-3">
      <Button variant="ghost" disabled={editingDisabled} onClick={() => void onCancel()}>{labels.clarifyCancel}</Button>
      {onAgentDecide ? <Button variant="ghost" disabled={editingDisabled} onClick={() => void onAgentDecide()}>{labels.clarifyAgentDecide}</Button> : null}
      {questions.length > 1 ? <Button variant="secondary" disabled={editingDisabled || draft.index === 0} onClick={() => move(draft.index - 1)}>{t.clarifyPrevious}</Button> : null}
      {showCustom || pending || submitError || localError || answered === questions.length ? (draft.index < questions.length - 1 && !pending
        ? <Button variant="primary" disabled={editingDisabled || !validCurrent} onClick={() => move(draft.index + 1)}>{t.clarifyNext}</Button>
        : <Button variant="primary" disabled={disabled || answered !== questions.length || !validCurrent} onClick={() => void submit()}>{disabled ? labels.clarifySubmitting : pending ? t.clarifyRetrySubmission : t.clarifySubmitAll}</Button>) : null}
    </footer>
  </section>;
}
