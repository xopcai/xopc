import { Brain, Cable, CircleUserRound, ExternalLink, Handshake, Moon, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { AutosaveStatus } from '@/components/ui/autosave-status';
import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAutosave } from '@/lib/use-autosave';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { fetchConnectorInstances, type ConnectorInstance } from '@/features/connectors/connectors-api';
import {
  createCollaborationRule, createUnderstanding, deleteCollaborationRule,
  deleteUnderstanding, detectBrowserTimezone, fetchUserContext, fetchUserContextSettings,
  fetchUnderstandingSourceGrants, fetchUserFocuses,
  refreshUnderstandingSourceGrant,
  revokeUnderstandingSourceGrant,
  updateCollaborationRule, updateUnderstanding, updateUserProfile,
  updateUserFocusStatus,
  updateUserContextSettings,
  type ContextConsolidationRun,
  type CollaborationRule, type UnderstandingKind, type UserContextResponse,
  type UserContextSettings,
  type UnderstandingSourceGrant, type UserFocus, type UserProfile, type UserUnderstanding,
  type UserUnderstandingQuality,
} from './user-context-api';

type Tab = 'profile' | 'understanding' | 'collaboration' | 'sources' | 'dreaming' | 'privacy';
const TABS = new Set<Tab>(['profile', 'understanding', 'collaboration', 'sources', 'dreaming', 'privacy']);
const inputClass = 'w-full rounded-xl border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20';

const copy = {
  en: {
    title: 'About You', subtitle: 'What xopc knows, why it knows it, and how it should work with you.',
    profile: 'Profile', understanding: 'Understanding', collaboration: 'Working agreement', sources: 'Sources', dreaming: 'Background review', privacy: 'Privacy',
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
    qualityTitle: 'Learning quality', qualityActive: 'Confirmed', qualityPending: 'Pending review', qualityAcceptance: '30-day acceptance', qualityRecall: 'Helpful recall', qualityNoData: 'Not enough feedback yet',
    emptyRules: 'No working agreements yet.', sourceExplicit: 'You said this directly', sourceInferred: 'Inferred — may be wrong', sourceObserved: 'Observed across prior work',
    sourcesHint: 'Review every granted source, its access mode, retention, and last collection. Revoking stops future learning.', manageSources: 'Connect another source', noSources: 'No sources are authorized.', connected: 'Connected', unavailable: 'Needs attention', revoke: 'Revoke & remove derived', refresh: 'Refresh', once: 'One-time', continuous: 'Continuous', localOnly: 'Local only', derivedOnly: 'Derived understanding only',
    focuses: 'Current focuses', focusHint: 'Candidate focuses never activate until you confirm them.', activate: 'Activate', pause: 'Pause', complete: 'Complete', noFocuses: 'No focus candidates yet.',
    dreamingHint: 'A deterministic daily review checks expiry, contradictory evidence, and corroborated candidates. It never auto-activates an inference.', mode: 'Background review', on: 'On — propose for review', off: 'Off', reviewTime: 'Daily review time', evidenceThreshold: 'Supporting evidence required', scanLimit: 'Maximum items per run', lastRun: 'Last review', neverRun: 'Not run yet', runCompleted: 'Completed', runFailed: 'Failed', runRunning: 'Running', runItems: 'items',
    privacyHint: 'Choose how generic memory providers handle sensitive content. Structured user understanding applies stricter rules of its own.', sensitivePolicy: 'Sensitive memory writes', policyDeny: 'Do not store', policyConfirm: 'Ask before storing', policyAllow: 'Store when relevant', privacyWarning: 'Secret and regulated content is never stored as structured user understanding, regardless of this setting.',
    error: 'Could not load your context.', retry: 'Try again',
  },
  zh: {
    title: '关于你', subtitle: '清楚查看 xopc 知道什么、为什么知道，以及应该如何与你协作。',
    profile: '个人资料', understanding: '对你的理解', collaboration: '协作约定', sources: '数据来源', dreaming: '后台复核', privacy: '隐私',
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
    qualityTitle: '学习质量', qualityActive: '已确认', qualityPending: '待审核', qualityAcceptance: '30 天采纳率', qualityRecall: '有效召回', qualityNoData: '反馈数据还不足',
    sourceExplicit: '由你直接告知', sourceInferred: '推断内容，可能有误', sourceObserved: '从过往工作中观察到',
    sourcesHint: '查看每项授权的访问方式、保留策略和最近采集时间；撤销后将停止后续学习。', manageSources: '连接其他来源', noSources: '尚未授权任何来源。', connected: '已连接', unavailable: '需要处理', revoke: '撤销并删除派生理解', refresh: '立即更新', once: '仅一次', continuous: '持续更新', localOnly: '仅本地处理', derivedOnly: '仅保留派生理解',
    focuses: '当前关注', focusHint: '候选关注不会自动生效，只有你确认后才会启用。', activate: '启用', pause: '暂停', complete: '完成', noFocuses: '还没有候选关注。',
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

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
      <PageTabs
        ariaLabel={t.title}
        activeTab={tab}
        onChange={(next) => setParams({ tab: next })}
        items={[
          { id: 'profile', label: t.profile, icon: CircleUserRound },
          { id: 'understanding', label: t.understanding, icon: Brain, count: data.understandings.length },
          { id: 'collaboration', label: t.collaboration, icon: Handshake, count: data.rules.filter((rule) => rule.status === 'active').length },
          { id: 'sources', label: t.sources, icon: Cable },
          { id: 'dreaming', label: t.dreaming, icon: Moon },
          { id: 'privacy', label: t.privacy, icon: ShieldCheck },
        ]}
      />
      {tab === 'profile' ? <ProfilePanel profile={data.profile} language={language} t={t} onChanged={(profile) => mutate((current) => current ? { ...current, profile } : current, { revalidate: false })} /> : null}
      {tab === 'understanding' ? <UnderstandingPanel items={data.understandings} quality={data.quality} language={language} t={t} onChanged={(understanding) => understanding ? mutate((current) => current ? { ...current, understandings: current.understandings.map((item) => item.id === understanding.id ? understanding : item) } : current, { revalidate: true }) : mutate()} /> : null}
      {tab === 'collaboration' ? <RulesPanel rules={data.rules} language={language} t={t} onChanged={() => mutate()} /> : null}
      {tab === 'sources' ? <SourcesPanel t={t} /> : null}
      {tab === 'dreaming' ? <DreamingPanel lastRun={data.consolidation?.lastRun ?? null} t={t} /> : null}
      {tab === 'privacy' ? <PrivacyPanel t={t} /> : null}
    </div>
  );
}

function ProfilePanel({ profile, language, t, onChanged }: {
  profile: UserProfile;
  language: 'en' | 'zh';
  t: typeof copy.en | typeof copy.zh;
  onChanged: (profile: UserProfile) => Promise<unknown>;
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
  return <Card>
    <div onBlurCapture={autosave.onBlurCapture}>
      <p className="mb-5 text-sm leading-6 text-fg-muted">{t.profileHint}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('callName', t.callName, t.callNamePlaceholder)}
        {field('role', t.role, t.rolePlaceholder)}
        <label className="space-y-1.5 text-sm sm:col-span-2"><span className="font-medium text-fg">{t.primaryGoal}</span><textarea className={inputClass} rows={3} placeholder={t.primaryGoalPlaceholder} value={draft.primaryGoal} onChange={(event) => setDraft((current) => ({ ...current, primaryGoal: event.target.value }))} /></label>
        {language === 'en' ? field('pronouns', t.pronouns, t.pronounsPlaceholder) : null}
        <label className="space-y-1.5 text-sm"><span className="font-medium text-fg">{t.timezone}</span><div className="flex gap-2"><input className={`${inputClass} min-w-0 flex-1`} value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))} /><Button className="shrink-0 whitespace-nowrap" onClick={() => setDraft((current) => ({ ...current, timezone: detectBrowserTimezone() }))}>{t.detect}</Button></div></label>
        {field('locale', t.locale)}
      </div>
      <div className="mt-5 flex justify-end"><AutosaveStatus status={autosave.status} error={autosave.error} /></div>
    </div>
  </Card>;
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
    <UnderstandingQualitySummary quality={quality} t={t} />
    <FocusPanel t={t} />
    {adding ? <Card><form className="space-y-3" onSubmit={submit}><textarea autoFocus className={inputClass} rows={3} placeholder={t.statement} value={statement} onChange={(event) => setStatement(event.target.value)} /><Select value={kind} onChange={(event) => setKind(event.target.value as UnderstandingKind)}>{Object.entries(kindLabels).map(([value, label]) => <SelectOption key={value} value={value}>{label[language]}</SelectOption>)}</Select><div className="flex gap-2"><Button type="submit" variant="primary">{t.add}</Button><Button onClick={() => setAdding(false)}>{t.cancel}</Button></div></form></Card> : null}
    {review.length ? <section className="space-y-3"><h2 className="text-sm font-semibold text-fg">{t.review} · {review.length}</h2>{review.map((item) => <UnderstandingItemCard key={item.id} item={item} language={language} t={t} onChanged={onChanged} />)}</section> : null}
    <section className="space-y-3"><h2 className="text-sm font-semibold text-fg">{t.active} · {active.length}</h2>{active.length ? active.map((item) => <UnderstandingItemCard key={item.id} item={item} language={language} t={t} onChanged={onChanged} />) : <Empty>{t.emptyUnderstanding}</Empty>}</section>
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
  ];
  return <Card>
    <h2 className="text-sm font-semibold text-fg">{t.qualityTitle}</h2>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {values.map(([label, value]) => <div key={label} className="rounded-xl bg-surface-muted px-3 py-2.5"><p className="text-[11px] text-fg-subtle">{label}</p><p className="mt-1 text-sm font-semibold text-fg">{value}</p></div>)}
    </div>
  </Card>;
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

  return <Card>
    <div onBlurCapture={autosave.onBlurCapture}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2"><span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">{kindLabels[item.kind][language]}</span><span className="text-xs text-fg-subtle">{item.explicitness === 'explicit' ? t.sourceExplicit : item.explicitness === 'observed' ? t.sourceObserved : t.sourceInferred}</span></div>
        {editing ? <textarea autoFocus className={inputClass} value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} /> : <p className="text-sm leading-6 text-fg">{draft}</p>}
      </div></div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {editing ? <Button variant="ghost" onClick={() => { autosave.flush(); setEditing(false); }}>{t.done}</Button> : <Button variant="ghost" onClick={() => setEditing(true)}><Pencil className="size-3.5" />{t.edit}</Button>}
        {item.status !== 'active' ? <><Button variant="primary" onClick={async () => { const result = await updateUnderstanding(item.id, { status: 'active' }); await onChanged(result.understanding); }}>{t.confirm}</Button><Button onClick={async () => { const result = await updateUnderstanding(item.id, { status: 'rejected' }); await onChanged(result.understanding); }}>{t.reject}</Button></> : null}
        <Button variant="ghost" className="text-danger" onClick={async () => { if (!deleting) { setDeleting(true); return; } await deleteUnderstanding(item.id); setDeleting(false); await onChanged(); }}><Trash2 className="size-3.5" />{deleting ? t.confirmDelete : t.delete}</Button>
        {editing || autosave.status !== 'idle' ? <AutosaveStatus className="ml-auto" status={autosave.status} error={autosave.error} /> : null}
      </div>
    </div>
  </Card>;
}

function FocusPanel({ t }: { t: typeof copy.en | typeof copy.zh }) {
  const { data, error, isLoading, mutate } = useSWR<UserFocus[]>('you-focuses', fetchUserFocuses);
  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (error) return <Empty>{t.error}</Empty>;
  const focuses = (data ?? []).filter((focus) => focus.status !== 'rejected');
  return <section className="space-y-3">
    <div><h2 className="text-sm font-semibold text-fg">{t.focuses}</h2><p className="mt-1 text-xs leading-5 text-fg-muted">{t.focusHint}</p></div>
    {focuses.length ? focuses.map((focus) => <Card key={focus.id}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-fg">{focus.title}</p><span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-fg-muted">{focus.status}</span></div><p className="mt-2 text-sm leading-6 text-fg-muted">{focus.summary}</p></div><span className="text-xs tabular-nums text-fg-subtle">{Math.round(focus.confidence * 100)}%</span></div>
      <div className="mt-4 flex flex-wrap gap-2">
        {focus.status !== 'active' ? <Button variant="primary" onClick={async () => { await updateUserFocusStatus(focus.id, 'active'); await mutate(); }}>{t.activate}</Button> : <Button onClick={async () => { await updateUserFocusStatus(focus.id, 'paused'); await mutate(); }}>{t.pause}</Button>}
        <Button variant="ghost" onClick={async () => { await updateUserFocusStatus(focus.id, 'completed'); await mutate(); }}>{t.complete}</Button>
        {focus.status === 'candidate' ? <Button variant="ghost" className="text-danger" onClick={async () => { await updateUserFocusStatus(focus.id, 'rejected'); await mutate(); }}>{t.reject}</Button> : null}
      </div>
    </Card>) : <Empty>{t.noFocuses}</Empty>}
  </section>;
}

function RulesPanel({ rules, language, t, onChanged }: { rules: CollaborationRule[]; language: 'en' | 'zh'; t: typeof copy.en | typeof copy.zh; onChanged: () => Promise<unknown> }) {
  const [adding, setAdding] = useState(false);
  const [statement, setStatement] = useState('');
  const [category, setCategory] = useState<CollaborationRule['category']>('communication');
  const [deleting, setDeleting] = useState<string | null>(null);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!statement.trim()) return; await createCollaborationRule({ statement, category }); setStatement(''); setAdding(false); await onChanged(); };
  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-4"><p className="max-w-2xl text-sm leading-6 text-fg-muted">{t.rulesHint}</p><Button variant="primary" onClick={() => setAdding(true)}><Plus className="size-4" />{t.addRule}</Button></div>
    {adding ? <Card><form className="space-y-3" onSubmit={submit}><textarea autoFocus className={inputClass} rows={3} placeholder={t.ruleStatement} value={statement} onChange={(event) => setStatement(event.target.value)} /><Select value={category} onChange={(event) => setCategory(event.target.value as CollaborationRule['category'])}>{Object.entries(ruleLabels).map(([value, label]) => <SelectOption key={value} value={value}>{label[language]}</SelectOption>)}</Select><div className="flex gap-2"><Button type="submit" variant="primary">{t.add}</Button><Button onClick={() => setAdding(false)}>{t.cancel}</Button></div></form></Card> : null}
    {rules.length ? rules.filter((rule) => rule.status !== 'archived').map((rule) => <Card key={rule.id}><div className="flex items-start justify-between gap-4"><div><span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">{ruleLabels[rule.category][language]}</span><p className={`mt-3 text-sm leading-6 ${rule.status === 'disabled' ? 'text-fg-subtle line-through' : 'text-fg'}`}>{rule.statement}</p></div><span className="text-xs tabular-nums text-fg-subtle">P{rule.priority}</span></div><div className="mt-4 flex gap-2"><Button variant="ghost" onClick={async () => { await updateCollaborationRule(rule.id, { status: rule.status === 'active' ? 'disabled' : 'active' }); await onChanged(); }}>{rule.status === 'active' ? t.disable : t.enable}</Button><Button variant="ghost" className="text-danger" onClick={async () => { if (deleting !== rule.id) { setDeleting(rule.id); return; } await deleteCollaborationRule(rule.id); setDeleting(null); await onChanged(); }}><Trash2 className="size-3.5" />{deleting === rule.id ? t.confirmDelete : t.delete}</Button></div></Card>) : <Empty>{t.emptyRules}</Empty>}
  </div>;
}

type SourcesPanelData = { grants: UnderstandingSourceGrant[]; connectors: ConnectorInstance[] };

async function fetchSourcesPanelData(): Promise<SourcesPanelData> {
  const [grants, connectors] = await Promise.all([fetchUnderstandingSourceGrants(), fetchConnectorInstances()]);
  return { grants, connectors };
}

function SourcesPanel({ t }: { t: typeof copy.en | typeof copy.zh }) {
  const { data, error, isLoading, mutate } = useSWR<SourcesPanelData>('you-understanding-sources', fetchSourcesPanelData);
  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error) return <Empty>{t.error} <button className="text-accent hover:underline" onClick={() => void mutate()}>{t.retry}</button></Empty>;
  const grants = data?.grants ?? [];
  const instances = data?.connectors ?? [];
  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-4"><p className="max-w-2xl text-sm leading-6 text-fg-muted">{t.sourcesHint}</p><Button asChild variant="primary"><Link to="/connectors?understanding=1&returnTo=%2Fyou%3Ftab%3Dsources">{t.manageSources}<ExternalLink className="size-4" /></Link></Button></div>
    {grants.length ? <div className="grid gap-3 sm:grid-cols-2">{grants.map((grant) => <Card key={grant.id}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-fg">{grant.displayName}</p><p className="mt-1 text-xs text-fg-subtle">{grant.accessMode === 'continuous' ? t.continuous : t.once} · {grant.processingPolicy === 'local_only' ? t.localOnly : grant.retentionPolicy === 'derived_only' ? t.derivedOnly : grant.retentionPolicy}</p>{grant.lastCollectedAt ? <p className="mt-1 text-xs text-fg-subtle">{new Date(grant.lastCollectedAt).toLocaleString()}</p> : null}</div><div className="flex shrink-0 flex-col items-end gap-1">{grant.accessMode === 'continuous' ? <Button variant="ghost" onClick={async () => { await refreshUnderstandingSourceGrant(grant.id); await mutate(); }}>{t.refresh}</Button> : null}<Button variant="ghost" className="text-danger" onClick={async () => { await revokeUnderstandingSourceGrant(grant.id); await mutate(); }}>{t.revoke}</Button></div></div></Card>)}</div> : <Empty>{t.noSources}</Empty>}
    {instances.length ? <div className="grid gap-3 sm:grid-cols-2">{instances.map((instance) => {
      const ready = instance.enabled && (instance.status === 'connected' || instance.connectionStatus === 'connected' || instance.authStatus === 'connected');
      return <Card key={instance.instanceId}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-fg">{instance.displayName}</p><p className="mt-1 truncate text-xs text-fg-subtle">{instance.connectorId}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs ${ready ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>{ready ? t.connected : t.unavailable}</span></div></Card>;
    })}</div> : null}
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
      <label className="space-y-1.5 text-sm sm:col-span-2"><span className="font-medium text-fg">{t.timezone}</span><div className="flex gap-2"><input className={`${inputClass} min-w-0 flex-1`} value={draft.timezone ?? ''} placeholder={detectBrowserTimezone()} onChange={(event) => setDraft((current) => current ? { ...current, timezone: event.target.value || undefined } : current)} /><Button className="shrink-0 whitespace-nowrap" onClick={() => setDraft((current) => current ? { ...current, timezone: detectBrowserTimezone() } : current)}>{t.detect}</Button></div></label>
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
