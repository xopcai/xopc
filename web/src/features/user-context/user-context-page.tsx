import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, Brain, Cable, ChevronLeft, ChevronRight, CircleUserRound, Database, ExternalLink, Handshake, Loader2, MessageCircle, Moon, Pencil, Plus, Settings2, ShieldCheck, Sparkles, Trash2, UserRoundPen, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { AutosaveStatus } from '@/components/ui/autosave-status';
import { Button } from '@/components/ui/button';
import { TabCompletionInput } from '@/components/ui/tab-completion-input';
import { PageTabs } from '@/components/ui/page-tabs';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAutosave } from '@/lib/use-autosave';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { ConnectorLogo } from '@/features/connectors/components/connector-logo';
import { fetchConnectorCatalog, fetchConnectorInstances, type ConnectorDefinition, type ConnectorInstance } from '@/features/connectors/connectors-api';
import {
  createCollaborationRule, createUnderstanding, deleteCollaborationRule,
  deleteUnderstanding, deleteUserFocus, detectBrowserTimezone, fetchUserContext, fetchUserContextSettings,
  fetchConnectedContentCandidates, fetchUnderstandingSourceOverview, fetchUserFocuses,
  readConnectedContent,
  refreshUnderstandingSourceGrant,
  revokeUnderstandingSourceGrant,
  updateCollaborationRule, updateUnderstanding, updateUserProfile,
  updateUserFocusStatus,
  updateUserContextSettings,
  type ContextConsolidationRun,
  type CollaborationRule, type ConnectedContentCandidate, type UnderstandingKind, type UserContextResponse,
  type UserContextSettings,
  type UnderstandingSourceGrant, type UnderstandingSourceRun, type UserFocus, type UserProfile, type UserUnderstanding,
  type UserUnderstandingQuality,
} from './user-context-api';

type Tab = 'profile' | 'understanding' | 'collaboration' | 'sources' | 'dreaming' | 'privacy';
const TABS = new Set<Tab>(['profile', 'understanding', 'collaboration', 'sources', 'dreaming', 'privacy']);
const inputClass = 'w-full rounded-xl border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20';

const copy = {
  en: {
    title: 'You', subtitle: 'A living portrait, shaped together by you and xopc.',
    profile: 'Your portrait', understanding: 'Shared understanding', collaboration: 'Working together', sources: 'Sources', dreaming: 'Background review', privacy: 'Privacy',
    portraitEyebrow: 'YOU × XOPC', portraitIntro: 'This is how xopc currently understands you. It grows through your conversations and work — and you always have the final say.',
    maintainedTogether: 'Shaped together', youDecide: 'You decide what stays', editProfile: 'Edit basics', talkAboutMe: 'Add through conversation',
    roleMissing: 'Add what you do', direction: 'What matters now', directionEmpty: 'Add a direction so xopc can help keep important work moving.',
    portraitUnderstanding: 'What xopc understands', portraitUnderstandingHint: 'Confirmed context xopc can use across conversations.', portraitRules: 'How we work together', portraitRulesHint: 'The agreements xopc should follow when helping you.',
    reviewWaiting: 'waiting for your review', seeAll: 'See all', addFirstUnderstanding: 'Nothing confirmed yet. Tell xopc what matters to you, or review a suggestion when one appears.', addFirstRule: 'No working agreements yet. Add one to make collaboration feel more like yours.',
    portraitControl: 'How this portrait evolves', portraitControlHint: 'Manage where understanding comes from, how it is reviewed, and what is never retained.', portraitLearn: 'Learn how this portrait is formed', advanced: 'Portrait controls', backToPortrait: 'Back to your portrait',
    controlSourcesHint: 'See which conversations, connections, and explicit details shape xopc’s understanding.', controlReviewHint: 'Choose how xopc proposes updates and which changes require your confirmation.', controlPrivacyHint: 'Set the boundaries for sensitive content and long-term retention.', controlTrust: 'Inferred understanding is never activated automatically. You can review, correct, or remove it at any time.',
    profileHint: 'Facts you provide directly. These are available across conversations.', done: 'Done', required: 'This field cannot be empty.',
    callName: 'What should xopc call you?', callNamePlaceholder: 'For example: Alex, Joyce, or Dr. Chen',
    role: 'Your role', rolePlaceholder: 'For example: product designer, founder, or engineer',
    primaryGoal: 'What are you mainly trying to achieve?', primaryGoalPlaceholder: 'The outcome you want xopc to optimize for',
    pronouns: 'Pronouns (optional)', pronounsPlaceholder: 'For example: she/her, he/him, they/them',
    timezone: 'Timezone', locale: 'Language / locale', detect: 'Use this device',
    understoodHint: 'Reviewable beliefs learned from your conversations and work. Inferences stay pending until confirmed.',
    addUnderstanding: 'Add understanding', statement: 'What should xopc understand?', kind: 'Type', add: 'Add', cancel: 'Cancel',
    active: 'Active', review: 'Needs review', confirm: 'Confirm', reject: 'Wrong', edit: 'Edit', delete: 'Delete', confirmDelete: 'Delete now',
    rulesHint: 'Explicit instructions for how xopc should collaborate with you. Rules outrank inferred understanding.',
    addRule: 'Add rule', ruleStatement: 'How should xopc work with you?', category: 'Category', disable: 'Disable', enable: 'Enable',
    emptyUnderstanding: 'Nothing here yet. Tell xopc something explicitly, or confirm a suggestion after it learns one.',
    qualityTitle: 'Learning quality', qualityActive: 'Confirmed', qualityPending: 'Pending review', qualityAcceptance: '30-day acceptance', qualityRecall: 'Helpful recall', qualitySourceCoverage: 'Source coverage', qualityBootstrapTime: 'Median first sync', qualityNoData: 'Not enough feedback yet',
    emptyRules: 'No working agreements yet.', sourceExplicit: 'You said this directly', sourceInferred: 'Inferred — may be wrong', sourceObserved: 'Observed across prior work',
    sourcesHint: 'Review every granted source, its latest learning result, access mode, and retention. Revoking stops future learning.', manageSources: 'Connect another source', authorizedSources: 'Authorized sources', connectorsTitle: 'Connectors', openConnector: 'Open connector', noSources: 'No sources are authorized.', noConnectors: 'No connectors are installed.', connected: 'Connected', unavailable: 'Needs attention', revoke: 'Revoke source', revokeHint: 'Revoke this source and remove its derived understanding', confirmRevoke: 'Confirm revoke', revoking: 'Revoking…', revokeDone: 'Source revoked and derived understanding removed.', refresh: 'Update', refreshing: 'Updating…', refreshStarted: 'Update started.', actionFailed: 'Action failed', once: 'One-time', continuous: 'Continuous', localOnly: 'Local only', derivedOnly: 'Derived understanding only', sourceQueued: 'Queued', sourceRunning: 'Learning', sourceCompleted: 'Learned', sourcePartial: 'Partially learned', sourceFailed: 'Learning failed', sourceNotRun: 'Not collected yet', sourceItems: 'items reviewed', sourceCandidates: 'candidates formed', sourceAccountUnavailable: 'The connected account is unavailable. Reconnect it and try again.', sourceSyncFailed: 'This source could not be synchronized. Try updating it again.', sourceAnalysisFailed: 'Content was collected, but deeper understanding could not be completed. Try again later.',
    focuses: 'Current focuses', focusHint: 'Candidate focuses never activate until you confirm them.', activate: 'Activate', pause: 'Pause', complete: 'Complete', noFocuses: 'No focus candidates yet.', focusCandidate: 'Suggested', focusActive: 'Active', focusPaused: 'Paused', focusCompleted: 'Completed', confidence: 'Confidence', confidenceHigh: 'High', confidenceMedium: 'Medium', confidenceLow: 'Low',
    contentReadTitle: 'Additional deeper reading', contentReadHint: 'These items still need content to add useful context. Select up to 5 for one bounded read.', readSelected: 'Read selected', reading: 'Reading…', contentReadDone: 'Selected content was read and indexed.',
    dreamingHint: 'A deterministic daily review checks expiry, contradictory evidence, and corroborated candidates. It never auto-activates an inference.', mode: 'Background review', on: 'On — propose for review', off: 'Off', reviewTime: 'Daily review time', evidenceThreshold: 'Supporting evidence required', scanLimit: 'Maximum items per run', lastRun: 'Last review', neverRun: 'Not run yet', runCompleted: 'Completed', runFailed: 'Failed', runRunning: 'Running', runItems: 'items',
    privacyHint: 'Choose how generic memory providers handle sensitive content. Structured user understanding applies stricter rules of its own.', sensitivePolicy: 'Sensitive memory writes', policyDeny: 'Do not store', policyConfirm: 'Ask before storing', policyAllow: 'Store when relevant', privacyWarning: 'Secret and regulated content is never stored as structured user understanding, regardless of this setting.',
    error: 'Could not load your context.', retry: 'Try again',
  },
  zh: {
    title: '你', subtitle: '一份由你和 xopc 共同塑造、持续生长的画像。',
    profile: '你的画像', understanding: '共同理解', collaboration: '协作方式', sources: '数据来源', dreaming: '后台复核', privacy: '隐私',
    portraitEyebrow: 'YOU × XOPC', portraitIntro: '这是 xopc 此刻对你的理解。它会在对话与共事中逐渐丰富，而你始终拥有最终决定权。',
    maintainedTogether: '由你与 xopc 共同维护', youDecide: '你决定什么被保留', editProfile: '编辑基本信息', talkAboutMe: '在对话中补充',
    roleMissing: '补充你的角色', direction: '此刻重要的事', directionEmpty: '写下你此刻的方向，让 xopc 帮你持续推动真正重要的事。',
    portraitUnderstanding: 'xopc 对你的理解', portraitUnderstandingHint: '已经确认、可以在不同对话中帮助你的上下文。', portraitRules: '我们如何一起工作', portraitRulesHint: 'xopc 在帮助你时应该遵循的约定。',
    reviewWaiting: '条等待你确认', seeAll: '查看全部', addFirstUnderstanding: '还没有已确认的理解。你可以直接告诉 xopc 什么对你重要，或在它形成建议后确认。', addFirstRule: '还没有协作约定。添加后，xopc 会更像你熟悉的搭档。',
    portraitControl: '这份画像如何更新', portraitControlHint: '管理理解从哪里来、如何复核，以及哪些内容永远不会被保留。', portraitLearn: '了解这份画像如何形成', advanced: '画像管理', backToPortrait: '返回你的画像',
    controlSourcesHint: '查看哪些对话、连接与明确告知的内容塑造了 xopc 的理解。', controlReviewHint: '决定 xopc 如何提出更新，以及哪些变化需要你确认。', controlPrivacyHint: '设定敏感内容与长期保留的边界。', controlTrust: '推断出的理解不会自动生效。你可以随时复核、修正或删除。',
    profileHint: '由你直接提供的事实，会在不同对话中使用。', done: '完成', required: '此项不能为空。',
    callName: '希望 xopc 如何称呼你？', callNamePlaceholder: '例如：Mic、Joyce、张老师',
    role: '你的角色', rolePlaceholder: '例如：产品设计师、创业者、工程师',
    primaryGoal: '你目前最想达成什么？', primaryGoalPlaceholder: '希望 xopc 优先帮助你实现的结果',
    pronouns: '代词（可选）', pronounsPlaceholder: '例如：she/her、he/him、they/them',
    timezone: '时区', locale: '语言 / 地区', detect: '使用本机时区',
    understoodHint: '从对话和工作中形成、可复核的理解。推断内容在你确认前保持待审核。',
    addUnderstanding: '添加理解', statement: '希望 xopc 了解什么？', kind: '类型', add: '添加', cancel: '取消',
    active: '使用中', review: '待审核', confirm: '确认', reject: '不正确', edit: '编辑', delete: '删除', confirmDelete: '确认删除',
    rulesHint: '你明确设定的协作方式。协作约定的优先级高于推断出的理解。',
    addRule: '添加约定', ruleStatement: '希望 xopc 如何与你协作？', category: '类别', disable: '停用', enable: '启用',
    emptyUnderstanding: '还没有内容。你可以直接告诉 xopc，或在它学到建议后进行确认。', emptyRules: '还没有协作约定。',
    qualityTitle: '学习质量', qualityActive: '已确认', qualityPending: '待审核', qualityAcceptance: '30 天采纳率', qualityRecall: '有效召回', qualitySourceCoverage: '来源覆盖率', qualityBootstrapTime: '首次同步中位耗时', qualityNoData: '反馈数据还不足',
    sourceExplicit: '由你直接告知', sourceInferred: '推断内容，可能有误', sourceObserved: '从过往工作中观察到',
    sourcesHint: '查看每项授权最近一次学习结果、访问方式与保留策略；撤销后将停止后续学习。', manageSources: '连接其他来源', authorizedSources: '已授权数据来源', connectorsTitle: '连接器', openConnector: '打开连接器', noSources: '尚未授权任何来源。', noConnectors: '尚未安装连接器。', connected: '已连接', unavailable: '需要处理', revoke: '撤销来源', revokeHint: '撤销此来源并删除由它产生的理解', confirmRevoke: '确认撤销', revoking: '正在撤销…', revokeDone: '已撤销来源并删除派生理解。', refresh: '更新', refreshing: '正在更新…', refreshStarted: '更新任务已开始。', actionFailed: '操作失败', once: '仅一次', continuous: '持续更新', localOnly: '仅本地处理', derivedOnly: '仅保留派生理解', sourceQueued: '等待中', sourceRunning: '正在理解', sourceCompleted: '理解完成', sourcePartial: '部分完成', sourceFailed: '理解失败', sourceNotRun: '尚未采集', sourceItems: '项已检查', sourceCandidates: '项候选理解', sourceAccountUnavailable: '连接的账号不可用，请重新连接后重试。', sourceSyncFailed: '该来源同步失败，请再次更新。', sourceAnalysisFailed: '内容已采集，但深入理解未完成，请稍后重试。',
    focuses: '当前关注', focusHint: '候选关注不会自动生效，只有你确认后才会启用。', activate: '启用', pause: '暂停', complete: '完成', noFocuses: '还没有候选关注。', focusCandidate: '待确认', focusActive: '进行中', focusPaused: '已暂停', focusCompleted: '已完成', confidence: '置信度', confidenceHigh: '高', confidenceMedium: '中', confidenceLow: '低',
    contentReadTitle: '补充深入读取', contentReadHint: '这些条目还需要正文才能形成有用上下文。你可以选择最多 5 项进行一次有界读取。', readSelected: '读取所选内容', reading: '正在读取…', contentReadDone: '已读取并索引所选内容。',
    dreamingHint: '每天进行一次确定性复核，检查过期、矛盾证据和得到佐证的候选理解；推断内容不会自动生效。', mode: '后台复核', on: '开启并生成待审核项', off: '关闭', reviewTime: '每日复核时间', evidenceThreshold: '所需支持证据数', scanLimit: '每次最多检查', lastRun: '最近一次复核', neverRun: '尚未运行', runCompleted: '已完成', runFailed: '失败', runRunning: '运行中', runItems: '项',
    privacyHint: '选择通用记忆服务如何处理敏感内容；结构化用户理解有独立且更严格的规则。', sensitivePolicy: '敏感记忆写入', policyDeny: '不保存', policyConfirm: '保存前询问', policyAllow: '相关时允许保存', privacyWarning: '无论这里如何设置，秘密和受监管内容都不会保存为结构化用户理解。',
    error: '无法加载用户上下文。', retry: '重试',
  },
} as const;

const kindLabels: Record<UnderstandingKind, { en: string; zh: string }> = {
  preference: { en: 'Preference', zh: '偏好' }, boundary: { en: 'Boundary', zh: '边界' },
  relationship: { en: 'Relationship', zh: '关系' }, routine: { en: 'Routine', zh: '习惯' },
  current_state: { en: 'Current state', zh: '当前状态' }, long_term_goal: { en: 'Long-term goal', zh: '长期目标' },
  project_context: { en: 'Project context', zh: '项目背景' }, task_lesson: { en: 'Task lesson', zh: '任务经验' },
  derived_insight: { en: 'Insight', zh: '洞察' },
};
const ruleLabels: Record<CollaborationRule['category'], { en: string; zh: string }> = {
  communication: { en: 'Communication', zh: '沟通' }, execution: { en: 'Execution', zh: '执行' },
  boundary: { en: 'Boundary', zh: '边界' }, routine: { en: 'Routine', zh: '习惯' },
  proactive: { en: 'Proactive help', zh: '主动协助' },
};

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-edge bg-surface-panel p-4 sm:p-5">{children}</section>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-edge px-5 py-10 text-center text-sm text-fg-muted">{children}</div>;
}

function AddItemDialog({ open, onOpenChange, title, description, submitLabel, cancelLabel, submitDisabled, onSubmit, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  cancelLabel: string;
  submitDisabled?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  children: React.ReactNode;
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] h-[min(30rem,calc(100vh-2rem))] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
        <form className="flex h-full min-h-0 flex-col" onSubmit={onSubmit}>
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4">
            <div className="min-w-0"><Dialog.Title className="text-base font-semibold text-fg">{title}</Dialog.Title><Dialog.Description className="mt-1 text-xs leading-5 text-fg-muted">{description}</Dialog.Description></div>
            <Dialog.Close asChild><Button type="button" variant="ghost" className="size-8 shrink-0 p-0" aria-label={cancelLabel}><X className="size-4" /></Button></Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">{children}</div>
          <footer className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-3">
            <Dialog.Close asChild><Button type="button">{cancelLabel}</Button></Dialog.Close>
            <Button type="submit" variant="primary" disabled={submitDisabled}>{submitLabel}</Button>
          </footer>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function draftSignature(value: unknown): string {
  return JSON.stringify(value);
}

function useSyncedDraft<T>(source: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [draft, setDraft] = useState(source);
  const baselineSignatureRef = useRef(draftSignature(source));
  const sourceSignature = draftSignature(source);

  useEffect(() => {
    if (sourceSignature === baselineSignatureRef.current) return;
    const previousBaseline = baselineSignatureRef.current;
    baselineSignatureRef.current = sourceSignature;
    setDraft((current) => draftSignature(current) === previousBaseline ? source : current);
  }, [source, sourceSignature]);

  return [draft, setDraft];
}

type UserProfileDraft = Pick<UserProfile, 'callName' | 'role' | 'primaryGoal' | 'pronouns' | 'timezone' | 'locale'>;

function toUserProfileDraft(profile: UserProfile): UserProfileDraft {
  return {
    callName: profile.callName,
    role: profile.role,
    primaryGoal: profile.primaryGoal,
    pronouns: profile.pronouns,
    timezone: profile.timezone,
    locale: profile.locale,
  };
}

export function UserContextPage() {
  const language = useLocaleStore((state) => state.language);
  const t = copy[language];
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab') as Tab | null;
  const tab = requestedTab && TABS.has(requestedTab) ? requestedTab : 'profile';
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const { data, error, isLoading, mutate } = useSWR<UserContextResponse>('/api/you', fetchUserContext);

  useEffect(() => {
    setPageHeader({ startExtra: null, main: <div><h1 className="text-base font-semibold text-fg">{t.title}</h1><p className="hidden text-xs text-fg-muted sm:block">{t.subtitle}</p></div>, end: null });
    return clearPageHeader;
  }, [clearPageHeader, setPageHeader, t]);

  if (isLoading) return <div className="space-y-4 p-4 sm:p-6"><Skeleton className="h-10 w-96 max-w-full" /><Skeleton className="h-72 rounded-2xl" /></div>;
  if (error || !data) return <div className="p-6"><Empty>{t.error} <button className="text-accent hover:underline" onClick={() => void mutate()}>{t.retry}</button></Empty></div>;

  const advancedTab = tab === 'sources' || tab === 'dreaming' || tab === 'privacy';
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6 lg:py-8">
      {advancedTab ? <div className="flex items-center gap-3 border-b border-edge pb-4">
        <Button variant="ghost" className="-ml-2" onClick={() => setParams({ tab: 'profile' })}><ChevronLeft className="size-4" />{t.backToPortrait}</Button>
        <span className="h-4 w-px bg-edge" aria-hidden="true" />
        <span className="text-sm font-medium text-fg-muted">{t.advanced}</span>
      </div> : <PageTabs
        ariaLabel={t.title}
        activeTab={tab}
        onChange={(next) => setParams({ tab: next })}
        items={[
          { id: 'profile', label: t.profile, icon: CircleUserRound },
          { id: 'understanding', label: t.understanding, icon: Brain, count: data.understandings.filter((item) => ['candidate', 'needs_review', 'stale'].includes(item.status)).length || undefined },
          { id: 'collaboration', label: t.collaboration, icon: Handshake },
        ]}
      />}
      {tab === 'profile' ? <PortraitOverview
        data={data}
        language={language}
        t={t}
        onNavigate={(next) => setParams({ tab: next })}
        onProfileChanged={(profile) => mutate((current) => current ? { ...current, profile } : current, { revalidate: false })}
      /> : null}
      {tab === 'understanding' ? <UnderstandingPanel items={data.understandings} quality={data.quality} language={language} t={t} onChanged={(understanding) => understanding ? mutate((current) => current ? { ...current, understandings: current.understandings.map((item) => item.id === understanding.id ? understanding : item) } : current, { revalidate: true }) : mutate()} /> : null}
      {tab === 'collaboration' ? <RulesPanel rules={data.rules} language={language} t={t} onChanged={() => mutate()} /> : null}
      {tab === 'sources' ? <SourcesPanel t={t} /> : null}
      {tab === 'dreaming' ? <DreamingPanel lastRun={data.consolidation?.lastRun ?? null} t={t} /> : null}
      {tab === 'privacy' ? <PrivacyPanel t={t} /> : null}
    </div>
  );
}

function PortraitOverview({ data, language, t, onNavigate, onProfileChanged }: {
  data: UserContextResponse;
  language: 'en' | 'zh';
  t: typeof copy.en | typeof copy.zh;
  onNavigate: (tab: Tab) => void;
  onProfileChanged: (profile: UserProfile) => Promise<unknown>;
}) {
  const [editingProfile, setEditingProfile] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const activeUnderstanding = data.understandings.filter((item) => item.status === 'active');
  const pendingUnderstanding = data.understandings.filter((item) => ['candidate', 'needs_review', 'stale'].includes(item.status));
  const activeRules = data.rules.filter((rule) => rule.status === 'active');
  const displayName = data.profile.callName.trim() || (language === 'zh' ? '你' : 'You');
  const initial = [...displayName][0]?.toLocaleUpperCase() ?? 'Y';

  return <div className="space-y-5">
    <section className="relative overflow-hidden rounded-3xl border border-edge bg-surface-panel">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" aria-hidden="true" />
      <div className="grid gap-8 px-5 py-7 sm:px-8 sm:py-9 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12 lg:px-10 lg:py-11">
        <div className="min-w-0">
          <div className="mb-7 flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-accent"><Sparkles className="size-3.5" />{t.portraitEyebrow}</div>
          <div className="flex items-center gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-edge bg-surface-muted text-2xl font-semibold text-fg sm:size-20 sm:text-3xl">{initial}</div>
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{displayName}</h2>
              <button className="mt-1 text-left text-sm text-fg-muted transition-colors hover:text-accent" onClick={() => setEditingProfile(true)}>{data.profile.role.trim() || t.roleMissing}</button>
            </div>
          </div>
          <p className="mt-7 max-w-2xl text-base leading-7 text-fg-muted">{t.portraitIntro}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-subtle">
            <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-success" />{t.maintainedTogether}</span>
            <button className="inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30" onClick={() => setControlsOpen(true)}><ShieldCheck className="size-3.5" />{t.youDecide}<span aria-hidden="true">·</span><span className="font-medium text-accent">{t.advanced}</span><ChevronRight className="size-3" /></button>
          </div>
        </div>
        <div className="flex flex-col justify-between rounded-2xl border border-edge bg-surface-base/70 p-5 sm:p-6">
          <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-fg-subtle">{t.direction}</p><p className={`mt-4 text-base leading-7 ${data.profile.primaryGoal.trim() ? 'text-fg' : 'text-fg-muted'}`}>{data.profile.primaryGoal.trim() || t.directionEmpty}</p></div>
          <div className="mt-8 flex flex-wrap gap-2">
            <Button variant="primary" asChild><Link to="/chat/new"><MessageCircle className="size-4" />{t.talkAboutMe}</Link></Button>
            <Button onClick={() => setEditingProfile(true)}><UserRoundPen className="size-4" />{t.editProfile}</Button>
          </div>
        </div>
      </div>
    </section>

    <div className="grid gap-5 lg:grid-cols-2">
      <PortraitSection
        icon={<Brain className="size-4" />}
        title={t.portraitUnderstanding}
        description={t.portraitUnderstandingHint}
        action={<button className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => onNavigate('understanding')}>{t.seeAll}<ChevronRight className="size-3.5" /></button>}
      >
        {pendingUnderstanding.length ? <button className="mb-4 flex w-full items-center justify-between rounded-xl border border-accent/20 bg-accent-soft px-3 py-2.5 text-left text-xs text-accent transition-colors hover:border-accent/40" onClick={() => onNavigate('understanding')}><span><Sparkles className="mr-1.5 inline size-3.5" />{pendingUnderstanding.length} {t.reviewWaiting}</span><ArrowUpRight className="size-3.5" /></button> : null}
        {activeUnderstanding.length ? <div className="space-y-1">{activeUnderstanding.slice(0, 4).map((item) => <div key={item.id} className="group flex gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-hover"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent/70" /><div className="min-w-0"><p className="text-sm leading-6 text-fg">{item.statement}</p><p className="mt-0.5 text-[11px] text-fg-subtle">{kindLabels[item.kind][language]}</p></div></div>)}</div> : <p className="py-5 text-sm leading-6 text-fg-muted">{t.addFirstUnderstanding}</p>}
      </PortraitSection>

      <PortraitSection
        icon={<Handshake className="size-4" />}
        title={t.portraitRules}
        description={t.portraitRulesHint}
        action={<button className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => onNavigate('collaboration')}>{t.seeAll}<ChevronRight className="size-3.5" /></button>}
      >
        {activeRules.length ? <div className="space-y-1">{activeRules.slice(0, 4).map((rule) => <div key={rule.id} className="flex gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-hover"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-fg-subtle" /><div className="min-w-0"><p className="text-sm leading-6 text-fg">{rule.statement}</p><p className="mt-0.5 text-[11px] text-fg-subtle">{ruleLabels[rule.category][language]}</p></div></div>)}</div> : <p className="py-5 text-sm leading-6 text-fg-muted">{t.addFirstRule}</p>}
      </PortraitSection>
    </div>

    <button className="group flex w-full items-center gap-4 rounded-2xl border border-edge bg-surface-panel px-5 py-4 text-left transition-colors hover:bg-surface-hover sm:px-6" onClick={() => setControlsOpen(true)}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-fg-muted"><Settings2 className="size-4" /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{t.portraitLearn}</span><span className="mt-0.5 block text-xs leading-5 text-fg-muted">{t.portraitControlHint}</span></span>
        <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
    </button>

    <EditProfileDialog open={editingProfile} onOpenChange={setEditingProfile} profile={data.profile} language={language} t={t} onChanged={onProfileChanged} />
    <PortraitControlDialog open={controlsOpen} onOpenChange={setControlsOpen} t={t} onNavigate={(next) => { setControlsOpen(false); onNavigate(next); }} />
  </div>;
}

function PortraitSection({ icon, title, description, action, children }: { icon: React.ReactNode; title: string; description: string; action: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-edge bg-surface-panel p-5 sm:p-6">
    <div className="flex items-start gap-3"><span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-fg-muted">{icon}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-fg">{title}</h3>{action}</div><p className="mt-1 text-xs leading-5 text-fg-muted">{description}</p></div></div>
    <div className="mt-4 border-t border-edge pt-3">{children}</div>
  </section>;
}

function PortraitControlDialog({ open, onOpenChange, t, onNavigate }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: typeof copy.en | typeof copy.zh;
  onNavigate: (tab: Extract<Tab, 'sources' | 'dreaming' | 'privacy'>) => void;
}) {
  const items: Array<{ tab: Extract<Tab, 'sources' | 'dreaming' | 'privacy'>; icon: React.ReactNode; label: string; description: string }> = [
    { tab: 'sources', icon: <Cable className="size-4" />, label: t.sources, description: t.controlSourcesHint },
    { tab: 'dreaming', icon: <Moon className="size-4" />, label: t.dreaming, description: t.controlReviewHint },
    { tab: 'privacy', icon: <ShieldCheck className="size-4" />, label: t.privacy, description: t.controlPrivacyHint },
  ];
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
    <Dialog.Content className="fixed inset-y-0 right-0 z-[90] h-full w-[min(30rem,100vw)] overflow-hidden border-l border-edge bg-surface-panel shadow-popover outline-none sm:rounded-l-2xl">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-5 sm:px-6 sm:py-6">
          <div className="min-w-0"><div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent"><Settings2 className="size-4" /></div><Dialog.Title className="text-lg font-semibold tracking-tight text-fg">{t.portraitControl}</Dialog.Title><Dialog.Description className="mt-2 text-sm leading-6 text-fg-muted">{t.portraitControlHint}</Dialog.Description></div>
          <Dialog.Close asChild><Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={t.cancel}><X className="size-4" /></Button></Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-3">{items.map((item) => <button key={item.tab} className="group flex w-full items-start gap-4 rounded-2xl border border-edge bg-surface-base p-4 text-left transition-colors hover:border-edge-strong hover:bg-surface-hover" onClick={() => onNavigate(item.tab)}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-fg-muted transition-colors group-hover:text-accent">{item.icon}</span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-fg">{item.label}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{item.description}</span></span>
            <ChevronRight className="mt-2.5 size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
          </button>)}</div>
          <div className="mt-6 flex gap-3 rounded-2xl bg-surface-muted p-4"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /><p className="text-xs leading-5 text-fg-muted">{t.controlTrust}</p></div>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

function EditProfileDialog({ open, onOpenChange, profile, language, t, onChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: UserProfile;
  language: 'en' | 'zh';
  t: typeof copy.en | typeof copy.zh;
  onChanged: (profile: UserProfile) => Promise<unknown>;
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[80] bg-scrim backdrop-blur-[2px]" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] h-[min(42rem,calc(100vh-2rem))] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-edge bg-surface-panel shadow-popover outline-none">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4 sm:px-6"><div><Dialog.Title className="text-base font-semibold text-fg">{t.editProfile}</Dialog.Title><Dialog.Description className="mt-1 text-xs leading-5 text-fg-muted">{t.profileHint}</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" className="size-8 shrink-0 p-0" aria-label={t.cancel}><X className="size-4" /></Button></Dialog.Close></header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6"><ProfilePanel profile={profile} language={language} t={t} onChanged={onChanged} bare /></div>
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

function ProfilePanel({ profile, language, t, onChanged, bare = false }: {
  profile: UserProfile;
  language: 'en' | 'zh';
  t: typeof copy.en | typeof copy.zh;
  onChanged: (profile: UserProfile) => Promise<unknown>;
  bare?: boolean;
}) {
  const sourceDraft = useMemo(() => toUserProfileDraft(profile), [profile]);
  const [draft, setDraft] = useSyncedDraft(sourceDraft);
  const autosave = useAutosave({
    value: draft,
    dirty: draftSignature(draft) !== draftSignature(sourceDraft),
    delayMs: 500,
    onSave: async (snapshot) => {
      const result = await updateUserProfile({ ...snapshot, accessibility: profile.accessibility });
      await onChanged(result.profile);
    },
  });
  const field = (key: 'callName' | 'role' | 'pronouns' | 'timezone' | 'locale', label: string, placeholder?: string) => (
    <label className="space-y-1.5 text-sm"><span className="font-medium text-fg">{label}</span><input className={inputClass} placeholder={placeholder} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /></label>
  );
  const content = <div onBlurCapture={autosave.onBlurCapture}>
    <div className="grid gap-4 sm:grid-cols-2">
      {field('callName', t.callName, t.callNamePlaceholder)}
      {field('role', t.role, t.rolePlaceholder)}
      <label className="space-y-1.5 text-sm sm:col-span-2"><span className="font-medium text-fg">{t.primaryGoal}</span><textarea className={inputClass} rows={3} placeholder={t.primaryGoalPlaceholder} value={draft.primaryGoal} onChange={(event) => setDraft((current) => ({ ...current, primaryGoal: event.target.value }))} /></label>
      {language === 'en' ? field('pronouns', t.pronouns, t.pronounsPlaceholder) : null}
      <label className="space-y-1.5 text-sm"><span className="font-medium text-fg">{t.timezone}</span><div className="flex gap-2"><input className={`${inputClass} min-w-0 flex-1`} value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))} /><Button className="shrink-0 whitespace-nowrap" onClick={() => setDraft((current) => ({ ...current, timezone: detectBrowserTimezone() }))}>{t.detect}</Button></div></label>
      {field('locale', t.locale)}
    </div>
    <div className="mt-5 flex justify-end"><AutosaveStatus status={autosave.status} error={autosave.error} /></div>
  </div>;
  if (bare) return content;
  return <Card><p className="mb-5 text-sm leading-6 text-fg-muted">{t.profileHint}</p>{content}</Card>;
}

function UnderstandingPanel({ items, quality, language, t, onChanged }: { items: UserUnderstanding[]; quality: UserUnderstandingQuality; language: 'en' | 'zh'; t: typeof copy.en | typeof copy.zh; onChanged: (understanding?: UserUnderstanding) => Promise<unknown> }) {
  const [adding, setAdding] = useState(false);
  const [statement, setStatement] = useState('');
  const [kind, setKind] = useState<UnderstandingKind>('preference');
  const active = useMemo(() => items.filter((item) => item.status === 'active'), [items]);
  const review = useMemo(() => items.filter((item) => ['candidate', 'needs_review', 'stale'].includes(item.status)), [items]);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!statement.trim()) return; await createUnderstanding({ statement, kind }); setStatement(''); setAdding(false); await onChanged(); };
  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-4"><p className="max-w-2xl text-sm leading-6 text-fg-muted">{t.understoodHint}</p><Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" />{t.addUnderstanding}</Button></div>
    <AddItemDialog open={adding} onOpenChange={setAdding} title={t.addUnderstanding} description={t.understoodHint} submitLabel={t.add} cancelLabel={t.cancel} submitDisabled={!statement.trim()} onSubmit={submit}>
      <label className="block space-y-1.5 text-sm"><span className="font-medium text-fg">{t.statement}</span><textarea autoFocus className={inputClass} rows={4} placeholder={t.statement} value={statement} onChange={(event) => setStatement(event.target.value)} /></label>
      <label className="block space-y-1.5 text-sm"><span className="font-medium text-fg">{t.kind}</span><Select value={kind} onChange={(event) => setKind(event.target.value as UnderstandingKind)}>{Object.entries(kindLabels).map(([value, label]) => <SelectOption key={value} value={value}>{label[language]}</SelectOption>)}</Select></label>
    </AddItemDialog>
    <UnderstandingQualitySummary quality={quality} t={t} />
    <FocusPanel t={t} />
    {review.length ? <section className="space-y-2"><h2 className="text-sm font-semibold text-fg">{t.review} · {review.length}</h2><div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-panel">{review.map((item) => <UnderstandingItemCard key={item.id} item={item} language={language} t={t} onChanged={onChanged} />)}</div></section> : null}
    <section className="space-y-2"><h2 className="text-sm font-semibold text-fg">{t.active} · {active.length}</h2>{active.length ? <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-panel">{active.map((item) => <UnderstandingItemCard key={item.id} item={item} language={language} t={t} onChanged={onChanged} />)}</div> : <Empty>{t.emptyUnderstanding}</Empty>}</section>
  </div>;
}

function UnderstandingQualitySummary({ quality, t }: {
  quality: UserUnderstandingQuality;
  t: typeof copy.en | typeof copy.zh;
}) {
  const rate = (value: number | null) => value == null ? t.qualityNoData : `${Math.round(value * 100)}%`;
  const values = [
    [t.qualityActive, String(quality.records.active)],
    [t.qualityPending, String(quality.records.candidate + quality.records.needsReview)],
    [t.qualityAcceptance, rate(quality.decisions.acceptanceRate)],
    [t.qualityRecall, rate(quality.recall.helpfulRate)],
    [t.qualitySourceCoverage, rate(quality.quickUnderstanding.sourceCoverage)],
    [t.qualityBootstrapTime, quality.quickUnderstanding.medianBootstrapDurationMs == null
      ? t.qualityNoData
      : `${(quality.quickUnderstanding.medianBootstrapDurationMs / 1_000).toFixed(1)}s`],
  ];
  return <section className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-surface-muted px-3 py-2.5">
    <h2 className="text-xs font-medium text-fg-muted">{t.qualityTitle}</h2>
    {values.map(([label, value]) => <div key={label} className="flex items-baseline gap-1.5 text-xs"><span className="text-fg-subtle">{label}</span><span className="font-semibold text-fg">{value}</span></div>)}
  </section>;
}

function UnderstandingItemCard({ item, language, t, onChanged }: {
  item: UserUnderstanding;
  language: 'en' | 'zh';
  t: typeof copy.en | typeof copy.zh;
  onChanged: (understanding?: UserUnderstanding) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useSyncedDraft(item.statement);
  const autosave = useAutosave({
    value: draft,
    dirty: draft !== item.statement,
    enabled: editing,
    delayMs: 500,
    validate: (statement) => statement.trim() ? null : t.required,
    onSave: async (statement) => {
      const result = await updateUnderstanding(item.id, { statement });
      await onChanged(result.understanding);
    },
  });

  return <article className="px-4 py-3 sm:px-5">
    <div onBlurCapture={autosave.onBlurCapture}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4"><div className="min-w-0 flex-1">
        {editing ? <textarea autoFocus className={inputClass} value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} /> : <p className="text-sm leading-6 text-fg">{draft}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle"><span>{kindLabels[item.kind][language]}</span><span>·</span><span>{item.explicitness === 'explicit' ? t.sourceExplicit : item.explicitness === 'observed' ? t.sourceObserved : t.sourceInferred}</span></div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
        {editing ? <Button variant="ghost" onClick={() => { autosave.flush(); setEditing(false); }}>{t.done}</Button> : <Button variant="ghost" onClick={() => setEditing(true)}><Pencil className="size-3.5" />{t.edit}</Button>}
        {item.status !== 'active' ? <><Button variant="primary" onClick={async () => { const result = await updateUnderstanding(item.id, { status: 'active' }); await onChanged(result.understanding); }}>{t.confirm}</Button><Button onClick={async () => { const result = await updateUnderstanding(item.id, { status: 'rejected' }); await onChanged(result.understanding); }}>{t.reject}</Button></> : null}
        <Button variant="ghost" className="text-danger" onClick={async () => { if (!deleting) { setDeleting(true); return; } await deleteUnderstanding(item.id); setDeleting(false); await onChanged(); }}><Trash2 className="size-3.5" />{deleting ? t.confirmDelete : t.delete}</Button>
      </div></div>
      {editing || autosave.status !== 'idle' ? <AutosaveStatus className="mt-2" status={autosave.status} error={autosave.error} /> : null}
    </div>
  </article>;
}

function FocusPanel({ t }: { t: typeof copy.en | typeof copy.zh }) {
  const { data, error, isLoading, mutate } = useSWR<UserFocus[]>('you-focuses', fetchUserFocuses);
  const [deleting, setDeleting] = useState<string | null>(null);
  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (error) return <Empty>{t.error}</Empty>;
  const focuses = (data ?? []).filter((focus) => focus.status !== 'rejected');
  const statusLabel = (status: UserFocus['status']) => status === 'candidate' ? t.focusCandidate : status === 'active' ? t.focusActive : status === 'paused' ? t.focusPaused : t.focusCompleted;
  const confidenceLabel = (confidence: number) => confidence >= 0.85 ? t.confidenceHigh : confidence >= 0.65 ? t.confidenceMedium : t.confidenceLow;
  return <section className="space-y-2">
    <div><h2 className="text-sm font-semibold text-fg">{t.focuses} · {focuses.length}</h2><p className="mt-1 text-xs leading-5 text-fg-muted">{t.focusHint}</p></div>
    {focuses.length ? <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-panel">{focuses.map((focus) => <article key={focus.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-fg">{focus.title}</p><span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">{statusLabel(focus.status)}</span><span className="text-[11px] text-fg-subtle">{t.confidence} · {confidenceLabel(focus.confidence)}</span></div><p className="mt-1 text-sm leading-5 text-fg-muted">{focus.summary}</p></div>
      <div className="flex shrink-0 flex-wrap gap-1 sm:justify-end">
        {focus.status !== 'active' ? <Button variant="primary" onClick={async () => { await updateUserFocusStatus(focus.id, 'active'); await mutate(); }}>{t.activate}</Button> : <Button onClick={async () => { await updateUserFocusStatus(focus.id, 'paused'); await mutate(); }}>{t.pause}</Button>}
        <Button variant="ghost" onClick={async () => { await updateUserFocusStatus(focus.id, 'completed'); await mutate(); }}>{t.complete}</Button>
        {focus.status === 'candidate' ? <Button variant="ghost" className="text-danger" onClick={async () => { await updateUserFocusStatus(focus.id, 'rejected'); await mutate(); }}>{t.reject}</Button> : null}
        <Button variant="ghost" className="text-danger" onClick={async () => { if (deleting !== focus.id) { setDeleting(focus.id); return; } await deleteUserFocus(focus.id); setDeleting(null); await mutate(); }}><Trash2 className="size-3.5" />{deleting === focus.id ? t.confirmDelete : t.delete}</Button>
      </div>
    </article>)}</div> : <Empty>{t.noFocuses}</Empty>}
  </section>;
}

function RulesPanel({ rules, language, t, onChanged }: { rules: CollaborationRule[]; language: 'en' | 'zh'; t: typeof copy.en | typeof copy.zh; onChanged: () => Promise<unknown> }) {
  const [adding, setAdding] = useState(false);
  const [statement, setStatement] = useState('');
  const [category, setCategory] = useState<CollaborationRule['category']>('communication');
  const [deleting, setDeleting] = useState<string | null>(null);
  const visibleRules = rules.filter((rule) => rule.status !== 'archived');
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!statement.trim()) return; await createCollaborationRule({ statement, category }); setStatement(''); setAdding(false); await onChanged(); };
  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-4"><p className="max-w-2xl text-sm leading-6 text-fg-muted">{t.rulesHint}</p><Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" />{t.addRule}</Button></div>
    <AddItemDialog open={adding} onOpenChange={setAdding} title={t.addRule} description={t.rulesHint} submitLabel={t.add} cancelLabel={t.cancel} submitDisabled={!statement.trim()} onSubmit={submit}>
      <label className="block space-y-1.5 text-sm"><span className="font-medium text-fg">{t.ruleStatement}</span><textarea autoFocus className={inputClass} rows={4} placeholder={t.ruleStatement} value={statement} onChange={(event) => setStatement(event.target.value)} /></label>
      <label className="block space-y-1.5 text-sm"><span className="font-medium text-fg">{t.category}</span><Select value={category} onChange={(event) => setCategory(event.target.value as CollaborationRule['category'])}>{Object.entries(ruleLabels).map(([value, label]) => <SelectOption key={value} value={value}>{label[language]}</SelectOption>)}</Select></label>
    </AddItemDialog>
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-fg">{t.collaboration} · {visibleRules.length}</h2>
      {visibleRules.length ? <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-panel">{visibleRules.map((rule) => <article key={rule.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
        <div className="min-w-0 flex-1"><p className={`text-sm leading-6 ${rule.status === 'disabled' ? 'text-fg-subtle line-through' : 'text-fg'}`}>{rule.statement}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle"><span>{ruleLabels[rule.category][language]}</span><span>·</span><span>P{rule.priority}</span>{rule.status === 'disabled' ? <><span>·</span><span>{t.disable}</span></> : null}</div></div>
        <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end"><Button variant="ghost" onClick={async () => { await updateCollaborationRule(rule.id, { status: rule.status === 'active' ? 'disabled' : 'active' }); await onChanged(); }}>{rule.status === 'active' ? t.disable : t.enable}</Button><Button variant="ghost" className="text-danger" onClick={async () => { if (deleting !== rule.id) { setDeleting(rule.id); return; } await deleteCollaborationRule(rule.id); setDeleting(null); await onChanged(); }}><Trash2 className="size-3.5" />{deleting === rule.id ? t.confirmDelete : t.delete}</Button></div>
      </article>)}</div> : <Empty>{t.emptyRules}</Empty>}
    </section>
  </div>;
}

type SourcesPanelData = {
  grants: UnderstandingSourceGrant[];
  latestRuns: Record<string, UnderstandingSourceRun>;
  connectors: ConnectorInstance[];
  catalog: ConnectorDefinition[];
};

async function fetchSourcesPanelData(): Promise<SourcesPanelData> {
  const [overview, connectors, catalog] = await Promise.all([fetchUnderstandingSourceOverview(), fetchConnectorInstances(), fetchConnectorCatalog()]);
  return { ...overview, connectors, catalog };
}

function SourcesPanel({ t }: { t: typeof copy.en | typeof copy.zh }) {
  const { data, error, isLoading, mutate } = useSWR<SourcesPanelData>('you-understanding-sources', fetchSourcesPanelData, { refreshInterval: 5_000 });
  const { data: contentCandidates = [], mutate: mutateContentCandidates } = useSWR<ConnectedContentCandidate[]>(
    'you-connected-content-candidates',
    fetchConnectedContentCandidates,
  );
  const [runningAction, setRunningAction] = useState<{ grantId: string; kind: 'refresh' | 'revoke' } | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string[]>([]);
  const [readingContent, setReadingContent] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error) return <Empty>{t.error} <button className="text-accent hover:underline" onClick={() => void mutate()}>{t.retry}</button></Empty>;
  const grants = data?.grants ?? [];
  const instances = data?.connectors ?? [];
  const definitions = new Map((data?.catalog ?? []).map((definition) => [definition.id, definition]));
  const latestRuns = data?.latestRuns ?? {};
  const sourceRunLabel = (run: UnderstandingSourceRun | undefined) => !run ? t.sourceNotRun
    : run.status === 'completed' ? t.sourceCompleted
      : run.status === 'partial' ? t.sourcePartial
        : run.status === 'failed' || run.status === 'canceled' ? t.sourceFailed
          : run.status === 'running' ? t.sourceRunning : t.sourceQueued;
  const sourceRunTone = (run: UnderstandingSourceRun | undefined) => !run
    ? 'bg-surface-muted text-fg-muted'
    : run.status === 'completed' ? 'bg-success-soft text-success'
      : run.status === 'partial' ? 'bg-warning-soft text-warning'
        : run.status === 'failed' || run.status === 'canceled' ? 'bg-danger/10 text-danger'
          : 'bg-accent-soft text-accent-fg';
  const sourceRunError = (error: string | undefined) => error === 'connected_account_unavailable'
    ? t.sourceAccountUnavailable
    : error === 'connected_source_sync_failed' ? t.sourceSyncFailed
      : error === 'connected_source_analysis_failed' ? t.sourceAnalysisFailed : error;
  const definitionForGrant = (grant: UnderstandingSourceGrant) => {
    const normalizedName = grant.displayName.trim().toLocaleLowerCase();
    const matchingInstance = instances.find((instance) => instance.displayName.trim().toLocaleLowerCase() === normalizedName);
    if (matchingInstance) return definitions.get(matchingInstance.connectorId);
    return [...definitions.values()].find((definition) => (
      definition.displayName.trim().toLocaleLowerCase() === normalizedName
      || grant.sourceKey.toLocaleLowerCase().includes(definition.id.toLocaleLowerCase())
    ));
  };
  const actionError = (actionError: unknown) => `${t.actionFailed}: ${actionError instanceof Error ? actionError.message : String(actionError)}`;
  const refreshGrant = async (grant: UnderstandingSourceGrant) => {
    setFeedback(null);
    setConfirmingRevoke(null);
    setRunningAction({ grantId: grant.id, kind: 'refresh' });
    try {
      await refreshUnderstandingSourceGrant(grant.id);
      await mutate().catch(() => undefined);
      setFeedback({ tone: 'success', message: `${grant.displayName}: ${t.refreshStarted}` });
    } catch (refreshError) {
      setFeedback({ tone: 'error', message: actionError(refreshError) });
    } finally {
      setRunningAction(null);
    }
  };
  const revokeGrant = async (grant: UnderstandingSourceGrant) => {
    if (confirmingRevoke !== grant.id) {
      setConfirmingRevoke(grant.id);
      setFeedback(null);
      return;
    }
    setRunningAction({ grantId: grant.id, kind: 'revoke' });
    try {
      await revokeUnderstandingSourceGrant(grant.id);
      await mutate().catch(() => undefined);
      setConfirmingRevoke(null);
      setFeedback({ tone: 'success', message: `${grant.displayName}: ${t.revokeDone}` });
    } catch (revokeError) {
      setFeedback({ tone: 'error', message: actionError(revokeError) });
    } finally {
      setRunningAction(null);
    }
  };
  const readSelectedContent = async () => {
    if (!selectedContent.length) return;
    setReadingContent(true);
    setFeedback(null);
    try {
      const response = await readConnectedContent(selectedContent);
      if (response.result.failed.length) {
        setFeedback({ tone: 'error', message: response.result.failed.map((item) => item.error).join('; ') });
      } else {
        setFeedback({ tone: 'success', message: t.contentReadDone });
      }
      setSelectedContent([]);
      await mutateContentCandidates();
    } catch (contentError) {
      setFeedback({ tone: 'error', message: actionError(contentError) });
    } finally {
      setReadingContent(false);
    }
  };
  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-4"><p className="max-w-2xl text-sm leading-6 text-fg-muted">{t.sourcesHint}</p><Button asChild variant="primary"><Link to="/connectors?understanding=1&returnTo=%2Fyou%3Ftab%3Dsources">{t.manageSources}<ExternalLink className="size-4" /></Link></Button></div>
    {feedback ? <p role="status" aria-live="polite" className={`rounded-xl px-3 py-2 text-sm ${feedback.tone === 'success' ? 'bg-success-soft text-success' : 'bg-danger/10 text-danger'}`}>{feedback.message}</p> : null}
    <section className="space-y-2"><h2 className="text-sm font-semibold text-fg">{t.authorizedSources} · {grants.length}</h2>
      {grants.length ? <div className="grid gap-3 sm:grid-cols-2">{grants.map((grant) => {
        const definition = definitionForGrant(grant);
        const run = latestRuns[grant.id];
        const candidatesCreated = typeof run?.metadata.candidatesCreated === 'number' ? run.metadata.candidatesCreated : 0;
        const runError = sourceRunError(run?.errorMessage
          ?? (typeof run?.metadata.semanticError === 'string' ? run.metadata.semanticError : undefined));
        return <article key={grant.id} className="flex min-h-28 items-start gap-3 rounded-2xl border border-edge bg-surface-panel p-4">
          {definition ? <ConnectorLogo connector={definition} size="sm" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-base"><Database className="size-4 text-fg-muted" /></span>}
          <div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-2"><p className="truncate text-sm font-medium text-fg">{grant.displayName}</p><span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${sourceRunTone(run)}`}>{sourceRunLabel(run)}</span></div><p className="mt-1 text-xs leading-5 text-fg-subtle">{grant.accessMode === 'continuous' ? t.continuous : t.once} · {grant.processingPolicy === 'local_only' ? t.localOnly : grant.retentionPolicy === 'derived_only' ? t.derivedOnly : grant.retentionPolicy}</p>{run ? <p className="mt-1 text-xs text-fg-subtle">{run.itemsSeen} {t.sourceItems}{candidatesCreated ? ` · ${candidatesCreated} ${t.sourceCandidates}` : ''} · {new Date(run.completedAt ?? run.startedAt).toLocaleString()}</p> : grant.lastCollectedAt ? <p className="mt-1 text-xs text-fg-subtle">{new Date(grant.lastCollectedAt).toLocaleString()}</p> : null}{runError ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-danger" title={runError}>{runError}</p> : null}</div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">{grant.accessMode === 'continuous' ? <Button variant="ghost" disabled={runningAction !== null} aria-busy={runningAction?.grantId === grant.id && runningAction.kind === 'refresh'} onClick={() => void refreshGrant(grant)}>{runningAction?.grantId === grant.id && runningAction.kind === 'refresh' ? <><Loader2 className="size-4 animate-spin" />{t.refreshing}</> : t.refresh}</Button> : null}<Button variant="ghost" className="text-danger" title={t.revokeHint} aria-label={`${t.revoke}: ${grant.displayName}`} disabled={runningAction !== null} aria-busy={runningAction?.grantId === grant.id && runningAction.kind === 'revoke'} onClick={() => void revokeGrant(grant)}>{runningAction?.grantId === grant.id && runningAction.kind === 'revoke' ? <><Loader2 className="size-4 animate-spin" />{t.revoking}</> : confirmingRevoke === grant.id ? t.confirmRevoke : t.revoke}</Button></div>
        </article>;
      })}</div> : <Empty>{t.noSources}</Empty>}
    </section>
    {contentCandidates.length ? <section className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-sm font-semibold text-fg">{t.contentReadTitle}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-fg-muted">{t.contentReadHint}</p></div><Button variant="primary" disabled={!selectedContent.length || readingContent} onClick={() => void readSelectedContent()}>{readingContent ? <><Loader2 className="size-4 animate-spin" />{t.reading}</> : `${t.readSelected} · ${selectedContent.length}`}</Button></div>
      <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-panel">{contentCandidates.map((candidate) => {
        const checked = selectedContent.includes(candidate.sourceItemId);
        const selectionFull = selectedContent.length >= 5 && !checked;
        return <label key={candidate.sourceItemId} className={`flex items-center gap-3 px-4 py-3 ${selectionFull ? 'opacity-50' : 'cursor-pointer hover:bg-surface-hover'}`}>
          <input type="checkbox" className="size-4 rounded border-edge accent-[var(--color-accent)]" checked={checked} disabled={selectionFull || readingContent} onChange={(event) => setSelectedContent((current) => event.target.checked ? [...current, candidate.sourceItemId] : current.filter((id) => id !== candidate.sourceItemId))} />
          <div className="min-w-0 flex-1"><p className="truncate text-sm text-fg">{candidate.title}</p><p className="mt-0.5 text-xs text-fg-subtle">{candidate.toolkit === 'gmail' ? 'Gmail' : 'Google Drive'}{candidate.occurredAt ? ` · ${new Date(candidate.occurredAt).toLocaleDateString()}` : ''}</p></div>
        </label>;
      })}</div>
    </section> : null}
    <section className="space-y-2"><h2 className="text-sm font-semibold text-fg">{t.connectorsTitle} · {instances.length}</h2>
      {instances.length ? <div className="grid gap-3 sm:grid-cols-2">{instances.map((instance) => {
        const ready = instance.enabled && (instance.status === 'connected' || instance.connectionStatus === 'connected' || instance.authStatus === 'connected');
        const definition = definitions.get(instance.connectorId);
        return <Link key={instance.instanceId} to={`/connectors?tab=connected&instance=${encodeURIComponent(instance.instanceId)}`} aria-label={`${t.openConnector}: ${instance.displayName}`} className="group flex min-h-24 items-center gap-3 rounded-2xl border border-edge bg-surface-panel p-4 transition-colors hover:border-edge-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <ConnectorLogo connector={definition ?? { displayName: instance.displayName }} />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-fg">{instance.displayName}</p><p className="mt-1 truncate text-xs text-fg-subtle">{instance.connectorId}</p></div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${ready ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>{ready ? t.connected : t.unavailable}</span>
          <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
        </Link>;
      })}</div> : <Empty>{t.noConnectors}</Empty>}
    </section>
  </div>;
}

function DreamingPanel({ lastRun, t }: { lastRun: ContextConsolidationRun | null; t: typeof copy.en | typeof copy.zh }) {
  const { data, error, isLoading, mutate } = useSWR<UserContextSettings>('you-context-settings', fetchUserContextSettings);
  const sourceDraft = data?.dreaming ?? null;
  const [draft, setDraft] = useSyncedDraft<UserContextSettings['dreaming'] | null>(sourceDraft);
  const autosave = useAutosave<UserContextSettings['dreaming']>({
    value: draft,
    dirty: Boolean(draft && sourceDraft && draftSignature(draft) !== draftSignature(sourceDraft)),
    delayMs: 500,
    onSave: async (snapshot) => {
      await updateUserContextSettings({ dreaming: snapshot });
      await mutate();
    },
  });
  if (error) return <Empty>{t.error} <button className="text-accent hover:underline" onClick={() => void mutate()}>{t.retry}</button></Empty>;
  if (isLoading || !draft) return <Skeleton className="h-72 rounded-2xl" />;
  const runStatus = lastRun?.status === 'completed' ? t.runCompleted : lastRun?.status === 'failed' ? t.runFailed : t.runRunning;
  return <div className="space-y-5">
    <p className="max-w-2xl text-sm leading-6 text-fg-muted">{t.dreamingHint}</p>
    <Card><div onBlurCapture={autosave.onBlurCapture}><div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1.5 text-sm"><span className="font-medium text-fg">{t.mode}</span><Select value={draft.mode} onChange={(event) => setDraft((current) => current ? { ...current, mode: event.target.value as 'off' | 'review' } : current)}><SelectOption value="review">{t.on}</SelectOption><SelectOption value="off">{t.off}</SelectOption></Select></label>
      <label className="space-y-1.5 text-sm"><span className="font-medium text-fg">{t.reviewTime}</span><input type="time" className={inputClass} value={draft.schedule.time} onChange={(event) => setDraft((current) => current ? { ...current, schedule: { time: event.target.value } } : current)} /></label>
      <label className="space-y-1.5 text-sm sm:col-span-2"><span className="font-medium text-fg">{t.timezone}</span><div className="flex gap-2"><TabCompletionInput className={`${inputClass} min-w-0 flex-1`} value={draft.timezone ?? ''} placeholder={detectBrowserTimezone()} suggestion={detectBrowserTimezone()} onAcceptSuggestion={(timezone) => setDraft((current) => current ? { ...current, timezone } : current)} onChange={(event) => setDraft((current) => current ? { ...current, timezone: event.target.value || undefined } : current)} /><Button className="shrink-0 whitespace-nowrap" onClick={() => setDraft((current) => current ? { ...current, timezone: detectBrowserTimezone() } : current)}>{t.detect}</Button></div></label>
      <label className="space-y-1.5 text-sm"><span className="font-medium text-fg">{t.evidenceThreshold}</span><input type="number" min={2} max={10} className={inputClass} value={draft.minEvidenceSources} onChange={(event) => setDraft((current) => current ? { ...current, minEvidenceSources: Number(event.target.value) } : current)} /></label>
      <label className="space-y-1.5 text-sm"><span className="font-medium text-fg">{t.scanLimit}</span><input type="number" min={1} max={2000} className={inputClass} value={draft.limit} onChange={(event) => setDraft((current) => current ? { ...current, limit: Number(event.target.value) } : current)} /></label>
    </div><div className="mt-5 flex justify-end"><AutosaveStatus status={autosave.status} error={autosave.error} /></div></div></Card>
    <Card><p className="text-sm font-medium text-fg">{t.lastRun}</p>{lastRun ? <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-muted"><span>{runStatus}</span><span>·</span><time>{new Date(lastRun.startedAt).toLocaleString()}</time>{typeof lastRun.metrics.scanned === 'number' ? <><span>·</span><span>{String(lastRun.metrics.scanned)} {t.runItems}</span></> : null}</div> : <p className="mt-2 text-sm text-fg-muted">{t.neverRun}</p>}</Card>
  </div>;
}

function PrivacyPanel({ t }: { t: typeof copy.en | typeof copy.zh }) {
  const { data, error, isLoading, mutate } = useSWR<UserContextSettings>('you-context-settings', fetchUserContextSettings);
  const sourcePolicy = data?.privacy.sensitiveWritePolicy ?? null;
  const [policy, setPolicy] = useSyncedDraft<UserContextSettings['privacy']['sensitiveWritePolicy'] | null>(sourcePolicy);
  const autosave = useAutosave<UserContextSettings['privacy']['sensitiveWritePolicy']>({
    value: policy,
    dirty: Boolean(policy && sourcePolicy && policy !== sourcePolicy),
    delayMs: 350,
    onSave: async (sensitiveWritePolicy) => {
      await updateUserContextSettings({ privacy: { sensitiveWritePolicy } });
      await mutate();
    },
  });
  if (error) return <Empty>{t.error} <button className="text-accent hover:underline" onClick={() => void mutate()}>{t.retry}</button></Empty>;
  if (isLoading || !policy) return <Skeleton className="h-56 rounded-2xl" />;
  return <div className="space-y-5"><p className="max-w-2xl text-sm leading-6 text-fg-muted">{t.privacyHint}</p><Card><div onBlurCapture={autosave.onBlurCapture}><label className="block max-w-xl space-y-1.5 text-sm"><span className="font-medium text-fg">{t.sensitivePolicy}</span><Select value={policy} onChange={(event) => setPolicy(event.target.value as typeof policy)}><SelectOption value="deny">{t.policyDeny}</SelectOption><SelectOption value="confirm">{t.policyConfirm}</SelectOption><SelectOption value="allow">{t.policyAllow}</SelectOption></Select></label><p className="mt-3 max-w-2xl text-xs leading-5 text-fg-subtle">{t.privacyWarning}</p><div className="mt-5 flex justify-end"><AutosaveStatus status={autosave.status} error={autosave.error} /></div></div></Card></div>;
}
