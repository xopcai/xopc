import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Loader2, Pencil, ShieldAlert, X } from 'lucide-react';
import {
  CLARIFICATION_ANSWER_LIMIT,
  normalizeClarificationSubmission,
  type ClarificationPresentation,
  type ClarificationSubmission,
} from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { ClarificationChoice } from '../clarification/clarification-choice';
import { ClarificationWizard } from '../clarification/clarification-wizard';

export type ClarifyPromptState = ClarificationPresentation & {
  conversationId?: string;
  requestId: string;
  kind: 'input' | 'approval';
  question: string;

  version: number;
  createdAt: number;
  expiresAt?: number;
  serverTime?: number;
};

type ClarifyPromptView = ClarificationPresentation & Pick<ClarifyPromptState,
  'requestId' | 'question' | 'expiresAt' | 'serverTime' | 'conversationId'>
  & Partial<Pick<ClarifyPromptState, 'kind' | 'version' | 'createdAt'>>
  & { durable?: boolean };

export type ClarifyPromptCopy = Pick<ChatMessages,
  'clarifyRegionAria' | 'clarifyResumeHint' | 'clarifyDurableNote' | 'clarifyApprovalTimeout'
  | 'clarifyChoicesGroupAria' | 'clarifyCustomLabel' | 'clarifyPlaceholder' | 'clarifySend'
  | 'clarifyAgentDecide' | 'clarifyCancel'
  | 'clarifyTimeRemaining' | 'clarifyQuickHint' | 'clarifyCompose' | 'clarifySupplement'
  | 'clarifyRecommended' | 'clarifyClearChoice' | 'clarifyKeyboardHint' | 'clarifyApprovalTitle'
  | 'clarifyApprove' | 'clarifyDeny' | 'clarifyOperation' | 'clarifyTarget' | 'clarifyImpact'
  | 'clarifyDetails' | 'clarifyOnce' | 'clarifyExpired' | 'clarifyAnswerTooLong' | 'clarifySubmitting'
  | 'clarifyCollapse' | 'clarifyExpand' | 'clarifyPendingLabel' | 'clarifyParamsCount'>;

export type ClarifyPromptProps = {
  prompt: ClarifyPromptView | null;
  focusRequestKey?: string;
  submitting: boolean;
  submitError: string | null;
  labels: ClarifyPromptCopy;
  onSubmit: (submission: ClarificationSubmission) => void | Promise<void>;
  onAgentDecide?: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
};

const COUNTER_THRESHOLD = 6400;

export function ClarifyPrompt(props: ClarifyPromptProps) {
  if (props.prompt?.schemaVersion === 2 && props.prompt.kind !== 'approval') {
    return <ClarificationWizard key={`${props.prompt.requestId}:${props.prompt.version}`} {...props} />;
  }
  return props.prompt ? <ClarifyPromptBody key={props.prompt.requestId} {...props} prompt={props.prompt} /> : null;
}

function ClarifyPromptBody({
  prompt,
  focusRequestKey,
  submitting,
  submitError,
  labels,
  onSubmit,
  onAgentDecide,
  onCancel,
}: Omit<ClarifyPromptProps, 'prompt'> & { prompt: ClarifyPromptView }) {
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const sending = useRef(false);
  const region = useRef<HTMLElement>(null);
  const errorRegion = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [clockOffset] = useState(() => (prompt.serverTime ? prompt.serverTime - Date.now() : 0));
  const remaining = prompt.expiresAt === undefined
    ? null
    : Math.max(0, Math.ceil((prompt.expiresAt - now - clockOffset) / 1000));
  const expired = remaining === 0;
  const disabled = submitting || busy || expired;
  const approval = prompt.kind === 'approval';
  const choices = prompt.choiceDetails ?? [];
  const compose = editing || !choices.length;
  const trimmedLength = draft.trim().length;
  const tooLong = trimmedLength > CLARIFICATION_ANSWER_LIMIT;
  const inputId = `clarify-answer-${prompt.requestId}`;
  const errorId = `clarify-error-${prompt.requestId}`;
  const hintId = `clarify-hint-${prompt.requestId}`;
  const recommended = prompt.recommendedChoiceId;

  useEffect(() => {
    if (focusRequestKey) {
      setCollapsed(false);
      region.current?.scrollIntoView?.({ block: 'nearest' });
    }
    region.current?.focus({ preventScroll: Boolean(focusRequestKey) });
  }, [focusRequestKey]);
  useEffect(() => {
    if (submitError || localError) errorRegion.current?.focus();
  }, [submitError, localError]);
  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  useEffect(() => {
    if (!prompt.expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [prompt.expiresAt]);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = 'auto';
    input.current.style.height = `${Math.min(160, input.current.scrollHeight)}px`;
  }, [draft]);

  const submit = async (submission: ClarificationSubmission) => {
    if (disabled || sending.current) return;
    sending.current = true;
    setBusy(true);
    setLocalError('');
    try {
      normalizeClarificationSubmission(prompt, submission);
      await onSubmit(submission);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const pick = (id: string) => {
    if (disabled) return;
    if (editing || draft.trim()) {
      setSelected(id);
      return;
    }
    setSelected(id);
    void submit({ response: { choiceId: id } });
  };

  const sendDraft = () => {
    if (tooLong || (!selected && !draft.trim())) return;
    void submit({
      response: {
        ...(selected ? { choiceId: selected } : {}),
        ...(draft.trim() ? { text: draft.trim() } : {}),
      },
    });
  };

  const formattedRemaining = remaining !== null
    ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
    : null;
  const urgentCountdown = remaining !== null && remaining > 0 && remaining <= 60;

  if (collapsed && !approval) {
    return (
      <section
        ref={region}
        tabIndex={-1}
        data-clarification-id={prompt.requestId}
        aria-label={labels.clarifyRegionAria}
        className={cn(
          'mb-3 flex items-center gap-2.5 rounded-2xl border border-edge bg-surface-overlay px-3.5 py-2.5 text-sm text-fg shadow-surface outline-none',
          interaction.focusRingPanel,
        )}
      >
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{prompt.question}</span>
        <Button variant="tonal" className="h-8 rounded-lg px-3 text-xs" onClick={() => setCollapsed(false)}>
          {labels.clarifyExpand}
          <ChevronUp aria-hidden="true" className="size-3.5" />
        </Button>
      </section>
    );
  }

  if (approval) {
    const paramEntries = prompt.approval?.argumentsPreview
      ? Object.keys(prompt.approval.argumentsPreview)
      : [];
    const detailRows = ([
      [labels.clarifyTarget, prompt.approval?.target],
      [labels.clarifyImpact, prompt.approval?.impact],
    ] as const).filter(([, value]) => Boolean(value));

    return (
      <section
        ref={region}
        tabIndex={-1}
        data-clarification-id={prompt.requestId}
        aria-label={labels.clarifyApprovalTitle}
        aria-busy={submitting || busy}
        className={cn(
          'mb-3 overflow-hidden rounded-2xl border border-edge bg-surface-overlay text-sm text-fg shadow-elevated outline-none',
          interaction.focusRingPanel,
        )}
      >
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-amber-700 dark:text-amber-400"
              >
                <ShieldAlert className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-fg-muted">{labels.clarifyApprovalTitle}</p>
                <p className="truncate text-[15px] font-semibold leading-snug text-fg">
                  {prompt.approval?.operation || prompt.question}
                </p>
              </div>
            </div>
            {formattedRemaining !== null ? (
              <span
                role="status"
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums',
                  expired
                    ? 'bg-danger-soft text-danger'
                    : urgentCountdown
                      ? 'bg-warning-soft text-amber-700 dark:text-amber-400'
                      : 'bg-surface-inset text-fg-muted',
                )}
              >
                {expired ? labels.clarifyExpired : labels.clarifyTimeRemaining.replace('{{time}}', formattedRemaining)}
              </span>
            ) : null}
          </div>

          {prompt.approval?.operation && prompt.question && prompt.question.trim() !== prompt.approval.operation.trim() ? (
            <MarkdownView content={prompt.question} compact className="text-sm text-fg-muted" />
          ) : null}

          {detailRows.length > 0 || paramEntries.length > 0 ? (
            <div className="overflow-hidden rounded-xl bg-surface-inset divide-y divide-edge-subtle">
              {detailRows.map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-3 px-3.5 py-2.5 text-xs">
                  <span className="w-12 shrink-0 text-fg-subtle">{label}</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-fg">{value}</span>
                </div>
              ))}
              {paramEntries.length > 0 ? (
                <div>
                  <button
                    type="button"
                    aria-expanded={paramsOpen}
                    onClick={() => setParamsOpen(prev => !prev)}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-surface-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <span className="w-12 shrink-0 text-fg-subtle">{labels.clarifyDetails}</span>
                    <span className="min-w-0 flex-1 text-fg-muted">
                      {labels.clarifyParamsCount.replace('{{count}}', String(paramEntries.length))}
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className={cn('size-3.5 shrink-0 text-fg-subtle transition-transform duration-150', paramsOpen && 'rotate-90')}
                    />
                  </button>
                  {paramsOpen ? (
                    <pre className="max-h-40 overflow-auto border-t border-edge-subtle bg-surface-panel/60 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-fg-muted whitespace-pre-wrap break-all">
                      {JSON.stringify(prompt.approval?.argumentsPreview, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {submitError || localError ? (
            <div ref={errorRegion} tabIndex={-1} id={errorId} role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
              {submitError || localError}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-xs text-fg-subtle">{labels.clarifyOnce}</span>
            <div className="flex items-center gap-2">
              <Button variant="tonal" className="h-9 min-w-20 rounded-xl px-4 text-sm" disabled={disabled} onClick={() => void submit({ decision: 'deny' })}>
                {labels.clarifyDeny}
              </Button>
              <Button variant="primary" className="h-9 min-w-20 rounded-xl px-4 text-sm" disabled={disabled} onClick={() => void submit({ decision: 'approve' })}>
                {submitting || busy ? (
                  <>
                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                    {labels.clarifySubmitting}
                  </>
                ) : labels.clarifyApprove}
              </Button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={region}
      tabIndex={-1}
      data-clarification-id={prompt.requestId}
      aria-label={labels.clarifyRegionAria}
      aria-busy={submitting || busy}
      onKeyDown={event => {
        if (disabled || !choices.length) return;
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const digit = Number(event.key);
        if (digit >= 1 && digit <= Math.min(9, choices.length)) {
          event.preventDefault();
          pick(choices[digit - 1].id);
        }
      }}
      className={cn(
        'mb-3 flex max-h-[min(34rem,72dvh)] min-h-0 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay text-sm text-fg shadow-elevated outline-none',
        interaction.focusRingPanel,
      )}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-2">
          <MarkdownView content={prompt.question} compact className="min-w-0 flex-1 text-[15px] leading-snug text-fg [&_p]:font-medium" />
          <div className="flex shrink-0 items-center gap-1.5">
            {formattedRemaining !== null ? (
              <span
                role="status"
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
                  expired ? 'bg-danger-soft text-danger' : 'bg-surface-inset text-fg-muted',
                )}
              >
                {expired ? labels.clarifyExpired : labels.clarifyTimeRemaining.replace('{{time}}', formattedRemaining)}
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

        {choices.length > 0 ? (
          <div
            role="group"
            aria-label={labels.clarifyChoicesGroupAria}
            className="max-h-64 overflow-y-auto rounded-xl bg-surface-inset divide-y divide-edge-subtle"
          >
            {choices.map((choice, index) => (
              <ClarificationChoice
                key={choice.id}
                {...choice}
                index={index}
                recommended={recommended === choice.id}
                recommendedLabel={labels.clarifyRecommended}
                selected={selected === choice.id}
                disabled={disabled}
                onClick={() => pick(choice.id)}
              />
            ))}
            <button
              type="button"
              disabled={disabled}
              aria-expanded={compose}
              aria-controls={inputId}
              onClick={() => setEditing(prev => !prev)}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm text-fg-muted transition-colors duration-150',
                'hover:bg-surface-hover/70 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              <Pencil aria-hidden="true" className="size-3.5 shrink-0 text-fg-subtle sm:ml-0.5" />
              <span className="min-w-0 flex-1 truncate">
                {selected ? labels.clarifySupplement : labels.clarifyCustomLabel}
              </span>
              <ChevronRight
                aria-hidden="true"
                className={cn('size-4 shrink-0 text-fg-subtle transition-transform duration-150', compose && 'rotate-90')}
              />
            </button>
          </div>
        ) : null}

        {compose ? (
          <form className="space-y-2" onSubmit={event => { event.preventDefault(); sendDraft(); }}>
            {selected && choices.length > 0 ? (
              <div className="flex items-center justify-between text-xs text-fg-muted">
                <span className="truncate">{choices.find(c => c.id === selected)?.label}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelected(undefined)}
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs text-fg-subtle hover:bg-surface-hover hover:text-fg"
                >
                  <X aria-hidden="true" className="size-3" />
                  {labels.clarifyClearChoice}
                </button>
              </div>
            ) : null}
            <label htmlFor={inputId} className="sr-only">
              {selected ? labels.clarifySupplement : labels.clarifyCustomLabel}
            </label>
            <textarea
              id={inputId}
              ref={input}
              value={draft}
              rows={2}
              disabled={disabled}
              placeholder={selected ? labels.clarifySupplement : labels.clarifyPlaceholder}
              aria-invalid={tooLong}
              aria-describedby={`${hintId}${submitError || localError ? ` ${errorId}` : ''}`}
              onChange={event => {
                setDraft(event.target.value);
                if (event.target.value) setEditing(true);
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  sendDraft();
                }
              }}
              className="max-h-40 min-h-16 w-full resize-none overflow-y-auto rounded-xl border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            {tooLong || trimmedLength >= COUNTER_THRESHOLD ? (
              <div id={hintId} className={cn('flex justify-between text-xs', tooLong ? 'text-danger' : 'text-fg-subtle')}>
                <span>{tooLong ? labels.clarifyAnswerTooLong : ''}</span>
                <span aria-live={tooLong ? 'polite' : 'off'} className="tabular-nums">
                  {trimmedLength}/{CLARIFICATION_ANSWER_LIMIT}
                </span>
              </div>
            ) : <span id={hintId} className="sr-only">{labels.clarifyKeyboardHint}</span>}
          </form>
        ) : null}

        {submitError || localError ? (
          <div ref={errorRegion} tabIndex={-1} id={errorId} role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
            {submitError || localError}
          </div>
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-edge-subtle px-4 py-2.5">
        <div className="flex items-center gap-1">
          {onAgentDecide ? (
            <Button variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" disabled={disabled} onClick={() => void onAgentDecide()}>
              {labels.clarifyAgentDecide}
            </Button>
          ) : null}
          <Button variant="ghost" className="h-8 rounded-lg px-2.5 text-xs text-fg-subtle hover:text-fg" disabled={submitting || busy} onClick={() => void onCancel()}>
            {labels.clarifyCancel}
          </Button>
        </div>
        {compose || submitting || busy ? (
          <Button
            variant="primary"
            className="h-8 rounded-lg px-3.5 text-xs"
            disabled={disabled || tooLong || (!selected && !draft.trim())}
            onClick={sendDraft}
          >
            {submitting || busy ? (
              <>
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                {labels.clarifySubmitting}
              </>
            ) : labels.clarifySend}
          </Button>
        ) : null}
      </footer>
    </section>
  );
}
