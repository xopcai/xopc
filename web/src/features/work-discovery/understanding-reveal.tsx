import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, GitBranch, Loader2, Pencil, ShieldCheck, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { UserFocus } from '@/features/user-context/user-context-api';
import { cn } from '@/lib/cn';

import type { WorkDiscoveryProfileCandidate, WorkDiscoveryRun } from './api';

type RevealStep = 'summary' | 'memory' | 'focus';
type RecognitionDecision = 'confirmed' | 'corrected';

type UnderstandingRevealProps = {
  run: WorkDiscoveryRun;
  sourceMemories: WorkDiscoveryProfileCandidate[];
  focuses: UserFocus[];
  activityRunning: boolean;
  language: 'en' | 'zh';
  busy: boolean;
  error: string | null;
  onReviewMemory: (
    candidate: WorkDiscoveryProfileCandidate,
    status: 'accepted' | 'edited' | 'rejected',
    statement?: string,
  ) => Promise<boolean>;
  onReviewFocus: (focus: UserFocus, accepted: boolean) => Promise<boolean>;
  onFinish: (decision: RecognitionDecision, correction?: string) => Promise<boolean>;
};

const copy = {
  zh: {
    eyebrow: '当前理解',
    summaryTitle: '这是我对你当前重点的理解。',
    summaryQuestion: '准确吗？',
    matches: '准确',
    adjust: '调整',
    why: '为什么这样理解？',
    evidenceHint: '这些线索只用于形成当前判断，不会自动成为长期记忆。',
    current: '当前',
    ongoing: '持续',
    longTerm: '长期',
    correctionTitle: '正确的重点是什么？',
    correctionPlaceholder: '直接告诉我你现在真正想推进什么。',
    continueWithCorrection: '按这个理解继续',
    cancel: '取消',
    memoryEyebrow: '长期理解',
    memoryTitle: '要记住这一点吗？',
    remember: '记住',
    sessionOnly: '只用于这次',
    edit: '修改',
    saveEdit: '保存并记住',
    source: '理解依据',
    focusEyebrow: '当前关注',
    focusTitle: '要持续关注这个方向吗？',
    focusHint: '关注只影响优先级和提醒，不代表执行授权。',
    activateFocus: '加入关注',
    notNow: '暂时不用',
    trustNote: '只有你确认的理解会被使用，之后随时可以修改。',
    sourcesFinishing: '正在整理其他来源，完成后再继续。',
  },
  en: {
    eyebrow: 'Current understanding',
    summaryTitle: 'This is how I understand your current focus.',
    summaryQuestion: 'Is this accurate?',
    matches: 'Accurate',
    adjust: 'Adjust',
    why: 'Why do I think this?',
    evidenceHint: 'These signals shape the current view. They never become lasting memory automatically.',
    current: 'Current',
    ongoing: 'Ongoing',
    longTerm: 'Long term',
    correctionTitle: 'What is the right focus?',
    correctionPlaceholder: 'Tell me what you actually want to move forward right now.',
    continueWithCorrection: 'Continue with this understanding',
    cancel: 'Cancel',
    memoryEyebrow: 'Lasting understanding',
    memoryTitle: 'Should I remember this?',
    remember: 'Remember',
    sessionOnly: 'This time only',
    edit: 'Edit',
    saveEdit: 'Save and remember',
    source: 'Why I inferred this',
    focusEyebrow: 'Current focus',
    focusTitle: 'Should I keep this in focus?',
    focusHint: 'Focus affects priority and reminders, never authorization to act.',
    activateFocus: 'Add to focus',
    notNow: 'Not now',
    trustNote: 'Only understanding you confirm is used, and you can change it anytime.',
    sourcesFinishing: 'Finishing the remaining sources before continuing.',
  },
} as const;

const confidenceRank = { high: 3, medium: 2, low: 1 } as const;

export function UnderstandingReveal({
  run,
  sourceMemories,
  focuses,
  activityRunning,
  language,
  busy,
  error,
  onReviewMemory,
  onReviewFocus,
  onFinish,
}: UnderstandingRevealProps) {
  const t = copy[language];
  const [step, setStep] = useState<RevealStep>('summary');
  const [decision, setDecision] = useState<RecognitionDecision>('confirmed');
  const [correctionOpen, setCorrectionOpen] = useState(Boolean(run.result?.lowConfidence));
  const [correction, setCorrection] = useState('');
  const [summaryConfirmed, setSummaryConfirmed] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState('');

  const memoryCandidate = useMemo(() => {
    const unique = new Map<string, WorkDiscoveryProfileCandidate>();
    for (const candidate of [...(run.result?.profileCandidates ?? []), ...sourceMemories]) {
      if (candidate.status === 'pending') unique.set(candidate.understandingId ?? candidate.id, candidate);
    }
    return [...unique.values()].sort((a, b) => confidenceRank[b.confidence] - confidenceRank[a.confidence])[0];
  }, [run.result?.profileCandidates, sourceMemories]);
  const focusCandidate = useMemo(() => (
    focuses.filter((focus) => focus.status === 'candidate').sort((a, b) => b.confidence - a.confidence)[0]
  ), [focuses]);
  const workThreads = run.result?.workThreads?.slice(0, 3) ?? [];
  const primarySuggestion = run.result?.suggestions.find((suggestion) => suggestion.id === run.result?.primarySuggestionId)
    ?? run.result?.suggestions[0];

  useEffect(() => {
    setEditingMemory(false);
    setMemoryDraft(memoryCandidate?.statement ?? '');
  }, [memoryCandidate?.id, memoryCandidate?.statement]);

  const finish = (nextDecision = decision, correctedIntent = correction.trim()) => (
    onFinish(nextDecision, nextDecision === 'corrected' ? correctedIntent : undefined)
  );

  const advanceAfterSummary = async (nextDecision: RecognitionDecision) => {
    setDecision(nextDecision);
    setSummaryConfirmed(true);
    if (activityRunning) return;
    if (memoryCandidate) setStep('memory');
    else if (focusCandidate) setStep('focus');
    else await finish(nextDecision, correction.trim());
  };

  useEffect(() => {
    if (!summaryConfirmed || activityRunning || step !== 'summary') return;
    if (memoryCandidate) setStep('memory');
    else if (focusCandidate) setStep('focus');
    else void finish();
  }, [activityRunning, focusCandidate, memoryCandidate, step, summaryConfirmed]);

  const reviewMemory = async (status: 'accepted' | 'edited' | 'rejected', statement?: string) => {
    if (!memoryCandidate) return;
    const completed = await onReviewMemory(memoryCandidate, status, statement);
    if (!completed) return;
    if (focusCandidate) setStep('focus');
    else await finish();
  };

  const reviewFocus = async (accepted: boolean) => {
    if (!focusCandidate) return;
    const completed = await onReviewFocus(focusCandidate, accepted);
    if (completed) await finish();
  };

  return (
    <section className="xopc-understanding-reveal flex min-h-full flex-1 flex-col" aria-live="polite">
      {step === 'summary' ? (
        <div className="xopc-reveal-scene mx-auto flex w-full max-w-[40rem] flex-1 flex-col justify-center py-8 text-center sm:py-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-fg">{t.eyebrow}</p>
          <h1 className="mx-auto mt-4 max-w-[34rem] text-3xl font-semibold tracking-[-0.035em] text-fg sm:text-[2.25rem]">{t.summaryTitle}</h1>
          <div className="xopc-understanding-hero-card relative mt-8 overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/72 px-6 py-7 text-left shadow-elevated backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 sm:px-8">
            <UnderstandingConstellation />
            <p className="relative text-lg font-medium leading-8 text-fg sm:text-xl">{correction.trim() || run.result?.projectSummary}</p>
            {(run.result?.currentState || workThreads.length || primarySuggestion?.evidence.length) ? (
              <div className="relative mt-5 border-t border-edge-subtle pt-4">
                <button type="button" className="flex items-center gap-2 text-xs font-medium text-fg-muted hover:text-fg" onClick={() => setEvidenceOpen((open) => !open)}>
                  {t.why}<ChevronDown className={cn('size-3.5 transition-transform', evidenceOpen && 'rotate-180')} />
                </button>
                {evidenceOpen ? (
                  <div className="mt-3 space-y-3 text-xs leading-5 text-fg-muted">
                    <p className="text-fg-subtle">{t.evidenceHint}</p>
                    {run.result?.currentState ? <p>{run.result.currentState}</p> : null}
                    {workThreads.length ? <div className="flex flex-wrap gap-2">{workThreads.map((thread) => <span key={thread.id} className="rounded-full bg-surface-muted px-2.5 py-1"><span className="font-medium text-fg">{thread.title}</span> · {thread.horizon === 'current' ? t.current : thread.horizon === 'ongoing' ? t.ongoing : t.longTerm}</span>)}</div> : null}
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
            <div className="xopc-reveal-calibration mx-auto mt-7 w-full max-w-xl rounded-2xl border border-edge bg-surface-panel/80 p-5 text-left shadow-surface backdrop-blur-xl">
              <label className="text-sm font-semibold text-fg" htmlFor="understanding-correction">{t.correctionTitle}</label>
              <textarea id="understanding-correction" autoFocus value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder={t.correctionPlaceholder} className="mt-3 min-h-24 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm leading-6 text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/15" />
              <div className="mt-4 flex justify-end gap-2">
                {!run.result?.lowConfidence ? <Button variant="ghost" disabled={summaryConfirmed} onClick={() => setCorrectionOpen(false)}>{t.cancel}</Button> : null}
                <Button variant="primary" disabled={summaryConfirmed || !correction.trim()} onClick={() => void advanceAfterSummary('corrected')}>{t.continueWithCorrection}</Button>
              </div>
            </div>
          )}
          {summaryConfirmed && activityRunning ? <p className="mx-auto mt-5 flex items-center gap-2 text-xs text-fg-muted"><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />{t.sourcesFinishing}</p> : null}
          {error ? <p className="mt-5 text-sm text-danger" role="alert">{error}</p> : null}
        </div>
      ) : null}

      {step === 'memory' && memoryCandidate ? (
        <div className="xopc-reveal-scene mx-auto flex w-full max-w-[38rem] flex-1 flex-col justify-center py-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-fg">{t.memoryEyebrow}</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-fg">{t.memoryTitle}</h1>
          <article className="xopc-understanding-review-card mt-7 rounded-[1.75rem] border border-white/70 bg-white/75 p-6 text-left shadow-elevated backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-fg"><Sparkles className="size-5" /></div>
              <div className="min-w-0 flex-1">
                {editingMemory ? <textarea autoFocus value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} className="min-h-28 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-base leading-7 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" /> : <p className="text-lg font-medium leading-8 text-fg">{memoryCandidate.statement}</p>}
                {memoryCandidate.evidence.length ? <details className="group mt-5 border-t border-edge-subtle pt-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-fg-muted marker:content-none">{t.source}<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><ul className="mt-3 space-y-2 text-xs leading-5 text-fg-muted">{memoryCandidate.evidence.slice(0, 3).map((item) => <li key={item} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-accent/70" />{item}</li>)}</ul></details> : null}
              </div>
            </div>
            {editingMemory ? <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse"><Button variant="primary" disabled={busy || !memoryDraft.trim()} onClick={() => void reviewMemory('edited', memoryDraft.trim())}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t.saveEdit}</Button><Button variant="ghost" disabled={busy} onClick={() => setEditingMemory(false)}>{t.cancel}</Button></div> : <div className="mt-7 flex flex-col gap-3 sm:flex-row-reverse"><Button variant="primary" disabled={busy} onClick={() => void reviewMemory('accepted')}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t.remember}</Button><Button variant="secondary" disabled={busy} onClick={() => void reviewMemory('rejected')}>{t.sessionOnly}</Button><Button variant="ghost" disabled={busy} onClick={() => setEditingMemory(true)}><Pencil className="size-4" />{t.edit}</Button></div>}
          </article>
          <p className="mt-5 text-xs leading-5 text-fg-muted">{t.trustNote}</p>
          {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
        </div>
      ) : null}

      {step === 'focus' && focusCandidate ? (
        <div className="xopc-reveal-scene mx-auto flex w-full max-w-[38rem] flex-1 flex-col justify-center py-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-fg">{t.focusEyebrow}</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-fg">{t.focusTitle}</h1>
          <article className="xopc-understanding-review-card mt-7 rounded-[1.75rem] border border-white/70 bg-white/75 p-7 text-left shadow-elevated backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 sm:p-9">
            <div className="flex items-start gap-4"><span className="mt-2 size-3 shrink-0 rounded-full bg-accent" /><div><p className="text-xl font-semibold tracking-tight text-fg">{focusCandidate.title}</p><p className="mt-3 text-sm leading-6 text-fg-muted">{focusCandidate.summary}</p><p className="mt-5 flex items-start gap-2 rounded-xl bg-surface-muted/80 px-3 py-2.5 text-xs leading-5 text-fg-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-fg" />{t.focusHint}</p></div></div>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row-reverse"><Button variant="primary" disabled={busy} onClick={() => void reviewFocus(true)}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t.activateFocus}</Button><Button variant="secondary" disabled={busy} onClick={() => void reviewFocus(false)}>{t.notNow}</Button></div>
          </article>
          <p className="mt-5 text-xs leading-5 text-fg-muted">{t.trustNote}</p>
          {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function UnderstandingConstellation() {
  return (
    <div className="pointer-events-none absolute -right-10 -top-12 size-52 opacity-45" aria-hidden>
      <span className="absolute inset-[12%] rounded-full border border-accent/15" />
      <span className="absolute inset-[28%] rounded-full border border-accent/20" />
      <span className="absolute left-[45%] top-[45%] size-[10%] rounded-full bg-accent shadow-[0_0_28px_rgba(54,123,245,0.5)]" />
      <span className="absolute left-[12%] top-[36%] size-2.5 rounded-full bg-accent/55" />
      <span className="absolute right-[14%] top-[24%] size-2 rounded-full bg-cyan-400/65" />
      <span className="absolute bottom-[15%] right-[30%] size-2.5 rounded-full bg-accent/35" />
    </div>
  );
}
