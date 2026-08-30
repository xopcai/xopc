import * as Dialog from '@radix-ui/react-dialog';
import { Archive, Check, Clock3, Network, Plus, Sparkles, Target, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';

import {
  createUnderstanding,
  updateUnderstanding,
  updateUserFocus,
  type UnderstandingKind,
  type UserFocus,
  type UserUnderstanding,
} from './user-context-api';
import { SharedUnderstandingMap } from './shared-understanding-map';
import {
  buildSharedUnderstandingModel,
  rankUnderstandingRelations,
  type SharedUnderstandingReviewItem,
} from './shared-understanding-model';
import { UNDERSTANDING_KIND_LABELS } from './understanding-kind-labels';

type SharedView = 'current' | 'map' | 'review' | 'history';

const COPY = {
  en: {
    intro: 'What xopc will use when helping you now. Review suggestions separately; completed and incorrect items stay in history.',
    add: 'Add understanding', current: 'Current focus', map: 'Possible connections', review: 'Review', history: 'History',
    noFocus: 'No active focus yet. Confirm a suggestion when one appears, or tell xopc what matters now.',
    related: 'possibly related context', noRelated: 'No possible connection yet',
    reviewTitle: 'One decision at a time', reviewHint: 'Suggestions do not affect xopc until you confirm them.',
    later: 'Later', yes: 'Yes', change: 'Needs changes', wrong: 'Not true', saveConfirm: 'Save and confirm', cancel: 'Cancel',
    focusCandidate: 'Suggested focus', understandingCandidate: 'Suggested understanding', confidence: 'confidence',
    high: 'high', medium: 'medium', low: 'low', noReview: 'Nothing needs your review.',
    statement: 'What should xopc understand?', type: 'Type', create: 'Add', required: 'This field cannot be empty.',
    historyEmpty: 'No completed or incorrect items yet.', paused: 'Paused', completed: 'Completed', rejected: 'Incorrect', archived: 'Archived',
    explicit: 'You said this directly', observed: 'Observed across work', inferred: 'Inferred — may be wrong',
  },
  zh: {
    intro: '这里只呈现 xopc 此刻会使用的你。候选内容集中确认，已完成和不正确的内容收进历史。',
    add: '添加理解', current: '当前关注', map: '可能关联', review: '待确认', history: '历史',
    noFocus: '还没有进行中的关注。你可以确认一条建议，或直接告诉 xopc 此刻什么最重要。',
    related: '条可能相关的上下文', noRelated: '暂时没有可能关联',
    reviewTitle: '一次只确认一条', reviewHint: '建议内容在你确认前不会影响 xopc 的行动。',
    later: '稍后', yes: '是的', change: '需要修改', wrong: '不是这样', saveConfirm: '保存并确认', cancel: '取消',
    focusCandidate: '候选关注', understandingCandidate: '候选理解', confidence: '把握',
    high: '高', medium: '中', low: '低', noReview: '目前没有需要你确认的内容。',
    statement: '希望 xopc 了解什么？', type: '类型', create: '添加', required: '此项不能为空。',
    historyEmpty: '还没有已完成或不正确的内容。', paused: '已暂停', completed: '已完成', rejected: '不正确', archived: '已归档',
    explicit: '由你直接告知', observed: '从过往工作中观察到', inferred: '推断内容，可能有误',
  },
} as const;

const inputClass = 'w-full rounded-xl border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20';

export function SharedUnderstandingPanel({ focuses, understandings, language, onRefresh }: {
  focuses: UserFocus[];
  understandings: UserUnderstanding[];
  language: 'en' | 'zh';
  onRefresh: () => Promise<unknown>;
}) {
  const t = COPY[language];
  const model = useMemo(() => buildSharedUnderstandingModel(focuses, understandings), [focuses, understandings]);
  const [view, setView] = useState<SharedView>('current');
  const [creating, setCreating] = useState(false);

  return <div className="space-y-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <p className="max-w-2xl text-sm leading-6 text-fg-muted">{t.intro}</p>
      <Button variant="primary" className="shrink-0" onClick={() => setCreating(true)}><Plus className="size-4" />{t.add}</Button>
    </div>

    <div className="flex gap-1 overflow-x-auto border-b border-edge" role="tablist" aria-label={language === 'zh' ? '共同理解视图' : 'Shared understanding views'}>
      <ViewTab selected={view === 'current'} onClick={() => setView('current')} icon={<Target className="size-3.5" />} label={t.current} count={model.currentFocuses.length} />
      <ViewTab selected={view === 'map'} onClick={() => setView('map')} icon={<Network className="size-3.5" />} label={t.map} />
      <ViewTab selected={view === 'review'} onClick={() => setView('review')} icon={<Sparkles className="size-3.5" />} label={t.review} count={model.reviewQueue.length} emphasize={model.reviewQueue.length > 0} />
      <ViewTab selected={view === 'history'} onClick={() => setView('history')} icon={<Archive className="size-3.5" />} label={t.history} />
    </div>

    {view === 'current' ? <CurrentFocusView focuses={model.currentFocuses} understandings={understandings} language={language} t={t} /> : null}
    {view === 'map' ? <SharedUnderstandingMap focuses={model.currentFocuses} understandings={understandings} language={language} onRefresh={onRefresh} onOpenReview={() => setView('review')} /> : null}
    {view === 'review' ? <ReviewQueue items={model.reviewQueue} language={language} t={t} onRefresh={onRefresh} /> : null}
    {view === 'history' ? <HistoryView items={model.history} language={language} t={t} /> : null}

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
  return <button
    type="button"
    role="tab"
    aria-selected={selected}
    onClick={onClick}
    className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors ${selected ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg'}`}
  >{icon}<span>{label}</span>{count !== undefined ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${emphasize ? 'bg-accent-soft text-accent-fg' : 'bg-surface-muted text-fg-subtle'}`}>{count}</span> : null}</button>;
}

function CurrentFocusView({ focuses, understandings, language, t }: {
  focuses: UserFocus[];
  understandings: UserUnderstanding[];
  language: 'en' | 'zh';
  t: typeof COPY.en | typeof COPY.zh;
}) {
  if (!focuses.length) return <EmptyState>{t.noFocus}</EmptyState>;
  return <div className="grid gap-3 lg:grid-cols-2">
    {focuses.map((focus) => {
      const relations = rankUnderstandingRelations(focus, understandings, 3);
      return <article key={focus.id} className="rounded-2xl border border-edge bg-surface-panel p-5">
        <div className="flex items-start gap-3">
          <span className="mt-1 size-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-6 text-fg">{focus.title}</h2>
            <p className="mt-1 text-sm leading-6 text-fg-muted">{focus.summary}</p>
          </div>
        </div>
        <div className="mt-4 border-t border-edge pt-3">
          <p className="text-[11px] font-medium text-fg-subtle">{relations.length ? `${relations.length} ${t.related}` : t.noRelated}</p>
          {relations.length ? <div className="mt-2 grid gap-2">{relations.map(({ understanding }) => <p key={understanding.id} className="truncate rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-fg-muted">{UNDERSTANDING_KIND_LABELS[understanding.kind][language]} · {understanding.statement}</p>)}</div> : null}
        </div>
      </article>;
    })}
  </div>;
}

function ReviewQueue({ items, language, t, onRefresh }: {
  items: SharedUnderstandingReviewItem[];
  language: 'en' | 'zh';
  t: typeof COPY.en | typeof COPY.zh;
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
    } finally {
      setPending(false);
    }
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
  t: typeof COPY.en | typeof COPY.zh;
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
    } finally {
      setSaving(false);
    }
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

function HistoryView({ items, language, t }: {
  items: ReturnType<typeof buildSharedUnderstandingModel>['history'];
  language: 'en' | 'zh';
  t: typeof COPY.en | typeof COPY.zh;
}) {
  if (!items.length) return <EmptyState>{t.historyEmpty}</EmptyState>;
  return <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-panel">
    {items.map((item) => {
      const status = item.type === 'focus' ? item.focus.status : item.understanding.status;
      const statusLabel = status === 'paused' ? t.paused : status === 'completed' ? t.completed : status === 'archived' ? t.archived : t.rejected;
      const text = item.type === 'focus' ? item.focus.title : item.understanding.statement;
      const kind = item.type === 'focus' ? t.current : UNDERSTANDING_KIND_LABELS[item.understanding.kind][language];
      return <article key={`${item.type}:${item.id}`} className="flex items-start gap-3 px-4 py-3 sm:px-5">
        <Clock3 className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
        <div className="min-w-0 flex-1"><p className="text-sm leading-6 text-fg-muted">{text}</p><p className="mt-0.5 text-[11px] text-fg-subtle">{kind}</p></div>
        <span className="shrink-0 rounded-full bg-surface-muted px-2 py-1 text-[10px] text-fg-subtle">{statusLabel}</span>
      </article>;
    })}
  </div>;
}

function CreateUnderstandingDialog({ open, onOpenChange, language, t, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: 'en' | 'zh';
  t: typeof COPY.en | typeof COPY.zh;
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
