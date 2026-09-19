import { useMemo, useState } from 'react';
import { ChevronDown, GitBranch, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import type { WorkDiscoveryRun } from './api';
import { understandingConversationStarter } from './understanding-conversation-starter';

type RecognitionDecision = 'confirmed' | 'corrected';

type UnderstandingRevealProps = {
  run: WorkDiscoveryRun;
  language: 'en' | 'zh';
  busy: boolean;
  error: string | null;
  onFinish: (decision: RecognitionDecision, correction?: string) => Promise<boolean>;
  onStartConversation: (starter: string, decision: RecognitionDecision) => Promise<boolean>;
};

const copy = {
  zh: {
    eyebrow: '当前理解',
    summaryTitle: '我理解的是这样',
    summaryQuestion: '可以继续，也可以随时修改。',
    matches: '准确，继续',
    adjust: '修改',
    why: '查看依据',
    evidenceHint: '这些内容只用于本次判断。',
    current: '当前',
    ongoing: '持续',
    longTerm: '长期',
    correctionTitle: '告诉我正确的重点',
    correctionPlaceholder: '你现在真正想推进什么？',
    continueWithCorrection: '按此继续',
    starterTitle: '从这里开始',
    starterHint: '可以修改后直接开始对话。',
    startConversation: '进入对话',
    cancel: '取消',

  },
  en: {
    eyebrow: 'Current understanding',
    summaryTitle: 'Here’s how I understand it',
    summaryQuestion: 'Continue, or adjust this anytime.',
    matches: 'Accurate, continue',
    adjust: 'Edit',
    why: 'View sources',
    evidenceHint: 'These sources are only used for this assessment.',
    current: 'Current',
    ongoing: 'Ongoing',
    longTerm: 'Long term',
    correctionTitle: 'Tell me the right focus',
    correctionPlaceholder: 'What do you want to move forward right now?',
    continueWithCorrection: 'Continue',
    starterTitle: 'Start here',
    starterHint: 'Edit this if needed, then start the conversation.',
    startConversation: 'Start conversation',
    cancel: 'Cancel',

  },
} as const;

export function UnderstandingReveal({
  run,
  language,
  busy,
  error,
  onFinish,
  onStartConversation,
}: UnderstandingRevealProps) {
  const t = copy[language];
  const lowConfidence = run.result?.lowConfidence === true;
  const suggestedStarter = useMemo(
    () => understandingConversationStarter(run, language),
    [language, run],
  );
  const [correctionOpen, setCorrectionOpen] = useState(lowConfidence);
  const [correction, setCorrection] = useState(lowConfidence ? suggestedStarter : '');
  const [summaryConfirmed, setSummaryConfirmed] = useState(false);
  const [conversationStarting, setConversationStarting] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const workThreads = run.result?.workThreads?.slice(0, 3) ?? [];
  const primarySuggestion = run.result?.suggestions.find((suggestion) => suggestion.id === run.result?.primarySuggestionId)
    ?? run.result?.suggestions[0];

  const advanceAfterSummary = async (nextDecision: RecognitionDecision) => {
    setSummaryConfirmed(true);
    const finished = await onFinish(nextDecision, nextDecision === 'corrected' ? correction.trim() : undefined);
    if (!finished) setSummaryConfirmed(false);
  };

  const startConversationFromInput = async () => {
    const starter = correction.trim();
    if (!starter) return;
    setConversationStarting(true);
    const opened = await onStartConversation(starter, 'corrected');
    if (!opened) setConversationStarting(false);
  };

  return (
    <section className="xopc-understanding-reveal flex min-h-full flex-1 flex-col" aria-live="polite">
        <div className="xopc-reveal-scene mx-auto flex w-full max-w-[40rem] flex-1 flex-col justify-center py-6 text-center sm:py-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-fg">{t.eyebrow}</p>
          <h1 className="mx-auto mt-4 max-w-[34rem] text-3xl font-semibold tracking-[-0.035em] text-fg sm:text-[2.25rem]">{t.summaryTitle}</h1>
          <div className="xopc-understanding-hero-card relative mt-8 overflow-hidden rounded-xl border border-edge bg-surface-panel px-6 py-7 text-left shadow-surface sm:px-8">
            <div className="mb-5 flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-fg" aria-hidden>
              <Sparkles className="size-[1.125rem]" />
            </div>
            <p className="relative text-lg font-medium leading-8 text-fg sm:text-xl">{run.result?.projectSummary}</p>
            {(run.result?.currentState || workThreads.length || primarySuggestion?.evidence.length) ? (
              <div className="relative mt-5 border-t border-edge-subtle pt-4">
                <button type="button" className="flex items-center gap-2 text-xs font-medium text-fg-muted hover:text-fg" onClick={() => setEvidenceOpen((open) => !open)}>
                  {t.why}<ChevronDown className={cn('size-3.5 transition-transform', evidenceOpen && 'rotate-180')} />
                </button>
                {evidenceOpen ? (
                  <div className="mt-3 space-y-3 text-xs leading-5 text-fg-muted">
                    <p className="text-fg-subtle">{t.evidenceHint}</p>
                    {run.result?.currentState ? <p>{run.result.currentState}</p> : null}
                    {workThreads.length ? <div className="flex flex-wrap gap-2">{workThreads.map((thread) => <span key={thread.id} className="rounded-full bg-surface-hover px-2.5 py-1"><span className="font-medium text-fg">{thread.title}</span> · {thread.horizon === 'current' ? t.current : thread.horizon === 'ongoing' ? t.ongoing : t.longTerm}</span>)}</div> : null}
                    {primarySuggestion?.evidence.slice(0, 3).map((item, index) => <div key={`${index}-${item.path ?? item.observation}`} className="flex gap-2"><GitBranch className="mt-0.5 size-3.5 shrink-0 text-accent-fg" /><span>{item.path ? <><code className="font-mono text-fg">{item.path}</code>: </> : null}{item.observation}</span></div>)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {!correctionOpen ? (
            <div className="mx-auto mt-8 w-full max-w-sm">
              <p className="text-base font-medium text-fg">{t.summaryQuestion}</p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row-reverse">
                <Button className="h-11 flex-1" variant="primary" disabled={summaryConfirmed} onClick={() => void advanceAfterSummary('confirmed')}>{t.matches}</Button>
                <Button className="h-11 flex-1" variant="secondary" disabled={summaryConfirmed} onClick={() => setCorrectionOpen(true)}>{t.adjust}</Button>
              </div>
            </div>
          ) : (
            <div className="xopc-reveal-calibration mx-auto mt-7 w-full max-w-xl rounded-xl border border-edge bg-surface-panel p-5 text-left shadow-surface">
              <label className="text-sm font-semibold text-fg" htmlFor="understanding-correction">{lowConfidence ? t.starterTitle : t.correctionTitle}</label>
              {lowConfidence ? <p className="mt-1.5 text-xs leading-5 text-fg-muted">{t.starterHint}</p> : null}
              <textarea id="understanding-correction" value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder={t.correctionPlaceholder} className="mt-3 min-h-24 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm leading-6 text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/15" />
              <div className="mt-4 flex justify-end gap-2">
                {!lowConfidence ? <Button variant="ghost" disabled={summaryConfirmed} onClick={() => setCorrectionOpen(false)}>{t.cancel}</Button> : null}
                <Button variant="primary" disabled={busy || conversationStarting || !correction.trim()} onClick={() => void startConversationFromInput()}>{lowConfidence ? t.startConversation : t.continueWithCorrection}</Button>
              </div>
            </div>
          )}
          {error ? <p className="mt-5 text-sm text-danger" role="alert">{error}</p> : null}
        </div>
    </section>
  );
}
