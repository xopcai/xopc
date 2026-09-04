import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CheckCircle2, Eye, EyeOff, Network, Pencil, Target, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import { updateUnderstanding, updateUserFocus, type UserFocus, type UserUnderstanding } from './user-context-api';
import { rankUnderstandingRelations, type UnderstandingRelation } from './shared-understanding-model';
import { UNDERSTANDING_KIND_LABELS } from './understanding-kind-labels';

const COPY = {
  en: {
    focus: 'Focus', you: 'You', active: 'Active', pending: 'Needs review',
    hint: 'All current focuses and context are shown in one connected map. Select any node to inspect it.',
    confirmed: 'Confirmed', possible: 'Possible', weak: 'Show weak signals', hideWeak: 'Hide weak signals',
    noFocus: 'Confirm a focus first, then xopc can show the context that affects it.',
    noRelations: 'No relationship is strong enough to show yet.', why: 'Why this relationship is shown',
    project_scope: 'Both belong to the same project.', topic_overlap: 'They share a meaningful topic signal.',
    global_context: 'This confirmed context may shape work across projects.',
    edit: 'Edit', pause: 'Pause', complete: 'Complete', incorrect: 'Not true', archive: 'Move to history',
    save: 'Save', cancel: 'Cancel', review: 'Review this suggestion',
    explicit: 'You said this directly', observed: 'Observed across work', inferred: 'Inferred — may be wrong',
    relatedCount: 'relationships', overview: 'Whole network', overviewTitle: 'Your shared context at a glance',
    overviewHint: 'Select a focus or understanding node to see its details and available actions.',
    focusCount: 'current focuses', understandingCount: 'understandings', connectedFocuses: 'Connected focuses',
    ariaLabel: 'Shared understanding network',
  },
  zh: {
    focus: '当前关注', you: '你', active: '进行中', pending: '待确认',
    hint: '把所有进行中的关注和有效理解放在同一张关系网中；选择任一节点即可查看详情。',
    confirmed: '已确认', possible: '可能关联', weak: '显示弱信号', hideWeak: '隐藏弱信号',
    noFocus: '先确认一项关注，xopc 才能展示会影响它的上下文。',
    noRelations: '目前还没有足够明确的关系。', why: '为什么展示这条关系',
    project_scope: '它们属于同一个项目。', topic_overlap: '它们共享了有意义的主题信号。',
    global_context: '这条已确认的上下文可能影响不同项目中的工作。',
    edit: '编辑', pause: '暂停', complete: '完成', incorrect: '不正确', archive: '移入历史',
    save: '保存', cancel: '取消', review: '去确认这条建议',
    explicit: '由你直接告知', observed: '从过往工作中观察到', inferred: '推断内容，可能有误',
    relatedCount: '条关系', overview: '整体关系网', overviewTitle: '你的共同上下文',
    overviewHint: '选择一个关注或理解节点，可以查看详情和可用操作。',
    focusCount: '项当前关注', understandingCount: '条有效理解', connectedFocuses: '关联的关注',
    ariaLabel: '共同理解关系网',
  },
} as const;

type Copy = typeof COPY.en | typeof COPY.zh;
type MapRelation = UnderstandingRelation & { focus: UserFocus };
type MapSelection = { type: 'focus'; id: string } | { type: 'understanding'; id: string } | null;

interface YouNodeData extends Record<string, unknown> { label: string }
interface FocusNodeData extends Record<string, unknown> { focus: UserFocus; dimmed: boolean }
interface UnderstandingNodeData extends Record<string, unknown> {
  understanding: UserUnderstanding;
  kindLabel: string;
  dimmed: boolean;
}

type YouFlowNode = Node<YouNodeData>;
type FocusFlowNode = Node<FocusNodeData>;
type UnderstandingFlowNode = Node<UnderstandingNodeData>;
type MapFlowNode = YouFlowNode | FocusFlowNode | UnderstandingFlowNode;

const VISIBLE_UNDERSTANDING_STATUSES = new Set<UserUnderstanding['status']>(['active', 'candidate', 'needs_review', 'stale']);
const inputClass = 'w-full rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20';

export function SharedUnderstandingMap({ focuses, understandings, language, onRefresh, onOpenReview }: {
  focuses: UserFocus[];
  understandings: UserUnderstanding[];
  language: 'en' | 'zh';
  onRefresh: () => Promise<unknown>;
  onOpenReview: () => void;
}) {
  const t = COPY[language];
  const [showWeak, setShowWeak] = useState(false);
  const [selection, setSelection] = useState<MapSelection>(null);
  const flowRef = useRef<ReactFlowInstance<MapFlowNode, Edge> | null>(null);
  const visibleUnderstandings = useMemo(() => understandings.filter((understanding) =>
    VISIBLE_UNDERSTANDING_STATUSES.has(understanding.status)), [understandings]);
  const allRelations = useMemo(() => focuses.flatMap((focus) =>
    rankUnderstandingRelations(focus, visibleUnderstandings, visibleUnderstandings.length)
      .map((relation) => ({ ...relation, focus }))), [focuses, visibleUnderstandings]);
  const relations = useMemo(() => showWeak
    ? allRelations
    : allRelations.filter((relation) => relation.score >= 0.25), [allRelations, showWeak]);
  const visibleUnderstandingIds = useMemo(() => new Set(visibleUnderstandings.map((item) => item.id)), [visibleUnderstandings]);

  useEffect(() => {
    if (selection?.type === 'focus' && !focuses.some((focus) => focus.id === selection.id)) setSelection(null);
    if (selection?.type === 'understanding' && !visibleUnderstandingIds.has(selection.id)) setSelection(null);
  }, [focuses, selection, visibleUnderstandingIds]);

  const nodes = useMemo<MapFlowNode[]>(() => buildNodes(
    focuses, visibleUnderstandings, relations, selection, language, t,
  ), [focuses, language, relations, selection, t, visibleUnderstandings]);
  const edges = useMemo<Edge[]>(() => buildEdges(focuses, relations, selection), [focuses, relations, selection]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void flowRef.current?.fitView({ padding: 0.2, minZoom: 0.1, maxZoom: 1, duration: 250 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focuses.length, relations.length, visibleUnderstandings.length]);

  if (!focuses.length) return <div className="rounded-2xl border border-dashed border-edge px-5 py-16 text-center text-sm text-fg-muted">{t.noFocus}</div>;

  return <section className="overflow-hidden rounded-2xl border border-edge bg-surface-panel">
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-edge px-4 py-3">
      <p className="min-w-0 flex-1 text-xs leading-5 text-fg-muted">{t.hint}</p>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-fg-subtle">
        <span className="inline-flex items-center gap-1.5"><span className="h-px w-5 bg-edge-strong" />{t.confirmed}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t border-dashed border-warning" />{t.possible}</span>
        {allRelations.some((relation) => relation.score < 0.25) ? <button type="button" className="inline-flex items-center gap-1.5 rounded-md text-fg-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30" onClick={() => setShowWeak((value) => !value)}>{showWeak ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{showWeak ? t.hideWeak : t.weak}</button> : null}
      </div>
    </header>

    <div className="grid lg:h-[min(42rem,calc(100dvh-14rem))] lg:min-h-[32rem] lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="h-[28rem] min-w-0 bg-surface-base/45 lg:h-auto" aria-label={t.ariaLabel}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_event, node) => {
            if (node.type === 'you') setSelection(null);
            else if (node.type === 'focus') setSelection({ type: 'focus', id: node.id.slice('focus:'.length) });
            else setSelection({ type: 'understanding', id: node.id.slice('understanding:'.length) });
          }}
          onPaneClick={() => setSelection(null)}
          onInit={(instance) => { flowRef.current = instance; }}
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.1, maxZoom: 1 }}
          minZoom={0.1}
          maxZoom={1.35}
          panOnScroll
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--color-edge)" gap={22} size={1} />
          <Controls showInteractive={false} className="!border-edge !bg-surface-panel !shadow-surface" />
        </ReactFlow>
      </div>
      <MapDetail
        selection={selection}
        focuses={focuses}
        understandings={visibleUnderstandings}
        relations={relations}
        language={language}
        t={t}
        onRefresh={onRefresh}
        onOpenReview={onOpenReview}
      />
    </div>
  </section>;
}

function buildNodes(
  focuses: UserFocus[],
  understandings: UserUnderstanding[],
  relations: MapRelation[],
  selection: MapSelection,
  language: 'en' | 'zh',
  t: Copy,
): MapFlowNode[] {
  const focusColumnWidth = 250;
  const understandingColumnWidth = 220;
  const focusColumns = Math.max(1, Math.min(5, focuses.length));
  const understandingColumns = Math.max(1, Math.min(6, understandings.length));
  const focusRows = Math.ceil(focuses.length / focusColumns);
  const focusWidth = focusColumns * focusColumnWidth;
  const understandingWidth = understandingColumns * understandingColumnWidth;
  const graphWidth = Math.max(focusWidth, understandingWidth);
  const focusOffset = (graphWidth - focusWidth) / 2;
  const understandingOffset = (graphWidth - understandingWidth) / 2;
  const understandingStartY = 280 + focusRows * 105;
  const connectedFocusIds = selection?.type === 'understanding'
    ? new Set(relations.filter((relation) => relation.understanding.id === selection.id).map((relation) => relation.focus.id))
    : null;
  const connectedUnderstandingIds = selection?.type === 'focus'
    ? new Set(relations.filter((relation) => relation.focus.id === selection.id).map((relation) => relation.understanding.id))
    : null;

  return [
    {
      id: 'you', type: 'you', position: { x: graphWidth / 2 - 28, y: 0 },
      data: { label: t.you }, selected: selection === null,
    } satisfies YouFlowNode,
    ...focuses.map((focus, index): FocusFlowNode => ({
      id: `focus:${focus.id}`,
      type: 'focus',
      position: {
        x: focusOffset + (index % focusColumns) * focusColumnWidth + 28,
        y: 140 + Math.floor(index / focusColumns) * 105,
      },
      data: { focus, dimmed: selection?.type === 'understanding' && !connectedFocusIds?.has(focus.id) },
      selected: selection?.type === 'focus' && selection.id === focus.id,
    })),
    ...understandings.map((understanding, index): UnderstandingFlowNode => ({
      id: `understanding:${understanding.id}`,
      type: 'understanding',
      position: {
        x: understandingOffset + (index % understandingColumns) * understandingColumnWidth,
        y: understandingStartY + Math.floor(index / understandingColumns) * 100,
      },
      data: {
        understanding,
        kindLabel: UNDERSTANDING_KIND_LABELS[understanding.kind][language],
        dimmed: selection?.type === 'focus' && !connectedUnderstandingIds?.has(understanding.id),
      },
      selected: selection?.type === 'understanding' && selection.id === understanding.id,
    })),
  ];
}

function buildEdges(focuses: UserFocus[], relations: MapRelation[], selection: MapSelection): Edge[] {
  const selectedFocusId = selection?.type === 'focus' ? selection.id : null;
  const selectedUnderstandingId = selection?.type === 'understanding' ? selection.id : null;
  return [
    ...focuses.map((focus): Edge => ({
      id: `you:${focus.id}`,
      source: 'you',
      target: `focus:${focus.id}`,
      style: {
        stroke: 'var(--color-edge-strong)',
        strokeWidth: selectedFocusId === focus.id ? 2 : 1.25,
        opacity: selectedUnderstandingId && !relations.some((relation) =>
          relation.focus.id === focus.id && relation.understanding.id === selectedUnderstandingId) ? 0.15 : 1,
      },
    })),
    ...relations.map((relation): Edge => {
      const pending = relation.understanding.status !== 'active';
      const connected = !selection
        || selectedFocusId === relation.focus.id
        || selectedUnderstandingId === relation.understanding.id;
      return {
        id: `${relation.focus.id}:${relation.understanding.id}`,
        source: `focus:${relation.focus.id}`,
        target: `understanding:${relation.understanding.id}`,
        style: {
          stroke: pending ? 'var(--color-warning)' : 'var(--color-edge-strong)',
          strokeWidth: connected && selection ? 1.8 : 1.1,
          strokeDasharray: pending ? '5 5' : undefined,
          opacity: connected ? 1 : 0.12,
        },
      };
    }),
  ];
}

function YouNode({ data, selected }: NodeProps<YouFlowNode>) {
  return <div className={cn(
    'flex size-14 items-center justify-center rounded-full bg-accent text-white shadow-surface transition-shadow',
    selected && 'ring-4 ring-accent/20',
  )}>
    <UserRound className="size-5" aria-hidden />
    <span className="sr-only">{data.label}</span>
    <Handle type="source" position={Position.Bottom} className="!invisible" />
  </div>;
}

function FocusNode({ data, selected }: NodeProps<FocusFlowNode>) {
  return <div className={cn(
    'w-48 rounded-xl border bg-surface-panel px-3 py-3 text-left shadow-surface transition-[border-color,box-shadow,opacity]',
    selected ? 'border-accent ring-2 ring-accent/20' : 'border-edge',
    data.dimmed && 'opacity-30',
  )}>
    <Handle type="target" position={Position.Top} className="!invisible" />
    <div className="flex items-start gap-2"><Target className="mt-0.5 size-4 shrink-0 text-accent" /><strong className="line-clamp-2 text-sm font-medium leading-5 text-fg">{data.focus.title}</strong></div>
    <Handle type="source" position={Position.Bottom} className="!invisible" />
  </div>;
}

function UnderstandingNode({ data, selected }: NodeProps<UnderstandingFlowNode>) {
  const pending = data.understanding.status !== 'active';
  return <div className={cn(
    'w-44 rounded-xl border bg-surface-panel px-3 py-2.5 text-left shadow-surface transition-[border-color,box-shadow,opacity]',
    selected ? 'border-accent ring-2 ring-accent/20' : pending ? 'border-dashed border-warning/60 bg-warning-soft' : 'border-edge',
    data.dimmed && 'opacity-30',
  )}>
    <Handle type="target" position={Position.Top} className="!invisible" />
    <span className="flex items-center gap-1.5 text-[10px] text-fg-subtle"><span className={cn('size-1.5 rounded-full', pending ? 'bg-warning' : 'bg-success')} />{data.kindLabel}</span>
    <span className="mt-1 line-clamp-2 block text-xs leading-5 text-fg">{data.understanding.statement}</span>
  </div>;
}

const NODE_TYPES = { you: YouNode, focus: FocusNode, understanding: UnderstandingNode };

function MapDetail({ selection, focuses, understandings, relations, language, t, onRefresh, onOpenReview }: {
  selection: MapSelection;
  focuses: UserFocus[];
  understandings: UserUnderstanding[];
  relations: MapRelation[];
  language: 'en' | 'zh';
  t: Copy;
  onRefresh: () => Promise<unknown>;
  onOpenReview: () => void;
}) {
  if (!selection) return <aside className="overflow-y-auto border-t border-edge bg-surface-panel p-5 lg:border-l lg:border-t-0">
    <div className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-fg"><Network className="size-4" /></div>
    <p className="mt-4 text-[11px] font-medium text-accent">{t.overview}</p>
    <h2 className="mt-2 text-base font-semibold leading-6 text-fg">{t.overviewTitle}</h2>
    <p className="mt-2 text-sm leading-6 text-fg-muted">{t.overviewHint}</p>
    <div className="mt-5 grid grid-cols-2 gap-2">
      <div className="rounded-xl bg-surface-muted p-3"><strong className="block text-lg text-fg">{focuses.length}</strong><span className="text-[11px] text-fg-muted">{t.focusCount}</span></div>
      <div className="rounded-xl bg-surface-muted p-3"><strong className="block text-lg text-fg">{understandings.length}</strong><span className="text-[11px] text-fg-muted">{t.understandingCount}</span></div>
    </div>
    {!relations.length ? <p className="mt-5 text-xs text-fg-muted">{t.noRelations}</p> : null}
  </aside>;

  if (selection.type === 'focus') {
    const focus = focuses.find((item) => item.id === selection.id);
    return focus ? <NodeDetail focus={focus} relations={relations.filter((relation) => relation.focus.id === focus.id)} language={language} t={t} onRefresh={onRefresh} onOpenReview={onOpenReview} /> : null;
  }
  const understanding = understandings.find((item) => item.id === selection.id);
  return understanding ? <NodeDetail understanding={understanding} relations={relations.filter((relation) => relation.understanding.id === understanding.id)} language={language} t={t} onRefresh={onRefresh} onOpenReview={onOpenReview} /> : null;
}

function NodeDetail({ focus, understanding, relations, language, t, onRefresh, onOpenReview }: {
  focus?: UserFocus;
  understanding?: UserUnderstanding;
  relations: MapRelation[];
  language: 'en' | 'zh';
  t: Copy;
  onRefresh: () => Promise<unknown>;
  onOpenReview: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(focus?.title ?? '');
  const [statement, setStatement] = useState(understanding?.statement ?? focus?.summary ?? '');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setEditing(false);
    setTitle(focus?.title ?? '');
    setStatement(understanding?.statement ?? focus?.summary ?? '');
  }, [focus?.id, focus?.summary, focus?.title, understanding?.id, understanding?.statement]);

  const mutate = async (action: () => Promise<unknown>) => {
    setPending(true);
    try { await action(); await onRefresh(); } finally { setPending(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!statement.trim() || (focus && !title.trim())) return;
    await mutate(() => understanding
      ? updateUnderstanding(understanding.id, { statement: statement.trim() })
      : updateUserFocus(focus!.id, { title: title.trim(), summary: statement.trim() }));
    setEditing(false);
  };

  const sourceLabel = understanding
    ? understanding.explicitness === 'explicit' ? t.explicit : understanding.explicitness === 'observed' ? t.observed : t.inferred
    : `${relations.length} ${t.relatedCount}`;
  const statusLabel = understanding?.status === 'active' || focus ? t.active : t.pending;
  const reasons = [...new Set(relations.flatMap((relation) => relation.reasons))];

  return <aside className="overflow-y-auto border-t border-edge bg-surface-panel p-5 lg:border-l lg:border-t-0">
    <p className="text-[11px] font-medium text-accent">{understanding ? UNDERSTANDING_KIND_LABELS[understanding.kind][language] : t.focus}</p>
    {editing ? <form className="mt-3 space-y-3" onSubmit={submit}>
      {focus ? <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} /> : null}
      <textarea autoFocus className={inputClass} rows={5} value={statement} onChange={(event) => setStatement(event.target.value)} />
      <div className="flex justify-end gap-2"><Button type="button" disabled={pending} onClick={() => setEditing(false)}>{t.cancel}</Button><Button type="submit" variant="primary" disabled={pending || !statement.trim() || Boolean(focus && !title.trim())}>{t.save}</Button></div>
    </form> : <>
      <h2 className="mt-2 text-base font-semibold leading-6 text-fg">{understanding?.statement ?? focus?.title}</h2>
      {focus ? <p className="mt-2 text-sm leading-6 text-fg-muted">{focus.summary}</p> : null}
      <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted"><span className={cn('size-1.5 rounded-full', understanding?.status === 'active' || focus ? 'bg-success' : 'bg-warning')} />{statusLabel}<span>·</span><span>{sourceLabel}</span></div>

      {understanding && relations.length ? <div className="mt-6"><p className="text-xs font-medium text-fg-muted">{t.connectedFocuses}</p><div className="mt-2 grid gap-1.5">{relations.map((relation) => <p key={relation.focus.id} className="rounded-lg bg-surface-muted px-3 py-2 text-xs leading-5 text-fg-muted">{relation.focus.title}</p>)}</div></div> : null}
      {understanding && reasons.length ? <div className="mt-5"><p className="text-xs font-medium text-fg-muted">{t.why}</p><div className="mt-2 grid gap-2">{reasons.map((reason) => <p key={reason} className="rounded-xl bg-surface-muted px-3 py-2 text-xs leading-5 text-fg-muted">{t[reason]}</p>)}</div></div> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {focus || understanding?.status === 'active' ? <Button disabled={pending} onClick={() => setEditing(true)}><Pencil className="size-3.5" />{t.edit}</Button> : <Button variant="primary" onClick={onOpenReview}>{t.review}</Button>}
        {focus ? <><Button disabled={pending} onClick={() => void mutate(() => updateUserFocus(focus.id, { status: 'paused' }))}>{t.pause}</Button><Button variant="ghost" disabled={pending} onClick={() => void mutate(() => updateUserFocus(focus.id, { status: 'completed' }))}><CheckCircle2 className="size-3.5" />{t.complete}</Button></> : understanding?.status === 'active' ? <><Button variant="ghost" disabled={pending} onClick={() => void mutate(() => updateUnderstanding(understanding.id, { status: 'archived' }))}>{t.archive}</Button><Button variant="ghost" className="text-danger" disabled={pending} onClick={() => void mutate(() => updateUnderstanding(understanding.id, { status: 'rejected' }))}>{t.incorrect}</Button></> : null}
      </div>
    </>}
  </aside>;
}
