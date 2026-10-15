import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import {
  CLARIFICATION_ANSWER_LIMIT,
  normalizeClarificationSubmission,
  type ClarificationPresentation, type ClarificationSubmission,
} from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/features/chat/markdown/markdown-view';
import type { ChatMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

export type ClarifyPromptState = ClarificationPresentation & {
  requestId: string;
  kind: 'input' | 'approval';
  question: string;

  version: number;
  createdAt: number;
  expiresAt?: number;
  serverTime?: number;
};

type ClarifyPromptView = ClarificationPresentation & Pick<ClarifyPromptState,
  'requestId' | 'question' | 'expiresAt' | 'serverTime'>
  & Partial<Pick<ClarifyPromptState, 'kind' | 'version' | 'createdAt'>>
  & { durable?: boolean };

export type ClarifyPromptCopy = Pick<ChatMessages,
  'clarifyRegionAria' | 'clarifyResumeHint' | 'clarifyDurableNote' | 'clarifyApprovalTimeout'
  | 'clarifyChoicesGroupAria' | 'clarifyCustomLabel' | 'clarifyPlaceholder' | 'clarifySend'
  | 'clarifyAgentDecide' | 'clarifyCancel'
  | 'clarifyTimeRemaining' | 'clarifyQuickHint' | 'clarifyCompose' | 'clarifySupplement'
  | 'clarifyRecommended' | 'clarifyClearChoice' | 'clarifyKeyboardHint' | 'clarifyApprovalTitle'
  | 'clarifyApprove' | 'clarifyDeny' | 'clarifyOperation' | 'clarifyTarget' | 'clarifyImpact'
  | 'clarifyDetails' | 'clarifyOnce' | 'clarifyExpired' | 'clarifyAnswerTooLong' | 'clarifySubmitting'>;

type ClarifyPromptProps = {
  prompt: ClarifyPromptView | null;
  submitting: boolean;
  submitError: string | null;
  labels: ClarifyPromptCopy;
  onSubmit: (submission: ClarificationSubmission) => void | Promise<void>;
  onAgentDecide?: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
};

export function ClarifyPrompt(props: ClarifyPromptProps) {
  return props.prompt ? <ClarifyPromptBody key={props.prompt.requestId} {...props} prompt={props.prompt} /> : null;
}

function ClarifyPromptBody({ prompt, submitting, submitError, labels, onSubmit, onAgentDecide, onCancel }:
  Omit<ClarifyPromptProps, 'prompt'> & { prompt: ClarifyPromptView }) {
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const region = useRef<HTMLElement>(null);
  const errorRegion = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [clockOffset] = useState(() => prompt.serverTime ? prompt.serverTime - Date.now() : 0);
  const remaining = prompt.expiresAt === undefined ? null : Math.max(0, Math.ceil((prompt.expiresAt - now - clockOffset) / 1000));
  const expired = remaining === 0;
  const disabled = submitting || busy || expired;
  const approval = prompt.kind === 'approval';
  const compose = prompt.interactionMode === 'compose' || editing;
  const choices = prompt.choiceDetails ?? [];
  const selectedChoice = choices.find(choice => choice.id === selected);
  const tooLong = draft.trim().length > CLARIFICATION_ANSWER_LIMIT;
  const inputId = `clarify-answer-${prompt.requestId}`;
  const errorId = `clarify-error-${prompt.requestId}`;
  const hintId = `clarify-hint-${prompt.requestId}`;
  const recommended = prompt.recommendedChoiceId;

  useEffect(() => { region.current?.focus(); }, []);
  useEffect(() => {
    if (submitError) errorRegion.current?.focus();
  }, [submitError]);
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
    normalizeClarificationSubmission(prompt, submission);
    sending.current = true;
    setBusy(true);
    try { await onSubmit(submission); }
    finally { sending.current = false; setBusy(false); }
  };
  const pick = (id: string) => {
    if (disabled) return;
    if (compose || draft.length) { setEditing(true); setSelected(id); }
    else void submit({ response: { choiceId: id } });
  };
  const sendDraft = () => {
    if (tooLong || (!selectedChoice && !draft.trim())) return;
    void submit({ response: { choiceId: selectedChoice?.id, text: draft.trim() || undefined } });
  };

  return <section ref={region} tabIndex={-1} data-clarification-id={prompt.requestId}
    aria-label={approval ? labels.clarifyApprovalTitle : labels.clarifyRegionAria}
    aria-busy={submitting || busy}
    className={cn('mb-4 rounded-lg border border-edge bg-surface-panel px-4 py-3 text-sm text-fg outline-none', interaction.focusRingPanel)}>
    <p className="mb-2 font-medium">{approval ? labels.clarifyApprovalTitle : labels.clarifyResumeHint}</p>
    <MarkdownView content={prompt.question} compact className="mb-3" />
    {approval && prompt.approval ? <dl className="mb-3 space-y-2">
      {([[labels.clarifyOperation, prompt.approval.operation], [labels.clarifyTarget, prompt.approval.target],
        [labels.clarifyImpact, prompt.approval.impact]] as const).map(([label, value]) => value ? <div key={label}>
        <dt className="text-xs text-fg-muted">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd>
      </div> : null)}
    </dl> : null}
    {approval && prompt.approval?.argumentsPreview ? <details className="mb-3">
      <summary className="cursor-pointer text-fg-muted">{labels.clarifyDetails}</summary>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(prompt.approval.argumentsPreview, null, 2)}</pre>
    </details> : null}
    <div className="mb-3 space-y-1 text-xs text-fg-muted">
      {approval ? <><p>{labels.clarifyOnce}</p><p>{labels.clarifyApprovalTimeout}</p></>
        : prompt.durable !== false ? <p>{labels.clarifyDurableNote}</p> : null}
      {remaining !== null ? <p role="status">{expired ? labels.clarifyExpired
        : labels.clarifyTimeRemaining.replace('{{time}}', `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`)}</p> : null}
    </div>
    {submitError ? <div ref={errorRegion} tabIndex={-1} id={errorId} role="alert" className="mb-3 rounded-md border border-edge p-3 text-red-600">{submitError}</div> : null}
    {submitting || busy ? <p role="status" className="mb-2 text-xs text-fg-muted">{labels.clarifySubmitting}</p> : null}
    {approval ? <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={disabled} onClick={() => void submit({ decision: 'deny' })}>{labels.clarifyDeny}</Button>
      <Button variant="primary" disabled={disabled} onClick={() => void submit({ decision: 'approve' })}>{labels.clarifyApprove}</Button>
    </div> : <>
      {choices.length ? <>
        {!compose ? <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
          <span>{labels.clarifyQuickHint}</span><Button variant="ghost" disabled={disabled} onClick={() => { setEditing(true); input.current?.focus(); }}>{labels.clarifyCompose}</Button>
        </div> : null}
        <div role="group" aria-label={labels.clarifyChoicesGroupAria} className="max-h-64 space-y-2 overflow-y-auto">
          {choices.map(choice => <Button key={choice.id} type="button" variant="secondary"
            aria-pressed={compose ? selected === choice.id : undefined} disabled={disabled}
            className={cn('min-h-11 w-full justify-start whitespace-normal px-3 py-2 text-left font-normal shadow-none', selected === choice.id && 'border-accent bg-surface-active')}
            onClick={() => pick(choice.id)}>
            {selected === choice.id ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
            <span className="min-w-0 break-words"><span className="font-medium">{choice.label}</span>
              {recommended === choice.id ? <span className="ml-2 text-xs text-accent">{labels.clarifyRecommended}</span> : null}
              {choice.description ? <span className="mt-1 block text-xs text-fg-muted">{choice.description}</span> : null}
            </span>
          </Button>)}
        </div>
        {selected ? <Button variant="ghost" disabled={disabled} onClick={() => setSelected(undefined)}>{labels.clarifyClearChoice}</Button> : null}
      </> : null}
      <form className="mt-3 space-y-2 border-t border-edge-subtle pt-3" onSubmit={event => { event.preventDefault(); sendDraft(); }}>
        <label htmlFor={inputId} className="block text-xs font-medium text-fg-muted">{selected ? labels.clarifySupplement : labels.clarifyCustomLabel}</label>
        <textarea id={inputId} ref={input} value={draft} rows={2} disabled={disabled}
          placeholder={labels.clarifyPlaceholder} aria-invalid={tooLong} aria-describedby={`${hintId}${submitError ? ` ${errorId}` : ''}`}
          onChange={event => { setDraft(event.target.value); if (event.target.value) setEditing(true); }}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); sendDraft(); }
          }}
          className="max-h-40 min-h-16 w-full resize-none overflow-y-auto rounded-md border border-edge bg-surface-panel px-3 py-2 text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50" />
        <div id={hintId} className="flex flex-wrap justify-between gap-2 text-xs text-fg-muted">
          <span>{tooLong ? labels.clarifyAnswerTooLong : labels.clarifyKeyboardHint}</span>
          <span aria-live={tooLong ? 'polite' : 'off'}>{draft.trim().length}/{CLARIFICATION_ANSWER_LIMIT}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="submit" variant="primary" disabled={disabled || tooLong || (!selectedChoice && !draft.trim())}>{labels.clarifySend}</Button>
        </div>
      </form>
      <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-edge-subtle pt-3">
        {onAgentDecide ? <Button variant="ghost" disabled={disabled} onClick={() => void onAgentDecide()}>{labels.clarifyAgentDecide}</Button> : null}
        <Button variant="ghost" disabled={submitting || busy} onClick={() => void onCancel()}>{labels.clarifyCancel}</Button>
      </div>
    </>}
  </section>;
}
