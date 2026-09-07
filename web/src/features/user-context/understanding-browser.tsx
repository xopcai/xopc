import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';

import { isGeneralUnderstanding, rankUnderstandingRelations } from './shared-understanding-model';
import { setUnderstandingFocusExcluded, type UserFocus, type UserUnderstanding } from './user-context-api';
import { UNDERSTANDING_KIND_LABELS } from './understanding-kind-labels';

const LocalContextGraph = lazy(() => import('./local-context-graph'));
const PAGE_SIZE = 12;
const COPY = {
  zh: {
    hint: '选择一项关注，查看与它相关的理解及依据。', focuses: '当前关注', all: '浏览全部理解',
    searchFocus: '搜索关注', search: '搜索理解', projects: '所有项目', kind: '所有类型', scopes: '所有范围', connected: '可能相关的关注',
    related: '可能相关', general: '通用背景', generalHint: '这些背景可能适用于多项关注，不代表本次已使用。',
    empty: '没有符合条件的理解。', noFocus: '还没有进行中的关注，可以先浏览已有理解。',
    project_scope: '同属一个项目', topic_overlap: '内容主题相近', review: '查看待确认内容',
    graph: '查看局部关系图', list: '返回列表', graphHint: '仅展示当前页的直接关联，最多 12 条。',
    prev: '上一页', next: '下一页', scope: '适用范围', global: '全局', workspace: '工作区', project: '项目', session: '对话',
    unrelated: '与这项关注无关', excluded: '已排除的关联', restore: '恢复关联', error: '操作失败，请重试。',
    back: '返回相关理解', details: '查看详情',
  },
  en: {
    hint: 'Choose a focus to explore related understanding and its evidence.', focuses: 'Current focuses', all: 'Browse all understanding',
    searchFocus: 'Search focuses', search: 'Search understanding', projects: 'All projects', kind: 'All types', scopes: 'All scopes', connected: 'Possibly related focuses',
    related: 'Possibly related', general: 'General background', generalHint: 'This background may apply across focuses. It does not mean it was used in this work.',
    empty: 'No understanding matches these filters.', noFocus: 'No active focus yet. You can still browse understanding.',
    project_scope: 'In the same project', topic_overlap: 'Similar topics', review: 'Review suggestions',
    graph: 'View local graph', list: 'Back to list', graphHint: 'Only direct relationships on this page are shown, up to 12.',
    prev: 'Previous', next: 'Next', scope: 'Scope', global: 'Global', workspace: 'Workspace', project: 'Project', session: 'Conversation',
    unrelated: 'Unrelated to this focus', excluded: 'Excluded relationships', restore: 'Restore relationship', error: 'Could not save. Please retry.',
    back: 'Back to related understanding', details: 'View details',
  },
} as const;

export function UnderstandingBrowser({ focuses, understandings, language, onRefresh, onOpenReview, renderDetail }: {
  focuses: UserFocus[];
  understandings: UserUnderstanding[];
  language: 'en' | 'zh';
  onRefresh: () => Promise<unknown>;
  onOpenReview: () => void;
  renderDetail: (selection: { type: 'focus'; item: UserFocus } | { type: 'understanding'; item: UserUnderstanding }) => ReactNode;
}) {
  const t = COPY[language];
  const [params, setParams] = useSearchParams();
  const update = (values: Record<string, string | null>, replace = false) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === '') next.delete(key); else next.set(key, value);
    }
    return next;
  }, { replace });
  const focusQuery = params.get('focusQuery') ?? '';
  const project = params.get('contextProject') ?? '';
  const query = params.get('contextQuery') ?? '';
  const kind = params.get('contextKind') ?? '';
  const scope = params.get('contextScope') ?? '';
  const selectedId = params.get('contextFocus');
  const focus = selectedId === 'all' ? undefined : focuses.find((item) => item.id === selectedId) ?? focuses[0];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const active = useMemo(() => understandings.filter((item) => item.status === 'active'
    && !(item.validTo !== undefined && item.validTo <= Date.now())
    && !(item.expiresAt !== undefined && item.expiresAt <= Date.now())
    && !(item.validFrom !== undefined && item.validFrom > Date.now())), [understandings]);
  const projects = useMemo(() => [...new Set(focuses.filter((item) => item.scope.type === 'project').map((item) => item.scope.id!))], [focuses]);
  const matchingFocuses = useMemo(() => focuses.filter((item) => (!project || item.scope.type === 'project' && item.scope.id === project)
    && `${item.title} ${item.summary}`.toLocaleLowerCase().includes(focusQuery.toLocaleLowerCase())), [focuses, project, focusQuery]);
  const focusPage = pageNumber(params.get('focusPage'), matchingFocuses.length);
  // Only the selected focus is ranked. Selecting a detail does not rerun ranking.
  const relations = useMemo(() => focus ? rankUnderstandingRelations(focus, active, active.length) : [], [focus, active]);
  const filter = (item: UserUnderstanding) => (!kind || item.kind === kind) && (!scope || item.scope.type === scope)
    && item.statement.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const items = (focus ? relations.map((relation) => relation.understanding) : active).filter(filter);
  const page = pageNumber(params.get('contextPage'), items.length);
  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const generalOpen = params.get('contextGeneral') === '1';
  const excludedOpen = params.get('contextExcluded') === '1';
  const general = focus && generalOpen ? active.filter((item) => isGeneralUnderstanding(item) && !item.excludedFocusIds?.includes(focus.id) && filter(item)) : [];
  const excluded = focus && excludedOpen ? active.filter((item) => item.excludedFocusIds?.includes(focus.id) && filter(item)) : [];
  const generalPage = pageNumber(params.get('generalPage'), general.length);
  const excludedPage = pageNumber(params.get('excludedPage'), excluded.length);
  const detail = active.find((item) => item.id === params.get('contextUnderstanding'));
  const connectedFocuses = useMemo(() => detail ? focuses.filter((item) => rankUnderstandingRelations(item, [detail], 1).length > 0) : [], [detail, focuses]);
  const connectedPage = pageNumber(params.get('connectedPage'), connectedFocuses.length);
  const reasons = new Map(relations.map((relation) => [relation.understanding.id, relation.reasons]));
  const selectFocus = (id: string) => update({ contextFocus: id, contextUnderstanding: null, contextPage: null, contextGraph: null, contextExcluded: null, connectedPage: null });
  const setExcluded = async (item: UserUnderstanding, value: boolean) => {
    if (!focus) return;
    setPending(true); setError(false);
    try {
      await setUnderstandingFocusExcluded(item.id, focus.id, value);
      await onRefresh();
      update({ contextUnderstanding: null });
    } catch { setError(true); } finally { setPending(false); }
  };
  const pager = (total: number, current: number, key: string) => total > PAGE_SIZE ? <nav className="flex items-center justify-between gap-3 pt-3" aria-label={t[key === 'focusPage' ? 'focuses' : 'related']}>
    <Button disabled={current === 0} onClick={() => update({ [key]: String(current - 1) })}>{t.prev}</Button>
    <span className="text-xs text-fg-muted">{current * PAGE_SIZE + 1}–{Math.min((current + 1) * PAGE_SIZE, total)} / {total}</span>
    <Button disabled={(current + 1) * PAGE_SIZE >= total} onClick={() => update({ [key]: String(current + 1) })}>{t.next}</Button>
  </nav> : null;
  const rows = (entries: UserUnderstanding[], showReasons: boolean, restore = false) => <div className="divide-y divide-edge">
    {entries.map((item) => <article key={item.id} className="py-3">
      <button type="button" className="w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => update({ contextUnderstanding: item.id, contextFocus: focus?.id ?? 'all' })}>
        <span className="text-[11px] text-fg-subtle">{UNDERSTANDING_KIND_LABELS[item.kind][language]} · {t[item.scope.type]}{item.scope.id ? ` · ${item.scope.id}` : ''}</span>
        <span className="mt-1 block text-sm leading-6 text-fg">{item.statement}</span>
        {showReasons ? <span className="mt-1 block text-xs text-fg-muted">{t.related} · {reasons.get(item.id)?.map((reason) => t[reason]).join(' · ')}</span> : null}
      </button>
      {restore ? <Button variant="ghost" disabled={pending} onClick={() => void setExcluded(item, false)}>{t.restore}</Button> : null}
    </article>)}
    {!entries.length ? <p className="py-8 text-sm text-fg-muted">{t.empty}</p> : null}
  </div>;
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-fg-muted">{t.hint}</p><Button onClick={onOpenReview}>{t.review}</Button></div>
    <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className={`${selectedId ? 'hidden lg:block' : ''} space-y-3 rounded-2xl border border-edge bg-surface-panel p-4`}>
        <h2 className="text-sm font-semibold">{t.focuses}</h2>
        <input aria-label={t.searchFocus} placeholder={t.searchFocus} className={inputClass} value={focusQuery} onChange={(event) => update({ focusQuery: event.target.value, focusPage: null }, true)} />
        <Select aria-label={t.projects} value={project} onChange={(event) => update({ contextProject: event.target.value, focusPage: null })}><SelectOption value="">{t.projects}</SelectOption>{projects.map((id) => <SelectOption key={id} value={id}>{id}</SelectOption>)}</Select>
        <button type="button" className={focusButton(!focus)} aria-pressed={!focus} onClick={() => selectFocus('all')}>{t.all}</button>
        {matchingFocuses.slice(focusPage * PAGE_SIZE, (focusPage + 1) * PAGE_SIZE).map((item) => <button key={item.id} type="button" className={focusButton(focus?.id === item.id)} aria-pressed={focus?.id === item.id} onClick={() => selectFocus(item.id)}>{item.title}</button>)}
        {!focuses.length ? <p className="text-xs leading-5 text-fg-muted">{t.noFocus}</p> : null}
        {pager(matchingFocuses.length, focusPage, 'focusPage')}
      </aside>
      <div className={`${selectedId ? '' : 'hidden lg:block'} min-w-0 space-y-4`}>
        <div className="lg:hidden"><Button onClick={() => update({ contextFocus: null, contextUnderstanding: null })}>{t.focuses}</Button></div>
        {error ? <p role="alert" className="text-sm text-danger">{t.error}</p> : null}
        {detail ? <><Button onClick={() => update({ contextUnderstanding: null })}>{t.back}</Button>{focus && reasons.has(detail.id) ? <p className="text-xs text-fg-muted">{t.related} · {reasons.get(detail.id)?.map((reason) => t[reason]).join(' · ')}</p> : null}{renderDetail({ type: 'understanding', item: detail })}
          {focus ? <Button disabled={pending} onClick={() => void setExcluded(detail, !detail.excludedFocusIds?.includes(focus.id))}>{detail.excludedFocusIds?.includes(focus.id) ? t.restore : t.unrelated}</Button> : null}
          {connectedFocuses.length ? <div className="rounded-2xl border border-edge bg-surface-panel p-4"><h3 className="mb-2 text-sm font-medium">{t.connected}</h3>{connectedFocuses.slice(connectedPage * PAGE_SIZE, (connectedPage + 1) * PAGE_SIZE).map((item) => <button key={item.id} type="button" className={focusButton(false)} onClick={() => selectFocus(item.id)}>{item.title}</button>)}{pager(connectedFocuses.length, connectedPage, 'connectedPage')}</div> : null}
        </> : <>
          {focus ? renderDetail({ type: 'focus', item: focus }) : <h2 className="text-lg font-semibold">{t.all}</h2>}
          <div className="rounded-2xl border border-edge bg-surface-panel p-5">
            <div className="flex flex-wrap items-center gap-3">
              <input aria-label={t.search} placeholder={t.search} className={`${inputClass} min-w-[10rem] flex-1`} value={query} onChange={(event) => update({ contextQuery: event.target.value, contextPage: null, generalPage: null, excludedPage: null }, true)} />
              <Select aria-label={t.kind} value={kind} onChange={(event) => update({ contextKind: event.target.value, contextPage: null, generalPage: null, excludedPage: null })}><SelectOption value="">{t.kind}</SelectOption>{Object.entries(UNDERSTANDING_KIND_LABELS).map(([id, label]) => <SelectOption key={id} value={id}>{label[language]}</SelectOption>)}</Select>
              <Select aria-label={t.scope} value={scope} onChange={(event) => update({ contextScope: event.target.value, contextPage: null, generalPage: null, excludedPage: null })}><SelectOption value="">{t.scopes}</SelectOption>{(['global', 'workspace', 'project', 'session'] as const).map((value) => <SelectOption key={value} value={value}>{t[value]}</SelectOption>)}</Select>
            </div>
            {focus ? <div className="mt-4 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{t.related}</h3><Button disabled={!pageItems.length} onClick={() => update({ contextFocus: focus.id, contextGraph: params.get('contextGraph') === '1' ? null : '1' })}>{params.get('contextGraph') === '1' ? t.list : t.graph}</Button></div> : null}
            {focus && params.get('contextGraph') === '1' ? <><p className="my-3 text-xs text-fg-muted">{t.graphHint}</p><Suspense fallback={<Skeleton className="h-96 w-full" />}><LocalContextGraph focus={focus} understandings={pageItems} onSelect={(id) => update({ contextUnderstanding: id, contextFocus: focus?.id ?? 'all' })} /></Suspense></> : rows(pageItems, Boolean(focus))}
            {pager(items.length, page, 'contextPage')}
          </div>
          {focus ? <>
            <div className="rounded-2xl border border-edge bg-surface-panel p-5"><button type="button" className="text-sm font-medium" aria-expanded={generalOpen} onClick={() => update({ contextGeneral: generalOpen ? null : '1' })}>{t.general}</button>{generalOpen ? <><p className="mt-2 text-xs text-fg-muted">{t.generalHint}</p>{rows(general.slice(generalPage * PAGE_SIZE, (generalPage + 1) * PAGE_SIZE), false)}{pager(general.length, generalPage, 'generalPage')}</> : null}</div>
            <div className="rounded-2xl border border-edge bg-surface-panel p-5"><button type="button" className="text-sm text-fg-muted" aria-expanded={excludedOpen} onClick={() => update({ contextExcluded: excludedOpen ? null : '1' })}>{t.excluded}</button>{excludedOpen ? <>{rows(excluded.slice(excludedPage * PAGE_SIZE, (excludedPage + 1) * PAGE_SIZE), false, true)}{pager(excluded.length, excludedPage, 'excludedPage')}</> : null}</div>
          </> : null}
        </>}
      </div>
    </div>
  </section>;
}

const inputClass = 'rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
function focusButton(selected: boolean): string {
  return `block w-full rounded-lg px-3 py-2 text-left text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selected ? 'bg-accent-soft text-accent-fg' : 'text-fg hover:bg-surface-hover'}`;
}
function pageNumber(value: string | null, total: number): number {
  const parsed = Number(value);
  return Math.min(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1), Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0);
}
