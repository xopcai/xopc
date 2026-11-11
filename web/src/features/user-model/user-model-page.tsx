import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Compass,
  Database,
  Handshake,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Download,
  UserRound,
  UserRoundPen,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { useDebounce } from 'use-debounce';

import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { Loopi } from '@/components/brand/loopi';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { PopoverSelect, Select, SelectOption, type PopoverSelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { UnderstandingStatusButton } from '@/features/work-discovery/understanding-status-button';

import { LearningStatus } from './learning-status';
import { KnowledgeEvidence } from './knowledge-evidence';
import { MemoryActions } from './memory-actions';
import { UnderstandingRow } from './understanding-row';
import {
  ABOUT_USER_MODEL_KEY,
  addCollaborationPreference,
  correctAssertion,
  createRuleFromSuggestion,
  createPriority,
  deleteAssertion,
  deleteKnowledge,
  detectBrowserTimezone,
  downloadUserModelExport,
  fetchAboutUserModel,
  fetchWorkMemoryPage,
  reviewKnowledgeItem,
  setAssertionScope,
  setKnowledgeScope,
  setRuleStatus,
  updateMemorySettings,
  updateUserProfile,
  updatePriority,
  type AboutUserModelResponse,
  type CollaborationRule,
  type ActionRuleSuggestion,
  type KnowledgeItem,
  type PriorityWindow,
  type UserAssertion,
  type UserGoal,
  type UserProfile,
} from './user-model-api';

type Language = 'en' | 'zh';
type View = 'overview' | 'understanding' | 'work' | 'privacy';
type UnderstandingFilter = 'all' | 'explicit' | 'learned';
type KnowledgeKindFilter = 'all' | KnowledgeItem['kind'];
type RefreshFeedback = 'idle' | 'refreshing' | 'success' | 'error';

function viewFromSearchParams(searchParams: URLSearchParams): View {
  const value = searchParams.get('tab');
  if (value === 'understanding' && searchParams.get('section') === 'work') return 'work';
  return value === 'understanding' || value === 'work' || value === 'privacy' ? value : 'overview';
}

const copy = {
  en: {
    pageTitle: 'About you',
    privacy: 'Data & privacy',
    knowledge: 'Work memory',
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
    learned: 'Learned together',
    allUnderstanding: 'All understanding',
    understandingFilterHint: 'Filter this view by how each item was formed.',
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
    howWeWork: 'How we work together',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    refreshComplete: 'Refreshed',
    refreshFailed: 'Refresh failed',
    aboutYouTitle: 'What xopc remembers about you',
    aboutYouHint: 'Review your background, preferences, and habits. Edit anything that no longer fits.',
    identity: 'Who you are',
    preferences: 'Preferences and working rhythm',
    relationships: 'People and relationships',
    currentState: 'Current context',
    insights: 'My current read',
    emptyGroup: 'No usable personal understanding yet. Ongoing preferences will build through collaboration; project facts and progress are in Work memory.',
    save: 'Save correction',
    cancel: 'Cancel',
    correctionPlaceholder: 'Write the accurate version…',
    searchPlaceholder: 'Search work memory…',
    allMemory: 'All work memory',
    memoryFilterHint: 'Filter by memory type',
    noKnowledge: 'No work memory has formed yet.',
    noKnowledgeMatch: 'No work memory matches this search.',
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
    pageTitle: '关于你',
    privacy: '数据与隐私',
    knowledge: '工作记忆',
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
    learned: '协作中学到的',
    allUnderstanding: '全部来源',
    understandingFilterHint: '按内容来源筛选这份理解。',
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
    howWeWork: '我们怎样协作',
    refresh: '刷新',
    refreshing: '正在刷新…',
    refreshComplete: '已刷新',
    refreshFailed: '刷新失败',
    aboutYouTitle: 'xopc 记住的你',
    aboutYouHint: '在这里查看你的背景、偏好和习惯。有不准确或已经变化的内容，可以直接修改。',
    identity: '你的背景与能力',
    preferences: '偏好与习惯',
    relationships: '重要的人与关系',
    currentState: '最近的状态',
    insights: '其他观察',
    emptyGroup: '还没有记住关于你的信息。你可以在聊天中告诉 xopc 你的背景或偏好，例如「回答时先给结论」。',
    save: '保存修正',
    cancel: '取消',
    correctionPlaceholder: '写下更准确的说法…',
    searchPlaceholder: '搜索工作记忆…',
    allMemory: '全部工作记忆',
    memoryFilterHint: '按记忆类型筛选',
    noKnowledge: '还没有形成工作记忆。',
    noKnowledgeMatch: '没有符合搜索条件的工作记忆。',
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

function profileFromResponse(data: AboutUserModelResponse): UserProfile {
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

function NotesDialog({
  open,
  title,
  children,
  closeLabel,
  busy,
  error,
  onOpenChange,
  onSubmit,
  submitLabel,
  submitDisabled,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  closeLabel: string;
  busy?: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim" />
        <Dialog.Content aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[90] flex h-[min(24rem,calc(100dvh-2rem))] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-popover outline-none">
          <Dialog.Title className="shrink-0 border-b border-edge-subtle px-5 py-4 text-base font-semibold text-fg">{title}</Dialog.Title>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {children}
              {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
            </div>
            <footer className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle px-5 py-3">
              <Dialog.Close asChild><Button type="button" variant="ghost" disabled={busy}>{closeLabel}</Button></Dialog.Close>
              {onSubmit ? <Button type="submit" variant="primary" disabled={busy || submitDisabled}>{submitLabel}</Button> : null}
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
  onScopeChange,
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
  onScopeChange: (scope: KnowledgeItem['scope']) => void;
  onReview: (action: 'edit_and_approve', content?: string) => void;
  onDelete: () => void;
}) {
  const t = copy[language];
  const date = formatDate(item.updatedAt ?? item.createdAt, language);
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
            <span>{knowledgeKindLabel(item.kind, language)}</span>
            <span>{scopeLabel(item.scope, language)}</span>
            {item.claimMode === 'reported' ? <span>{language === 'zh' ? '来源报告' : 'Source report'}</span> : null}
            {item.verification === 'tentative' ? <span>{language === 'zh' ? '证据待补充' : 'Evidence pending'}</span> : null}
            {date ? <span>{date}</span> : null}
          </div>
          {expanded ? <KnowledgeEvidence id={item.id} language={language} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" className="size-11 p-0" aria-expanded={expanded} aria-label={expanded ? t.collapse : t.expand} onClick={onToggle}>
              <ChevronDown className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
          <MemoryActions language={language} busy={busy} statement={item.content} scope={item.scope} onScopeChange={onScopeChange} onEdit={onEdit} onDelete={onDelete} />
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
  const { data, error, isLoading, isValidating: isModelValidating, mutate } = useSWR(ABOUT_USER_MODEL_KEY, fetchAboutUserModel);
  const view = viewFromSearchParams(searchParams);
  const zh = language === 'zh';
  const query = searchParams.get('q') ?? '';
  const [debouncedQuery] = useDebounce(query, 250);
  const cursor = searchParams.get('cursor') ?? '';
  const kind = searchParams.get('kind');
  const knowledgeKindFilter: KnowledgeKindFilter = knowledgeKindOrder.find((value) => value === kind) ?? 'all';
  const workParams = new URLSearchParams({ view: 'manage' });
  if (debouncedQuery.trim()) workParams.set('q', debouncedQuery.trim());
  if (knowledgeKindFilter !== 'all') workParams.set('kind', knowledgeKindFilter);
  if (cursor) workParams.set('cursor', cursor);
  const workKey = view === 'work' && debouncedQuery === query ? `/api/knowledge-memory?${workParams}` : null;
  const workMemory = useSWR(workKey, fetchWorkMemoryPage);
  const isValidating = view === 'work' ? workMemory.isValidating : isModelValidating;
  const [preferenceDraft, setPreferenceDraft] = useState<string>();
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [actionMessage, setActionMessage] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [expandedKnowledgeId, setExpandedKnowledgeId] = useState<string>();
  const [profileOpen, setProfileOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const sourceFilter = searchParams.get('source');
  const understandingFilter: UnderstandingFilter = sourceFilter === 'explicit' || sourceFilter === 'learned' ? sourceFilter : 'all';
  const personalQuery = searchParams.get('search') ?? '';
  const understandingCategory = searchParams.get('category') ?? 'all';
  const [refreshFeedback, setRefreshFeedback] = useState<RefreshFeedback>('idle');
  const refreshResetTimer = useRef<number | undefined>(undefined);

  const setView = (nextView: View) => {
    if (nextView === view) return;
    const main = document.getElementById('app-main-content');
    if (typeof main?.scrollTo === 'function') main.scrollTo({ top: 0, behavior: 'auto' });
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const key of ['section', 'source', 'search', 'category', 'q', 'kind', 'cursor']) next.delete(key);
      if (nextView === 'overview') next.delete('tab');
      else next.set('tab', nextView);
      return next;
    });
  };

  const setUnderstandingParam = (key: string, value: string, replace = false) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (!value || value === 'all') next.delete(key);
      else next.set(key, value);
      return next;
    }, { replace });
  };

  const setWorkParam = (key: 'q' | 'kind' | 'cursor', value: string) => {
    setExpandedKnowledgeId(undefined);
    setEditingId(undefined);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('cursor');
      if (value && (key !== 'kind' || value !== 'all')) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: key === 'q' });
  };

  const refreshUserModel = useCallback(async () => {
    if (refreshFeedback === 'refreshing' || isValidating || (view === 'work' && !workKey)) return;
    if (refreshResetTimer.current) window.clearTimeout(refreshResetTimer.current);
    setRefreshFeedback('refreshing');
    setActionError(undefined);
    setActionMessage(t.refreshing);
    try {
      await (view === 'work' ? workMemory.mutate() : mutate());
      setRefreshFeedback('success');
      setActionMessage(t.refreshComplete);
    } catch {
      setRefreshFeedback('error');
      setActionMessage('');
      setActionError(t.refreshFailed);
    } finally {
      refreshResetTimer.current = window.setTimeout(() => setRefreshFeedback('idle'), 1600);
    }
  }, [isValidating, mutate, refreshFeedback, t, view, workKey, workMemory.mutate]);

  useEffect(() => () => {
    if (refreshResetTimer.current) window.clearTimeout(refreshResetTimer.current);
  }, []);

  const refreshBusy = (view === 'work' && !workKey) || isValidating || refreshFeedback === 'refreshing';
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
      main: <h1 className="text-base font-semibold text-fg">{t.pageTitle}</h1>,
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
      await (view === 'work' ? workMemory.mutate() : mutate());
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
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 pb-7 pt-6 sm:px-6 lg:px-8">
        <Skeleton className="h-12 w-44 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
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
    item.usable && !profilePredicates.has(item.predicate)
  )).sort((a, b) => {
    const importanceA = a.declaredImportance ?? a.inferredImportance;
    const importanceB = b.declaredImportance ?? b.inferredImportance;
    return importanceB - importanceA || b.recordedAt - a.recordedAt;
  });
  const profile = profileFromResponse(data);
  const displayName = profile.callName || (language === 'zh' ? '你' : 'You');
  const assertionCategories = [
    { key: 'identity', title: t.identity, icon: UserRound, kinds: ['identity', 'capability'] },
    { key: 'preferences', title: t.preferences, icon: Compass, kinds: ['preference', 'value', 'routine'] },
    { key: 'relationships', title: t.relationships, icon: Handshake, kinds: ['relationship'] },
    { key: 'current', title: t.currentState, icon: Clock3, kinds: ['current_state'] },
    { key: 'insights', title: t.insights, icon: Sparkles, kinds: ['derived_insight'] },
  ];
  const selectedCategory = assertionCategories.find((group) => group.key === understandingCategory);
  const matchingAssertions = assertions.filter((item) => (
    (!selectedCategory || selectedCategory.kinds.includes(item.kind))
    && (!personalQuery.trim() || item.statement.toLocaleLowerCase().includes(personalQuery.trim().toLocaleLowerCase()))
  ));
  const explicitCount = matchingAssertions.filter((item) => item.authority === 'user_explicit').length;
  const learnedCount = matchingAssertions.length - explicitCount;
  const filteredAssertions = matchingAssertions.filter((item) => {
    if (understandingFilter === 'explicit') return item.authority === 'user_explicit';
    if (understandingFilter === 'learned') return item.authority !== 'user_explicit';
    return true;
  });
  const now = Date.now();
  const activePriorities = data.priorities.filter((item) => item.status === 'active' && item.validFrom <= now && item.validTo > now);
  const primaryPriority = activePriorities.find((item) => item.rank === 'primary') ?? activePriorities[0];
  const primaryTitle = goalTitle(primaryPriority, data.goals, language);
  const primaryGoal = primaryPriority?.targetType === 'goal'
    ? data.goals.find((goal) => goal.id === primaryPriority.targetId)
    : undefined;
  const collaborationRules = data.rules.filter((rule) => rule.status !== 'archived');
  const ruleSuggestions = data.ruleSuggestions ?? [];
  const visibleAssertionGroups = assertionCategories
    .map((group) => ({ ...group, items: filteredAssertions.filter((item) => group.kinds.includes(item.kind)) }))
    .filter((group) => group.items.length > 0);
  const globalPreferences = assertions.filter((item) =>
    item.kind === 'preference' && item.scope.type === 'global' && item.sensitivity === 'normal');
  const explicitPreferences = globalPreferences
    .filter((item) => item.authority === 'user_explicit')
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .slice(0, 3);
  const overviewRules = collaborationRules
    .filter((rule) => rule.status === 'active' && rule.scope.type === 'global' && !Object.keys(rule.conditions ?? {}).length)
    .slice(0, 3 - explicitPreferences.length);
  const learnedPreferences = globalPreferences
    .filter((item) => item.authority !== 'user_explicit')
    .slice(0, 3 - explicitPreferences.length - overviewRules.length);
  const overviewPreferences = [...explicitPreferences, ...learnedPreferences];
  const hasOverviewPreferences = overviewRules.length > 0 || overviewPreferences.length > 0;
  const meaningfulConflicts = data.assertions.filter((item) => item.status === 'conflicted'
    && (item.consequence === 'high' || item.consequence === 'critical') && item.sensitivity === 'normal');
  const previewMarkdown = [
    `# ${zh ? '协作说明' : 'Collaboration notes'}`,
    ...(primaryTitle ? ['', `## ${zh ? '当前关注' : 'Current focus'}`, primaryTitle.replace(/\s+/g, ' '),
      ...(primaryPriority ? [validUntil(primaryPriority.validTo, language)] : [])] : []),
    ...(hasOverviewPreferences ? ['', `## ${zh ? '协作偏好' : 'Preferences'}`,
      ...overviewRules.map((rule) => `- ${rule.statement.replace(/\s+/g, ' ')}`),
      ...overviewPreferences.map((item) => `- ${item.statement.replace(/\s+/g, ' ')}${item.authority === 'user_explicit' ? '' : zh ? '（xopc 推断）' : ' (learned by xopc)'}`)] : []),
  ].join('\n');
  const understandingFilterOptions: Array<{ id: UnderstandingFilter; label: string; count: number }> = [
    { id: 'all', label: t.allUnderstanding, count: matchingAssertions.length },
    { id: 'explicit', label: t.explicit, count: explicitCount },
    { id: 'learned', label: t.learned, count: learnedCount },
  ];

  const openUnderstanding = (category = 'all') => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('tab', 'understanding');
      next.delete('section');
      next.delete('source');
      next.delete('search');
      if (category === 'all') next.delete('category');
      else next.set('category', category);
      return next;
    });
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
      onScopeChange={(scope) => void act(item.id, () => setAssertionScope(item.id, scope, item.version))}
    />
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 pb-4 pt-3 sm:space-y-8 sm:px-6 sm:pb-7 lg:px-8 lg:pb-10 lg:pt-4">
      <nav aria-label={t.pageTitle} className="flex flex-wrap items-center justify-between gap-2">
        {view !== 'overview' ? (
          <Button variant="ghost" onClick={() => setView(view === 'work' ? 'privacy' : 'overview')}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {view === 'work' ? t.privacy : t.pageTitle}
          </Button>
        ) : <span />}
        {view === 'overview' ? (
          <Button variant="ghost" onClick={() => setView('privacy')}>
            <ShieldCheck className="size-4" aria-hidden="true" />{t.privacy}
          </Button>
        ) : null}
      </nav>

      <p role="status" className="sr-only">{actionMessage}</p>
      {actionError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(undefined)} aria-label={t.cancel}><X className="size-4" /></button>
        </div>
      ) : null}

      {view === 'overview' ? (
        <div className="space-y-6">
          <section data-testid="overview-hero" className="flex items-center gap-3 sm:gap-4">
            <Loopi className="size-12 shrink-0" mood={actionError ? 'care' : busy ? 'work' : 'listen'} />
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-xl font-semibold tracking-tight text-fg">{displayName}</h2>
              <p className="break-words text-sm text-fg-muted">
                {[profile.locale && localeLabel(profile.locale, language), profile.timezone].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Button variant="ghost" className="min-h-11 shrink-0" onClick={() => setProfileOpen(true)}>
              <UserRoundPen className="size-4" aria-hidden="true" />{t.editProfile}
            </Button>
          </section>

          <section data-testid="priority-panel" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge-subtle bg-surface-inset p-4 sm:p-5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-fg">{zh ? '当前关注' : 'Current focus'}</h2>
              <p className="mt-1 break-words text-sm text-fg">
                {primaryTitle ?? (zh ? '最近最重要的一件事是什么？' : 'What matters most right now?')}
              </p>
              {primaryGoal?.desiredOutcome ? <p className="mt-1 break-words text-sm text-fg-muted">{primaryGoal.desiredOutcome}</p> : null}
              {primaryPriority ? <p className="mt-1 text-xs text-fg-muted">{validUntil(primaryPriority.validTo, language)}</p> : null}
            </div>
            <Button variant={primaryPriority ? 'ghost' : 'primary'} className="min-h-11" onClick={() => setPriorityOpen(true)}>
              {primaryPriority ? t.editPriority : t.addPriority}
            </Button>
          </section>

          {meaningfulConflicts.length ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge-subtle px-4 py-2">
              <p className="text-sm text-fg">{zh ? 'xopc 对你有相互冲突的理解。' : 'xopc found conflicting information about you.'}</p>
              <Button variant="ghost" onClick={() => openUnderstanding()}>{zh ? '查看冲突' : 'Review conflicts'}</Button>
            </div>
          ) : null}

          <section aria-labelledby="collaboration-preferences">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge-subtle pb-2">
              <h2 id="collaboration-preferences" className="text-base font-semibold text-fg">{zh ? '协作偏好' : 'Collaboration preferences'}</h2>
              <Button variant="ghost" className="min-h-11" onClick={() => { setActionError(undefined); setPreferenceDraft(''); }}>
                <Plus className="size-4" aria-hidden="true" />{zh ? '添加偏好' : 'Add preference'}
              </Button>
            </header>
            {hasOverviewPreferences ? (
              <div className="[&>article]:px-0 [&>div]:px-0 [&>article:not(:first-child)]:border-t">
                {explicitPreferences.map(assertionRow)}
                {overviewRules.map((rule) => (
                  <RuleRow key={rule.id} rule={rule} language={language} busy={Boolean(busy)}
                    onToggle={() => void act(rule.id, () => setRuleStatus(rule.id, 'disabled'))} />
                ))}
                {learnedPreferences.map(assertionRow)}
              </div>
            ) : (
              <p className="py-3 text-sm text-fg-muted">{zh ? '还没有保存偏好。你可以添加一条，比如「回答先给结论」。' : 'Add a preference such as “Lead with the conclusion.”'}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => openUnderstanding()}>{zh ? '查看个人理解' : 'View personal understanding'}</Button>
              {hasOverviewPreferences || primaryTitle ? (
                <Button variant="ghost" onClick={() => setMarkdownOpen(true)}>{zh ? '查看 Markdown' : 'View Markdown'}</Button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {view === 'understanding' ? (
        <div className="space-y-7">
          <div className="px-1 pt-1">
            <div className="flex items-start gap-3">
              <Brain className="mt-0.5 size-5 shrink-0 text-accent-fg" aria-hidden="true" />
              <div><h2 className="font-semibold text-fg">{t.aboutYouTitle}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-fg-muted"><span className="sm:hidden">{language === 'zh' ? '你的偏好与背景，都可以在这里修改。' : 'Review and edit your preferences here.'}</span><span className="hidden sm:inline">{t.aboutYouHint}</span></p></div>
            </div>
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_7rem] gap-2 sm:flex sm:gap-3">
              <label className="relative block min-w-0 flex-1">
                <span className="sr-only">{language === 'zh' ? '搜索关于你的信息' : 'Search what xopc knows'}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
                <input type="search" value={personalQuery} onChange={(event) => setUnderstandingParam('search', event.target.value, true)} placeholder={language === 'zh' ? '搜索记忆' : 'Search memories'} className="min-h-11 w-full rounded-xl border border-edge bg-surface-panel pl-10 pr-3 text-base text-fg placeholder:text-fg-muted sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
              </label>
              <Select aria-label={language === 'zh' ? '内容分类' : 'Category'} value={assertionCategories.some((group) => group.key === understandingCategory) ? understandingCategory : 'all'} onChange={(event) => setUnderstandingParam('category', event.target.value)} triggerClassName="min-h-11 w-full text-base sm:w-48 sm:text-sm">
                <SelectOption value="all">{language === 'zh' ? '全部' : 'All'}</SelectOption>
                {assertionCategories.map((group) => <SelectOption key={group.key} value={group.key}>{language === 'zh'
                  ? ({ identity: '背景', preferences: '偏好', relationships: '关系', current: '近况', insights: '观察' } as Record<string, string>)[group.key]
                  : ({ identity: 'Profile', preferences: 'Habits', relationships: 'People', current: 'Now', insights: 'Notes' } as Record<string, string>)[group.key]}</SelectOption>)}
              </Select>
            </div>
            <SlidingTabList className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t.understandingFilterHint} indicatorClassName="rounded-full bg-surface-active">
              {understandingFilterOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={understandingFilter === option.id}
                  className={`touch-target inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${understandingFilter === option.id ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'}`}
                  onClick={() => setUnderstandingParam('source', option.id)}
                >
                  <span className="sm:hidden">{language === 'zh' ? ({ all: '全部', explicit: '你说过的', learned: '协作中发现' } as const)[option.id] : ({ all: 'All', explicit: 'You said', learned: 'Observed' } as const)[option.id]}</span><span className="hidden sm:inline">{option.label}</span><span className="hidden tabular-nums text-fg-muted sm:inline">{option.count}</span>
                </button>
              ))}
            </SlidingTabList>
          </div>
          {meaningfulConflicts.length && !personalQuery && understandingFilter === 'all' && !selectedCategory ? (
            <Section title={zh ? '需要纠正的冲突' : 'Conflicting information'}>
              {meaningfulConflicts.map(assertionRow)}
            </Section>
          ) : null}
          {visibleAssertionGroups.length ? visibleAssertionGroups.map(({ key, title, icon: Icon, items }) => (
            <Section key={key} title={title} action={<Icon className="size-4 text-fg-subtle" aria-hidden="true" />}>
              <div>{items.map(assertionRow)}</div>
            </Section>
          )) : (
            <div className="rounded-2xl bg-surface-panel">
              <Empty icon={<Brain className="size-5" />}>{assertions.length ? (language === 'zh' ? '没有找到符合条件的内容，试试其他关键词或清除筛选。' : 'No matching details. Try another search or clear the filters.') : t.emptyGroup}</Empty>
              {assertions.length ? <Button variant="ghost" className="mb-4 ml-4" onClick={() => openUnderstanding()}>{language === 'zh' ? '清除筛选' : 'Clear filters'}</Button> : null}
            </div>
          )}
          {collaborationRules.length || ruleSuggestions.length ? (
            <Section title={t.howWeWork}>
              {collaborationRules.map((rule) => (
                <RuleRow key={rule.id} rule={rule} language={language} busy={Boolean(busy)}
                  onToggle={() => void act(rule.id, () => setRuleStatus(rule.id, rule.status === 'active' ? 'disabled' : 'active'))} />
              ))}
              {ruleSuggestions.map((suggestion) => (
                <RuleSuggestionRow key={suggestion.id} suggestion={suggestion} language={language} busy={Boolean(busy)}
                  onConfirm={() => void act(suggestion.id, () => createRuleFromSuggestion(suggestion))} />
              ))}
            </Section>
          ) : null}
        </div>
      ) : null}
      {view === 'work' ? (
        <div className="space-y-5">
          <h2 className="text-lg font-semibold text-fg">{zh ? '管理工作记忆' : 'Manage work memory'}</h2>
          <div className="flex flex-wrap gap-3">
            <label className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-fg-muted" aria-hidden="true" />
              <span className="sr-only">{t.searchPlaceholder}</span>
              <input type="search" value={query} onChange={(event) => setWorkParam('q', event.target.value)}
                placeholder={t.searchPlaceholder}
                className="h-11 w-full rounded-xl border border-edge bg-surface-panel pl-9 pr-3 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-sm" />
            </label>
            <Select aria-label={t.memoryFilterHint} value={knowledgeKindFilter}
              onChange={(event) => setWorkParam('kind', event.target.value)} triggerClassName="min-h-11">
              <SelectOption value="all">{t.allMemory}</SelectOption>
              {knowledgeKindOrder.map((option) => <SelectOption key={option} value={option}>{knowledgeKindLabel(option, language)}</SelectOption>)}
            </Select>
          </div>
          {workMemory.error ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
              {t.loadFailed}<Button onClick={() => void workMemory.mutate()}>{t.tryAgain}</Button>
              {cursor ? <Button variant="ghost" onClick={() => setWorkParam('cursor', '')}>{zh ? '返回第一页' : 'First page'}</Button> : null}
            </div>
          ) : !workKey || workMemory.isLoading ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : workMemory.data?.items.length ? (
            <section aria-label={t.knowledge} className="overflow-hidden rounded-2xl bg-surface-panel">
              {workMemory.data.items.map((item) => (
                <KnowledgeRow key={item.id} item={item} language={language} busy={Boolean(busy)}
                  expanded={expandedKnowledgeId === item.id}
                  onToggle={() => setExpandedKnowledgeId((current) => current === item.id ? undefined : item.id)}
                  editing={editingId === `knowledge:${item.id}`} draft={draft} onDraftChange={setDraft}
                  onEdit={() => { setEditingId(`knowledge:${item.id}`); setDraft(item.content); }}
                  onCancel={() => { setEditingId(undefined); setDraft(''); }}
                  onDelete={() => void act(item.id, () => deleteKnowledge(item.id))}
                  onScopeChange={(scope) => void act(item.id, () => setKnowledgeScope(item, scope))}
                  onReview={(action, content) => void act(item.id, async () => {
                    await reviewKnowledgeItem(item, action, content);
                    setEditingId(undefined);
                    setDraft('');
                  })}
                />
              ))}
            </section>
          ) : <Empty icon={<Search className="size-5" />}>{query.trim() ? t.noKnowledgeMatch : t.noKnowledge}</Empty>}
          {cursor || workMemory.data?.nextCursor ? (
            <div className="flex flex-wrap justify-end gap-2">
              {cursor ? <Button variant="ghost" onClick={() => setWorkParam('cursor', '')}>{zh ? '返回第一页' : 'First page'}</Button> : null}
              {workMemory.data?.nextCursor ? (
                <Button onClick={() => setWorkParam('cursor', workMemory.data?.nextCursor ?? '')}>{zh ? '下一页' : 'Next page'}</Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {view === 'privacy' ? (
        <div className="space-y-6">
          <div className="px-1 pt-1">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent-fg" aria-hidden="true" />
              <div>
                <h2 className="font-semibold text-fg">{language === 'zh' ? '你的信息，由你掌控' : 'Your information, under your control'}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-fg-muted">{language === 'zh' ? '决定 xopc 可以记住什么、从哪里了解你，以及如何迁移你的数据。' : 'Decide what xopc can remember, where it learns from, and how your data moves.'}</p>
              </div>
            </div>
          </div>

          <Section title={language === 'zh' ? '记忆与使用' : 'Memory & use'}>
            <div className="divide-y divide-edge-subtle">
              {[
                { key: 'memory' as const, icon: Brain, title: language === 'zh' ? '长期记忆' : 'Long-term memory', detail: language === 'zh' ? '记住长期有用的信息，减少重复说明。' : 'Remember useful information so you do not have to repeat yourself.', enabled: data.settings.memoryEnabled },
                { key: 'references' as const, icon: Sparkles, title: language === 'zh' ? '回答中的记忆引用' : 'Memory references in answers', detail: language === 'zh' ? '当个人信息影响回答时，显示本次参考内容。' : 'Show what personal context was referenced when it shapes an answer.', enabled: data.settings.showMemoryReferences },
              ].map(({ key, icon: Icon, title, detail, enabled }) => (
                <button key={key} type="button" role="switch" aria-checked={enabled} disabled={Boolean(busy)} className="flex min-h-20 w-full items-center gap-4 px-5 py-4 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-60 sm:px-6" onClick={() => void act(`setting:${key}`, () => updateMemorySettings(key === 'memory' ? { memoryEnabled: !enabled } : { showMemoryReferences: !enabled }))}>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-base text-fg-muted"><Icon className="size-4.5" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{title}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{detail}</span></span>
                  <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-surface-active'}`} aria-hidden="true"><span className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} /></span>
                </button>
              ))}
              <div className="flex min-h-20 items-center gap-4 px-5 py-4 sm:px-6">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-base text-fg-muted"><LockKeyhole className="size-4.5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{language === 'zh' ? '敏感信息' : 'Sensitive information'}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{language === 'zh' ? '控制健康、财务等信息是否可以保存。' : 'Control whether health, financial, and similar information can be saved.'}</span></span>
                <Select aria-label={language === 'zh' ? '敏感信息策略' : 'Sensitive information policy'} value={data.settings.sensitiveWritePolicy} disabled={Boolean(busy)} onChange={(event) => void act('setting:sensitive', () => updateMemorySettings({ sensitiveWritePolicy: event.target.value as AboutUserModelResponse['settings']['sensitiveWritePolicy'] }))}>
                  <SelectOption value="confirm">{language === 'zh' ? '先询问' : 'Ask first'}</SelectOption>
                  <SelectOption value="deny">{language === 'zh' ? '不保存' : 'Never save'}</SelectOption>
                  <SelectOption value="allow">{language === 'zh' ? '允许' : 'Allow'}</SelectOption>
                </Select>
              </div>
            </div>
          </Section>

          <Section title={language === 'zh' ? '数据管理' : 'Data management'}>
            <div className="divide-y divide-edge-subtle">
              <button type="button" className="flex min-h-20 w-full items-center gap-4 px-5 py-4 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-6" onClick={() => setView('work')}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-base text-fg-muted"><Database className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{zh ? '管理工作记忆' : 'Manage work memory'}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{zh ? '搜索、纠正或删除已保存的工作记录。' : 'Search, correct or delete saved work records.'}</span></span>
                <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              </button>
              <Link to="/settings/imports" className="flex min-h-20 items-center gap-4 px-5 py-4 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-6">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-base text-fg-muted"><Upload className="size-4.5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{language === 'zh' ? '从其他 AI 导入' : 'Import from another AI'}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{language === 'zh' ? '导入前预览新增、重复和冲突内容。' : 'Preview new, duplicate, and conflicting items before import.'}</span></span>
                <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              </Link>
              <button type="button" disabled={Boolean(busy)} className="flex min-h-20 w-full items-center gap-4 px-5 py-4 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-60 sm:px-6" onClick={() => void act('export', downloadUserModelExport)}>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-base text-fg-muted"><Download className="size-4.5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{language === 'zh' ? '下载我的记忆' : 'Download my memory'}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{language === 'zh' ? '导出为可阅读、可迁移的数据包。' : 'Export a readable, portable archive.'}</span></span>
                <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              </button>
            </div>
          </Section>

          <LearningStatus language={language} />
        </div>
      ) : null}
      <NotesDialog open={preferenceDraft !== undefined} title={zh ? '添加偏好' : 'Add preference'}
        onOpenChange={(open) => { if (!open && !busy) setPreferenceDraft(undefined); }}
        closeLabel={t.cancel} busy={busy === 'preference'} error={actionError}
        onSubmit={() => {
          const statement = preferenceDraft?.trim();
          if (!statement) return;
          void act('preference', async () => {
            await addCollaborationPreference(statement);
            setPreferenceDraft(undefined);
          });
        }}
        submitLabel={zh ? '保存' : 'Save'} submitDisabled={!preferenceDraft?.trim()}>
        <label className="block space-y-2 text-sm text-fg">
          <span>{zh ? '希望 xopc 怎么与你协作？' : 'How should xopc work with you?'}</span>
          <textarea value={preferenceDraft ?? ''} onChange={(event) => setPreferenceDraft(event.target.value)}
            maxLength={240} rows={4} disabled={Boolean(busy)} required
            className="w-full rounded-xl border border-edge bg-surface-base p-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        </label>
      </NotesDialog>
      <NotesDialog open={markdownOpen} title={zh ? '协作说明' : 'Collaboration notes'} closeLabel={zh ? '关闭' : 'Close'}
        onOpenChange={setMarkdownOpen}>
        <textarea aria-label="Markdown" readOnly value={previewMarkdown}
          className="h-full min-h-40 w-full resize-none rounded-xl border border-edge bg-surface-base p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      </NotesDialog>
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
