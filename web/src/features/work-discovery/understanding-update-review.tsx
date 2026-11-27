import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Database,
  FileClock,
  FolderOpen,
  FolderPlus,
  GitBranch,
  HardDrive,
  ListTodo,
  Loader2,
  Mail,
  MessageCircle,
  Plug,
  StickyNote,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { UserAssertion, UserModelResponse } from '@/features/user-model/user-model-api';
import { UnderstandingRow } from '@/features/user-model/understanding-row';
import { groupUnderstandingByDate } from '@/features/user-model/understanding-row.utils';
import { cn } from '@/lib/cn';

import { UnderstandingRefreshButton, UnderstandingRefreshProgress } from './understanding-refresh-controls';

type AssertionDecision = 'edited' | 'deleted';
type AssertionSource = NonNullable<UserAssertion['sources']>[number];
type SourceKind = AssertionSource['kind'];
type SourceCategory = AssertionSource['category'];

type ChannelView = {
  key: string;
  grantId?: string;
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
  onAddLocalSources?: () => void;
  onPreloadLocalSources?: () => void;
  onOpenConnectors?: () => void;
};

const copy = {
  zh: {
    statGlobal: '全局理解',
    statGlobalSub: '{{count}} 条生效中',
    statLocal: '本机资料与目录',
    statLocalEmpty: '尚未扫描',
    statConnectors: '云端连接服务',
    statConnectorsEmpty: '尚未连接',
    sourceCountUnit: '{{count}} 个来源',
    itemCountUnit: '{{count}} 条',
    sourcesTitle: '理解来源',
    sourcesHint: '点击来源卡片可按渠道筛选下方理解；项目事实保留在工作记忆，不会混入个人画像。',
    localGroupTitle: '本机资料与工作目录',
    localAddAction: '添加 / 重新扫描',
    localEmptyTitle: '尚未扫描本机文件',
    localEmptyBody: '可选择读取 AI 工具规则、Obsidian 知识库、本地笔记、近期文档或工作目录，让 xopc 快速理解你的工作习惯。',
    localEmptyCta: '选择本地资料',
    connectorsGroupTitle: '云端连接服务',
    connectorsManageAction: '管理连接器',
    connectorsEmpty: '尚未连接 Gmail、Google Calendar、GitHub 等外部服务。',
    connectorsEmptyCta: '前往连接',
    directGroupTitle: '对话与手动补充',
    activeCount: '{{count}} 条生效中',
    pendingCount: '{{count}} 条暂不使用',
    noUnderstanding: '暂无全局画像（项目线索留在工作记忆）',
    pending: '最近更新',
    pendingHint: '自动整理并按需使用，你可以随时修改或删除。',
    filterLabel: '仅看：{{label}}',
    clearFilter: '查看全部',
    nothingPending: '尚未形成全局理解。可以先扫描本地资料，或在连接器中授权常用工作服务。',
    filteredEmpty: '「{{label}}」暂未沉淀跨项目的全局理解。该来源里的日程、文档或任务线索会保留在工作记忆中。',
    showAll: '查看全部 {{count}} 条',
    showLess: '收起',
    updating: '正在从已授权来源更新理解；你可以先浏览已有内容。',
    sourceKinds: {
      user: '你明确告诉我的',
      conversation: '对话与协作',
      connector: '连接的服务',
      work_folder: '工作目录',
      local_source: '本机来源',
      inference: '综合整理',
    },
  },
  en: {
    statGlobal: 'Global understanding',
    statGlobalSub: '{{count}} in use',
    statLocal: 'Local files & folders',
    statLocalEmpty: 'Not scanned yet',
    statConnectors: 'Connected services',
    statConnectorsEmpty: 'None connected',
    sourceCountUnit: '{{count}} sources',
    itemCountUnit: '{{count}} items',
    sourcesTitle: 'Understanding sources',
    sourcesHint: 'Select a source card to filter items below. Project facts stay in Work Memory rather than your personal portrait.',
    localGroupTitle: 'Local files & work folders',
    localAddAction: 'Add or rescan',
    localEmptyTitle: 'No local files scanned yet',
    localEmptyBody: 'Optionally scan AI instructions, Obsidian vaults, Markdown notes, recent documents, or work folders so xopc understands your habits faster.',
    localEmptyCta: 'Choose local sources',
    connectorsGroupTitle: 'Connected services',
    connectorsManageAction: 'Manage connectors',
    connectorsEmpty: 'No external services such as Gmail, Google Calendar, or GitHub are connected yet.',
    connectorsEmptyCta: 'Connect services',
    directGroupTitle: 'Conversations & direct notes',
    activeCount: '{{count}} in use',
    pendingCount: '{{count}} not in use',
    noUnderstanding: 'No global portrait items yet (work items stay in Work Memory)',
    pending: 'Recent updates',
    pendingHint: 'Organized automatically and used when relevant. Edit or delete anytime.',
    filterLabel: 'Filtered: {{label}}',
    clearFilter: 'Show all',
    nothingPending: 'No global understanding has formed yet. Scan local sources or connect a work service to get started.',
    filteredEmpty: '"{{label}}" has not formed cross-project global understanding yet. Specific events, documents, and tasks remain in Work Memory.',
    showAll: 'View all {{count}}',
    showLess: 'Show less',
    updating: 'Updating from authorized sources. You can review existing understanding now.',
    sourceKinds: {
      user: 'You told me',
      conversation: 'Conversations and work',
      connector: 'Connected services',
      work_folder: 'Work folders',
      local_source: 'On-device sources',
      inference: 'Synthesized understanding',
    },
  },
} as const;

const BUILT_IN_SOURCE_NAMES: Record<string, { en: string; zh: string }> = {
  'local-ai-instructions': { en: 'AI instructions & rules', zh: 'AI 工具规则' },
  'local-obsidian': { en: 'Obsidian vaults', zh: 'Obsidian 知识库' },
  'local-markdown-notes': { en: 'Local Markdown notes', zh: '本地笔记目录' },
  'local-recent-files': { en: 'Recent documents', zh: '近期文档' },
  'chromium-bookmarks': { en: 'Browser bookmarks', zh: '浏览器书签' },
  'apple-notes': { en: 'Apple Notes', zh: 'Apple 备忘录' },
  'apple-mail': { en: 'Apple Mail', zh: 'Apple 邮件' },
  'apple-calendar': { en: 'Apple Calendar', zh: 'Apple 日历' },
  'apple-reminders': { en: 'Apple Reminders', zh: 'Apple 提醒事项' },
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
  onAddLocalSources,
  onPreloadLocalSources,
  onOpenConnectors,
}: UnderstandingUpdateReviewProps) {
  const t = copy[language];
  const [showAll, setShowAll] = useState(false);
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const globalAssertions = useMemo(
    () => assertions.filter((item) => item.scope.type === 'global' && item.status !== 'archived' && item.status !== 'rejected'),
    [assertions],
  );
  const activeGlobalCount = useMemo(
    () => globalAssertions.filter((item) => item.usable !== false).length,
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
        grantId: source.id,
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

  const localChannels = useMemo(
    () => channels.filter((channel) => channel.kind === 'local_source' || channel.kind === 'work_folder'),
    [channels],
  );
  const connectorChannels = useMemo(
    () => channels.filter((channel) => channel.kind === 'connector'),
    [channels],
  );
  const directChannels = useMemo(
    () => channels.filter((channel) => channel.kind === 'user' || channel.kind === 'conversation' || channel.kind === 'inference'),
    [channels],
  );

  const selectedChannel = useMemo(
    () => (selectedChannelKey ? channels.find((channel) => channel.key === selectedChannelKey) ?? null : null),
    [channels, selectedChannelKey],
  );

  const recentAssertions = useMemo(() => {
    const base = selectedChannel ? selectedChannel.assertions : globalAssertions;
    return [...base].sort((a, b) => b.recordedAt - a.recordedAt);
  }, [globalAssertions, selectedChannel]);

  const visibleRecent = showAll ? recentAssertions : recentAssertions.slice(0, 6);

  const review = async (assertion: UserAssertion, decision: AssertionDecision, statement?: string) => {
    const completed = await onReviewAssertion(assertion, decision, statement);
    if (completed) setEditingId(null);
  };

  const toggleChannel = (key: string) => {
    setSelectedChannelKey((current) => (current === key ? null : key));
    setShowAll(false);
  };

  const renderChannelCard = (channel: ChannelView) => {
    const Icon = channel.category ? CATEGORY_ICONS[channel.category] ?? SOURCE_ICONS[channel.kind] : SOURCE_ICONS[channel.kind];
    const active = channel.assertions.filter((item) => item.usable !== false).length;
    const pending = channel.assertions.filter((item) => item.usable === false).length;
    const selected = selectedChannel?.key === channel.key;
    return (
      <article
        key={channel.key}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => toggleChannel(channel.key)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleChannel(channel.key);
          }
        }}
        className={cn(
          'flex cursor-pointer flex-col justify-between rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          selected
            ? 'border-accent bg-accent-soft/35'
            : 'border-edge bg-surface-panel hover:bg-surface-hover/50',
        )}
      >
        <div className="flex items-start gap-2.5">
          <div className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
            selected ? 'bg-accent-soft text-accent-fg' : 'bg-surface-inset text-fg-muted',
          )}>
            <Icon className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-1.5">
              <h5 className="truncate pt-0.5 text-sm font-medium text-fg">{channel.label}</h5>
              {channel.grantId ? <UnderstandingRefreshButton sourceId={channel.grantId} /> : null}
            </div>
            {channel.assertions.length ? (
              <p className="mt-0.5 text-xs text-fg-muted">
                {[active ? t.activeCount.replace('{{count}}', String(active)) : '', pending ? t.pendingCount.replace('{{count}}', String(pending)) : ''].filter(Boolean).join(' · ')}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-fg-subtle">{t.noUnderstanding}</p>
            )}
            {channel.grantId ? (
              <UnderstandingRefreshProgress sourceId={channel.grantId} lastCollectedAt={channel.lastObservedAt} />
            ) : null}
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-6" aria-live="polite">
      {/* Compact Overview Strip */}
      <section className="grid grid-cols-3 gap-2.5" aria-label={t.statGlobal}>
        <div className="rounded-xl border border-edge bg-surface-panel px-3.5 py-3">
          <p className="text-[11px] font-medium text-fg-subtle">{t.statGlobal}</p>
          <p className="mt-1 text-base font-semibold text-fg">
            {t.itemCountUnit.replace('{{count}}', String(globalAssertions.length))}
          </p>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            {t.statGlobalSub.replace('{{count}}', String(activeGlobalCount))}
          </p>
        </div>
        <div className="rounded-xl border border-edge bg-surface-panel px-3.5 py-3">
          <p className="text-[11px] font-medium text-fg-subtle">{t.statLocal}</p>
          <p className="mt-1 text-base font-semibold text-fg">
            {localChannels.length
              ? t.sourceCountUnit.replace('{{count}}', String(localChannels.length))
              : t.statLocalEmpty}
          </p>
          {onAddLocalSources ? (
            <button
              type="button"
              onPointerEnter={onPreloadLocalSources}
              onFocus={onPreloadLocalSources}
              onClick={onAddLocalSources}
              className="mt-0.5 text-[11px] font-medium text-accent-fg hover:underline"
            >
              {localChannels.length ? t.localAddAction : t.localEmptyCta}
            </button>
          ) : null}
        </div>
        <div className="rounded-xl border border-edge bg-surface-panel px-3.5 py-3">
          <p className="text-[11px] font-medium text-fg-subtle">{t.statConnectors}</p>
          <p className="mt-1 text-base font-semibold text-fg">
            {connectorChannels.length
              ? t.sourceCountUnit.replace('{{count}}', String(connectorChannels.length))
              : t.statConnectorsEmpty}
          </p>
          {onOpenConnectors ? (
            <button
              type="button"
              onClick={onOpenConnectors}
              className="mt-0.5 text-[11px] font-medium text-fg-muted hover:text-fg hover:underline"
            >
              {connectorChannels.length ? t.connectorsManageAction : t.connectorsEmptyCta}
            </button>
          ) : null}
        </div>
      </section>

      {activityRunning ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-accent/20 bg-accent-soft/55 px-4 py-2.5 text-xs text-accent-fg">
          <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          <p>{t.updating}</p>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-danger/25 bg-danger/5 px-4 py-2.5 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {/* Section 1: Grouped Understanding Sources */}
      <section className="space-y-4" aria-labelledby="understanding-sources-title">
        <div>
          <h3 id="understanding-sources-title" className="text-sm font-semibold text-fg">
            {t.sourcesTitle}{channels.length ? ` · ${channels.length}` : ''}
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t.sourcesHint}</p>
        </div>

        {/* Group A: Local files & work folders (always visible so users can easily discover & rescan) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
              <HardDrive className="size-3.5" aria-hidden />
              {t.localGroupTitle}
            </h4>
            {onAddLocalSources ? (
              <Button
                type="button"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-accent-fg"
                onPointerEnter={onPreloadLocalSources}
                onFocus={onPreloadLocalSources}
                onClick={onAddLocalSources}
              >
                <FolderPlus className="size-3.5" aria-hidden />
                {t.localAddAction}
              </Button>
            ) : null}
          </div>
          {localChannels.length ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {localChannels.map(renderChannelCard)}
            </div>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-edge bg-surface-inset/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-fg">{t.localEmptyTitle}</p>
                <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t.localEmptyBody}</p>
              </div>
              {onAddLocalSources ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 shrink-0 gap-1.5 self-start px-3 text-xs sm:self-center"
                  onPointerEnter={onPreloadLocalSources}
                  onFocus={onPreloadLocalSources}
                  onClick={onAddLocalSources}
                >
                  <FolderPlus className="size-3.5" aria-hidden />
                  {t.localEmptyCta}
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {/* Group B: Connected cloud services */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
              <Plug className="size-3.5" aria-hidden />
              {t.connectorsGroupTitle}
            </h4>
            {onOpenConnectors ? (
              <Button
                type="button"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-fg-muted"
                onClick={onOpenConnectors}
              >
                {t.connectorsManageAction}
                <ArrowUpRight className="size-3" aria-hidden />
              </Button>
            ) : null}
          </div>
          {connectorChannels.length ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {connectorChannels.map(renderChannelCard)}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-surface-panel/70 px-4 py-3 text-xs text-fg-muted">
              <span>{t.connectorsEmpty}</span>
              {onOpenConnectors ? (
                <button
                  type="button"
                  onClick={onOpenConnectors}
                  className="shrink-0 font-medium text-accent-fg hover:underline"
                >
                  {t.connectorsEmptyCta}
                </button>
              ) : null}
            </div>
          )}
        </div>

        {/* Group C: Direct conversations & explicit user notes (compact chips when present) */}
        {directChannels.length ? (
          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
              <MessageCircle className="size-3.5" aria-hidden />
              {t.directGroupTitle}
            </h4>
            <div className="flex flex-wrap gap-2">
              {directChannels.map((channel) => {
                const Icon = SOURCE_ICONS[channel.kind];
                const selected = selectedChannel?.key === channel.key;
                return (
                  <button
                    key={channel.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleChannel(channel.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      selected
                        ? 'border-accent bg-accent-soft/45 font-medium text-accent-fg'
                        : 'border-edge bg-surface-panel text-fg-muted hover:bg-surface-hover hover:text-fg',
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    <span>{channel.label}</span>
                    <span className="text-[11px] opacity-75">· {channel.assertions.length}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {/* Section 2: Recent Global Understanding Updates */}
      <section className="space-y-3 border-t border-edge-subtle pt-5" aria-labelledby="understanding-updates-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="understanding-updates-title" className="text-sm font-semibold text-fg">
              {t.pending}{recentAssertions.length ? ` · ${recentAssertions.length}` : ''}
            </h3>
            <p className="mt-0.5 text-xs leading-5 text-fg-muted">{t.pendingHint}</p>
          </div>
          {selectedChannel ? (
            <button
              type="button"
              onClick={() => setSelectedChannelKey(null)}
              className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent-soft/45 px-2.5 py-1 text-xs font-medium text-accent-fg hover:bg-accent-soft/70"
            >
              <span>{t.filterLabel.replace('{{label}}', selectedChannel.label)}</span>
              <X className="size-3" aria-hidden />
            </button>
          ) : null}
        </div>

        {recentAssertions.length ? (
          <div className="overflow-hidden rounded-xl border border-edge bg-surface-panel">
            {groupUnderstandingByDate(visibleRecent, language).map(({ label, items }) => (
              <div key={label} className="border-t border-edge-subtle first:border-t-0">
                <h4 className="bg-surface-inset/50 px-4 py-1.5 text-[11px] font-medium text-fg-muted">{label}</h4>
                <div>
                  {items.map((assertion) => (
                    <UnderstandingRow
                      key={assertion.id}
                      item={assertion}
                      language={language}
                      busy={busy}
                      editing={editingId === assertion.id}
                      draft={draft}
                      onDraftChange={setDraft}
                      onEdit={() => { setEditingId(assertion.id); setDraft(assertion.statement); }}
                      onCancel={() => setEditingId(null)}
                      onCorrect={() => void review(assertion, 'edited', draft.trim())}
                      onDelete={() => void review(assertion, 'deleted')}
                    />
                  ))}
                </div>
              </div>
            ))}
            {recentAssertions.length > 6 ? (
              <div className="border-t border-edge-subtle bg-surface-inset/30 py-1.5 text-center">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-accent-fg hover:underline"
                  onClick={() => setShowAll((value) => !value)}
                >
                  {showAll ? t.showLess : t.showAll.replace('{{count}}', String(recentAssertions.length))}
                  <ChevronDown className={cn('size-3.5 transition-transform', showAll && 'rotate-180')} />
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-edge bg-surface-panel p-4">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
              <p className="text-xs leading-5 text-fg-muted">
                {selectedChannel
                  ? t.filteredEmpty.replace('{{label}}', selectedChannel.label)
                  : t.nothingPending}
              </p>
            </div>
            {selectedChannel ? (
              <Button variant="ghost" className="h-7 shrink-0 px-2 text-xs text-accent-fg" onClick={() => setSelectedChannelKey(null)}>
                {t.clearFilter}
              </Button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
