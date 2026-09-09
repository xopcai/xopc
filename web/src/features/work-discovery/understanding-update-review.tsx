import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Database,
  FileClock,
  FolderOpen,
  GitBranch,
  ListTodo,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  StickyNote,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { UserAssertion, UserModelResponse } from '@/features/user-model/user-model-api';
import { cn } from '@/lib/cn';

type AssertionDecision = 'accepted' | 'edited' | 'rejected';
type AssertionSource = NonNullable<UserAssertion['sources']>[number];
type SourceKind = AssertionSource['kind'];
type SourceCategory = AssertionSource['category'];

type ChannelView = {
  key: string;
  kind: SourceKind;
  category?: SourceCategory;
  label: string;
  assertions: UserAssertion[];
  lastObservedAt?: number;
};

type UnderstandingUpdateReviewProps = {
  assertions: UserAssertion[];
  configuredSources: NonNullable<UserModelResponse['sources']>;
  activityRunning: boolean;
  language: 'en' | 'zh';
  busy: boolean;
  error: string | null;
  onReviewAssertion: (
    assertion: UserAssertion,
    decision: AssertionDecision,
    statement?: string,
  ) => Promise<boolean>;
  onCompleted: () => void;
};

const REVIEW_STATUSES = new Set<UserAssertion['status']>(['candidate', 'needs_review', 'conflicted', 'stale']);

const copy = {
  zh: {
    eyebrow: '全局用户理解',
    title: 'xopc 如何形成对你的理解',
    subtitle: '这里汇总跨项目、跨对话形成的认识，并说明它们来自哪些渠道。项目事实不会混入你的个人画像。',
    channels: '理解渠道',
    channelHint: '每个渠道只贡献有依据的候选内容。',
    noChannels: '尚未通过任何渠道形成可展示的全局理解。',
    activeCount: '{{count}} 条已在使用',
    pendingCount: '{{count}} 条待确认',
    noUnderstanding: '尚未从这个渠道形成可使用的全局理解',
    pending: '需要你确认',
    pendingHint: '确认后才会用于其他项目和之后的对话。',
    nothingPending: '目前没有需要确认的全局理解。',
    source: '来源',
    remember: '确认',
    discard: '不是这样',
    edit: '修正',
    save: '保存修正',
    cancel: '取消',
    showAll: '查看全部 {{count}} 条',
    showLess: '收起',
    done: '完成',
    updating: '正在从已授权渠道更新理解；你可以先查看已有内容。',
    sourceKinds: {
      user: '你明确告诉我的',
      conversation: '对话与协作',
      connector: '连接的服务',
      work_folder: '工作目录',
      local_source: '本机来源',
      inference: '综合整理',
    },
    categories: {
      identity: '关于你是谁', preference: '偏好', value: '价值取向', routine: '工作习惯',
      capability: '能力与职责', relationship: '协作关系', current_state: '当前状态', derived_insight: '综合判断',
    },
  },
  en: {
    eyebrow: 'Global user understanding',
    title: 'How xopc forms its understanding of you',
    subtitle: 'This brings together understanding formed across projects and conversations, with the channel behind each item. Project facts stay out of your personal portrait.',
    channels: 'Understanding channels',
    channelHint: 'Each channel contributes only evidence-backed candidates.',
    noChannels: 'No channel has formed displayable global understanding yet.',
    activeCount: '{{count}} in use',
    pendingCount: '{{count}} to review',
    noUnderstanding: 'No usable global understanding has formed from this channel yet',
    pending: 'Needs your confirmation',
    pendingHint: 'Only confirmed items may be used across projects and future conversations.',
    nothingPending: 'There is no global understanding to review right now.',
    source: 'Source',
    remember: 'Confirm',
    discard: 'Not true',
    edit: 'Correct',
    save: 'Save correction',
    cancel: 'Cancel',
    showAll: 'View all {{count}}',
    showLess: 'Show less',
    done: 'Done',
    updating: 'Updating from authorized channels. You can review existing understanding now.',
    sourceKinds: {
      user: 'You told me',
      conversation: 'Conversations and work',
      connector: 'Connected services',
      work_folder: 'Work folders',
      local_source: 'On-device sources',
      inference: 'Synthesized understanding',
    },
    categories: {
      identity: 'Who you are', preference: 'Preference', value: 'Values', routine: 'Routine',
      capability: 'Capabilities and responsibilities', relationship: 'Collaboration', current_state: 'Current state', derived_insight: 'Synthesis',
    },
  },
} as const;

const BUILT_IN_SOURCE_NAMES: Record<string, { en: string; zh: string }> = {
  'local-recent-files': { en: 'Recent files', zh: '最近文件' },
  'chromium-bookmarks': { en: 'Recent bookmarks', zh: '最近书签' },
  'apple-notes': { en: 'Apple Notes', zh: 'Apple 备忘录' },
  'apple-mail': { en: 'Apple Mail', zh: 'Apple 邮件' },
  'apple-calendar': { en: 'Apple Calendar', zh: 'Apple 日历' },
  'apple-reminders': { en: 'Apple Reminders', zh: 'Apple 提醒事项' },
  'windows-recent-documents': { en: 'Recent documents', zh: '最近文档' },
  'linux-recent-documents': { en: 'Recent documents', zh: '最近文档' },
};

const SOURCE_ICONS: Record<SourceKind, LucideIcon> = {
  user: UserRound,
  conversation: MessageCircle,
  connector: Database,
  work_folder: FolderOpen,
  local_source: FileClock,
  inference: Database,
};

const CATEGORY_ICONS: Partial<Record<NonNullable<SourceCategory>, LucideIcon>> = {
  files: FolderOpen,
  recent_documents: FileClock,
  calendar: CalendarDays,
  tasks: ListTodo,
  notes: StickyNote,
  mail: Mail,
  messages: MessageCircle,
  code_activity: GitBranch,
};

function fallbackSource(assertion: UserAssertion): AssertionSource {
  const kind: SourceKind = assertion.authority === 'user_explicit'
    ? 'user'
    : assertion.authority === 'user_observed'
      ? 'conversation'
      : assertion.authority === 'external_untrusted'
        ? 'connector'
        : 'inference';
  return { id: kind, kind, observedAt: assertion.observedAt };
}

function sourceDisplayName(source: AssertionSource, language: 'en' | 'zh'): string {
  if (source.kind === 'local_source' && source.label) {
    return BUILT_IN_SOURCE_NAMES[source.label]?.[language] ?? source.label;
  }
  if (source.kind === 'work_folder' && source.label) {
    return language === 'zh' ? `工作目录 · ${source.label}` : `Work folder · ${source.label}`;
  }
  if (source.label) return source.label;
  return copy[language].sourceKinds[source.kind];
}

function configuredSourceKey(source: NonNullable<UserModelResponse['sources']>[number]): string {
  return `${source.kind}:${source.adapterId}:${source.displayName}`;
}

export function UnderstandingUpdateReview({
  assertions,
  configuredSources,
  activityRunning,
  language,
  busy,
  error,
  onReviewAssertion,
  onCompleted,
}: UnderstandingUpdateReviewProps) {
  const t = copy[language];
  const [showAll, setShowAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const globalAssertions = useMemo(
    () => assertions.filter((item) => item.scope.type === 'global' && item.status !== 'archived' && item.status !== 'rejected'),
    [assertions],
  );
  const pendingAssertions = useMemo(
    () => globalAssertions.filter((item) => REVIEW_STATUSES.has(item.status)),
    [globalAssertions],
  );
  const channels = useMemo<ChannelView[]>(() => {
    const channelMap = new Map<string, ChannelView>();
    for (const source of configuredSources) {
      const label = source.kind === 'local_source'
        ? BUILT_IN_SOURCE_NAMES[source.adapterId]?.[language] ?? source.displayName
        : source.displayName;
      const key = configuredSourceKey(source);
      channelMap.set(key, {
        key,
        kind: source.kind,
        category: source.category,
        label: source.kind === 'work_folder'
          ? language === 'zh' ? `工作目录 · ${label}` : `Work folder · ${label}`
          : label,
        assertions: [],
        lastObservedAt: source.lastCollectedAt,
      });
    }
    for (const assertion of globalAssertions) {
      for (const source of assertion.sources?.length ? assertion.sources : [fallbackSource(assertion)]) {
        const label = sourceDisplayName(source, language);
        const matchingConfigured = [...channelMap.values()].find((channel) => (
          channel.kind === source.kind && channel.label === label
        ));
        const key = matchingConfigured?.key ?? `${source.kind}:${label}`;
        const channel = matchingConfigured ?? channelMap.get(key) ?? {
          key,
          kind: source.kind,
          category: source.category,
          label,
          assertions: [],
          lastObservedAt: source.observedAt,
        };
        if (!channel.assertions.some((item) => item.id === assertion.id)) channel.assertions.push(assertion);
        channel.lastObservedAt = Math.max(channel.lastObservedAt ?? 0, source.observedAt);
        channelMap.set(key, channel);
      }
    }
    return [...channelMap.values()].sort((left, right) => (
      right.assertions.length - left.assertions.length || (right.lastObservedAt ?? 0) - (left.lastObservedAt ?? 0)
    ));
  }, [configuredSources, globalAssertions, language]);

  const review = async (assertion: UserAssertion, decision: AssertionDecision, statement?: string) => {
    const completed = await onReviewAssertion(assertion, decision, statement);
    if (completed) setEditingId(null);
  };
  const visiblePending = showAll ? pendingAssertions : pendingAssertions.slice(0, 5);

  return (
    <section className="mx-auto w-full max-w-[42rem] pb-2" aria-live="polite">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-fg">{t.eyebrow}</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{t.title}</h2>
        <p className="mx-auto mt-3 max-w-[38rem] text-sm leading-6 text-fg-muted">{t.subtitle}</p>
      </div>

      {activityRunning ? (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent-soft/55 px-4 py-3 text-sm text-accent-fg">
          <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
          <p>{t.updating}</p>
        </div>
      ) : null}

      <section className="mt-8" aria-labelledby="understanding-channels-title">
        <h3 id="understanding-channels-title" className="text-sm font-semibold text-fg">{t.channels}</h3>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{t.channelHint}</p>
        {channels.length ? <div className="mt-3 space-y-3">
          {channels.map((channel) => {
            const Icon = channel.category ? CATEGORY_ICONS[channel.category] ?? SOURCE_ICONS[channel.kind] : SOURCE_ICONS[channel.kind];
            const active = channel.assertions.filter((item) => item.status === 'active').length;
            const pending = channel.assertions.filter((item) => REVIEW_STATUSES.has(item.status)).length;
            return (
              <article key={channel.key} className="rounded-2xl border border-edge bg-surface-base/55 px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-fg-muted"><Icon className="size-4" /></div>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-sm font-medium text-fg">{channel.label}</h4>
                    {channel.assertions.length ? (
                      <p className="mt-1 text-xs text-fg-muted">
                        {[active ? t.activeCount.replace('{{count}}', String(active)) : '', pending ? t.pendingCount.replace('{{count}}', String(pending)) : ''].filter(Boolean).join(' · ')}
                      </p>
                    ) : <p className="mt-1 text-xs text-fg-muted">{t.noUnderstanding}</p>}
                  </div>
                </div>
                {channel.assertions.length ? (
                  <ul className="ml-12 mt-3 space-y-2 border-t border-edge-subtle pt-3 text-xs leading-5 text-fg-muted">
                    {channel.assertions.slice(0, 5).map((item) => (
                      <li key={item.id} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-accent/60" /><span>{item.statement}</span></li>
                    ))}
                  </ul>
                ) : null}
              </article>
            );
          })}
        </div> : <p className="mt-3 rounded-2xl border border-edge bg-surface-base/55 p-4 text-sm text-fg-muted">{t.noChannels}</p>}
      </section>

      <section className="mt-8" aria-labelledby="understanding-pending-title">
        <h3 id="understanding-pending-title" className="text-sm font-semibold text-fg">
          {t.pending}{pendingAssertions.length ? ` · ${pendingAssertions.length}` : ''}
        </h3>
        <p className="mt-1 text-xs leading-5 text-fg-muted">{t.pendingHint}</p>
        {pendingAssertions.length ? (
          <div className="mt-3 space-y-3">
            {visiblePending.map((assertion) => {
              const editing = editingId === assertion.id;
              const sourceLabels = (assertion.sources?.length ? assertion.sources : [fallbackSource(assertion)])
                .map((source) => sourceDisplayName(source, language));
              return (
                <article key={assertion.id} className="rounded-2xl border border-edge bg-surface-panel p-4 shadow-surface sm:p-5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent-fg">{t.categories[assertion.kind]}</span>
                    <span className="text-fg-subtle">{t.source}: {sourceLabels.join(' · ')}</span>
                  </div>
                  {editing ? (
                    <textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} className="mt-3 min-h-24 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm leading-6 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" />
                  ) : <p className="mt-3 text-[0.95rem] font-medium leading-7 text-fg">{assertion.statement}</p>}
                  {editing ? (
                    <div className="mt-4 flex justify-end gap-2">
                      <Button variant="ghost" disabled={busy} onClick={() => setEditingId(null)}>{t.cancel}</Button>
                      <Button variant="primary" disabled={busy || !draft.trim()} onClick={() => void review(assertion, 'edited', draft.trim())}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t.save}
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <Button variant="ghost" disabled={busy} onClick={() => { setEditingId(assertion.id); setDraft(assertion.statement); }}><Pencil className="size-3.5" />{t.edit}</Button>
                      <Button variant="secondary" disabled={busy} onClick={() => void review(assertion, 'rejected')}><X className="size-3.5" />{t.discard}</Button>
                      <Button variant="primary" disabled={busy} onClick={() => void review(assertion, 'accepted')}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t.remember}</Button>
                    </div>
                  )}
                </article>
              );
            })}
            {pendingAssertions.length > 5 ? (
              <button type="button" className="mx-auto flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-accent-fg hover:underline" onClick={() => setShowAll((value) => !value)}>
                {showAll ? t.showLess : t.showAll.replace('{{count}}', String(pendingAssertions.length))}
                <ChevronDown className={cn('size-3.5 transition-transform', showAll && 'rotate-180')} />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-3 rounded-2xl border border-edge bg-surface-base/55 p-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
            <p className="text-sm leading-6 text-fg-muted">{t.nothingPending}</p>
          </div>
        )}
      </section>

      <div className="mt-6 flex justify-end">
        <Button variant="primary" disabled={busy} onClick={onCompleted}><Check className="size-4" />{t.done}</Button>
      </div>
      {error ? <p className="mt-5 text-sm text-danger" role="alert">{error}</p> : null}
    </section>
  );
}
