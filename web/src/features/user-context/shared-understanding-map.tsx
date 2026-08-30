import { CheckCircle2, Pencil, Target, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';

import { updateUnderstanding, updateUserFocus, type UserFocus, type UserUnderstanding } from './user-context-api';
import { rankUnderstandingRelations, type UnderstandingRelation } from './shared-understanding-model';
import { UNDERSTANDING_KIND_LABELS } from './understanding-kind-labels';

const NODE_POSITIONS = [
  { x: 15, y: 17 }, { x: 14, y: 51 }, { x: 19, y: 83 },
  { x: 85, y: 17 }, { x: 86, y: 51 }, { x: 81, y: 83 },
] as const;

const COPY = {
  en: {
    focus: 'Focus', selectFocus: 'Focus in view', you: 'You', active: 'Active', pending: 'Needs review',
    hint: 'These are possible connections inferred from scope and wording, not verified facts. Select a node to inspect the signal.',
    noFocus: 'Confirm a focus first, then xopc can show the context that affects it.',
    noRelations: 'No possible connection is strong enough to show yet.', why: 'Why it may be related',
    project_scope: 'It may be related because it belongs to the same project.', topic_overlap: 'Its wording overlaps this focus.',
    global_context: 'This global context may apply across your work.',
    edit: 'Edit', pause: 'Pause', complete: 'Complete', incorrect: 'Not true', archive: 'Move to history',
    save: 'Save', cancel: 'Cancel', review: 'Review this suggestion',
    explicit: 'You said this directly', observed: 'Observed across work', inferred: 'Inferred — may be wrong',
    relatedCount: 'possible connections',
  },
  zh: {
    focus: '当前关注', selectFocus: '图中关注', you: '你', active: '进行中', pending: '待确认',
    hint: '这些是根据范围和措辞推测的可能关联，并非已验证事实。点选节点可查看判断依据。',
    noFocus: '先确认一项关注，xopc 才能展示会影响它的上下文。',
    noRelations: '目前还没有足够明确的可能关联。', why: '为什么可能相关',
    project_scope: '它们可能相关，因为属于同一个项目。', topic_overlap: '它们的措辞与当前关注有所重叠。',
    global_context: '这条全局上下文可能适用于不同工作。',
    edit: '编辑', pause: '暂停', complete: '完成', incorrect: '不正确', archive: '移入历史',
    save: '保存', cancel: '取消', review: '去确认这条建议',
    explicit: '由你直接告知', observed: '从过往工作中观察到', inferred: '推断内容，可能有误',
    relatedCount: '条可能关联',
  },
} as const;

const inputClass = 'w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20';

export function SharedUnderstandingMap({ focuses, understandings, language, onRefresh, onOpenReview }: {
  focuses: UserFocus[];
  understandings: UserUnderstanding[];
  language: 'en' | 'zh';
  onRefresh: () => Promise<unknown>;
  onOpenReview: () => void;
}) {
  const t = COPY[language];
  const [focusId, setFocusId] = useState(focuses[0]?.id ?? '');
  const focus = focuses.find((item) => item.id === focusId) ?? focuses[0];
  const relations = useMemo(() => focus ? rankUnderstandingRelations(focus, understandings) : [], [focus, understandings]);
  const [selectedUnderstandingId, setSelectedUnderstandingId] = useState<string | null>(null);
  const selectedRelation = relations.find((relation) => relation.understanding.id === selectedUnderstandingId) ?? null;

  useEffect(() => {
    if (!focus || focus.id === focusId) return;
    setFocusId(focus.id);
  }, [focus, focusId]);
  useEffect(() => {
    if (selectedUnderstandingId && !relations.some((relation) => relation.understanding.id === selectedUnderstandingId)) {
      setSelectedUnderstandingId(null);
    }
  }, [relations, selectedUnderstandingId]);

  if (!focus) return <div className="rounded-2xl border border-dashed border-edge px-5 py-16 text-center text-sm text-fg-muted">{t.noFocus}</div>;

  return <section className="overflow-hidden rounded-2xl border border-edge bg-surface-panel">
    <header className="flex flex-col gap-3 border-b border-edge px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs leading-5 text-fg-muted">{t.hint}</p>
      {focuses.length > 1 ? <label className="flex shrink-0 items-center gap-2 text-xs text-fg-muted"><span>{t.selectFocus}</span><Select value={focus.id} onChange={(event) => { setFocusId(event.target.value); setSelectedUnderstandingId(null); }} triggerClassName="min-w-44 bg-surface-base">{focuses.map((item) => <SelectOption key={item.id} value={item.id}>{item.title}</SelectOption>)}</Select></label> : null}
    </header>

    <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 bg-surface-base/45 p-3 sm:p-4">
        <div className="relative hidden h-[30rem] overflow-hidden rounded-xl border border-edge bg-surface-base sm:block">
          <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(var(--color-edge)_0.7px,transparent_0.7px)] [background-size:20px_20px]" aria-hidden="true" />
          <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line x1="50" y1="13" x2="50" y2="50" className="stroke-edge-strong" strokeWidth="0.35" vectorEffect="non-scaling-stroke" />
            {relations.map((relation, index) => <line key={relation.understanding.id} x1="50" y1="50" x2={NODE_POSITIONS[index]?.x ?? 50} y2={NODE_POSITIONS[index]?.y ?? 50} className={relation.understanding.status === 'active' ? 'stroke-edge-strong' : 'stroke-warning'} strokeWidth={selectedUnderstandingId === relation.understanding.id ? '0.55' : '0.3'} strokeDasharray={relation.understanding.status === 'active' ? undefined : '1.4 1.4'} vectorEffect="non-scaling-stroke" />)}
          </svg>

          <div className="absolute left-1/2 top-[13%] z-10 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-white shadow-surface"><UserRound className="size-5" /><span className="sr-only">{t.you}</span></div>
          <button type="button" onClick={() => setSelectedUnderstandingId(null)} className={`absolute left-1/2 top-1/2 z-10 flex w-44 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-medium shadow-surface transition-colors ${selectedRelation ? 'border-edge bg-surface-panel hover:bg-surface-hover' : 'border-accent bg-accent-soft text-accent-fg ring-2 ring-accent/15'}`}><Target className="size-4 shrink-0" /><span className="line-clamp-2">{focus.title}</span></button>
          {relations.map((relation, index) => <GraphNode key={relation.understanding.id} relation={relation} position={NODE_POSITIONS[index] ?? NODE_POSITIONS[0]} language={language} selected={selectedUnderstandingId === relation.understanding.id} onSelect={() => setSelectedUnderstandingId(relation.understanding.id)} />)}
          {!relations.length ? <p className="absolute inset-x-0 bottom-8 text-center text-xs text-fg-muted">{t.noRelations}</p> : null}
        </div>

        <div className="grid gap-2 sm:hidden">
          <button type="button" onClick={() => setSelectedUnderstandingId(null)} className={`rounded-xl border p-3 text-left ${selectedRelation ? 'border-edge bg-surface-panel' : 'border-accent bg-accent-soft'}`}><span className="text-xs text-fg-muted">{t.focus}</span><p className="mt-1 text-sm font-medium text-fg">{focus.title}</p></button>
          {relations.map((relation) => <button key={relation.understanding.id} type="button" onClick={() => setSelectedUnderstandingId(relation.understanding.id)} className={`rounded-xl border p-3 text-left ${selectedUnderstandingId === relation.understanding.id ? 'border-accent bg-accent-soft' : relation.understanding.status === 'active' ? 'border-edge bg-surface-panel' : 'border-warning/40 bg-warning-soft'}`}><span className="text-[11px] text-fg-subtle">{UNDERSTANDING_KIND_LABELS[relation.understanding.kind][language]}</span><p className="mt-1 line-clamp-2 text-sm text-fg">{relation.understanding.statement}</p></button>)}
        </div>
      </div>

      <ContextDetail
        focus={focus}
        relation={selectedRelation}
        relationCount={relations.length}
        language={language}
        t={t}
        onRefresh={onRefresh}
        onOpenReview={onOpenReview}
      />
    </div>
  </section>;
}

function GraphNode({ relation, position, language, selected, onSelect }: {
  relation: UnderstandingRelation;
  position: { x: number; y: number };
  language: 'en' | 'zh';
  selected: boolean;
  onSelect: () => void;
}) {
  const pending = relation.understanding.status !== 'active';
  return <button
    type="button"
    onClick={onSelect}
    style={{ left: `${position.x}%`, top: `${position.y}%` }}
    className={`absolute z-10 flex max-w-40 -translate-x-1/2 -translate-y-1/2 items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-xs leading-5 shadow-surface transition-colors ${selected ? 'border-accent bg-accent-soft ring-2 ring-accent/15' : pending ? 'border-dashed border-warning/60 bg-warning-soft hover:border-warning' : 'border-edge bg-surface-panel hover:bg-surface-hover'}`}
  >
    <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${pending ? 'bg-warning' : 'bg-success'}`} />
    <span className="min-w-0"><span className="block text-[10px] text-fg-subtle">{UNDERSTANDING_KIND_LABELS[relation.understanding.kind][language]}</span><span className="line-clamp-2 text-fg">{relation.understanding.statement}</span></span>
  </button>;
}

function ContextDetail({ focus, relation, relationCount, language, t, onRefresh, onOpenReview }: {
  focus: UserFocus;
  relation: UnderstandingRelation | null;
  relationCount: number;
  language: 'en' | 'zh';
  t: typeof COPY.en | typeof COPY.zh;
  onRefresh: () => Promise<unknown>;
  onOpenReview: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(focus.title);
  const [statement, setStatement] = useState(relation?.understanding.statement ?? focus.summary);
  const [pending, setPending] = useState(false);
  const understanding = relation?.understanding;
  useEffect(() => {
    setEditing(false);
    setTitle(focus.title);
    setStatement(understanding?.statement ?? focus.summary);
  }, [focus.id, focus.summary, focus.title, understanding?.id, understanding?.statement]);

  const mutate = async (action: () => Promise<unknown>) => {
    setPending(true);
    try { await action(); await onRefresh(); } finally { setPending(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!statement.trim() || (!understanding && !title.trim())) return;
    await mutate(() => understanding
      ? updateUnderstanding(understanding.id, { statement })
      : updateUserFocus(focus.id, { title, summary: statement }));
    setEditing(false);
  };

  const sourceLabel = understanding
    ? understanding.explicitness === 'explicit' ? t.explicit : understanding.explicitness === 'observed' ? t.observed : t.inferred
    : `${relationCount} ${t.relatedCount}`;
  const statusLabel = understanding?.status === 'active' || !understanding ? t.active : t.pending;

  return <aside className="border-t border-edge bg-surface-panel p-5 lg:border-l lg:border-t-0">
    <p className="text-[11px] font-medium text-accent">{understanding ? UNDERSTANDING_KIND_LABELS[understanding.kind][language] : t.focus}</p>
    {editing ? <form className="mt-3 space-y-3" onSubmit={submit}>
      {!understanding ? <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} /> : null}
      <textarea autoFocus className={inputClass} rows={5} value={statement} onChange={(event) => setStatement(event.target.value)} />
      <div className="flex justify-end gap-2"><Button type="button" disabled={pending} onClick={() => setEditing(false)}>{t.cancel}</Button><Button type="submit" variant="primary" disabled={pending || !statement.trim() || (!understanding && !title.trim())}>{t.save}</Button></div>
    </form> : <>
      <h2 className="mt-2 text-base font-semibold leading-6 text-fg">{understanding?.statement ?? focus.title}</h2>
      {!understanding ? <p className="mt-2 text-sm leading-6 text-fg-muted">{focus.summary}</p> : null}
      <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted"><span className={`size-1.5 rounded-full ${understanding?.status === 'active' || !understanding ? 'bg-success' : 'bg-warning'}`} />{statusLabel}<span>·</span><span>{sourceLabel}</span></div>

      {relation ? <div className="mt-6"><p className="text-xs font-medium text-fg-muted">{t.why}</p><div className="mt-2 grid gap-2">{relation.reasons.map((reason) => <p key={reason} className="rounded-xl bg-surface-muted px-3 py-2 text-xs leading-5 text-fg-muted">{t[reason]}</p>)}</div></div> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {!understanding ? <Button disabled={pending} onClick={() => setEditing(true)}><Pencil className="size-3.5" />{t.edit}</Button> : understanding.status !== 'active' ? <Button variant="primary" onClick={onOpenReview}>{t.review}</Button> : <Button disabled={pending} onClick={() => setEditing(true)}><Pencil className="size-3.5" />{t.edit}</Button>}
        {!understanding ? <><Button disabled={pending} onClick={() => void mutate(() => updateUserFocus(focus.id, { status: 'paused' }))}>{t.pause}</Button><Button variant="ghost" disabled={pending} onClick={() => void mutate(() => updateUserFocus(focus.id, { status: 'completed' }))}><CheckCircle2 className="size-3.5" />{t.complete}</Button></> : understanding.status === 'active' ? <><Button variant="ghost" disabled={pending} onClick={() => void mutate(() => updateUnderstanding(understanding.id, { status: 'archived' }))}>{t.archive}</Button><Button variant="ghost" className="text-danger" disabled={pending} onClick={() => void mutate(() => updateUnderstanding(understanding.id, { status: 'rejected' }))}>{t.incorrect}</Button></> : null}
      </div>
    </>}
  </aside>;
}
