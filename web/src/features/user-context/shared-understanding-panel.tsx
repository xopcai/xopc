import * as Dialog from '@radix-ui/react-dialog';
import { Check, ChevronRight, Eye, History, Network, Pencil, Plus, Sparkles, Target, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';

import {
  createUnderstanding,
  fetchUnderstandingEvidence,
  updateUnderstanding,
  updateUserFocus,
  type ContextEvidence,
  type UnderstandingKind,
  type UserFocus,
  type UserUnderstanding,
} from './user-context-api';
import { SharedUnderstandingMap } from './shared-understanding-map';
import {
  buildSharedUnderstandingModel,
  type SharedUnderstandingReviewItem,
  type SharedUnderstandingTimelineItem,
} from './shared-understanding-model';
import { UNDERSTANDING_KIND_LABELS } from './understanding-kind-labels';

type SharedView = 'portrait' | 'map' | 'changes' | 'review';
type PortraitSelection = { type: 'focus'; item: UserFocus } | { type: 'understanding'; item: UserUnderstanding };

const COPY = {
  en: {
    eyebrow: 'YOU, NOW', intro: 'A living, correctable portrait of what matters now and what remains true over time.',
    add: 'Add understanding', portrait: 'Now', map: 'Relationships', changes: 'Recent changes', review: 'Review',
    portraitHint: 'This is the context xopc will use when helping you now.', importantNow: 'Important now',
    lastingPortrait: 'What continues to shape the portrait', lastingHint: 'Confirmed context that can travel across conversations.',
    noFocus: 'No active focus yet. Tell xopc what matters now, or confirm a suggested focus.',
    noUnderstanding: 'No confirmed understanding yet. Add one directly or review a suggestion.',
    selectedDetail: 'Selected understanding', focusDetail: 'Selected focus', scope: 'Scope', source: 'Origin',
    global: 'Across xopc', workspace: 'Workspace', project: 'Project', session: 'Conversation',
    explicit: 'Told by you', observed: 'Observed over time', inferred: 'Inferred — may be wrong',
    validSince: 'Valid since', validUntil: 'Valid until', updated: 'Updated', reviewDue: 'Review due',
    edit: 'Edit', save: 'Save', cancel: 'Cancel', pause: 'Pause', complete: 'Complete', archive: 'Archive', incorrect: 'Not true',
    evidence: 'View evidence', evidenceTitle: 'Why xopc holds this', evidenceLoading: 'Loading evidence…', evidenceEmpty: 'No displayable evidence is linked.', evidenceError: 'Evidence could not be loaded.',
    changesIntro: 'A timeline of when the portrait formed, changed, or stopped applying. It shows state changes without inventing a diff.',
    timelineEmpty: 'There are no changes yet.', formed: 'Formed', changed: 'Updated', proposed: 'Proposed', needsReview: 'Needs review',
    paused: 'Paused', completed: 'Completed', rejected: 'Marked incorrect', archived: 'Archived',
    reviewTitle: 'One decision at a time', reviewHint: 'Suggestions do not affect xopc until you confirm them.',
    later: 'Later', yes: 'Yes', change: 'Needs changes', wrong: 'Not true', saveConfirm: 'Save and confirm', confidence: 'confidence',
    focusCandidate: 'Suggested focus', understandingCandidate: 'Suggested understanding', high: 'high', medium: 'medium', low: 'low', noReview: 'Nothing needs your review.',
    statement: 'What should xopc understand?', type: 'Type', create: 'Add',
  },
  zh: {
    eyebrow: '此刻的你', intro: '一份会随时间生长、可以随时纠正的画像：既看此刻重要的事，也保留长期成立的理解。',
    add: '添加理解', portrait: '此刻', map: '关系', changes: '最近变化', review: '待确认',
    portraitHint: '这是 xopc 此刻帮助你时会使用的上下文。', importantNow: '此刻重要',
    lastingPortrait: '持续构成画像的理解', lastingHint: '已经确认、可以跨对话使用的上下文。',
    noFocus: '还没有进行中的关注。你可以告诉 xopc 此刻什么最重要，或确认一条候选关注。',
    noUnderstanding: '还没有已确认的理解。你可以直接添加，或确认一条建议。',
    selectedDetail: '选中的理解', focusDetail: '选中的关注', scope: '适用范围', source: '形成方式',
    global: '全局适用', workspace: '工作区', project: '项目', session: '当前对话',
    explicit: '由你直接告知', observed: '从长期共事中观察到', inferred: '推断内容，可能有误',
    validSince: '开始成立', validUntil: '有效至', updated: '最近更新', reviewDue: '建议复核',
    edit: '编辑', save: '保存', cancel: '取消', pause: '暂停', complete: '完成', archive: '归档', incorrect: '不正确',
    evidence: '查看依据', evidenceTitle: 'xopc 为什么这样理解', evidenceLoading: '正在读取依据…', evidenceEmpty: '暂时没有可展示的依据。', evidenceError: '暂时无法读取依据。',
    changesIntro: '按时间呈现画像何时形成、更新或不再适用；只表达状态变化，不虚构具体差异。',
    timelineEmpty: '还没有画像变化。', formed: '形成', changed: '更新', proposed: '提出建议', needsReview: '需要复核',
    paused: '已暂停', completed: '已完成', rejected: '标记为不正确', archived: '已归档',
    reviewTitle: '一次只确认一条', reviewHint: '建议内容在你确认前不会影响 xopc 的行动。',
    later: '稍后', yes: '是的', change: '需要修改', wrong: '不是这样', saveConfirm: '保存并确认', confidence: '把握',
    focusCandidate: '候选关注', understandingCandidate: '候选理解', high: '高', medium: '中', low: '低', noReview: '目前没有需要你确认的内容。',
    statement: '希望 xopc 了解什么？', type: '类型', create: '添加',
  },
} as const;

type Copy = typeof COPY.en | typeof COPY.zh;

const inputClass = 'w-full rounded-xl border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20';

export function SharedUnderstandingPanel({ focuses, understandings, language, onRefresh }: {
  focuses: UserFocus[];
  understandings: UserUnderstanding[];
  language: 'en' | 'zh';
  onRefresh: () => Promise<unknown>;
}) {
  const t = COPY[language];
  const model = useMemo(() => buildSharedUnderstandingModel(focuses, understandings), [focuses, understandings]);
  const [view, setView] = useState<SharedView>('portrait');
  const [creating, setCreating] = useState(false);

  return <div className="space-y-5">
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t.eyebrow}</p>
        <p className="mt-2 text-sm leading-6 text-fg-muted">{t.intro}</p>
      </div>
      <Button variant="primary" className="shrink-0" onClick={() => setCreating(true)}><Plus className="size-4" />{t.add}</Button>
    </header>

    <div className="flex gap-1 overflow-x-auto border-b border-edge" role="tablist" aria-label={language === 'zh' ? '共同理解视图' : 'Shared understanding views'}>
      <ViewTab selected={view === 'portrait'} onClick={() => setView('portrait')} icon={<Target className="size-3.5" />} label={t.portrait} count={model.currentFocuses.length} />
      <ViewTab selected={view === 'map'} onClick={() => setView('map')} icon={<Network className="size-3.5" />} label={t.map} />
      <ViewTab selected={view === 'changes'} onClick={() => setView('changes')} icon={<History className="size-3.5" />} label={t.changes} />
      <ViewTab selected={view === 'review'} onClick={() => setView('review')} icon={<Sparkles className="size-3.5" />} label={t.review} count={model.reviewQueue.length} emphasize={model.reviewQueue.length > 0} />
    </div>

    {view === 'portrait' ? <PortraitView focuses={model.currentFocuses} understandings={model.activeUnderstandings} language={language} t={t} onRefresh={onRefresh} /> : null}
    {view === 'map' ? <SharedUnderstandingMap focuses={model.currentFocuses} understandings={understandings} language={language} onRefresh={onRefresh} onOpenReview={() => setView('review')} /> : null}
    {view === 'changes' ? <ChangesTimeline items={model.timeline} language={language} t={t} /> : null}
    {view === 'review' ? <ReviewQueue items={model.reviewQueue} language={language} t={t} onRefresh={onRefresh} /> : null}

    <CreateUnderstandingDialog open={creating} onOpenChange={setCreating} language={language} t={t} onCreated={onRefresh} />
  </div>;
}

function ViewTab({ selected, onClick, icon, label, count, emphasize = false }: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  emphasize?: boolean;
}) {
  return <button type="button" role="tab" aria-selected={selected} onClick={onClick}
    className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors ${selected ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}>
    {icon}<span>{label}</span>{count !== undefined ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${emphasize ? 'bg-accent-soft text-accent-fg' : 'bg-surface-muted text-fg-subtle'}`}>{count}</span> : null}
  </button>;
}

function PortraitView({ focuses, understandings, language, t, onRefresh }: {
  focuses: UserFocus[];
  understandings: UserUnderstanding[];
  language: 'en' | 'zh';
  t: Copy;
  onRefresh: () => Promise<unknown>;
}) {
  const initialSelection: PortraitSelection | null = focuses[0]
    ? { type: 'focus', item: focuses[0] }
    : understandings[0] ? { type: 'understanding', item: understandings[0] } : null;
  const [selectionKey, setSelectionKey] = useState(initialSelection ? `${initialSelection.type}:${initialSelection.item.id}` : '');
  const selection = resolveSelection(selectionKey, focuses, understandings) ?? initialSelection;
  const leadFocus = focuses[0];

  useEffect(() => {
    if (selection || !initialSelection) return;
    setSelectionKey(`${initialSelection.type}:${initialSelection.item.id}`);
  }, [initialSelection, selection]);

  if (!leadFocus && !understandings.length) return <EmptyState>{t.noFocus}</EmptyState>;

  return <div className="space-y-5">
    <section className="relative overflow-hidden rounded-3xl border border-edge bg-surface-panel">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/45 to-transparent" aria-hidden="true" />
      <div className="grid gap-8 px-5 py-7 sm:px-8 sm:py-9 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12 lg:px-10 lg:py-11">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent"><Sparkles className="size-3.5" />{t.portraitHint}</div>
          {leadFocus ? <>
            <button type="button" className="mt-7 block max-w-3xl text-left" onClick={() => setSelectionKey(`focus:${leadFocus.id}`)}>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-fg sm:text-3xl">{leadFocus.title}</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-fg-muted sm:text-base">{leadFocus.summary}</p>
            </button>
            <p className="mt-7 text-xs text-fg-subtle">{t.updated} · {formatDate(leadFocus.updatedAt, language)}</p>
          </> : <p className="mt-7 max-w-2xl text-base leading-7 text-fg-muted">{t.noFocus}</p>}
        </div>
        <div className="rounded-2xl border border-edge bg-surface-base/70 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-fg-subtle">{t.importantNow}</p>
          {focuses.length ? <div className="mt-4 space-y-1">
            {focuses.map((focus, index) => <button key={focus.id} type="button" onClick={() => setSelectionKey(`focus:${focus.id}`)} className={`group flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${selection?.type === 'focus' && selection.item.id === focus.id ? 'bg-accent-soft' : 'hover:bg-surface-hover'}`}>
              <span className={`mt-2 size-1.5 shrink-0 rounded-full ${index === 0 ? 'bg-accent' : 'bg-success'}`} />
              <span className="min-w-0 flex-1"><span className="line-clamp-2 text-sm leading-6 text-fg">{focus.title}</span><span className="mt-0.5 block text-[11px] text-fg-subtle">{formatDate(focus.updatedAt, language)}</span></span>
              <ChevronRight className="mt-1 size-3.5 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
            </button>)}
          </div> : <p className="mt-4 text-sm leading-6 text-fg-muted">{t.noFocus}</p>}
        </div>
      </div>
    </section>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="rounded-2xl border border-edge bg-surface-panel p-4 sm:p-5">
        <div><h3 className="text-sm font-semibold text-fg">{t.lastingPortrait}</h3><p className="mt-1 text-xs leading-5 text-fg-muted">{t.lastingHint}</p></div>
        {understandings.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {understandings.map((item) => {
            const selected = selection?.type === 'understanding' && selection.item.id === item.id;
            return <button key={item.id} type="button" onClick={() => setSelectionKey(`understanding:${item.id}`)} className={`group min-h-28 rounded-xl border p-3.5 text-left transition-colors ${selected ? 'border-accent bg-accent-soft ring-2 ring-accent/10' : 'border-edge bg-surface-base/50 hover:bg-surface-hover'}`}>
              <span className="flex items-center justify-between gap-2 text-[11px] text-fg-subtle"><span>{UNDERSTANDING_KIND_LABELS[item.kind][language]}</span><span>{formatDate(item.updatedAt, language)}</span></span>
              <span className="mt-2 line-clamp-3 block text-sm leading-6 text-fg">{item.statement}</span>
            </button>;
          })}
        </div> : <p className="mt-5 rounded-xl border border-dashed border-edge px-4 py-8 text-center text-sm leading-6 text-fg-muted">{t.noUnderstanding}</p>}
      </section>
      {selection ? <PortraitDetail selection={selection} language={language} t={t} onRefresh={onRefresh} /> : null}
    </div>
  </div>;
}

function resolveSelection(key: string, focuses: UserFocus[], understandings: UserUnderstanding[]): PortraitSelection | null {
  const [type, id] = key.split(':', 2);
  if (type === 'focus') {
    const item = focuses.find((focus) => focus.id === id);
    return item ? { type: 'focus', item } : null;
  }
  if (type === 'understanding') {
    const item = understandings.find((understanding) => understanding.id === id);
    return item ? { type: 'understanding', item } : null;
  }
  return null;
}

function PortraitDetail({ selection, language, t, onRefresh }: {
  selection: PortraitSelection;
  language: 'en' | 'zh';
  t: Copy;
  onRefresh: () => Promise<unknown>;
}) {
  const item = selection.item;
  const understanding = selection.type === 'understanding' ? selection.item : null;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(selection.type === 'focus' ? selection.item.title : '');
  const [statement, setStatement] = useState(selection.type === 'focus' ? selection.item.summary : selection.item.statement);
  const [pending, setPending] = useState(false);
  const [evidenceState, setEvidenceState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [evidence, setEvidence] = useState<ContextEvidence[]>([]);

  useEffect(() => {
    setEditing(false);
    setTitle(selection.type === 'focus' ? selection.item.title : '');
    setStatement(selection.type === 'focus' ? selection.item.summary : selection.item.statement);
    setEvidenceState('idle');
    setEvidence([]);
  }, [selection.type, selection.item.id]);

  const mutate = async (action: () => Promise<unknown>) => {
    setPending(true);
    try { await action(); await onRefresh(); } finally { setPending(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!statement.trim() || (selection.type === 'focus' && !title.trim())) return;
    await mutate(() => selection.type === 'focus'
      ? updateUserFocus(selection.item.id, { title: title.trim(), summary: statement.trim() })
      : updateUnderstanding(selection.item.id, { statement: statement.trim() }));
    setEditing(false);
  };
  const loadEvidence = async () => {
    if (!understanding || evidenceState === 'loading') return;
    setEvidenceState('loading');
    try {
      const response = await fetchUnderstandingEvidence(understanding.id);
      setEvidence(response.evidence);
      setEvidenceState('loaded');
    } catch {
      setEvidenceState('error');
    }
  };

  const sourceLabel = item.explicitness === 'explicit' ? t.explicit : item.explicitness === 'observed' ? t.observed : t.inferred;
  return <aside className="self-start overflow-hidden rounded-2xl border border-edge bg-surface-panel lg:sticky lg:top-5">
    <div className="border-b border-edge px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">{selection.type === 'focus' ? t.focusDetail : t.selectedDetail}</p>
      {editing ? <form className="mt-3 space-y-3" onSubmit={submit}>
        {selection.type === 'focus' ? <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} /> : null}
        <textarea autoFocus className={inputClass} rows={5} value={statement} onChange={(event) => setStatement(event.target.value)} />
        <div className="flex justify-end gap-2"><Button type="button" disabled={pending} onClick={() => setEditing(false)}>{t.cancel}</Button><Button type="submit" variant="primary" disabled={pending || !statement.trim() || (selection.type === 'focus' && !title.trim())}>{t.save}</Button></div>
      </form> : <>
        <h3 className="mt-3 text-base font-semibold leading-6 text-fg">{selection.type === 'focus' ? selection.item.title : selection.item.statement}</h3>
        {selection.type === 'focus' ? <p className="mt-2 text-sm leading-6 text-fg-muted">{selection.item.summary}</p> : null}
      </>}
    </div>
    {!editing ? <div className="space-y-5 px-5 py-4">
      <dl className="space-y-3 text-xs">
        <DetailRow label={t.source} value={sourceLabel} />
        <DetailRow label={t.scope} value={scopeLabel(item.scope, t)} />
        <DetailRow label={t.updated} value={formatDate(item.updatedAt, language, true)} />
        {item.validFrom ? <DetailRow label={t.validSince} value={formatDate(item.validFrom, language, true)} /> : null}
        {item.validTo ? <DetailRow label={t.validUntil} value={formatDate(item.validTo, language, true)} /> : null}
        {item.reviewAt ? <DetailRow label={t.reviewDue} value={formatDate(item.reviewAt, language, true)} /> : null}
      </dl>

      {understanding ? <div>
        <button type="button" onClick={() => void loadEvidence()} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline"><Eye className="size-3.5" />{t.evidence}</button>
        {evidenceState !== 'idle' ? <div className="mt-2 rounded-xl bg-surface-muted p-3">
          <p className="text-xs font-medium text-fg-muted">{t.evidenceTitle}</p>
          {evidenceState === 'loading' ? <p className="mt-2 text-xs text-fg-subtle">{t.evidenceLoading}</p> : null}
          {evidenceState === 'error' ? <p className="mt-2 text-xs text-danger">{t.evidenceError}</p> : null}
          {evidenceState === 'loaded' && !evidence.length ? <p className="mt-2 text-xs text-fg-subtle">{t.evidenceEmpty}</p> : null}
          {evidence.length ? <div className="mt-2 space-y-2">{evidence.slice(0, 4).map((entry) => <EvidenceItem key={entry.id} evidence={entry} language={language} />)}</div> : null}
        </div> : null}
      </div> : null}

      <div className="flex flex-wrap gap-2 border-t border-edge pt-4">
        <Button disabled={pending} onClick={() => setEditing(true)}><Pencil className="size-3.5" />{t.edit}</Button>
        {selection.type === 'focus' ? <>
          <Button variant="ghost" disabled={pending} onClick={() => void mutate(() => updateUserFocus(selection.item.id, { status: 'paused' }))}>{t.pause}</Button>
          <Button variant="ghost" disabled={pending} onClick={() => void mutate(() => updateUserFocus(selection.item.id, { status: 'completed' }))}><Check className="size-3.5" />{t.complete}</Button>
        </> : <>
          <Button variant="ghost" disabled={pending} onClick={() => void mutate(() => updateUnderstanding(selection.item.id, { status: 'archived' }))}>{t.archive}</Button>
          <Button variant="ghost" className="text-danger" disabled={pending} onClick={() => void mutate(() => updateUnderstanding(selection.item.id, { status: 'rejected' }))}>{t.incorrect}</Button>
        </>}
      </div>
    </div> : null}
  </aside>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><dt className="shrink-0 text-fg-subtle">{label}</dt><dd className="text-right leading-5 text-fg-muted">{value}</dd></div>;
}

function EvidenceItem({ evidence, language }: { evidence: ContextEvidence; language: 'en' | 'zh' }) {
  const sourceLabels: Record<ContextEvidence['sourceType'], { en: string; zh: string }> = {
    conversation: { en: 'Conversation', zh: '对话' }, connector: { en: 'Connected source', zh: '连接的数据源' },
    user: { en: 'Direct input', zh: '直接输入' }, runtime: { en: 'Work context', zh: '工作过程' },
  };
  return <div className="border-l-2 border-edge-strong pl-2.5">
    <p className="text-[11px] text-fg-subtle">{sourceLabels[evidence.sourceType][language]} · {formatDate(evidence.observedAt, language)}</p>
    {evidence.redactedExcerpt ? <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-fg-muted">{evidence.redactedExcerpt}</p> : null}
  </div>;
}

function ChangesTimeline({ items, language, t }: {
  items: SharedUnderstandingTimelineItem[];
  language: 'en' | 'zh';
  t: Copy;
}) {
  if (!items.length) return <EmptyState>{t.timelineEmpty}</EmptyState>;
  return <section className="overflow-hidden rounded-2xl border border-edge bg-surface-panel">
    <header className="border-b border-edge px-5 py-4"><p className="max-w-2xl text-xs leading-5 text-fg-muted">{t.changesIntro}</p></header>
    <div className="px-4 py-2 sm:px-6">
      {items.map((item, index) => {
        const status = item.type === 'focus' ? item.focus.status : item.understanding.status;
        const object = item.type === 'focus' ? item.focus : item.understanding;
        const text = item.type === 'focus' ? item.focus.title : item.understanding.statement;
        const label = timelineLabel(status, object.createdAt === object.updatedAt, t);
        const kind = item.type === 'focus' ? t.importantNow : UNDERSTANDING_KIND_LABELS[item.understanding.kind][language];
        const inactive = ['paused', 'completed', 'rejected', 'archived'].includes(status);
        return <article key={`${item.type}:${item.id}`} className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[6.5rem_1.25rem_minmax(0,1fr)] sm:gap-4">
          <time className="hidden pt-0.5 text-right text-[11px] tabular-nums text-fg-subtle sm:block">{formatDate(item.updatedAt, language)}</time>
          {index < items.length - 1 ? <span className="absolute bottom-0 left-[0.6rem] top-7 w-px bg-edge sm:left-[7.9rem]" aria-hidden="true" /> : null}
          <span className={`relative z-10 mt-1 size-2.5 rounded-full border-2 border-surface-panel ${inactive ? 'bg-fg-subtle' : status === 'active' ? 'bg-success' : 'bg-warning'}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-[11px] font-medium text-accent">{label}</span><span className="text-[11px] text-fg-subtle">{kind}</span><time className="text-[11px] text-fg-subtle sm:hidden">{formatDate(item.updatedAt, language)}</time></div>
            <p className={`mt-1 text-sm leading-6 ${inactive ? 'text-fg-muted' : 'text-fg'}`}>{text}</p>
          </div>
        </article>;
      })}
    </div>
  </section>;
}

function timelineLabel(status: UserFocus['status'] | UserUnderstanding['status'], newlyCreated: boolean, t: Copy): string {
  if (status === 'candidate') return t.proposed;
  if (status === 'needs_review' || status === 'stale') return t.needsReview;
  if (status === 'paused') return t.paused;
  if (status === 'completed') return t.completed;
  if (status === 'rejected') return t.rejected;
  if (status === 'archived') return t.archived;
  return newlyCreated ? t.formed : t.changed;
}

function scopeLabel(scope: UserFocus['scope'], t: Copy): string {
  const base = scope.type === 'global' ? t.global : scope.type === 'workspace' ? t.workspace : scope.type === 'project' ? t.project : t.session;
  return scope.id ? `${base} · ${scope.id}` : base;
}

function formatDate(timestamp: number, language: 'en' | 'zh', includeYear = false): string {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    ...(includeYear ? { year: 'numeric' as const } : {}), month: 'short', day: 'numeric',
  }).format(new Date(timestamp));
}

function ReviewQueue({ items, language, t, onRefresh }: {
  items: SharedUnderstandingReviewItem[];
  language: 'en' | 'zh';
  t: Copy;
  onRefresh: () => Promise<unknown>;
}) {
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const currentIndex = items.length ? index % items.length : 0;
  const item = items[currentIndex];
  useEffect(() => { setIndex(0); setEditing(false); }, [items.length]);
  if (!item) return <EmptyState>{t.noReview}</EmptyState>;

  const decide = async (accepted: boolean) => {
    setPending(true);
    try {
      if (item.type === 'focus') await updateUserFocus(item.id, { status: accepted ? 'active' : 'rejected' });
      else await updateUnderstanding(item.id, { status: accepted ? 'active' : 'rejected' });
      await onRefresh();
    } finally { setPending(false); }
  };

  return <section className="mx-auto max-w-2xl">
    <div className="flex items-center justify-between text-xs text-fg-muted"><span>{t.reviewTitle}</span><span className="tabular-nums">{currentIndex + 1} / {items.length}</span></div>
    <article className="mt-3 rounded-2xl border border-edge bg-surface-panel p-5 sm:p-6">
      <ReviewItemContent item={item} language={language} t={t} editing={editing} pending={pending} onCancelEdit={() => setEditing(false)} onSaved={onRefresh} />
      {!editing ? <>
        <p className="mt-5 rounded-xl bg-surface-muted px-3 py-2.5 text-xs leading-5 text-fg-muted">{t.reviewHint}</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <Button variant="primary" disabled={pending} onClick={() => void decide(true)}><Check className="size-4" />{t.yes}</Button>
          <Button disabled={pending} onClick={() => setEditing(true)}>{t.change}</Button>
          <Button variant="ghost" className="text-danger" disabled={pending} onClick={() => void decide(false)}>{t.wrong}</Button>
        </div>
        {items.length > 1 ? <button type="button" className="mx-auto mt-3 block rounded-md px-2 py-1 text-xs text-fg-muted hover:text-fg" onClick={() => setIndex((current) => (current + 1) % items.length)}>{t.later}</button> : null}
      </> : null}
    </article>
  </section>;
}

function ReviewItemContent({ item, language, t, editing, pending, onCancelEdit, onSaved }: {
  item: SharedUnderstandingReviewItem;
  language: 'en' | 'zh';
  t: Copy;
  editing: boolean;
  pending: boolean;
  onCancelEdit: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [title, setTitle] = useState(item.type === 'focus' ? item.focus.title : '');
  const [statement, setStatement] = useState(item.type === 'focus' ? item.focus.summary : item.understanding.statement);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setTitle(item.type === 'focus' ? item.focus.title : '');
    setStatement(item.type === 'focus' ? item.focus.summary : item.understanding.statement);
  }, [item]);
  const confidence = item.type === 'focus' ? item.focus.confidence : item.understanding.confidence;
  const confidenceLabel = confidence >= 0.85 ? t.high : confidence >= 0.65 ? t.medium : t.low;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!statement.trim() || (item.type === 'focus' && !title.trim())) return;
    setSaving(true);
    try {
      if (item.type === 'focus') await updateUserFocus(item.id, { title, summary: statement, status: 'active' });
      else await updateUnderstanding(item.id, { statement, status: 'active' });
      await onSaved();
    } finally { setSaving(false); }
  };
  if (editing) return <form onSubmit={save} className="space-y-3">
    {item.type === 'focus' ? <input autoFocus className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} /> : null}
    <textarea autoFocus={item.type === 'understanding'} className={inputClass} rows={4} value={statement} onChange={(event) => setStatement(event.target.value)} />
    <div className="flex justify-end gap-2"><Button type="button" disabled={saving} onClick={onCancelEdit}>{t.cancel}</Button><Button type="submit" variant="primary" disabled={pending || saving || !statement.trim() || (item.type === 'focus' && !title.trim())}>{t.saveConfirm}</Button></div>
  </form>;
  const understanding = item.type === 'understanding' ? item.understanding : null;
  const source = understanding ? understanding.explicitness === 'explicit' ? t.explicit : understanding.explicitness === 'observed' ? t.observed : t.inferred : t.inferred;
  return <>
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      <span className="font-medium text-accent">{item.type === 'focus' ? t.focusCandidate : t.understandingCandidate}</span><span>·</span><span>{t.confidence} {confidenceLabel}</span>
      {understanding ? <><span>·</span><span>{UNDERSTANDING_KIND_LABELS[understanding.kind][language]}</span></> : null}
    </div>
    {item.type === 'focus' ? <><h2 className="mt-4 text-lg font-semibold leading-7 text-fg">{item.focus.title}</h2><p className="mt-2 text-sm leading-6 text-fg-muted">{item.focus.summary}</p></> : <p className="mt-4 text-lg font-semibold leading-8 text-fg">{item.understanding.statement}</p>}
    <p className="mt-4 text-xs text-fg-subtle">{source}</p>
  </>;
}

function CreateUnderstandingDialog({ open, onOpenChange, language, t, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: 'en' | 'zh';
  t: Copy;
  onCreated: () => Promise<unknown>;
}) {
  const [statement, setStatement] = useState('');
  const [kind, setKind] = useState<UnderstandingKind>('preference');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!statement.trim()) return;
    await createUnderstanding({ statement, kind });
    setStatement('');
    onOpenChange(false);
    await onCreated();
  };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] flex h-[min(30rem,calc(100vh-2rem))] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
      <form className="flex h-full min-h-0 flex-col" onSubmit={submit}>
        <header className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4"><Dialog.Title className="text-base font-semibold text-fg">{t.add}</Dialog.Title><Dialog.Close asChild><Button type="button" variant="ghost" className="size-8 p-0" aria-label={t.cancel}><X className="size-4" /></Button></Dialog.Close></header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block space-y-1.5 text-sm"><span className="font-medium text-fg">{t.statement}</span><textarea autoFocus className={inputClass} rows={4} value={statement} onChange={(event) => setStatement(event.target.value)} /></label>
          <label className="block space-y-1.5 text-sm"><span className="font-medium text-fg">{t.type}</span><Select value={kind} onChange={(event) => setKind(event.target.value as UnderstandingKind)}>{Object.entries(UNDERSTANDING_KIND_LABELS).map(([value, label]) => <SelectOption key={value} value={value}>{label[language]}</SelectOption>)}</Select></label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-edge px-5 py-3"><Dialog.Close asChild><Button type="button">{t.cancel}</Button></Dialog.Close><Button type="submit" variant="primary" disabled={!statement.trim()}>{t.create}</Button></footer>
      </form>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-edge px-5 py-12 text-center text-sm leading-6 text-fg-muted">{children}</div>;
}
