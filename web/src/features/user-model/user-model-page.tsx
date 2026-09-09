import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  Database,
  Handshake,
  Languages,
  Loader2,
  MapPin,
  MessageCircle,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  UserRoundPen,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { UnderstandingStatusButton } from '@/features/work-discovery/understanding-status-button';

import {
  correctAssertion,
  detectBrowserTimezone,
  fetchUserModel,
  setAssertionStatus,
  setKnowledgeStatus,
  setRuleStatus,
  updateUserProfile,
  type AssertionStatus,
  type CollaborationRule,
  type KnowledgeItem,
  type PriorityWindow,
  type UserAssertion,
  type UserGoal,
  type UserModelResponse,
  type UserProfile,
} from './user-model-api';

type Language = 'en' | 'zh';
type View = 'overview' | 'understanding' | 'knowledge';

const copy = {
  en: {
    pageTitle: 'You',
    pageSubtitle: 'A living portrait shaped by you and xopc.',
    overview: 'Your portrait',
    understanding: 'Shared understanding',
    knowledge: 'Work memory',
    portraitEyebrow: 'YOU × XOPC',
    portraitIntro: 'Your explicit profile stays clear and editable. xopc builds a separate shared understanding through conversations and work.',
    editProfile: 'Edit basics',
    callName: 'What should xopc call you?',
    callNamePlaceholder: 'For example: Alex, Joyce, or Dr. Chen',
    role: 'Your role',
    rolePlaceholder: 'For example: founder, designer, or engineer',
    pronouns: 'Pronouns (optional)',
    pronounsPlaceholder: 'For example: she/her, he/him, they/them',
    timezone: 'Timezone',
    locale: 'Language / locale',
    useDeviceTimezone: 'Use this device',
    notProvided: 'Not provided',
    editProfileHint: 'These are facts you provide directly. They remain separate from xopc’s observations and inferences.',
    saveProfile: 'Save',
    saving: 'Saving…',
    explicit: 'You told me',
    explicitHint: 'Facts and preferences you stated directly',
    learned: 'Learned together',
    learnedHint: 'Patterns formed from our work',
    pending: 'To confirm together',
    pendingHint: 'Items that need your judgment',
    confirmTogether: 'Confirm together',
    confirmHint: 'These may affect future behavior. Confirm them, correct the wording, or tell me not to use them.',
    nothingToConfirm: 'Nothing needs your confirmation right now.',
    importantNow: 'What matters now',
    noPriority: 'No current priority has been set.',
    otherGoals: 'Other active outcomes',
    howWeWork: 'How we work together',
    howWeWorkHint: 'Your standing instructions for how I should communicate and act.',
    noRules: 'No collaboration preferences yet.',
    recent: 'Recently formed understanding',
    recentHint: 'The most useful current facts, with their origin and time horizon.',
    seeAll: 'See all',
    workMemory: 'What I remember from the work',
    workMemoryHint: 'Project facts, decisions, lessons, and open questions stay separate from facts about you.',
    items: 'items',
    maintenanceReady: 'Memory upkeep is enabled and waiting for its first run.',
    maintenanceComplete: 'Memory was last organized',
    maintenanceFailed: 'The latest memory upkeep needs attention',
    refresh: 'Refresh',
    aboutYouTitle: 'A view you can correct',
    aboutYouHint: 'This is working context, not a fixed profile. Every item can be corrected or retired.',
    identity: 'Who you are',
    preferences: 'Preferences and working rhythm',
    relationships: 'People and relationships',
    currentState: 'Current context',
    insights: 'My current read',
    emptyGroup: 'No understanding has formed here yet.',
    correct: 'Correct',
    stopUsing: 'Stop using',
    confirm: 'Confirm',
    notTrue: 'Not true',
    save: 'Save correction',
    cancel: 'Cancel',
    correctionPlaceholder: 'Write the accurate version…',
    searchPlaceholder: 'Search work memory…',
    allMemory: 'All work memory',
    memoryLibraryHint: 'Only distilled facts, decisions, lessons, commitments, and open questions appear here. Source records stay with their connector.',
    noKnowledge: 'No work memory has formed yet.',
    noKnowledgeMatch: 'No work memory matches this search.',
    archive: 'Archive',
    showMore: 'Show more',
    expand: 'Show details',
    collapse: 'Hide details',
    disable: 'Disable',
    disabled: 'Not in use',
    enable: 'Enable',
    loadFailed: 'Could not load your understanding.',
    tryAgain: 'Try again',
    actionFailed: 'The change could not be saved. Please try again.',
  },
  zh: {
    pageTitle: '你',
    pageSubtitle: '一份由你和 xopc 共同塑造、持续生长的画像。',
    overview: '你的画像',
    understanding: '共同理解',
    knowledge: '工作记忆',
    portraitEyebrow: 'YOU × XOPC',
    portraitIntro: '你明确提供的基本信息会被清晰呈现并由你直接编辑；xopc 在对话与共事中形成的理解则单独维护。',
    editProfile: '编辑基本信息',
    callName: '希望 xopc 如何称呼你？',
    callNamePlaceholder: '例如：Mic、Joyce、张老师',
    role: '你的角色',
    rolePlaceholder: '例如：创业者、产品设计师、工程师',
    pronouns: '代词（可选）',
    pronounsPlaceholder: '例如：she/her、he/him、they/them',
    timezone: '时区',
    locale: '语言 / 地区',
    useDeviceTimezone: '使用本机时区',
    notProvided: '未填写',
    editProfileHint: '这些是由你直接提供的事实，与 xopc 的观察和推断分开维护。',
    saveProfile: '保存',
    saving: '正在保存…',
    explicit: '你告诉我的',
    explicitHint: '你明确表达的事实与偏好',
    learned: '协作中学到的',
    learnedHint: '从实际协作中形成的认识',
    pending: '等待一起确认',
    pendingHint: '需要由你判断的内容',
    confirmTogether: '一起确认',
    confirmHint: '这些理解可能影响之后的行为。你可以确认、修正，或告诉我以后不要使用。',
    nothingToConfirm: '目前没有需要你确认的理解。',
    importantNow: '此刻重要',
    noPriority: '还没有设置当前优先事项。',
    otherGoals: '其他进行中的目标',
    howWeWork: '我们怎样协作',
    howWeWorkHint: '你对沟通方式和执行行为的长期约定。',
    noRules: '还没有形成协作偏好。',
    recent: '最近形成的理解',
    recentHint: '最值得使用的当前认识，同时说明它来自哪里、适用多久。',
    seeAll: '查看全部',
    workMemory: '我在工作中记住的',
    workMemoryHint: '项目事实、决定、经验和待解问题，与“关于你”的理解分别管理。',
    items: '条',
    maintenanceReady: '记忆整理已经启用，正在等待首次运行。',
    maintenanceComplete: '最近一次记忆整理于',
    maintenanceFailed: '最近一次记忆整理需要处理',
    refresh: '刷新',
    aboutYouTitle: '一份可以共同修正的理解',
    aboutYouHint: '它是协作中的工作认知，不是给你定型的档案。每一条都能修正或停止使用。',
    identity: '关于你是谁',
    preferences: '偏好与工作节奏',
    relationships: '重要的人与关系',
    currentState: '当前状态',
    insights: '我形成的判断',
    emptyGroup: '这里还没有形成理解。',
    correct: '修正',
    stopUsing: '不再使用',
    confirm: '确认',
    notTrue: '不是这样',
    save: '保存修正',
    cancel: '取消',
    correctionPlaceholder: '写下更准确的说法…',
    searchPlaceholder: '搜索工作记忆…',
    allMemory: '全部工作记忆',
    memoryLibraryHint: '这里只显示提炼后的事实、决定、经验、承诺和待解问题；邮件、日历与文档原文保留在对应来源中。',
    noKnowledge: '还没有形成工作记忆。',
    noKnowledgeMatch: '没有符合搜索条件的工作记忆。',
    archive: '归档',
    showMore: '显示更多',
    expand: '查看详情',
    collapse: '收起详情',
    disable: '停用',
    disabled: '已停用',
    enable: '启用',
    loadFailed: '无法载入对你的理解。',
    tryAgain: '重试',
    actionFailed: '修改没有保存，请重试。',
  },
} as const;

const reviewStatuses: AssertionStatus[] = ['candidate', 'needs_review', 'conflicted', 'stale'];

const profilePredicates = new Set([
  'identity.call_name',
  'identity.role',
  'identity.pronouns',
  'preference.timezone',
  'preference.locale',
]);

const knowledgeKindOrder = [
  'project_fact',
  'workspace_fact',
  'decision',
  'task_lesson',
  'commitment',
  'open_question',
  'episode',
  'note',
] as const;

function formatDate(value: number | undefined, language: Language, withTime = false): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
  }).format(value);
}

function profileText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function profileFromResponse(data: UserModelResponse): UserProfile {
  return {
    callName: profileText(data.profile.callName) ?? '',
    role: profileText(data.profile.role) ?? '',
    pronouns: profileText(data.profile.pronouns) ?? '',
    timezone: profileText(data.profile.timezone) ?? '',
    locale: profileText(data.profile.locale) ?? '',
  };
}

function localeLabel(locale: string, language: Language): string {
  const labels: Record<string, { en: string; zh: string }> = {
    'zh-CN': { en: 'Simplified Chinese', zh: '简体中文' },
    'zh-TW': { en: 'Traditional Chinese', zh: '繁体中文' },
    'en-US': { en: 'English (US)', zh: '英语（美国）' },
    'en-GB': { en: 'English (UK)', zh: '英语（英国）' },
    'ja-JP': { en: 'Japanese', zh: '日语' },
  };
  return labels[locale]?.[language] ?? locale;
}

function initials(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toLocaleUpperCase();
}

function authorityLabel(item: UserAssertion, language: Language): string {
  const labels = language === 'zh'
    ? {
        user_explicit: '你告诉我的',
        user_observed: '从协作中观察到',
        system_inferred: '我形成的判断',
        external_untrusted: '来自连接的信息',
      }
    : {
        user_explicit: 'You told me',
        user_observed: 'Observed while working together',
        system_inferred: 'My current read',
        external_untrusted: 'From connected information',
      };
  return labels[item.authority];
}

function timeHorizon(item: UserAssertion, language: Language): string {
  if (item.validTo) {
    const date = formatDate(item.validTo, language);
    return language === 'zh' ? `适用至 ${date}` : `Applies until ${date}`;
  }
  const labels = language === 'zh'
    ? { stable: '长期有效', slow: '会随时间复核', dynamic: '近期状态', event: '特定阶段' }
    : { stable: 'Long-term', slow: 'Reviewed over time', dynamic: 'Current context', event: 'Specific period' };
  return labels[item.volatility];
}

function validUntil(value: number, language: Language): string {
  const date = formatDate(value, language);
  return language === 'zh' ? `当前安排至 ${date}` : `Current plan through ${date}`;
}

function confidenceLabel(item: UserAssertion, language: Language): string | null {
  if (item.authority === 'user_explicit') return null;
  if (item.confidence >= 0.85) return language === 'zh' ? '把握较高' : 'High confidence';
  if (item.confidence >= 0.65) return language === 'zh' ? '把握中等' : 'Medium confidence';
  return language === 'zh' ? '仍需确认' : 'Needs confirmation';
}

function scopeLabel(scope: UserAssertion['scope'], language: Language): string {
  const labels = language === 'zh'
    ? { global: '所有协作', agent: '当前智能体', workspace: '当前工作区', project: '当前项目', session: '当前会话' }
    : { global: 'All work', agent: 'This agent', workspace: 'This workspace', project: 'This project', session: 'This conversation' };
  return labels[scope.type];
}

function knowledgeKindLabel(kind: KnowledgeItem['kind'], language: Language): string {
  const labels = language === 'zh'
    ? {
        project_fact: '项目事实', workspace_fact: '工作区事实', decision: '已经决定', task_lesson: '工作经验',
        commitment: '承诺与约定', open_question: '待解问题', episode: '重要经历', note: '其他记录',
      }
    : {
        project_fact: 'Project facts', workspace_fact: 'Workspace facts', decision: 'Decisions', task_lesson: 'Lessons',
        commitment: 'Commitments', open_question: 'Open questions', episode: 'Episodes', note: 'Notes',
      };
  return labels[kind];
}

function goalTitle(priority: PriorityWindow | undefined, goals: UserGoal[], language: Language): string | undefined {
  if (!priority) return undefined;
  if (priority.targetType === 'goal') return goals.find((goal) => goal.id === priority.targetId)?.title;
  const looksLikeId = /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(priority.targetId);
  if (!looksLikeId) return priority.targetId;
  const targetLabels = language === 'zh'
    ? { project: '当前项目', task: '当前任务', assertion: '一项待处理的理解', topic: '当前主题' }
    : { project: 'Current project', task: 'Current task', assertion: 'An understanding to address', topic: 'Current topic' };
  return targetLabels[priority.targetType];
}

function Section({
  title,
  hint,
  action,
  children,
  className = '',
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-edge bg-surface-panel shadow-surface ${className}`}>
      <header className="flex items-start justify-between gap-4 border-b border-edge-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {hint ? <p className="mt-1 max-w-2xl text-sm leading-5 text-fg-muted">{hint}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-5 py-8 text-center text-sm text-fg-muted">
      <span className="text-fg-subtle">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

function ProfileDialog({
  open,
  profile,
  language,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  profile: UserProfile;
  language: Language;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (profile: UserProfile) => void;
}) {
  const t = copy[language];
  const [draft, setDraft] = useState(profile);

  useEffect(() => {
    if (open) setDraft(profile);
  }, [open, profile]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({
      callName: draft.callName.trim(),
      role: draft.role.trim(),
      pronouns: draft.pronouns.trim(),
      timezone: draft.timezone.trim(),
      locale: draft.locale.trim(),
    });
  };
  const field = (key: 'callName' | 'role' | 'pronouns', label: string, placeholder: string) => (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-fg">{label}</span>
      <input
        value={draft[key]}
        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-edge bg-surface-base px-3 text-sm text-fg outline-none transition placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </label>
  );
  const localeOptions = ['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'ja-JP'];
  if (draft.locale && !localeOptions.includes(draft.locale)) localeOptions.push(draft.locale);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] h-[min(40rem,calc(100vh-2rem))] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
          <form className="flex h-full min-h-0 flex-col" onSubmit={submit}>
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4 sm:px-6">
              <div>
                <Dialog.Title className="font-semibold text-fg">{t.editProfile}</Dialog.Title>
                <Dialog.Description className="mt-1 text-xs leading-5 text-fg-muted">{t.editProfileHint}</Dialog.Description>
              </div>
              <Dialog.Close asChild><Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={t.cancel}><X className="size-4" /></Button></Dialog.Close>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                {field('callName', t.callName, t.callNamePlaceholder)}
                {field('role', t.role, t.rolePlaceholder)}
                {field('pronouns', t.pronouns, t.pronounsPlaceholder)}
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg">{t.locale}</span>
                  <Select value={draft.locale} onChange={(event) => setDraft((current) => ({ ...current, locale: event.target.value }))}>
                    <SelectOption value="">{t.notProvided}</SelectOption>
                    {localeOptions.map((locale) => <SelectOption key={locale} value={locale}>{localeLabel(locale, language)}</SelectOption>)}
                  </Select>
                </label>
                <label className="grid gap-1.5 text-sm sm:col-span-2">
                  <span className="font-medium text-fg">{t.timezone}</span>
                  <div className="flex gap-2">
                    <input
                      value={draft.timezone}
                      onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}
                      placeholder={detectBrowserTimezone()}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-edge bg-surface-base px-3 text-sm text-fg outline-none transition placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    <Button className="shrink-0 whitespace-nowrap" onClick={() => setDraft((current) => ({ ...current, timezone: detectBrowserTimezone() }))}>{t.useDeviceTimezone}</Button>
                  </div>
                </label>
              </div>
            </div>
            <footer className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-3 sm:px-6">
              <Dialog.Close asChild><Button disabled={saving}>{t.cancel}</Button></Dialog.Close>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}{saving ? t.saving : t.saveProfile}
              </Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function UnderstandingCard({
  item,
  language,
  busy,
  editing,
  draft,
  onDraftChange,
  onEdit,
  onCancel,
  onAction,
  onCorrect,
}: {
  item: UserAssertion;
  language: Language;
  busy: boolean;
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onAction: (status: AssertionStatus) => void;
  onCorrect: () => void;
}) {
  const t = copy[language];
  const needsReview = reviewStatuses.includes(item.status);
  const confidence = confidenceLabel(item, language);

  return (
    <article className={`rounded-xl border p-4 ${needsReview ? 'border-edge-strong bg-surface-base' : 'border-edge bg-surface-panel'}`}>
      {editing ? (
        <div className="space-y-3">
          <label className="sr-only" htmlFor={`assertion-${item.id}`}>{t.correctionPlaceholder}</label>
          <textarea
            id={`assertion-${item.id}`}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={t.correctionPlaceholder}
            className="min-h-24 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm leading-6 text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-8" onClick={onCancel}>{t.cancel}</Button>
            <Button variant="primary" className="h-8" disabled={!draft.trim() || busy} onClick={onCorrect}>{t.save}</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm leading-6 text-fg">{item.statement}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-subtle">
            <span className="inline-flex items-center gap-1.5"><MessageCircle className="size-3.5" />{authorityLabel(item, language)}</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" />{timeHorizon(item, language)}</span>
            {item.scope.type !== 'global' ? <span>{scopeLabel(item.scope, language)}</span> : null}
            {confidence ? <span>{confidence}</span> : null}
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-1.5">
            {needsReview ? (
              <>
                <Button variant="secondary" className="h-8 gap-1.5 px-2.5" disabled={busy} onClick={() => onAction('active')}>
                  <Check className="size-3.5" />{t.confirm}
                </Button>
                <Button variant="ghost" className="h-8 gap-1.5 px-2.5" disabled={busy} onClick={onEdit}>
                  <Pencil className="size-3.5" />{t.correct}
                </Button>
                <Button variant="ghost" className="h-8 gap-1.5 px-2.5" disabled={busy} onClick={() => onAction('rejected')}>
                  <X className="size-3.5" />{t.notTrue}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" className="h-8 gap-1.5 px-2.5" disabled={busy} onClick={onEdit}>
                  <Pencil className="size-3.5" />{t.correct}
                </Button>
                <Button variant="ghost" className="h-8 gap-1.5 px-2.5" disabled={busy} onClick={() => onAction('archived')}>
                  <Archive className="size-3.5" />{t.stopUsing}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </article>
  );
}

function RuleRow({
  rule,
  language,
  busy,
  onToggle,
}: {
  rule: CollaborationRule;
  language: Language;
  busy: boolean;
  onToggle: () => void;
}) {
  const t = copy[language];
  return (
    <div className="flex items-start gap-3 border-t border-edge-subtle px-5 py-3 first:border-t-0">
      <Handshake className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      <p className="min-w-0 flex-1 text-sm leading-6 text-fg">{rule.statement}</p>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {rule.status === 'disabled' ? <span className="text-xs text-fg-subtle">{t.disabled}</span> : null}
        <Button variant="ghost" className="h-8" disabled={busy} onClick={onToggle}>
          {rule.status === 'active' ? t.disable : t.enable}
        </Button>
      </div>
    </div>
  );
}

function KnowledgeRow({
  item,
  language,
  busy,
  expanded,
  onToggle,
  onArchive,
}: {
  item: KnowledgeItem;
  language: Language;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onArchive: () => void;
}) {
  const t = copy[language];
  const date = formatDate(item.updatedAt ?? item.createdAt, language);
  const canExpand = item.content.length > 96 || item.content.includes('\n');
  return (
    <article className="group border-t border-edge-subtle px-5 py-4 first:border-t-0 sm:px-6">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-1 size-4 shrink-0 text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <p className={`whitespace-pre-wrap text-sm leading-6 text-fg ${expanded ? '' : 'line-clamp-2'}`}>{item.content}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
            <span>{scopeLabel(item.scope, language)}</span>
            {date ? <span>{date}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canExpand ? (
            <Button variant="ghost" className="h-8 gap-1 px-2" onClick={onToggle}>
              <span className="hidden sm:inline">{expanded ? t.collapse : t.expand}</span>
              <ChevronDown className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </Button>
          ) : null}
          <Button variant="ghost" className="size-8 shrink-0 p-0" disabled={busy} onClick={onArchive} aria-label={t.archive} title={t.archive}>
            <Archive className="size-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

export function UserModelPage() {
  const language = useLocaleStore((state) => state.language);
  const t = copy[language];
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const { data, error, isLoading, mutate } = useSWR<UserModelResponse>('/api/user-model', fetchUserModel);
  const [view, setView] = useState<View>('overview');
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [knowledgeLimit, setKnowledgeLimit] = useState(24);
  const [expandedKnowledgeId, setExpandedKnowledgeId] = useState<string>();
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    setPageHeader({
      startExtra: null,
      main: <div><h1 className="text-base font-semibold text-fg">{t.pageTitle}</h1><p className="hidden text-xs text-fg-muted sm:block">{t.pageSubtitle}</p></div>,
      end: <UnderstandingStatusButton />,
    });
    return clearPageHeader;
  }, [clearPageHeader, setPageHeader, t]);

  const act = async (id: string, operation: () => Promise<unknown>) => {
    setBusy(id);
    setActionError(undefined);
    try {
      await operation();
      await mutate();
    } catch {
      setActionError(t.actionFailed);
    } finally {
      setBusy(undefined);
    }
  };

  const changeAssertion = (item: UserAssertion, status: AssertionStatus) => {
    void act(item.id, () => setAssertionStatus(item.id, status));
  };

  const saveCorrection = (item: UserAssertion) => {
    void act(item.id, async () => {
      await correctAssertion(item.id, draft.trim());
      setEditingId(undefined);
      setDraft('');
    });
  };

  const saveProfile = async (profile: UserProfile) => {
    setBusy('profile');
    setActionError(undefined);
    try {
      await updateUserProfile(profile);
      await mutate();
      setProfileOpen(false);
    } catch {
      setActionError(t.actionFailed);
    } finally {
      setBusy(undefined);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6 lg:py-8">
        <Skeleton className="h-10 w-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
        <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-80 rounded-xl" /><Skeleton className="h-80 rounded-xl" /></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto flex min-h-72 max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
        <Brain className="size-6 text-fg-subtle" />
        <p className="text-sm text-danger">{t.loadFailed}</p>
        <Button onClick={() => void mutate()}>{t.tryAgain}</Button>
      </div>
    );
  }

  const allAssertions = [...data.assertions].sort((a, b) => {
    const reviewDifference = Number(reviewStatuses.includes(b.status)) - Number(reviewStatuses.includes(a.status));
    if (reviewDifference) return reviewDifference;
    const importanceA = a.declaredImportance ?? a.inferredImportance;
    const importanceB = b.declaredImportance ?? b.inferredImportance;
    return importanceB - importanceA || b.recordedAt - a.recordedAt;
  });
  const assertions = allAssertions.filter((item) => (
    item.scope.type === 'global' && !profilePredicates.has(item.predicate)
  ));
  const profile = profileFromResponse(data);
  const displayName = profile.callName || (language === 'zh' ? '你' : 'You');
  const pendingAssertions = assertions.filter((item) => reviewStatuses.includes(item.status));
  const activeAssertions = assertions.filter((item) => item.status === 'active');
  const explicitCount = activeAssertions.filter((item) => item.authority === 'user_explicit').length;
  const learnedCount = activeAssertions.length - explicitCount;
  const activePriorities = data.priorities.filter((item) => item.status === 'active' && item.validTo > Date.now());
  const primaryPriority = activePriorities.find((item) => item.rank === 'primary') ?? activePriorities[0];
  const primaryTitle = goalTitle(primaryPriority, data.goals, language);
  const primaryGoal = primaryPriority?.targetType === 'goal'
    ? data.goals.find((goal) => goal.id === primaryPriority.targetId)
    : undefined;
  const activeGoals = data.goals.filter((goal) => goal.status === 'active' || goal.status === 'paused');
  const otherGoals = activeGoals.filter((goal) => primaryPriority?.targetType !== 'goal' || goal.id !== primaryPriority.targetId);
  const collaborationRules = data.rules.filter((rule) => rule.status !== 'archived');
  const recentAssertions = [...activeAssertions].sort((a, b) => b.recordedAt - a.recordedAt);
  const visibleKnowledge = data.knowledge.filter((item) => item.status !== 'archived' && item.status !== 'rejected');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchedKnowledge = visibleKnowledge.filter((item) => !normalizedQuery
    || item.content.toLocaleLowerCase().includes(normalizedQuery)
    || knowledgeKindLabel(item.kind, language).toLocaleLowerCase().includes(normalizedQuery));
  const groupedAssertions = [
    { key: 'identity', title: t.identity, icon: UserRound, items: assertions.filter((item) => item.kind === 'identity') },
    { key: 'preferences', title: t.preferences, icon: Compass, items: assertions.filter((item) => ['preference', 'value', 'routine', 'capability'].includes(item.kind)) },
    { key: 'relationships', title: t.relationships, icon: Handshake, items: assertions.filter((item) => item.kind === 'relationship') },
    { key: 'current', title: t.currentState, icon: Clock3, items: assertions.filter((item) => item.kind === 'current_state') },
    { key: 'insights', title: t.insights, icon: Sparkles, items: assertions.filter((item) => item.kind === 'derived_insight') },
  ];
  const visibleAssertionGroups = groupedAssertions.filter((group) => group.items.length > 0);
  const memoryCounts = knowledgeKindOrder
    .map((kind) => ({ kind, count: visibleKnowledge.filter((item) => item.kind === kind).length }))
    .filter((entry) => entry.count > 0);
  const limitedKnowledge = searchedKnowledge.slice(0, knowledgeLimit);
  const knowledgeGroups = knowledgeKindOrder
    .map((kind) => ({
      kind,
      items: limitedKnowledge.filter((item) => item.kind === kind),
      totalCount: searchedKnowledge.filter((item) => item.kind === kind).length,
    }))
    .filter((group) => group.items.length > 0);

  const assertionCard = (item: UserAssertion) => (
    <UnderstandingCard
      key={item.id}
      item={item}
      language={language}
      busy={busy === item.id}
      editing={editingId === item.id}
      draft={editingId === item.id ? draft : ''}
      onDraftChange={setDraft}
      onEdit={() => { setEditingId(item.id); setDraft(item.statement); }}
      onCancel={() => { setEditingId(undefined); setDraft(''); }}
      onAction={(status) => changeAssertion(item, status)}
      onCorrect={() => saveCorrection(item)}
    />
  );

  const maintenanceAt = data.maintenance.lastRun
    ? formatDate(data.maintenance.lastRun.finishedAt ?? data.maintenance.lastRun.startedAt, language, true)
    : null;
  const maintenanceText = !data.maintenance.lastRun
    ? t.maintenanceReady
    : data.maintenance.lastRun.status === 'completed'
      ? `${t.maintenanceComplete} ${maintenanceAt}`
      : t.maintenanceFailed;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6 lg:py-8">
      <PageTabs
        items={[
          { id: 'overview', label: t.overview, icon: Sparkles },
          { id: 'understanding', label: t.understanding, icon: UserRound, count: assertions.length },
          { id: 'knowledge', label: t.knowledge, icon: BookOpen, count: visibleKnowledge.length },
        ]}
        activeTab={view}
        onChange={setView}
        ariaLabel={t.pageTitle}
        tabIdPrefix="understanding-tab"
        panelIdPrefix="understanding-panel"
      />

      {actionError ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(undefined)} aria-label={t.cancel}><X className="size-4" /></button>
        </div>
      ) : null}

      {view === 'overview' ? (
        <div id="understanding-panel-overview" role="tabpanel" aria-labelledby="understanding-tab-overview" className="space-y-5">
          <section className="overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-surface">
            <div className="grid gap-8 px-5 py-7 sm:px-8 sm:py-9 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-10">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-accent-fg">
                  <Sparkles className="size-3.5" />
                  <span>{t.portraitEyebrow}</span>
                </div>
                <div className="mt-6 flex items-center gap-4">
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-edge bg-surface-active text-lg font-semibold text-fg sm:size-20 sm:text-xl">
                    {initials(displayName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{displayName}</h2>
                    <p className="mt-1 truncate text-sm text-fg-muted">{profile.role || t.notProvided}</p>
                  </div>
                  <Button className="shrink-0" onClick={() => setProfileOpen(true)}><UserRoundPen className="size-4" />{t.editProfile}</Button>
                </div>
                <p className="mt-6 max-w-2xl text-sm leading-6 text-fg-muted">{t.portraitIntro}</p>
                <div className="mt-6 overflow-hidden rounded-xl border border-edge bg-edge-subtle">
                  <div className="grid gap-px sm:grid-cols-3">
                    {[
                      { icon: Languages, label: t.locale, value: profile.locale ? localeLabel(profile.locale, language) : t.notProvided },
                      { icon: MapPin, label: t.timezone, value: profile.timezone || t.notProvided },
                      { icon: UserRound, label: t.pronouns, value: profile.pronouns || t.notProvided },
                    ].map(({ icon: Icon, label, value }) => (
                      <div key={label} className="bg-surface-panel px-4 py-3.5">
                        <p className="flex items-center gap-1.5 text-xs text-fg-subtle"><Icon className="size-3.5" />{label}</p>
                        <p className="mt-1.5 truncate text-sm font-medium text-fg">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex min-h-52 flex-col rounded-xl border border-edge bg-surface-base p-5 sm:p-6">
                <p className="text-xs font-semibold tracking-wide text-fg-subtle">{t.importantNow}</p>
                {primaryTitle ? (
                  <>
                    <p className="mt-4 text-xl font-semibold leading-7 tracking-tight text-fg">{primaryTitle}</p>
                    {primaryGoal?.desiredOutcome ? <p className="mt-2 text-sm leading-6 text-fg-muted">{primaryGoal.desiredOutcome}</p> : null}
                    {primaryPriority ? <p className="mt-4 text-xs text-fg-subtle">{validUntil(primaryPriority.validTo, language)}</p> : null}
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center text-sm text-fg-muted">
                    <BriefcaseBusiness className="size-5 text-fg-subtle" />
                    <span>{t.noPriority}</span>
                  </div>
                )}
                {otherGoals.length ? (
                  <div className="mt-5 border-t border-edge pt-4">
                    <p className="text-xs text-fg-subtle">{t.otherGoals}</p>
                    <div className="mt-2 space-y-2">{otherGoals.slice(0, 3).map((goal) => <p key={goal.id} className="text-sm text-fg">{goal.title}</p>)}</div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="grid border-t border-edge-subtle sm:grid-cols-3">
              {[
                { icon: MessageCircle, label: t.explicit, hint: t.explicitHint, count: explicitCount },
                { icon: Brain, label: t.learned, hint: t.learnedHint, count: learnedCount },
                { icon: Check, label: t.pending, hint: t.pendingHint, count: pendingAssertions.length },
              ].map(({ icon: Icon, label, hint, count }, index) => (
                <div key={label} className={`flex gap-3 px-5 py-4 sm:px-6 ${index ? 'border-t border-edge-subtle sm:border-l sm:border-t-0' : ''}`}>
                  <Icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                  <div><p className="text-sm font-medium text-fg"><span className="mr-1.5 text-lg tabular-nums">{count}</span>{label}</p><p className="mt-0.5 text-xs text-fg-subtle">{hint}</p></div>
                </div>
              ))}
            </div>
          </section>

          {pendingAssertions.length ? (
            <Section title={t.confirmTogether} hint={t.confirmHint}>
              <div className="grid gap-3 p-4 lg:grid-cols-2">{pendingAssertions.map(assertionCard)}</div>
            </Section>
          ) : null}

          <Section title={t.howWeWork} hint={t.howWeWorkHint}>
            {collaborationRules.length ? collaborationRules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                language={language}
                busy={busy === rule.id}
                onToggle={() => void act(rule.id, () => setRuleStatus(rule.id, rule.status === 'active' ? 'disabled' : 'active'))}
              />
            )) : <Empty icon={<Handshake className="size-5" />}>{t.noRules}</Empty>}
          </Section>

          <Section
            title={t.recent}
            hint={t.recentHint}
            action={<Button variant="ghost" className="h-8 shrink-0" onClick={() => setView('understanding')}>{t.seeAll}</Button>}
          >
            {recentAssertions.length
              ? <div className="grid gap-3 p-4 lg:grid-cols-2">{recentAssertions.slice(0, 6).map(assertionCard)}</div>
              : <Empty icon={<Brain className="size-5" />}>{t.emptyGroup}</Empty>}
          </Section>

          <Section
            title={t.workMemory}
            hint={t.workMemoryHint}
            action={<Button variant="ghost" className="h-8 shrink-0" onClick={() => setView('knowledge')}>{t.seeAll}</Button>}
          >
            {memoryCounts.length ? (
              <div className="grid gap-px bg-edge-subtle sm:grid-cols-2 lg:grid-cols-4">
                {memoryCounts.slice(0, 4).map(({ kind, count }) => (
                  <div key={kind} className="bg-surface-panel px-5 py-4">
                    <p className="text-2xl font-semibold tabular-nums text-fg">{count}</p>
                    <p className="mt-1 text-sm text-fg-muted">{knowledgeKindLabel(kind, language)}</p>
                  </div>
                ))}
              </div>
            ) : <Empty icon={<Database className="size-5" />}>{t.noKnowledge}</Empty>}
          </Section>

          <footer className="flex items-center justify-between gap-4 px-1 pb-2 text-xs text-fg-subtle">
            <span className="inline-flex items-center gap-2"><RefreshCw className="size-3.5" />{maintenanceText}</span>
            <Button variant="ghost" className="h-8 gap-1.5 px-2.5" onClick={() => void mutate()}><RefreshCw className="size-3.5" />{t.refresh}</Button>
          </footer>
        </div>
      ) : null}

      {view === 'understanding' ? (
        <div id="understanding-panel-understanding" role="tabpanel" aria-labelledby="understanding-tab-understanding" className="space-y-5">
          <div className="rounded-xl border border-edge bg-surface-panel px-5 py-5 shadow-surface sm:px-6">
            <div className="flex items-start gap-3">
              <Brain className="mt-0.5 size-5 shrink-0 text-accent-fg" />
              <div><h2 className="font-semibold text-fg">{t.aboutYouTitle}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-fg-muted">{t.aboutYouHint}</p></div>
            </div>
          </div>
          {visibleAssertionGroups.length ? visibleAssertionGroups.map(({ key, title, icon: Icon, items }) => (
            <Section key={key} title={title} action={<Icon className="size-4 text-fg-subtle" />}>
              <div className="grid gap-3 p-4 lg:grid-cols-2">{items.map(assertionCard)}</div>
            </Section>
          )) : (
            <div className="rounded-xl border border-edge bg-surface-panel shadow-surface">
              <Empty icon={<Brain className="size-5" />}>{t.emptyGroup}</Empty>
            </div>
          )}
        </div>
      ) : null}

      {view === 'knowledge' ? (
        <div id="understanding-panel-knowledge" role="tabpanel" aria-labelledby="understanding-tab-knowledge" className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-edge bg-surface-panel p-4 shadow-surface sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <h2 className="font-semibold text-fg">{t.allMemory}</h2>
              <p className="mt-1 text-sm leading-6 text-fg-muted">{visibleKnowledge.length} {t.items} · {t.memoryLibraryHint}</p>
            </div>
            <label className="relative block sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              <span className="sr-only">{t.searchPlaceholder}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setKnowledgeLimit(24); }}
                placeholder={t.searchPlaceholder}
                className="h-10 w-full rounded-xl border border-edge bg-surface-base pl-9 pr-3 text-sm text-fg outline-none transition placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>
          </div>
          {searchedKnowledge.length ? (
            <>
              <div className="space-y-4">
                {knowledgeGroups.map(({ kind, items, totalCount }) => (
                  <section key={kind} className="overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-surface">
                    <header className="flex items-center justify-between border-b border-edge-subtle px-5 py-3 sm:px-6">
                      <h3 className="text-sm font-semibold text-fg">{knowledgeKindLabel(kind, language)}</h3>
                      <span className="text-xs tabular-nums text-fg-subtle">{totalCount}</span>
                    </header>
                    <div>{items.map((item) => (
                      <KnowledgeRow
                        key={item.id}
                        item={item}
                        language={language}
                        busy={busy === item.id}
                        expanded={expandedKnowledgeId === item.id}
                        onToggle={() => setExpandedKnowledgeId((current) => current === item.id ? undefined : item.id)}
                        onArchive={() => void act(item.id, () => setKnowledgeStatus(item.id, 'archived'))}
                      />
                    ))}</div>
                  </section>
                ))}
              </div>
              {searchedKnowledge.length > knowledgeLimit ? (
                <div className="flex justify-center pt-2"><Button onClick={() => setKnowledgeLimit((value) => value + 24)}>{t.showMore}</Button></div>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl border border-edge bg-surface-panel shadow-surface">
              <Empty icon={<Search className="size-5" />}>{query.trim() ? t.noKnowledgeMatch : t.noKnowledge}</Empty>
            </div>
          )}
        </div>
      ) : null}
      <ProfileDialog
        open={profileOpen}
        profile={profile}
        language={language}
        saving={busy === 'profile'}
        onOpenChange={setProfileOpen}
        onSave={(next) => void saveProfile(next)}
      />
    </div>
  );
}
