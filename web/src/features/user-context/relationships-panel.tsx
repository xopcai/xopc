import * as Dialog from '@radix-ui/react-dialog';
import { Bot, ChevronRight, EyeOff, Mail, Search, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';

import {
  fetchUserRelationship,
  fetchUserRelationships,
  updateUserRelationship,
  type UserPerson,
  type UserPersonKind,
  type UserRelationshipsResponse,
} from './user-context-api';

type RelationshipFilter = UserPersonKind | 'hidden';

const copy = {
  en: {
    title: 'Your relationships',
    hint: 'People are organized from sources you authorized. You can correct or hide any result.',
    search: 'Search people, email, or username…',
    people: 'People', automated: 'Automated', review: 'Needs review', hidden: 'Hidden', sources: 'Sources', sourceUnit: 'sources',
    person: 'People', bot: 'Bots', service: 'Service accounts', group: 'Groups', unknown: 'Needs review',
    empty: 'No relationships match this view.', interactions: 'related interactions',
    loadMore: 'Load more', details: 'Relationship details', identities: 'Known identities',
    sourceActivity: 'Source activity', lastInteraction: 'Last observed', firstInteraction: 'First observed',
    understanding: 'What xopc understands', noUnderstanding: 'No relationship understanding has been formed yet.',
    classification: 'Classification', displayName: 'Display name', save: 'Save', hide: 'Hide', unhide: 'Restore',
    close: 'Close', loading: 'Loading relationships…', loadFailed: 'Could not load relationships.',
  },
  zh: {
    title: '我的关系',
    hint: '根据你授权的数据来源整理；任何结果都可以纠正或隐藏。',
    search: '搜索人物、邮箱或用户名……',
    people: '人物', automated: '自动化账号', review: '待确认', hidden: '已隐藏', sources: '来源', sourceUnit: '个来源',
    person: '人物', bot: '机器人', service: '服务账号', group: '群组', unknown: '待确认',
    empty: '当前视图中没有匹配的关系。', interactions: '次相关互动',
    loadMore: '加载更多', details: '关系详情', identities: '关联身份',
    sourceActivity: '来源活动', lastInteraction: '最近观察', firstInteraction: '首次观察',
    understanding: 'xopc 对这段关系的理解', noUnderstanding: '尚未形成可供确认的关系理解。',
    classification: '身份类型', displayName: '显示名称', save: '保存', hide: '隐藏', unhide: '恢复显示',
    close: '关闭', loading: '正在加载关系……', loadFailed: '无法加载关系数据。',
  },
} as const;

function date(value: number, language: 'en' | 'zh'): string {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(value);
}

function sourceLabel(person: UserPerson): string {
  return [...new Set(person.sources.map((source) => (
    source.toolkit ?? source.connectorId ?? source.sourceInstanceId
  )))].join(' · ');
}

function RelationshipCard({ person, language, onOpen }: {
  person: UserPerson;
  language: 'en' | 'zh';
  onOpen: (person: UserPerson) => void;
}) {
  const t = copy[language];
  return <button
    type="button"
    className="group flex w-full items-center gap-3 rounded-2xl border border-edge bg-surface-panel p-4 text-left transition-colors hover:bg-surface-hover"
    onClick={() => onOpen(person)}
  >
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-fg-muted">
      {person.kind === 'person' ? <Users className="size-4" /> : <Bot className="size-4" />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold text-fg">{person.displayName}</span>
      <span className="mt-1 block truncate text-xs text-fg-muted">{person.primaryHandle ?? sourceLabel(person)}</span>
      <span className="mt-1.5 block truncate text-[11px] text-fg-subtle">
        {sourceLabel(person)} · {person.interactionCount} {t.interactions}
      </span>
    </span>
    <span className="shrink-0 text-right">
      <span className="block text-[11px] text-fg-subtle">{date(person.lastObservedAt, language)}</span>
      <ChevronRight className="ml-auto mt-2 size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
    </span>
  </button>;
}

function PersonDetailDrawer({ personId, open, language, onOpenChange, onChanged }: {
  personId: string | null;
  open: boolean;
  language: 'en' | 'zh';
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const t = copy[language];
  const [person, setPerson] = useState<UserPerson | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !personId) return;
    setPerson(null);
    void fetchUserRelationship(personId).then((next) => {
      setPerson(next);
      setName(next.displayName);
    });
  }, [open, personId]);

  const patch = async (value: Parameters<typeof updateUserRelationship>[1]) => {
    if (!personId || busy) return;
    setBusy(true);
    try {
      const next = await updateUserRelationship(personId, value);
      setPerson(next);
      setName(next.displayName);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
    <Dialog.Content className="fixed inset-y-0 right-0 z-[90] h-full w-[min(32rem,100vw)] overflow-hidden border-l border-edge bg-surface-panel shadow-popover outline-none sm:rounded-l-2xl">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4">
          <div><Dialog.Title className="text-base font-semibold text-fg">{t.details}</Dialog.Title><Dialog.Description className="mt-1 text-xs text-fg-muted">{person?.displayName ?? t.loading}</Dialog.Description></div>
          <Dialog.Close asChild><Button type="button" variant="ghost" className="size-8 p-0" aria-label={t.close}><X className="size-4" /></Button></Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!person ? <div className="space-y-3"><Skeleton className="h-12 rounded-xl" /><Skeleton className="h-32 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div> : <div className="space-y-6">
            <section>
              <label className="text-xs font-medium text-fg-muted" htmlFor="relationship-display-name">{t.displayName}</label>
              <div className="mt-2 flex gap-2">
                <input id="relationship-display-name" className="min-w-0 flex-1 rounded-xl border border-edge bg-surface-base px-3 py-2 text-sm text-fg outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20" value={name} onChange={(event) => setName(event.target.value)} />
                <Button type="button" variant="primary" disabled={busy || !name.trim() || name.trim() === person.displayName} onClick={() => void patch({ displayName: name.trim() })}>{t.save}</Button>
              </div>
            </section>

            <section>
              <p className="text-xs font-medium text-fg-muted">{t.classification}</p>
              <Select value={person.kind} onChange={(event) => void patch({ kind: event.target.value as UserPersonKind })} disabled={busy} className="mt-2 w-full">
                {(['person', 'bot', 'service', 'group', 'unknown'] as UserPersonKind[]).map((kind) => <SelectOption key={kind} value={kind}>{t[kind]}</SelectOption>)}
              </Select>
            </section>

            <section className="rounded-2xl border border-edge p-4">
              <h3 className="text-sm font-semibold text-fg">{t.understanding}</h3>
              <p className="mt-2 text-sm leading-6 text-fg-muted">{person.relationshipUnderstanding?.statement ?? t.noUnderstanding}</p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-fg">{t.identities}</h3>
              <div className="mt-3 space-y-2">{person.handles.filter((handle) => handle.type !== 'display_name').map((handle) => <div key={handle.id} className="flex items-center gap-3 rounded-xl border border-edge px-3 py-2.5"><Mail className="size-4 shrink-0 text-fg-subtle" /><div className="min-w-0"><p className="truncate text-sm text-fg">{handle.value}</p><p className="mt-0.5 truncate text-[11px] text-fg-subtle">{handle.sourceInstanceId}</p></div></div>)}</div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-fg">{t.sourceActivity}</h3>
              <div className="mt-3 space-y-2">{person.sources.map((source) => <div key={source.sourceInstanceId} className="rounded-xl bg-surface-muted px-3 py-2.5"><div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium text-fg">{source.toolkit ?? source.connectorId ?? source.sourceInstanceId}</span><span className="text-xs text-fg-subtle">{source.interactionCount} {t.interactions}</span></div><p className="mt-1 text-[11px] text-fg-subtle">{t.firstInteraction} {date(source.firstObservedAt, language)} · {t.lastInteraction} {date(source.lastObservedAt, language)}</p></div>)}</div>
            </section>
          </div>}
        </div>
        {person ? <footer className="flex shrink-0 justify-end border-t border-edge px-5 py-3"><Button type="button" disabled={busy} onClick={() => void patch({ hidden: !person.hidden })}>{person.hidden ? t.unhide : t.hide}</Button></footer> : null}
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function RelationshipsPanel({ language }: { language: 'en' | 'zh' }) {
  const t = copy[language];
  const [filter, setFilter] = useState<RelationshipFilter>('person');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [data, setData] = useState<UserRelationshipsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const load = useCallback(async (cursor?: string, append = false) => {
    setLoading(true);
    setError(false);
    try {
      const next = await fetchUserRelationships({
        query: debouncedQuery,
        ...(filter === 'hidden' ? { hiddenOnly: true, includeHidden: true } : { kind: filter }),
        cursor,
        limit: 30,
      });
      setData((current) => append && current ? { ...next, items: [...current.items, ...next.items] } : next);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, filter]);

  useEffect(() => { void load(); }, [load]);

  const summary = data?.summary;
  const filters = useMemo(() => [
    { value: 'person', label: t.person },
    { value: 'bot', label: t.bot },
    { value: 'service', label: t.service },
    { value: 'group', label: t.group },
    { value: 'unknown', label: t.unknown },
    { value: 'hidden', label: t.hidden },
  ], [t]);

  return <div className="space-y-5">
    <section className="rounded-2xl border border-edge bg-surface-panel p-5 sm:p-6">
      <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Users className="size-4" /></span><div><h2 className="text-base font-semibold text-fg">{t.title}</h2><p className="mt-1 text-sm leading-6 text-fg-muted">{t.hint}</p></div></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        {[
          [t.people, summary?.people ?? 0],
          [t.automated, summary?.automatedAccounts ?? 0],
          [t.review, summary?.needsReview ?? 0],
          [t.sources, summary?.sources ?? 0],
        ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-surface-muted px-4 py-3"><p className="text-2xl font-semibold text-fg">{value}</p><p className="mt-1 text-xs text-fg-muted">{label}</p></div>)}
      </div>
    </section>

    <div className="flex flex-col gap-3 sm:flex-row">
      <label className="relative min-w-0 flex-1"><span className="sr-only">{t.search}</span><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-fg-subtle" /><input className="w-full rounded-xl border border-edge bg-surface-panel py-2 pl-9 pr-3 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20" placeholder={t.search} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <Select value={filter} onChange={(event) => setFilter(event.target.value as RelationshipFilter)} className="w-full sm:w-48">
        {filters.map((item) => <SelectOption key={item.value} value={item.value}>{item.label}</SelectOption>)}
      </Select>
    </div>

    {loading && !data ? <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}</div>
      : error ? <div className="rounded-2xl border border-dashed border-edge px-5 py-10 text-center text-sm text-fg-muted">{t.loadFailed}</div>
        : data?.items.length ? <><div className="grid gap-3 sm:grid-cols-2">{data.items.map((person) => <RelationshipCard key={person.id} person={person} language={language} onOpen={(selected) => setSelectedId(selected.id)} />)}</div>{data.nextCursor ? <div className="flex justify-center"><Button type="button" disabled={loading} onClick={() => void load(data.nextCursor, true)}>{t.loadMore}</Button></div> : null}</>
          : <div className="rounded-2xl border border-dashed border-edge px-5 py-10 text-center text-sm text-fg-muted">{filter === 'hidden' ? <EyeOff className="mx-auto mb-3 size-5" /> : null}{t.empty}</div>}

    <PersonDetailDrawer personId={selectedId} open={Boolean(selectedId)} language={language} onOpenChange={(open) => { if (!open) setSelectedId(null); }} onChanged={() => void load()} />
  </div>;
}

export function RelationshipPortraitCard({ language, onOpen }: {
  language: 'en' | 'zh';
  onOpen: () => void;
}) {
  const t = copy[language];
  const [data, setData] = useState<UserRelationshipsResponse | null>(null);
  useEffect(() => {
    void fetchUserRelationships({ kind: 'person', limit: 5 }).then(setData).catch(() => {});
  }, []);
  return <button type="button" className="group flex w-full items-center gap-4 rounded-2xl border border-edge bg-surface-panel px-5 py-4 text-left transition-colors hover:bg-surface-hover sm:px-6" onClick={onOpen}>
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Users className="size-4" /></span>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium text-fg">{t.title}</span>
      <span className="mt-0.5 block truncate text-xs leading-5 text-fg-muted">
        {data
          ? `${data.summary.people} ${t.people} · ${data.summary.sources} ${t.sourceUnit}${data.items.length ? ` · ${data.items.slice(0, 3).map((person) => person.displayName).join('、')}` : ''}`
          : t.loading}
      </span>
    </span>
    <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
  </button>;
}
