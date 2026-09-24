import * as Dialog from '@radix-ui/react-dialog';
import {
  BookOpen,
  Brain,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Compass,
  Database,
  Handshake,
  Languages,
  Loader2,
  MapPin,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  UserRoundPen,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { PageTabs } from '@/components/ui/page-tabs';
import { PopoverSelect, Select, SelectOption, type PopoverSelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { UnderstandingStatusButton } from '@/features/work-discovery/understanding-status-button';

import { MemoryActions } from './memory-actions';
import { UnderstandingRow } from './understanding-row';
import { groupUnderstandingByDate } from './understanding-row.utils';
import {
  correctAssertion,
  createRuleFromSuggestion,
  createPriority,
  deleteAssertion,
  deleteKnowledge,
  detectBrowserTimezone,
  fetchUserModel,
  reviewKnowledgeItem,
  setRuleStatus,
  updateUserProfile,
  updatePriority,
  type CollaborationRule,
  type ActionRuleSuggestion,
  type KnowledgeItem,
  type PriorityWindow,
  type UserAssertion,
  type UserGoal,
  type UserModelResponse,
  type UserProfile,
} from './user-model-api';

type Language = 'en' | 'zh';
type View = 'overview' | 'understanding' | 'knowledge';
type UnderstandingFilter = 'all' | 'explicit' | 'learned';
type KnowledgeKindFilter = 'all' | KnowledgeItem['kind'];
type RefreshFeedback = 'idle' | 'refreshing' | 'success' | 'error';

function viewFromSearchParams(searchParams: URLSearchParams): View {
  const value = searchParams.get('tab');
  return value === 'understanding' || value === 'knowledge' ? value : 'overview';
}

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
    timezoneSearch: 'Search timezones…',
    timezoneNoMatch: 'No matching timezone',
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
    allUnderstanding: 'All understanding',
    understandingFilterHint: 'Filter this view by how each item was formed.',
    importantNow: 'What matters now',
    prioritySourceGoal: 'From a goal you confirmed',
    prioritySourceWork: 'From your current work',
    editPriority: 'Edit focus',
    addPriority: 'Set current focus',
    priorityTitle: 'Current focus',
    priorityTitlePlaceholder: 'What matters most right now?',
    priorityOutcome: 'What a good outcome looks like',
    priorityOutcomePlaceholder: 'Describe the result you want…',
    priorityUntil: 'Focus through',
    savePriority: 'Save focus',
    endPriority: 'End focus',
    endingPriority: 'Ending…',
    priorityHint: 'This is used to keep xopc aligned with what deserves attention now.',
    noPriority: 'No current priority has been set.',
    otherGoals: 'Other active outcomes',
    howWeWork: 'How we work together',
    howWeWorkHint: 'Your standing instructions for how I should communicate and act.',
    noRules: 'No collaboration preferences yet.',
    recent: 'Recently formed understanding',
    recentHint: 'Recent understanding from our work. You can edit any item.',
    seeAll: 'See all',
    workMemory: 'What I remember from the work',
    workMemoryHint: 'Project facts, decisions, lessons, and open questions stay separate from facts about you.',
    items: 'items',
    maintenanceReady: 'Memory upkeep is enabled and waiting for its first run.',
    maintenanceComplete: 'Memory was last organized',
    maintenanceFailed: 'The latest memory upkeep needs attention',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    refreshComplete: 'Refreshed',
    refreshFailed: 'Refresh failed',
    aboutYouTitle: 'A view you can correct',
    aboutYouHint: 'xopc quietly maintains this working context from collaboration. You can edit or retire any item.',
    identity: 'Who you are',
    preferences: 'Preferences and working rhythm',
    relationships: 'People and relationships',
    currentState: 'Current context',
    insights: 'My current read',
    emptyGroup: 'No understanding has formed here yet.',
    correct: 'Correct',
    save: 'Save correction',
    cancel: 'Cancel',
    correctionPlaceholder: 'Write the accurate version…',
    searchPlaceholder: 'Search work memory…',
    allMemory: 'All work memory',
    memoryFilterHint: 'Filter by memory type',
    memoryLibraryHint: 'Only distilled facts, decisions, lessons, commitments, and open questions appear here. Source records stay with their connector.',
    noKnowledge: 'No work memory has formed yet.',
    noKnowledgeMatch: 'No work memory matches this search.',
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
    timezoneSearch: '搜索时区…',
    timezoneNoMatch: '没有匹配的时区',
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
    allUnderstanding: '全部理解',
    understandingFilterHint: '按内容来源筛选这份理解。',
    importantNow: '此刻重要',
    prioritySourceGoal: '来自你确认的当前目标',
    prioritySourceWork: '来自当前工作上下文',
    editPriority: '编辑',
    addPriority: '设置当前关注',
    priorityTitle: '当前关注',
    priorityTitlePlaceholder: '现在最重要的是什么？',
    priorityOutcome: '期待结果',
    priorityOutcomePlaceholder: '描述你希望达成的结果…',
    priorityUntil: '关注至',
    savePriority: '保存关注',
    endPriority: '结束关注',
    endingPriority: '正在结束…',
    priorityHint: '这项内容会帮助 xopc 在协作中优先关注当前最重要的事情。',
    noPriority: '还没有设置当前优先事项。',
    otherGoals: '其他进行中的目标',
    howWeWork: '我们怎样协作',
    howWeWorkHint: '你对沟通方式和执行行为的长期约定。',
    noRules: '还没有形成协作偏好。',
    recent: '最近形成的理解',
    recentHint: '最近在协作中形成的认识，你可以随时修改。',
    seeAll: '查看全部',
    workMemory: '我在工作中记住的',
    workMemoryHint: '项目事实、决定、经验和待解问题，与“关于你”的理解分别管理。',
    items: '条',
    maintenanceReady: '记忆整理已经启用，正在等待首次运行。',
    maintenanceComplete: '最近一次记忆整理于',
    maintenanceFailed: '最近一次记忆整理需要处理',
    refresh: '刷新',
    refreshing: '正在刷新…',
    refreshComplete: '已刷新',
    refreshFailed: '刷新失败',
    aboutYouTitle: '一份可以共同修正的理解',
    aboutYouHint: 'xopc 会在协作中安静地维护这份工作认知。你仍可随时修改或停止使用任何一条。',
    identity: '关于你是谁',
    preferences: '偏好与工作节奏',
    relationships: '重要的人与关系',
    currentState: '当前状态',
    insights: '我形成的判断',
    emptyGroup: '这里还没有形成理解。',
    correct: '修正',
    save: '保存修正',
    cancel: '取消',
    correctionPlaceholder: '写下更准确的说法…',
    searchPlaceholder: '搜索工作记忆…',
    allMemory: '全部工作记忆',
    memoryFilterHint: '按记忆类型筛选',
    memoryLibraryHint: '这里只显示提炼后的事实、决定、经验、承诺和待解问题；邮件、日历与文档原文保留在对应来源中。',
    noKnowledge: '还没有形成工作记忆。',
    noKnowledgeMatch: '没有符合搜索条件的工作记忆。',
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


const profilePredicates = new Set([
  'identity.call_name',
  'identity.role',
  'identity.pronouns',
  'preference.timezone',
  'preference.locale',
]);

const knowledgeKindOrder = [
  'work_thread',
  'project_fact',
  'workspace_fact',
  'decision',
  'task_lesson',
  'commitment',
  'open_question',
  'episode',
  'note',
] as const;

const fallbackTimezones = [
  'UTC',
  'Africa/Cairo', 'Africa/Johannesburg',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Mexico_City',
  'America/New_York', 'America/Sao_Paulo', 'America/Toronto', 'America/Vancouver',
  'Asia/Bangkok', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Kolkata',
  'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Taipei', 'Asia/Tokyo',
  'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Berlin', 'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Rome',
  'Pacific/Auckland', 'Pacific/Honolulu',
] as const;

function supportedTimezones(): string[] {
  try {
    const values = Intl.supportedValuesOf('timeZone');
    return [...new Set(['UTC', ...values])];
  } catch {
    return [...fallbackTimezones];
  }
}

const browserTimezones = supportedTimezones();

function timezoneOptions(values: string[]): PopoverSelectOption[] {
  return values.map((timezone) => ({
    value: timezone,
    label: timezone.replaceAll('_', ' '),
    group: timezone.includes('/') ? timezone.split('/')[0] : 'UTC',
  }));
}

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

function validUntil(value: number, language: Language): string {
  const date = formatDate(value, language);
  return language === 'zh' ? `当前安排至 ${date}` : `Current plan through ${date}`;
}

function dateInputValue(value: number): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function endOfLocalDay(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
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
        work_thread: '工作主线', project_fact: '项目事实', workspace_fact: '工作区事实', decision: '已经决定', task_lesson: '工作经验',
        commitment: '承诺与约定', open_question: '待解问题', episode: '重要经历', note: '其他记录',
      }
    : {
        work_thread: 'Work threads', project_fact: 'Project facts', workspace_fact: 'Workspace facts', decision: 'Decisions', task_lesson: 'Lessons',
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
    <section className={className}>
      <header className="flex items-end justify-between gap-4 px-1 pb-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-fg">{title}</h2>
          {hint ? <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{hint}</p> : null}
        </div>
        {action}
      </header>
      <div className="overflow-hidden rounded-2xl bg-surface-panel">{children}</div>
    </section>
  );
}

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 py-5 text-sm text-fg-muted">
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
  const [timezoneQuery, setTimezoneQuery] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(profile);
      setTimezoneQuery('');
    }
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
  const deviceTimezone = detectBrowserTimezone();
  const availableTimezones = useMemo(() => (
    [...new Set([...browserTimezones, deviceTimezone, draft.timezone].filter(Boolean))].sort()
  ), [deviceTimezone, draft.timezone]);
  const normalizedTimezoneQuery = timezoneQuery.trim().toLocaleLowerCase();
  const filteredTimezoneOptions = useMemo(() => timezoneOptions(
    availableTimezones.filter((timezone) => (
      !normalizedTimezoneQuery
      || timezone.toLocaleLowerCase().includes(normalizedTimezoneQuery)
      || timezone.replaceAll('_', ' ').toLocaleLowerCase().includes(normalizedTimezoneQuery)
    )),
  ), [availableTimezones, normalizedTimezoneQuery]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] h-[min(40rem,calc(100vh-2rem))] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none">
          <form className="flex h-full min-h-0 flex-col overflow-hidden [border-radius:inherit]" onSubmit={submit}>
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
                    <PopoverSelect
                      value={draft.timezone}
                      options={filteredTimezoneOptions}
                      placeholder={detectBrowserTimezone()}
                      emptyLabel={t.notProvided}
                      ariaLabel={t.timezone}
                      selectedLabel={draft.timezone || t.notProvided}
                      searchPlaceholder={t.timezoneSearch}
                      searchValue={timezoneQuery}
                      onSearchChange={setTimezoneQuery}
                      statusMessage={filteredTimezoneOptions.length ? undefined : t.timezoneNoMatch}
                      triggerClassName="min-w-0 flex-1 rounded-xl bg-surface-base"
                      onChange={(timezone) => {
                        setDraft((current) => ({ ...current, timezone }));
                        setTimezoneQuery('');
                      }}
                    />
                    <Button className="shrink-0 whitespace-nowrap" onClick={() => setDraft((current) => ({ ...current, timezone: deviceTimezone }))}>{t.useDeviceTimezone}</Button>
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

function PriorityDialog({
  open,
  priority,
  title,
  outcome,
  language,
  saving,
  onOpenChange,
  onSave,
  onEnd,
}: {
  open: boolean;
  priority?: PriorityWindow;
  title: string;
  outcome?: string;
  language: Language;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: { title: string; desiredOutcome?: string; validTo: number }) => void;
  onEnd?: () => void;
}) {
  const t = copy[language];
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftOutcome, setDraftOutcome] = useState(outcome ?? '');
  const initialValidTo = dateInputValue(priority?.validTo ?? Date.now() + 7 * 86_400_000);
  const [draftValidTo, setDraftValidTo] = useState(initialValidTo);

  useEffect(() => {
    if (!open) return;
    setDraftTitle(title);
    setDraftOutcome(outcome ?? '');
    setDraftValidTo(initialValidTo);
  }, [initialValidTo, open, outcome, title]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({
      title: draftTitle.trim(),
      ...(priority?.targetType === 'goal' ? { desiredOutcome: draftOutcome.trim() } : {}),
      validTo: endOfLocalDay(draftValidTo),
    });
  };
  const valid = Boolean(draftTitle.trim() && draftValidTo
    && (priority?.targetType !== 'goal' || draftOutcome.trim()));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
        <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[90] h-[min(34rem,calc(100vh-2rem))] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none">
          <form className="flex h-full min-h-0 flex-col overflow-hidden [border-radius:inherit]" onSubmit={submit}>
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4 sm:px-6">
              <div>
                <Dialog.Title className="font-semibold text-fg">{priority ? t.editPriority : t.addPriority}</Dialog.Title>
                <Dialog.Description className="mt-1 text-xs leading-5 text-fg-muted">{t.priorityHint}</Dialog.Description>
              </div>
              <Dialog.Close asChild><Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={t.cancel}><X className="size-4" /></Button></Dialog.Close>
            </header>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-fg">{t.priorityTitle}</span>
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  placeholder={t.priorityTitlePlaceholder}
                  className="h-10 w-full rounded-xl border border-edge bg-surface-base px-3 text-sm text-fg outline-none transition placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </label>
              {priority?.targetType === 'goal' ? (
                <label className="grid gap-1.5 text-sm">
                  <span className="font-medium text-fg">{t.priorityOutcome}</span>
                  <textarea
                    value={draftOutcome}
                    onChange={(event) => setDraftOutcome(event.target.value)}
                    placeholder={t.priorityOutcomePlaceholder}
                    className="min-h-28 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm leading-6 text-fg outline-none transition placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </label>
              ) : null}
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-fg">{t.priorityUntil}</span>
                <DatePicker
                  min={dateInputValue(priority?.validFrom ?? Date.now())}
                  value={draftValidTo}
                  onChange={setDraftValidTo}
                  ariaLabel={t.priorityUntil}
                  className="rounded-xl border border-edge bg-surface-base hover:border-edge-strong hover:bg-surface-base"
                />
              </label>
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-edge px-5 py-3 sm:px-6">
              {priority && onEnd ? (
                <Button variant="ghost" className="text-danger hover:text-danger" disabled={saving} onClick={onEnd}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}{saving ? t.endingPriority : t.endPriority}
                </Button>
              ) : <span />}
              <div className="flex gap-2">
                <Dialog.Close asChild><Button disabled={saving}>{t.cancel}</Button></Dialog.Close>
                <Button type="submit" variant="primary" disabled={!valid || saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}{t.savePriority}
                </Button>
              </div>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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

function RuleSuggestionRow({
  suggestion, language, busy, onConfirm,
}: {
  suggestion: ActionRuleSuggestion;
  language: Language;
  busy: boolean;
  onConfirm: () => void;
}) {
  const zh = language === 'zh';
  return (
    <div className="flex items-start gap-3 border-t border-edge-subtle px-5 py-3 first:border-t-0">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-fg" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-6 text-fg">{suggestion.statement}</p>
        <p className="mt-0.5 text-xs text-fg-subtle">{zh ? '根据你已确认的模式生成；确认前不会生效' : 'Suggested from a pattern you confirmed; inactive until you approve'}</p>
      </div>
      <Button variant="secondary" className="h-8 shrink-0" disabled={busy} onClick={onConfirm}>
        {busy ? (zh ? '启用中…' : 'Enabling…') : (zh ? '确认启用' : 'Approve')}
      </Button>
    </div>
  );
}

function KnowledgeRow({
  item,
  language,
  busy,
  expanded,
  onToggle,
  editing,
  draft,
  onDraftChange,
  onEdit,
  onCancel,
  onReview,
  onDelete,
}: {
  item: KnowledgeItem;
  language: Language;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onReview: (action: 'edit_and_approve', content?: string) => void;
  onDelete: () => void;
}) {
  const t = copy[language];
  const date = formatDate(item.updatedAt ?? item.createdAt, language);
  const canExpand = item.content.length > 96 || item.content.includes('\n');
  return (
    <article className="group border-t border-edge-subtle px-5 py-4 first:border-t-0 sm:px-6">
      {editing ? (
        <div className="space-y-3">
          <textarea
            aria-label={t.correctionPlaceholder}
            disabled={busy}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            className="min-h-24 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm leading-6 text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="h-8" onClick={onCancel}>{t.cancel}</Button>
            <Button variant="primary" className="h-8" disabled={!draft.trim() || busy} onClick={() => onReview('edit_and_approve', draft.trim())}>{t.save}</Button>
          </div>
        </div>
      ) : (
      <div className="flex items-start gap-3">
        <BookOpen className="mt-1 size-4 shrink-0 text-fg-subtle" />
        <div className="min-w-0 flex-1">
          <p className={`whitespace-pre-wrap break-words text-base leading-7 text-fg ${expanded ? '' : 'line-clamp-2'}`}>{item.content}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
            <span>{scopeLabel(item.scope, language)}</span>
            {date ? <span>{date}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canExpand ? (
            <Button variant="ghost" className="size-11 p-0" aria-expanded={expanded} aria-label={expanded ? t.collapse : t.expand} onClick={onToggle}>
              <ChevronDown className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </Button>
          ) : null}
          <MemoryActions language={language} busy={busy} statement={item.content} onEdit={onEdit} onDelete={onDelete} />
        </div>
      </div>
      )}
    </article>
  );
}

export function UserModelPage() {
  const language = useLocaleStore((state) => state.language);
  const t = copy[language];
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, error, isLoading, isValidating, mutate } = useSWR<UserModelResponse>('/api/user-model', fetchUserModel);
  const view = viewFromSearchParams(searchParams);
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [actionMessage, setActionMessage] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [knowledgeLimit, setKnowledgeLimit] = useState(24);
  const [expandedKnowledgeId, setExpandedKnowledgeId] = useState<string>();
  const [profileOpen, setProfileOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [understandingFilter, setUnderstandingFilter] = useState<UnderstandingFilter>('all');
  const [knowledgeKindFilter, setKnowledgeKindFilter] = useState<KnowledgeKindFilter>('all');
  const [refreshFeedback, setRefreshFeedback] = useState<RefreshFeedback>('idle');
  const refreshResetTimer = useRef<number | undefined>(undefined);

  const setView = (nextView: View) => {
    if (nextView === view) return;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (nextView === 'overview') next.delete('tab');
      else next.set('tab', nextView);
      return next;
    });
  };

  const refreshUserModel = useCallback(async () => {
    if (refreshFeedback === 'refreshing' || isValidating) return;
    if (refreshResetTimer.current) window.clearTimeout(refreshResetTimer.current);
    setRefreshFeedback('refreshing');
    setActionError(undefined);
    setActionMessage(t.refreshing);
    try {
      await mutate();
      setRefreshFeedback('success');
      setActionMessage(t.refreshComplete);
    } catch {
      setRefreshFeedback('error');
      setActionMessage('');
      setActionError(t.refreshFailed);
    } finally {
      refreshResetTimer.current = window.setTimeout(() => setRefreshFeedback('idle'), 1600);
    }
  }, [isValidating, mutate, refreshFeedback, t]);

  useEffect(() => () => {
    if (refreshResetTimer.current) window.clearTimeout(refreshResetTimer.current);
  }, []);

  const refreshBusy = isValidating || refreshFeedback === 'refreshing';
  const refreshLabel = refreshBusy
    ? t.refreshing
    : refreshFeedback === 'success'
      ? t.refreshComplete
      : refreshFeedback === 'error'
        ? t.refreshFailed
        : t.refresh;

  useEffect(() => {
    setPageHeader({
      startExtra: null,
      main: <div><h1 className="text-base font-semibold text-fg">{t.pageTitle}</h1><p className="hidden text-xs text-fg-muted sm:block">{t.pageSubtitle}</p></div>,
      end: (
        <div className="flex items-center gap-2">
          <UnderstandingStatusButton />
          <Button
            variant="secondary"
            className={`size-9 p-0 ${refreshFeedback === 'success' ? 'text-success' : refreshFeedback === 'error' ? 'text-danger' : ''}`}
            disabled={refreshBusy}
            aria-label={refreshLabel}
            title={refreshLabel}
            onClick={() => void refreshUserModel()}
          >
            {refreshBusy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : refreshFeedback === 'success' ? <Check className="size-4" aria-hidden="true" />
                : refreshFeedback === 'error' ? <CircleAlert className="size-4" aria-hidden="true" />
                  : <RefreshCw className="size-4" aria-hidden="true" />}
          </Button>
        </div>
      ),
    });
    return clearPageHeader;
  }, [clearPageHeader, refreshBusy, refreshFeedback, refreshLabel, refreshUserModel, setPageHeader, t]);

  const act = async (id: string, operation: () => Promise<unknown>) => {
    setBusy(id);
    setActionError(undefined);
    setActionMessage('');
    try {
      await operation();
      await mutate();
      setActionMessage(language === 'zh' ? '已更新' : 'Updated');
    } catch {
      setActionError(t.actionFailed);
    } finally {
      setBusy(undefined);
    }
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
    setActionMessage('');
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

  const savePriority = async (
    priority: PriorityWindow,
    input: { title: string; desiredOutcome?: string; validTo: number },
  ) => {
    setBusy(`priority:${priority.id}`);
    setActionError(undefined);
    setActionMessage('');
    try {
      await updatePriority(priority.id, input);
      await mutate();
      setPriorityOpen(false);
      setActionMessage(language === 'zh' ? '当前关注已更新' : 'Current focus updated');
    } catch {
      setActionError(t.actionFailed);
    } finally {
      setBusy(undefined);
    }
  };

  const addPriority = async (input: { title: string; validTo: number }) => {
    setBusy('priority:create');
    setActionError(undefined);
    setActionMessage('');
    try {
      await createPriority(input);
      await mutate();
      setPriorityOpen(false);
      setActionMessage(language === 'zh' ? '当前关注已设置' : 'Current focus set');
    } catch {
      setActionError(t.actionFailed);
    } finally {
      setBusy(undefined);
    }
  };

  const endPriority = async (priority: PriorityWindow) => {
    setBusy(`priority:${priority.id}`);
    setActionError(undefined);
    setActionMessage('');
    try {
      await updatePriority(priority.id, { status: 'completed' });
      await mutate();
      setPriorityOpen(false);
      setActionMessage(language === 'zh' ? '当前关注已结束' : 'Current focus ended');
    } catch {
      setActionError(t.actionFailed);
    } finally {
      setBusy(undefined);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
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

  const assertions = data.assertions.filter((item) => (
    item.usable && item.scope.type === 'global' && !profilePredicates.has(item.predicate)
  )).sort((a, b) => {
    const importanceA = a.declaredImportance ?? a.inferredImportance;
    const importanceB = b.declaredImportance ?? b.inferredImportance;
    return importanceB - importanceA || b.recordedAt - a.recordedAt;
  });
  const profile = profileFromResponse(data);
  const displayName = profile.callName || (language === 'zh' ? '你' : 'You');
  const explicitCount = assertions.filter((item) => item.authority === 'user_explicit').length;
  const learnedCount = assertions.length - explicitCount;
  const filteredAssertions = assertions.filter((item) => {
    if (understandingFilter === 'explicit') return item.authority === 'user_explicit';
    if (understandingFilter === 'learned') return item.authority !== 'user_explicit';
    return true;
  });
  const activePriorities = data.priorities.filter((item) => item.status === 'active' && item.validTo > Date.now());
  const primaryPriority = activePriorities.find((item) => item.rank === 'primary') ?? activePriorities[0];
  const primaryTitle = goalTitle(primaryPriority, data.goals, language);
  const primaryGoal = primaryPriority?.targetType === 'goal'
    ? data.goals.find((goal) => goal.id === primaryPriority.targetId)
    : undefined;
  const activeGoals = data.goals.filter((goal) => goal.status === 'active' || goal.status === 'paused');
  const otherGoals = activeGoals.filter((goal) => primaryPriority?.targetType !== 'goal' || goal.id !== primaryPriority.targetId);
  const collaborationRules = data.rules.filter((rule) => rule.status !== 'archived');
  const ruleSuggestions = data.ruleSuggestions ?? [];
  const recentAssertions = [...assertions].sort((a, b) => b.recordedAt - a.recordedAt);
  const visibleKnowledge = data.knowledge.filter((item) => item.status !== 'archived' && item.status !== 'rejected');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const kindFilteredKnowledge = visibleKnowledge.filter((item) => (
    knowledgeKindFilter === 'all' || item.kind === knowledgeKindFilter
  ));
  const searchedKnowledge = kindFilteredKnowledge.filter((item) => !normalizedQuery
    || item.content.toLocaleLowerCase().includes(normalizedQuery)
    || knowledgeKindLabel(item.kind, language).toLocaleLowerCase().includes(normalizedQuery));
  const groupedAssertions = [
    { key: 'identity', title: t.identity, icon: UserRound, items: filteredAssertions.filter((item) => item.kind === 'identity') },
    { key: 'preferences', title: t.preferences, icon: Compass, items: filteredAssertions.filter((item) => ['preference', 'value', 'routine', 'capability'].includes(item.kind)) },
    { key: 'relationships', title: t.relationships, icon: Handshake, items: filteredAssertions.filter((item) => item.kind === 'relationship') },
    { key: 'current', title: t.currentState, icon: Clock3, items: filteredAssertions.filter((item) => item.kind === 'current_state') },
    { key: 'insights', title: t.insights, icon: Sparkles, items: filteredAssertions.filter((item) => item.kind === 'derived_insight') },
  ];
  const visibleAssertionGroups = groupedAssertions.filter((group) => group.items.length > 0);
  const memoryCounts = knowledgeKindOrder
    .map((kind) => ({ kind, count: visibleKnowledge.filter((item) => item.kind === kind).length }))
    .filter((entry) => entry.count > 0);
  const overviewMemoryCounts = memoryCounts.slice(0, 4);
  const memoryGridClass = overviewMemoryCounts.length === 1
    ? 'grid-cols-1'
    : overviewMemoryCounts.length === 2
      ? 'sm:grid-cols-2'
      : overviewMemoryCounts.length === 3
        ? 'sm:grid-cols-3'
        : 'sm:grid-cols-2 lg:grid-cols-4';
  const limitedKnowledge = searchedKnowledge.slice(0, knowledgeLimit);
  const knowledgeGroups = knowledgeKindOrder
    .map((kind) => ({
      kind,
      items: limitedKnowledge.filter((item) => item.kind === kind),
      totalCount: searchedKnowledge.filter((item) => item.kind === kind).length,
    }))
    .filter((group) => group.items.length > 0);
  const understandingFilterOptions: Array<{ id: UnderstandingFilter; label: string; count: number }> = [
    { id: 'all', label: t.allUnderstanding, count: assertions.length },
    { id: 'explicit', label: t.explicit, count: explicitCount },
    { id: 'learned', label: t.learned, count: learnedCount },
  ];

  const openUnderstanding = (filter: UnderstandingFilter) => {
    setUnderstandingFilter(filter);
    setView('understanding');
  };

  const openKnowledge = (kind: KnowledgeKindFilter) => {
    setKnowledgeKindFilter(kind);
    setQuery('');
    setKnowledgeLimit(24);
    setView('knowledge');
  };

  const assertionRow = (item: UserAssertion) => (
    <UnderstandingRow
      key={item.id}
      item={item}
      language={language}
      busy={Boolean(busy)}
      editing={editingId === item.id}
      draft={editingId === item.id ? draft : ''}
      onDraftChange={setDraft}
      onEdit={() => { setEditingId(item.id); setDraft(item.statement); }}
      onCancel={() => { setEditingId(undefined); setDraft(''); }}
      onDelete={() => void act(item.id, () => deleteAssertion(item.id))}
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
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
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
        className="w-fit max-w-full gap-1 rounded-full bg-surface-panel p-1 shadow-surface"
        buttonClassName="rounded-full px-3.5 py-2"
        selectedClassName="bg-surface-active text-fg"
        unselectedClassName="text-fg-muted hover:bg-surface-hover hover:text-fg"
      />

      <p role="status" className="sr-only">{actionMessage}</p>
      {actionError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(undefined)} aria-label={t.cancel}><X className="size-4" /></button>
        </div>
      ) : null}

      {view === 'overview' ? (
        <div id="understanding-panel-overview" role="tabpanel" aria-labelledby="understanding-tab-overview" className="space-y-10">
          <section data-testid="overview-hero" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:gap-12">
            <div className="min-w-0 px-1 py-2">
                <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-accent-fg">
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  <span>{t.portraitEyebrow}</span>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-5">
                  <div className="flex size-20 shrink-0 items-center justify-center rounded-[1.4rem] bg-surface-active text-xl font-semibold text-fg">
                    {initials(displayName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-3xl font-semibold tracking-tight text-fg">{displayName}</h2>
                    <p className="mt-1 break-words text-sm text-fg-muted">{profile.role || t.notProvided}</p>
                  </div>
                  <Button variant="ghost" className="shrink-0" onClick={() => setProfileOpen(true)}><UserRoundPen className="size-4" aria-hidden="true" />{t.editProfile}</Button>
                </div>
                <p className="mt-5 max-w-2xl text-sm leading-6 text-fg-muted">{t.portraitIntro}</p>
              <dl className="mt-7 grid gap-x-8 gap-y-5 sm:grid-cols-3">
                {[
                  { icon: Languages, label: t.locale, value: profile.locale ? localeLabel(profile.locale, language) : t.notProvided },
                  { icon: MapPin, label: t.timezone, value: profile.timezone || t.notProvided },
                  { icon: UserRound, label: t.pronouns, value: profile.pronouns || t.notProvided },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-xs text-fg-subtle"><Icon className="size-3.5" aria-hidden="true" />{label}</dt>
                    <dd className="mt-1.5 truncate text-sm font-medium text-fg">{value}</dd>
                  </div>
                ))}
                </dl>
            </div>
            <aside data-testid="priority-panel" className="flex min-h-64 flex-col rounded-[1.4rem] bg-surface-panel p-6 shadow-surface">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold tracking-wide text-fg-subtle">{t.importantNow}</p>
                    {primaryPriority ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-muted">
                        <BriefcaseBusiness className="size-3.5" aria-hidden="true" />
                        {primaryPriority.targetType === 'goal' ? t.prioritySourceGoal : t.prioritySourceWork}
                      </p>
                    ) : null}
                  </div>
                  {primaryPriority && primaryTitle ? (
                    <Button variant="ghost" className="h-8 shrink-0 px-2.5" onClick={() => setPriorityOpen(true)}>
                      <Pencil className="size-3.5" aria-hidden="true" />{t.editPriority}
                    </Button>
                  ) : null}
                </div>
                {primaryTitle ? (
                  <>
                    <p className="mt-3 text-lg font-semibold leading-7 tracking-tight text-fg">{primaryTitle}</p>
                    {primaryGoal?.desiredOutcome ? <p className="mt-2 text-sm leading-6 text-fg-muted">{primaryGoal.desiredOutcome}</p> : null}
                    {primaryPriority ? <p className="mt-auto flex items-center gap-1.5 pt-4 text-xs text-fg-subtle"><CalendarDays className="size-3.5" aria-hidden="true" />{validUntil(primaryPriority.validTo, language)}</p> : null}
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center text-sm text-fg-muted">
                    <BriefcaseBusiness className="size-5 text-fg-subtle" />
                    <span>{t.noPriority}</span>
                    <Button variant="primary" className="mt-2" onClick={() => setPriorityOpen(true)}>
                      <Plus className="size-4" aria-hidden="true" />{t.addPriority}
                    </Button>
                  </div>
                )}
                {otherGoals.length ? (
                  <div className="mt-5 border-t border-edge-subtle pt-4">
                    <p className="text-xs text-fg-subtle">{t.otherGoals}</p>
                    <div className="mt-2 space-y-2">{otherGoals.slice(0, 3).map((goal) => <p key={goal.id} className="text-sm text-fg">{goal.title}</p>)}</div>
                  </div>
                ) : null}
            </aside>
          </section>

          <section aria-label={t.understanding} className="grid gap-2 sm:grid-cols-2">
            {[
              { filter: 'explicit' as const, icon: MessageCircle, label: t.explicit, hint: t.explicitHint, count: explicitCount },
              { filter: 'learned' as const, icon: Brain, label: t.learned, hint: t.learnedHint, count: learnedCount },
            ].map(({ filter, icon: Icon, label, hint, count }) => (
                <button
                  key={label}
                  type="button"
                  className="group flex min-h-24 w-full cursor-pointer items-start gap-3 rounded-2xl px-4 py-4 text-left transition-colors hover:bg-surface-panel focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:px-5"
                  onClick={() => openUnderstanding(filter)}
                  aria-label={`${label}: ${count}`}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium text-fg"><span className="mr-1.5 text-lg tabular-nums">{count}</span>{label}</p><p className="mt-0.5 text-xs text-fg-subtle">{hint}</p></div>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg-muted motion-reduce:transform-none" aria-hidden="true" />
                </button>
            ))}
          </section>

          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-8">
            <Section
              title={t.recent}
              hint={t.recentHint}
              action={<Button variant="ghost" className="h-8 shrink-0" onClick={() => setView('understanding')}>{t.seeAll}</Button>}
            >
              {recentAssertions.length
                ? <div>{groupUnderstandingByDate(recentAssertions.slice(0, 3), language).map(({ label, items }) => (
                    <div key={label}>
                      <h3 className="px-5 pb-1 pt-4 text-xs font-medium text-fg-muted">{label}</h3>
                      <div>{items.map(assertionRow)}</div>
                    </div>
                  ))}</div>
                : <Empty icon={<Brain className="size-5" />}>{t.emptyGroup}</Empty>}
            </Section>

            <Section title={t.howWeWork} hint={t.howWeWorkHint}>
              {collaborationRules.length || ruleSuggestions.length ? <>
                {collaborationRules.slice(0, 3).map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  language={language}
                  busy={busy === rule.id}
                  onToggle={() => void act(rule.id, () => setRuleStatus(rule.id, rule.status === 'active' ? 'disabled' : 'active'))}
                />
                ))}
                {ruleSuggestions.slice(0, 2).map((suggestion) => (
                  <RuleSuggestionRow
                    key={suggestion.id}
                    suggestion={suggestion}
                    language={language}
                    busy={busy === suggestion.id}
                    onConfirm={() => void act(suggestion.id, () => createRuleFromSuggestion(suggestion))}
                  />
                ))}
              </> : <Empty icon={<Handshake className="size-5" />}>{t.noRules}</Empty>}
            </Section>
          </div>

          <Section
            title={t.workMemory}
            hint={t.workMemoryHint}
            action={<Button variant="ghost" className="h-8 shrink-0" onClick={() => setView('knowledge')}>{t.seeAll}</Button>}
          >
            {memoryCounts.length ? (
              <div data-testid="memory-summary-grid" className={`grid gap-3 bg-surface-base ${memoryGridClass}`}>
                {overviewMemoryCounts.map(({ kind, count }) => (
                  <button
                    key={kind}
                    type="button"
                    className="group flex min-h-28 cursor-pointer items-start justify-between rounded-2xl bg-surface-panel px-5 py-5 text-left transition-colors hover:bg-surface-hover focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={() => openKnowledge(kind)}
                    aria-label={`${knowledgeKindLabel(kind, language)}: ${count}`}
                  >
                    <span><span className="block text-2xl font-semibold tabular-nums text-fg">{count}</span><span className="mt-1 block text-sm text-fg-muted">{knowledgeKindLabel(kind, language)}</span></span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg-muted motion-reduce:transform-none" aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : <Empty icon={<Database className="size-5" />}>{t.noKnowledge}</Empty>}
          </Section>

          <footer className="flex items-center gap-4 px-1 pb-2 text-xs text-fg-subtle">
            <span className="inline-flex items-center gap-2"><RefreshCw className="size-3.5" aria-hidden="true" />{maintenanceText}</span>
          </footer>
        </div>
      ) : null}

      {view === 'understanding' ? (
        <div id="understanding-panel-understanding" role="tabpanel" aria-labelledby="understanding-tab-understanding" className="space-y-10">
          <div className="px-1 pt-1">
            <div className="flex items-start gap-3">
              <Brain className="mt-0.5 size-5 shrink-0 text-accent-fg" aria-hidden="true" />
              <div><h2 className="font-semibold text-fg">{t.aboutYouTitle}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-fg-muted">{t.aboutYouHint}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t.understandingFilterHint}>
              {understandingFilterOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={understandingFilter === option.id}
                  className={`touch-target inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${understandingFilter === option.id ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}`}
                  onClick={() => setUnderstandingFilter(option.id)}
                >
                  {option.label}<span className="tabular-nums text-fg-subtle">{option.count}</span>
                </button>
              ))}
            </div>
          </div>
          {visibleAssertionGroups.length ? visibleAssertionGroups.map(({ key, title, icon: Icon, items }) => (
            <Section key={key} title={title} action={<Icon className="size-4 text-fg-subtle" aria-hidden="true" />}>
              <div>{items.map(assertionRow)}</div>
            </Section>
          )) : (
            <div className="rounded-2xl bg-surface-panel">
              <Empty icon={<Brain className="size-5" />}>{t.emptyGroup}</Empty>
            </div>
          )}
        </div>
      ) : null}

      {view === 'knowledge' ? (
        <div id="understanding-panel-knowledge" role="tabpanel" aria-labelledby="understanding-tab-knowledge" className="space-y-8">
          <div className="px-1 pt-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-2xl">
                <h2 className="font-semibold text-fg">{knowledgeKindFilter === 'all' ? t.allMemory : knowledgeKindLabel(knowledgeKindFilter, language)}</h2>
                <p className="mt-1 text-sm leading-6 text-fg-muted">{kindFilteredKnowledge.length} {t.items} · {t.memoryLibraryHint}</p>
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
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t.memoryFilterHint}>
              <button
                type="button"
                aria-pressed={knowledgeKindFilter === 'all'}
                className={`touch-target inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${knowledgeKindFilter === 'all' ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}`}
                onClick={() => setKnowledgeKindFilter('all')}
              >
                {t.allMemory}<span className="tabular-nums text-fg-subtle">{visibleKnowledge.length}</span>
              </button>
              {memoryCounts.map(({ kind, count }) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={knowledgeKindFilter === kind}
                  className={`touch-target inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${knowledgeKindFilter === kind ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}`}
                  onClick={() => setKnowledgeKindFilter(kind)}
                >
                  {knowledgeKindLabel(kind, language)}<span className="tabular-nums text-fg-subtle">{count}</span>
                </button>
              ))}
            </div>
          </div>
          {searchedKnowledge.length ? (
            <>
              <div className="space-y-8">
                {knowledgeGroups.map(({ kind, items, totalCount }) => (
                  <section key={kind} className="overflow-hidden rounded-2xl bg-surface-panel">
                    <header className="flex items-center justify-between px-5 pb-1 pt-4 sm:px-6">
                      <h3 className="text-sm font-semibold text-fg">{knowledgeKindLabel(kind, language)}</h3>
                      <span className="text-xs tabular-nums text-fg-subtle">{totalCount}</span>
                    </header>
                    <div>{items.map((item) => (
                      <KnowledgeRow
                        key={item.id}
                        item={item}
                        language={language}
                        busy={Boolean(busy)}
                        expanded={expandedKnowledgeId === item.id}
                        onToggle={() => setExpandedKnowledgeId((current) => current === item.id ? undefined : item.id)}
                        editing={editingId === `knowledge:${item.id}`}
                        draft={draft}
                        onDraftChange={setDraft}
                        onEdit={() => { setEditingId(`knowledge:${item.id}`); setDraft(item.content); }}
                        onCancel={() => { setEditingId(undefined); setDraft(''); }}
                        onDelete={() => void act(item.id, () => deleteKnowledge(item.id))}
                    onReview={(action, content) => void act(item.id, async () => {
                          await reviewKnowledgeItem(item, action, content);
                          setEditingId(undefined);
                          setDraft('');
                        })}
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
            <div className="rounded-2xl bg-surface-panel">
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
      <PriorityDialog
        open={priorityOpen}
        priority={primaryPriority}
        title={primaryTitle ?? ''}
        outcome={primaryGoal?.desiredOutcome}
        language={language}
        saving={busy === (primaryPriority ? `priority:${primaryPriority.id}` : 'priority:create')}
        onOpenChange={setPriorityOpen}
        onSave={(input) => primaryPriority
          ? void savePriority(primaryPriority, input)
          : void addPriority(input)}
        onEnd={primaryPriority ? () => void endPriority(primaryPriority) : undefined}
      />
    </div>
  );
}
