import {
  Brain,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  CircleUserRound,
  Database,
  Download,
  HeartHandshake,
  History,
  Lightbulb,
  Moon,
  Pencil,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageTabs } from '@/components/ui/page-tabs';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { TimePicker } from '@/components/ui/time-picker';
import { setConnectionLearningPaused, startConnectionLearning } from '@/features/connectors/connectors-api';
import { detectBrowserTimezone } from '@/features/settings/agents/agent-profile-markdown';
import { UserProfileFieldsEditor } from '@/features/settings/user-profile-fields-editor';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { formatMediumDateTime } from '@/lib/date-formatters';
import { showToast } from '@/lib/toast';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import {
  fetchUserContext,
  createPersonalPlaybookRule,
  createUnderstanding,
  batchUpdateUnderstanding,
  deletePersonalPlaybookRule,
  decideReferenceConsent,
  exportUserContext,
  fetchUnderstandingHistory,
  disconnectPersonalContextSource,
  forgetUnderstanding,
  importUserContext,
  resolveUnderstandingConflict,
  revokeReferenceConsent,
  rollbackPersonalPlaybookRule,
  setPersonalPlaybookEnabled,
  updateInsightSuggestion,
  updateRelationshipSettings,
  updatePersonalPlaybookRule,
  updateUnderstanding,
  updateConnectedClaim,
  updateUserContextControls,
  updateUserProfile,
  updateUserProfilePrompt,
  updateUserTrust,
  type InsightSuggestion,
  type ConnectedClaim,
  type PersonalContextSource,
  type PersonalPlaybook,
  type RelationshipSettingsPatch,
  type UserContextFacet,
  type UserContextResponse,
  type UserProfileFields,
  type UserProfileSetup,
  type UserTrustLevel,
  type UserUnderstanding,
} from './user-context-api';
import { AboutYouExplainerDialog } from './about-you-explainer-dialog';
import { DreamingPanel } from './dreaming-panel';
import { SourceDisconnectDialog } from './source-disconnect-dialog';
import { SourcesPanel } from './sources-panel';
import { userContextViewFromTab, type UserContextViewId } from './user-context-navigation';

type MemorySection = 'profile' | 'review';
type UnderstandingKind = 'preference' | 'boundary' | 'relationship' | 'routine' | 'current_state' | 'long_term_goal';

const FACET_ORDER: UserContextFacet[] = ['collaboration', 'priorities', 'boundaries', 'people', 'current', 'basics'];
const OTHER_UNDERSTANDING_KINDS = ['relationship', 'routine', 'long_term_goal'] as const;
const inputClass = 'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/50 focus:ring-2 focus:ring-accent/20';

function replaceCount(template: string, count: number): string {
  return template.replace('{{count}}', String(count));
}

function ContextBadge({ children }: { children: ReactNode }) {
  return <span className="inline-flex rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">{children}</span>;
}

function formatDateTime(value: string, language: 'en' | 'zh'): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return formatMediumDateTime(timestamp, language);
}

function UserContextSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-24 rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}

function originLabel(item: UserUnderstanding, t: ReturnType<typeof messages>['you']): string {
  return item.origin === 'connected_source'
    ? t.origins.connected_source.replace('{{source}}', item.sourceName)
    : t.origins[item.origin];
}

function UnderstandingCard({
  item,
  language,
  t,
  busy,
  onConfirm,
  onReject,
  onUpdate,
  onForget,
}: {
  item: UserUnderstanding;
  language: 'en' | 'zh';
  t: ReturnType<typeof messages>['you'];
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onUpdate: (content: string) => void;
  onForget: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.statement);
  const [history, setHistory] = useState<Array<UserUnderstanding & { storedStatus: string }> | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const needsReview = item.status !== 'active';

  return (
    <article className={cn(
      'rounded-xl border p-3.5',
      needsReview ? 'border-warning/35 bg-warning-soft/35' : 'border-edge-subtle bg-surface-panel',
    )}>
      {editing ? (
        <div className="space-y-2">
          <textarea className={cn(inputClass, 'min-h-20 resize-y')} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t.updatePlaceholder} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => { setDraft(item.statement); setEditing(false); }}>{t.cancel}</Button>
            <Button type="button" variant="primary" className="h-8 px-2" disabled={busy || !draft.trim()} onClick={() => { onUpdate(draft.trim()); setEditing(false); }}>{t.save}</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm leading-6 text-fg">{item.statement}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
              <span className="inline-flex items-center gap-1"><Sparkles className="size-3 text-accent" aria-hidden />{originLabel(item, t)}</span>
              <span className="rounded-full bg-surface-hover px-2 py-0.5">{t.understandingScopes[item.scope.type]}</span>
              <span className="rounded-full bg-surface-hover px-2 py-0.5">{t.stability[item.stability]}</span>
              {item.evidenceCount > 0 ? <span>{replaceCount(t.evidenceCount, item.evidenceCount)}</span> : null}
              {item.latestEvidenceAt ? <span>{t.observedAt.replace('{{time}}', formatDateTime(item.latestEvidenceAt, language))}</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {needsReview ? (
                <>
                  <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onConfirm}><Check className="size-3.5" aria-hidden />{t.confirm}</Button>
                  <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onReject}><X className="size-3.5" aria-hidden />{t.notTrue}</Button>
                </>
              ) : null}
              <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={() => setEditing(true)}><Pencil className="size-3.5" aria-hidden />{t.change}</Button>
              <Button type="button" variant="ghost" className="h-8 px-2" disabled={historyLoading} onClick={() => { if (history) { setHistory(null); return; } setHistoryLoading(true); void fetchUnderstandingHistory(item.id).then((result) => setHistory(result.history)).finally(() => setHistoryLoading(false)); }}><History className="size-3.5" aria-hidden />{t.history}</Button>
              <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onForget}><Trash2 className="size-3.5" aria-hidden />{t.forget}</Button>
            </div>
          </div>
          <details className="mt-2 rounded-lg bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">
            <summary className="cursor-pointer font-medium text-fg-muted">{t.viewEvidence}</summary>
            <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
              <div><dt className="text-fg-subtle">{t.evidenceSource}</dt><dd className="mt-0.5 break-all text-fg-muted">{item.sourceName}</dd></div>
              {item.sourcePath ? <div><dt className="text-fg-subtle">{t.evidencePath}</dt><dd className="mt-0.5 break-all text-fg-muted">{item.sourcePath}</dd></div> : null}
              <div><dt className="text-fg-subtle">{t.evidenceUpdated}</dt><dd className="mt-0.5 text-fg-muted">{formatDateTime(item.updatedAt, language)}</dd></div>
              <div><dt className="text-fg-subtle">{t.evidenceSupport}</dt><dd className="mt-0.5 text-fg-muted">{replaceCount(t.evidenceCount, item.evidenceCount)}</dd></div>
              {item.evidenceBasis ? <div className="sm:col-span-2"><dt className="text-fg-subtle">{t.evidenceRule}</dt><dd className="mt-0.5 text-fg-muted">{t.evidenceRuleValue.replace('{{events}}', String(item.evidenceBasis.eventCount)).replace('{{days}}', String(item.evidenceBasis.activeDays)).replace('{{window}}', String(item.evidenceBasis.windowDays))}</dd></div> : null}
              {item.confidence === undefined ? null : <div><dt className="text-fg-subtle">{t.evidenceConfidence}</dt><dd className="mt-0.5 text-fg-muted">{Math.round(item.confidence * 100)}%</dd></div>}
              {item.validTo ? <div><dt className="text-fg-subtle">{t.evidenceValidUntil}</dt><dd className="mt-0.5 text-fg-muted">{formatDateTime(item.validTo, language)}</dd></div> : null}
              {item.expiresAt ? <div><dt className="text-fg-subtle">{t.evidenceExpires}</dt><dd className="mt-0.5 text-fg-muted">{formatDateTime(item.expiresAt, language)}</dd></div> : null}
            </dl>
          </details>
          {history ? <div className="mt-2 space-y-2 border-t border-edge pt-2"><p className="text-xs font-medium text-fg-muted">{t.historyTitle}</p>{history.map((version) => <div key={version.id} className="flex items-start justify-between gap-3 text-xs"><p className="min-w-0 text-fg-muted">{version.statement}</p><span className="shrink-0 text-fg-subtle">{formatDateTime(version.updatedAt, language)}</span></div>)}</div> : null}
        </>
      )}
    </article>
  );
}

function ConnectedClaimCard({ claim, language, t, busy, onDecision }: {
  claim: ConnectedClaim;
  language: 'en' | 'zh';
  t: ReturnType<typeof messages>['you'];
  busy: boolean;
  onDecision: (action: 'confirm' | 'reject') => void;
}) {
  const label = typeof claim.value.label === 'string' ? claim.value.label : '';
  const weekdays = language === 'zh'
    ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const summary = claim.class === 'relationship'
    ? t.claimRelationship.replace('{{label}}', label)
    : claim.class === 'project'
      ? t.claimProject.replace('{{label}}', label)
      : t.claimRoutine
          .replace('{{weekday}}', weekdays[Number(claim.value.weekday)] ?? '')
          .replace('{{hour}}', String(claim.value.hour).padStart(2, '0'));
  const sources = [...new Set(claim.evidence.map((item) => item.sourceInstanceId))];
  const needsReview = claim.state === 'provisional' || claim.state === 'stale';
  return (
    <article className={cn('rounded-xl border p-3.5', needsReview ? 'border-warning/35 bg-warning-soft/35' : 'border-edge-subtle bg-surface-panel')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="text-[11px] font-medium text-fg-subtle">{t.claimClasses[claim.class]}</span>
          <p className="mt-1 text-sm font-medium leading-6 text-fg">{summary}</p>
        </div>
        <span className="rounded-full bg-surface-hover px-2 py-1 text-[11px] text-fg-muted">{t.claimStates[claim.state]}</span>
      </div>
      <p className="mt-2 text-xs text-fg-muted">
        {t.claimEvidence.replace('{{events}}', String(claim.independentEvidenceCount)).replace('{{days}}', String(claim.activeDayCount))}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-fg-subtle">{t.observedAt.replace('{{time}}', formatDateTime(claim.lastReinforcedAt, language))}</span>
        {needsReview ? <div className="flex gap-1">
          <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={() => onDecision('confirm')}><Check className="size-3.5" aria-hidden />{t.confirm}</Button>
          <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={() => onDecision('reject')}><X className="size-3.5" aria-hidden />{t.notTrue}</Button>
        </div> : null}
      </div>
      <details className="mt-2 rounded-lg bg-surface-muted/70 px-3 py-2 text-xs text-fg-muted">
        <summary className="cursor-pointer font-medium">{t.viewEvidence}</summary>
        <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
          <div><dt className="text-fg-subtle">{t.evidenceSource}</dt><dd className="mt-0.5 break-all">{sources.join(', ')}</dd></div>
          <div><dt className="text-fg-subtle">{t.evidenceConfidence}</dt><dd className="mt-0.5">{Math.round(claim.confidence * 100)}%</dd></div>
          <div className="sm:col-span-2"><dt className="text-fg-subtle">{t.evidenceRule}</dt><dd className="mt-0.5">{t.claimRule}</dd></div>
        </dl>
      </details>
    </article>
  );
}

type PlaybookRulePatch = {
  statement?: string;
  enabled?: boolean;
  order?: number;
  context?: { channel?: string | null; supportNeed?: string | null };
};

function PlaybookCard({ playbook, busy, t, onToggleGroup, onCreate, onUpdate, onDelete, onRollback }: {
  playbook: PersonalPlaybook;
  busy: boolean;
  t: ReturnType<typeof messages>['you'];
  onToggleGroup: () => void;
  onCreate: (statement: string) => void;
  onUpdate: (ruleId: string, patch: PlaybookRulePatch) => void;
  onDelete: (ruleId: string) => void;
  onRollback: (ruleId: string, versionId: string) => void;
}) {
  const [newRule, setNewRule] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  return (
    <article className={cn('rounded-xl border p-4', playbook.enabled ? 'border-edge-subtle bg-surface-panel' : 'border-edge-subtle bg-surface-muted')}>
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-sm font-semibold text-fg">{t.playbookNames[playbook.id]}</h3><p className="mt-1 text-xs text-fg-muted">{replaceCount(t.playbookRuleCount, playbook.rules.filter((rule) => rule.enabled).length)}</p></div>
        <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onToggleGroup}>{playbook.enabled ? t.pausePlaybook : t.resumePlaybook}</Button>
      </div>
      <ul className="mt-3 space-y-2">{playbook.rules.map((rule, index) => (
        <li key={rule.id} className={cn('rounded-lg border border-edge-subtle p-2.5', !rule.enabled && 'opacity-60')}>
          {editingId === rule.id ? (
            <div className="space-y-2"><textarea className={cn(inputClass, 'min-h-16 resize-y')} value={editingText} onChange={(event) => setEditingText(event.target.value)} /><div className="flex justify-end gap-1"><Button type="button" variant="ghost" className="h-7 px-2" onClick={() => setEditingId(null)}>{t.cancel}</Button><Button type="button" variant="primary" className="h-7 px-2" disabled={!editingText.trim()} onClick={() => { onUpdate(rule.id, { statement: editingText.trim() }); setEditingId(null); }}>{t.save}</Button></div></div>
          ) : (
            <>
              <p className="text-xs leading-5 text-fg-muted">{rule.statement}</p>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <label className="grid gap-1 text-[10px] text-fg-subtle">{t.ruleSupportContext}<Select value={rule.context.supportNeed ?? ''} disabled={busy} onChange={(event) => onUpdate(rule.id, { context: { supportNeed: event.target.value || null } })}><SelectOption value="">{t.ruleContextAny}</SelectOption>{(['listen', 'clarify', 'advise', 'act', 'unknown'] as const).map((value) => <SelectOption key={value} value={value}>{t.ruleSupportNeeds[value]}</SelectOption>)}</Select></label>
                <label className="grid gap-1 text-[10px] text-fg-subtle">{t.ruleChannelContext}<Select value={rule.context.channel ?? ''} disabled={busy} onChange={(event) => onUpdate(rule.id, { context: { channel: event.target.value || null } })}><SelectOption value="">{t.ruleContextAny}</SelectOption>{['webchat', 'telegram', 'weixin', 'feishu', 'cli'].map((value) => <SelectOption key={value} value={value}>{value}</SelectOption>)}</Select></label>
              </div>
              <div className="mt-2 flex flex-wrap justify-end gap-1"><Button type="button" variant="ghost" className="h-7 px-2" disabled={busy || index === 0} onClick={() => onUpdate(rule.id, { order: playbook.rules[index - 1].order - 1 })}>{t.moveUp}</Button><Button type="button" variant="ghost" className="h-7 px-2" disabled={busy || index === playbook.rules.length - 1} onClick={() => onUpdate(rule.id, { order: playbook.rules[index + 1].order + 1 })}>{t.moveDown}</Button><Button type="button" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => onUpdate(rule.id, { enabled: !rule.enabled })}>{rule.enabled ? t.disableRule : t.enableRule}</Button><Button type="button" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => { setEditingId(rule.id); setEditingText(rule.statement); }}><Pencil className="size-3" aria-hidden />{t.edit}</Button><Button type="button" variant="ghost" className="h-7 px-2 text-danger" disabled={busy} onClick={() => onDelete(rule.id)}><Trash2 className="size-3" aria-hidden />{t.deleteRule}</Button></div>
              {rule.versions.length > 1 ? <details className="mt-2 border-t border-edge-subtle pt-2"><summary className="cursor-pointer text-[11px] text-fg-subtle">{t.ruleHistory}</summary><div className="mt-2 space-y-2">{rule.versions.filter((version) => !version.current).map((version) => <div key={version.id} className="flex items-start justify-between gap-2 text-[11px]"><p className="line-clamp-2 text-fg-muted">{version.statement}</p><Button type="button" variant="ghost" className="h-7 shrink-0 px-2" disabled={busy} onClick={() => onRollback(rule.id, version.id)}>{t.rollbackRule}</Button></div>)}</div></details> : null}
            </>
          )}
        </li>
      ))}</ul>
      <div className="mt-3"><div className="flex gap-2"><input className={inputClass} value={newRule} onChange={(event) => setNewRule(event.target.value)} placeholder={t.newRulePlaceholder} /><Button type="button" variant="secondary" disabled={busy || !newRule.trim()} onClick={() => { onCreate(newRule.trim()); setNewRule(''); }}>{t.addRule}</Button></div><p className="mt-1.5 text-[11px] leading-5 text-fg-subtle">{t.playbookRuleExamples[playbook.id]}</p></div>
    </article>
  );
}

function FirstMeetingCard({ suggestion, draft, busy, onDraftChange, onSave, onLater, t }: {
  suggestion?: UserProfileSetup['callNameSuggestion'];
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onLater: () => void;
  t: ReturnType<typeof messages>['you'];
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent-soft/80 via-surface-panel to-surface-panel p-5 sm:p-6">
      <div className="relative max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-fg">{suggestion ? t.meetSuggestedTitle.replace('{{name}}', suggestion.value) : t.meetTitle}</h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">{suggestion ? t.meetSuggestedBody : t.meetBody}</p>
        <div className="mt-5 flex max-w-xl flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="you-call-name">{t.callName}</label>
          <input id="you-call-name" value={draft} maxLength={80} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && draft.trim() && !busy) onSave(); }} placeholder={t.meetPlaceholder} className={cn(inputClass, 'h-10 flex-1 bg-surface-base/90')} />
          <Button type="button" variant="primary" className="h-10 shrink-0" disabled={busy || !draft.trim()} onClick={onSave}>{busy ? t.meetSaving : t.meetSave}</Button>
        </div>
        {suggestion ? <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-fg-subtle"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden /><span>{t.meetSource}</span></p> : null}
        <button type="button" disabled={busy} className="mt-3 text-xs font-medium text-fg-muted hover:text-fg hover:underline disabled:opacity-60" onClick={onLater}>{t.meetLater}</button>
      </div>
    </section>
  );
}

export function UserContextPage() {
  const language = useLocaleStore((state) => state.language);
  const t = messages(language).you;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = userContextViewFromTab(searchParams.get('tab'));
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const { data, error, isLoading, mutate } = useSWR<UserContextResponse>('/api/you', fetchUserContext);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingUnderstanding, setAddingUnderstanding] = useState(false);
  const [understandingDraft, setUnderstandingDraft] = useState('');
  const [understandingKind, setUnderstandingKind] = useState<UnderstandingKind>('preference');
  const [choosingOtherUnderstanding, setChoosingOtherUnderstanding] = useState(false);
  const [forgetItem, setForgetItem] = useState<UserUnderstanding | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState<UserProfileFields | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [callNameDraft, setCallNameDraft] = useState('');
  const [profilePromptSaving, setProfilePromptSaving] = useState(false);
  const [controlsDraft, setControlsDraft] = useState<UserContextResponse['controls'] | null>(null);
  const [controlsSaving, setControlsSaving] = useState(false);
  const [trustSaving, setTrustSaving] = useState(false);
  const [relationshipSaving, setRelationshipSaving] = useState(false);
  const [pendingTrustLevel, setPendingTrustLevel] = useState<UserTrustLevel | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [disconnectSource, setDisconnectSource] = useState<PersonalContextSource | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [transferBusy, setTransferBusy] = useState<'export' | 'import' | null>(null);
  const [pendingMemorySection, setPendingMemorySection] = useState<MemorySection | null>(null);
  const profileCardRef = useRef<HTMLElement | null>(null);
  const reviewSectionRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const profile = data?.profile ?? { callName: '', pronouns: '', timezone: '', notes: '' };
  const active = useMemo(() => data?.understanding.filter((item) => item.status === 'active') ?? [], [data]);
  const review = useMemo(() => data?.understanding.filter((item) => item.status !== 'active') ?? [], [data]);
  const visibleClaims = useMemo(() => data?.connectedClaims.filter((claim) => claim.state !== 'rejected') ?? [], [data]);
  const reviewClaims = useMemo(() => visibleClaims.filter((claim) => claim.state !== 'active'), [visibleClaims]);
  const grouped = useMemo(() => new Map(FACET_ORDER.map((facet) => [facet, active.filter((item) => item.facet === facet)])), [active]);
  const controls = controlsDraft ?? data?.controls ?? null;
  const connectedSources = data?.sources.filter((source) => source.installed && source.enabled) ?? [];
  const unhealthySources = connectedSources.filter((source) => ['failed', 'unauthorized', 'degraded', 'not_configured'].includes(source.status));

  useEffect(() => {
    const refresh = () => { void mutate(); };
    window.addEventListener('connector-learning-updated', refresh);
    return () => window.removeEventListener('connector-learning-updated', refresh);
  }, [mutate]);

  useEffect(() => {
    if (view !== 'memory' || !pendingMemorySection) return;
    const frame = requestAnimationFrame(() => {
      const target = pendingMemorySection === 'profile' ? profileCardRef : reviewSectionRef;
      target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPendingMemorySection(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingMemorySection, view]);

  async function saveRelationship(patch: RelationshipSettingsPatch) {
    if (!data || relationshipSaving) return;
    setRelationshipSaving(true);
    try {
      const result = await updateRelationshipSettings(patch);
      await mutate({ ...data, relationship: result.relationship }, { revalidate: false });
      showToast({ type: 'success', title: t.collaborationTitle, message: t.saved });
    } catch {
      showToast({ type: 'error', title: t.supportModeTitle, message: t.saveError });
    } finally {
      setRelationshipSaving(false);
    }
  }

  async function decideConnectedClaim(claim: ConnectedClaim, action: 'confirm' | 'reject') {
    setBusyId(`claim:${claim.id}`);
    try {
      const updated = await updateConnectedClaim(claim.id, action);
      await mutate((current) => current ? {
        ...current,
        connectedClaims: current.connectedClaims.map((item) => item.id === updated.id ? updated : item),
      } : current, { revalidate: false });
    } catch {
      showToast({ type: 'error', title: t.connectedClaimsTitle, message: t.saveError });
    } finally {
      setBusyId(null);
    }
  }

  const selectView = (next: UserContextViewId) => {
    const params = new URLSearchParams();
    if (next !== 'overview') params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const openMemorySection = (section: MemorySection) => {
    setPendingMemorySection(section);
    selectView('memory');
  };

  const openSourceConfiguration = (source: Pick<PersonalContextSource, 'id' | 'instanceId'>) => {
    const params = new URLSearchParams({ connector: source.id });
    if (source.instanceId) params.set('instance', source.instanceId);
    navigate(`/connectors?${params.toString()}`);
  };

  const runSourceLearning = async (source: PersonalContextSource) => {
    if (!source.instanceId) return;
    const operationId = `source-learning:${source.instanceId}`;
    setBusyId(operationId);
    try {
      if (source.learning?.status === 'paused') {
        await setConnectionLearningPaused(source.instanceId, false);
      } else {
        await startConnectionLearning(source.instanceId);
      }
      await mutate();
      showToast({ type: 'success', title: source.displayName, message: t.sourceLearningStarted });
    } catch (learningError) {
      showToast({
        type: 'error',
        title: source.displayName,
        message: learningError instanceof Error ? learningError.message : t.sourceLearningStartFailed,
      });
    } finally {
      setBusyId(null);
    }
  };

  const pauseSourceLearning = async (source: PersonalContextSource) => {
    if (!source.instanceId) return;
    const operationId = `source-learning:${source.instanceId}`;
    setBusyId(operationId);
    try {
      await setConnectionLearningPaused(source.instanceId, true);
      await mutate();
    } catch (learningError) {
      showToast({
        type: 'error',
        title: source.displayName,
        message: learningError instanceof Error ? learningError.message : t.sourceLearningStartFailed,
      });
    } finally {
      setBusyId(null);
    }
  };

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: <div className="min-w-0"><h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1><p className="truncate text-xs text-fg-muted">{t.subtitle}</p></div>,
      end: <Button type="button" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => setHelpOpen(true)}><CircleHelp className="size-3.5" aria-hidden />{t.howItWorks}</Button>,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, setPageHeader, t.howItWorks, t.subtitle, t.title]);

  useEffect(() => {
    if (!data || data.profile.callName) return;
    setCallNameDraft(data.profileSetup.callNameSuggestion?.value ?? '');
  }, [data, data?.profile.callName, data?.profileSetup.callNameSuggestion?.id]);

  async function runUnderstandingAction(item: UserUnderstanding, action: 'confirm' | 'reject' | 'update', content?: string) {
    setBusyId(item.id);
    try {
      const updated = await updateUnderstanding(item.id, { action, content });
      await mutate((current) => current ? {
        ...current,
        understanding: action === 'reject'
          ? current.understanding.filter((entry) => entry.id !== item.id)
          : current.understanding.map((entry) => entry.id === item.id ? updated : entry),
      } : current, { revalidate: false });
      void mutate();
    }
    catch { showToast({ type: 'error', title: t.title, message: t.saveError }); }
    finally { setBusyId(null); }
  }

  async function decideConsent(id: string, decision: 'once' | 'session' | 'always' | 'deny') {
    setBusyId(`consent:${id}`);
    try {
      await decideReferenceConsent(id, decision);
      await mutate();
      showToast({ type: 'success', title: t.title, message: t.saved });
    } catch {
      showToast({ type: 'error', title: t.title, message: t.saveError });
    } finally {
      setBusyId(null);
    }
  }

  async function addUnderstanding() {
    const content = understandingDraft.trim();
    if (!content) return;
    setBusyId('understanding:new');
    try {
      await createUnderstanding({ content, kind: understandingKind });
      setUnderstandingDraft('');
      setAddingUnderstanding(false);
      setChoosingOtherUnderstanding(false);
      await mutate();
      showToast({ type: 'success', title: t.understandingTitle, message: t.saved });
    } catch {
      showToast({ type: 'error', title: t.understandingTitle, message: t.saveError });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmAllReview() {
    if (!review.length) return;
    setBusyId('understanding:batch');
    try {
      await batchUpdateUnderstanding(review.map((item) => item.id), 'confirm');
      await mutate();
    } catch {
      showToast({ type: 'error', title: t.reviewTitle, message: t.saveError });
    } finally {
      setBusyId(null);
    }
  }

  async function resolveConflict(groupId: string, winnerId: string) {
    setBusyId(`conflict:${groupId}`);
    try {
      await resolveUnderstandingConflict(groupId, winnerId);
      await mutate();
    } catch {
      showToast({ type: 'error', title: t.conflictsTitle, message: t.saveError });
    } finally {
      setBusyId(null);
    }
  }

  async function revokeGrant(id: string) {
    setBusyId(`grant:${id}`);
    try {
      await revokeReferenceConsent(id);
      await mutate();
    } catch {
      showToast({ type: 'error', title: t.grantsTitle, message: t.saveError });
    } finally {
      setBusyId(null);
    }
  }

  async function runInsightAction(item: InsightSuggestion, action: 'apply' | 'dismiss') {
    setBusyId(`insight:${item.id}`);
    try { const result = await updateInsightSuggestion(item.id, { action, uiLocale: language }); await mutate(); if (action === 'apply' && result.href) navigate(result.href); }
    catch { showToast({ type: 'error', title: t.insightsTitle, message: t.saveError }); }
    finally { setBusyId(null); }
  }

  async function togglePlaybook(item: PersonalPlaybook) {
    setBusyId(`playbook:${item.id}`);
    try { await setPersonalPlaybookEnabled(item.id, !item.enabled); await mutate(); }
    catch { showToast({ type: 'error', title: t.playbooksTitle, message: t.saveError }); }
    finally { setBusyId(null); }
  }

  async function mutatePlaybookRule(
    playbookId: PersonalPlaybook['id'],
    action: () => Promise<unknown>,
  ) {
    setBusyId(`playbook:${playbookId}`);
    try {
      await action();
      await mutate();
    } catch {
      showToast({ type: 'error', title: t.playbooksTitle, message: t.saveError });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmForget() {
    if (!forgetItem) return;
    setBusyId(forgetItem.id);
    try {
      await forgetUnderstanding(forgetItem.id);
      const forgottenId = forgetItem.id;
      setForgetItem(null);
      await mutate((current) => current ? {
        ...current,
        understanding: current.understanding.filter((entry) => entry.id !== forgottenId),
      } : current, { revalidate: false });
      void mutate();
    }
    catch { showToast({ type: 'error', title: t.title, message: t.saveError }); }
    finally { setBusyId(null); }
  }

  async function saveProfile() {
    if (!profileDraft) return;
    setProfileSaving(true);
    try { const saved = await updateUserProfile(profileDraft); setProfileEditing(false); setProfileDraft(null); await mutate((current) => current ? { ...current, ...saved } : current, { revalidate: false }); }
    catch { showToast({ type: 'error', title: t.title, message: t.saveError }); }
    finally { setProfileSaving(false); }
  }

  async function saveCallName() {
    const callName = callNameDraft.trim();
    if (!callName || profilePromptSaving) return;
    setProfilePromptSaving(true);
    try { const saved = await updateUserProfile({ callName, timezone: profile.timezone || detectBrowserTimezone() }); await mutate((current) => current ? { ...current, ...saved } : current, { revalidate: false }); }
    catch { showToast({ type: 'error', title: t.title, message: t.saveError }); }
    finally { setProfilePromptSaving(false); }
  }

  async function snoozeProfilePrompt() {
    if (profilePromptSaving) return;
    setProfilePromptSaving(true);
    try {
      const saved = await updateUserProfilePrompt('snooze');
      await mutate((current) => current ? { ...current, profileSetup: saved.profileSetup } : current, { revalidate: false });
    } catch {
      showToast({ type: 'error', title: t.title, message: t.saveError });
    } finally {
      setProfilePromptSaving(false);
    }
  }

  function openProfileEditor() {
    setProfileDraft(profile);
    setProfileEditing(true);
    openMemorySection('profile');
  }

  function startUnderstanding(kind: UnderstandingKind, chooseOther = false) {
    setUnderstandingKind(kind);
    setChoosingOtherUnderstanding(chooseOther);
    setAddingUnderstanding(true);
    selectView('memory');
  }

  function cancelUnderstanding() {
    setAddingUnderstanding(false);
    setChoosingOtherUnderstanding(false);
    setUnderstandingDraft('');
  }

  async function saveControls(next: UserContextResponse['controls']) {
    if (controlsSaving) return;
    setControlsDraft(next);
    setControlsSaving(true);
    try { const saved = await updateUserContextControls(next); setControlsDraft(saved); await mutate(); showToast({ type: 'success', title: t.privacyTitle, message: t.saved }); }
    catch { setControlsDraft(null); showToast({ type: 'error', title: t.privacyTitle, message: t.saveError }); }
    finally { setControlsSaving(false); }
  }

  async function selectTrustLevel(level: UserTrustLevel) {
    if (trustSaving || level === data?.trust.defaultActionLevel) return;
    setTrustSaving(true);
    try { const trust = await updateUserTrust(level); await mutate((current) => current ? { ...current, trust } : current, { revalidate: false }); showToast({ type: 'success', title: t.trustTitle, message: t.saved }); }
    catch { showToast({ type: 'error', title: t.trustTitle, message: t.saveError }); }
    finally { setTrustSaving(false); setPendingTrustLevel(null); }
  }

  async function confirmDisconnectSource(understandingPolicy: 'keep' | 'delete') {
    if (!disconnectSource?.instanceId || disconnecting) return;
    setDisconnecting(true);
    try {
      const result = await disconnectPersonalContextSource(disconnectSource.instanceId, understandingPolicy);
      setDisconnectSource(null);
      await mutate();
      showToast({
        type: 'success',
        title: t.sourcesTitle,
        message: understandingPolicy === 'delete'
          ? t.disconnectDeleted.replace('{{count}}', String(result.deletedUnderstandingCount))
          : t.disconnectSuccess,
      });
    } catch {
      showToast({ type: 'error', title: t.sourcesTitle, message: t.saveError });
    } finally {
      setDisconnecting(false);
    }
  }

  async function downloadUserContext() {
    if (transferBusy) return;
    setTransferBusy('export');
    try {
      const payload = await exportUserContext();
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `xopc-about-you-${payload.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      showToast({ type: 'error', title: t.transferTitle, message: t.saveError });
    } finally {
      setTransferBusy(null);
    }
  }

  async function uploadUserContext(file: File | null) {
    if (!file || transferBusy) return;
    setTransferBusy('import');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('file too large');
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await importUserContext(payload);
      await mutate();
      openMemorySection('review');
      showToast({ type: 'success', title: t.transferTitle, message: t.importSuccess.replace('{{count}}', String(result.importedCount)).replace('{{skipped}}', String(result.skippedCount)) });
    } catch {
      showToast({ type: 'error', title: t.transferTitle, message: t.importError });
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
      setPendingImportFile(null);
      setTransferBusy(null);
    }
  }

  function cancelImport() {
    setPendingImportFile(null);
    if (importInputRef.current) importInputRef.current.value = '';
  }

  const tabs = [
    { id: 'overview' as const, label: t.tabs.overview, icon: HeartHandshake },
    { id: 'memory' as const, label: t.tabs.memory, icon: Brain, count: review.length + reviewClaims.length || undefined },
    { id: 'collaboration' as const, label: t.tabs.collaboration, icon: BookOpen },
    { id: 'sources' as const, label: t.tabs.sources, icon: Database },
    { id: 'dreaming' as const, label: t.tabs.dreaming, icon: Moon },
    { id: 'privacy' as const, label: t.tabs.privacy, icon: ShieldCheck },
  ];

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-3 py-6 sm:px-5 xl:px-6">
      <div className="relative">
        <PageTabs
          items={tabs}
          activeTab={view}
          onChange={selectView}
          ariaLabel={t.title}
          tabIdPrefix="you-tab"
          panelIdPrefix="you-panel"
          className="pr-8 sm:pr-1"
          buttonClassName="px-2.5 sm:px-3"
        />
        <div
          className="pointer-events-none absolute inset-y-1 right-0 w-8 bg-gradient-to-l from-surface-panel to-transparent sm:hidden"
          aria-hidden
        />
      </div>
      {isLoading ? <UserContextSkeleton /> : error || !data ? <div className="rounded-2xl border border-danger/25 bg-danger-soft p-5 text-sm text-danger">{t.loadError}</div> : null}

      {data && view === 'overview' ? (
        <div id="you-panel-overview" role="tabpanel" aria-labelledby="you-tab-overview" className="space-y-4">
          {!profile.callName && data.profileSetup.shouldPrompt ? (
            <FirstMeetingCard suggestion={data.profileSetup.callNameSuggestion} draft={callNameDraft} busy={profilePromptSaving} onDraftChange={setCallNameDraft} onSave={() => void saveCallName()} onLater={() => void snoozeProfilePrompt()} t={t} />
          ) : null}

          {(review.length > 0 || reviewClaims.length > 0 || unhealthySources.length > 0 || !profile.callName) ? (
            <section className="rounded-2xl border border-warning/25 bg-warning-soft/35 p-5">
              <h2 className="text-sm font-semibold text-fg">{t.attentionTitle}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {review.length + reviewClaims.length > 0 ? <Button type="button" variant="secondary" onClick={() => openMemorySection('review')}>{replaceCount(t.reviewCount, review.length + reviewClaims.length)}<ChevronRight className="size-4" aria-hidden /></Button> : null}
                {unhealthySources.length > 0 ? <Button type="button" variant="secondary" onClick={() => selectView('sources')}>{replaceCount(t.sourceIssues, unhealthySources.length)}<ChevronRight className="size-4" aria-hidden /></Button> : null}
                {!profile.callName ? <Button type="button" variant="secondary" onClick={openProfileEditor}>{t.completeProfile}<ChevronRight className="size-4" aria-hidden /></Button> : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-edge-subtle bg-surface-base p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <button type="button" className="rounded-xl border border-edge-subtle bg-surface-panel p-3 text-left hover:bg-surface-hover" onClick={() => selectView('memory')}><span className="text-xl font-semibold text-fg">{active.length}</span><span className="mt-1 block text-xs text-fg-muted">{t.knownSummary}</span></button>
              <button type="button" className="rounded-xl border border-edge-subtle bg-surface-panel p-3 text-left hover:bg-surface-hover" onClick={() => selectView('sources')}><span className="text-xl font-semibold text-fg">{connectedSources.length}</span><span className="mt-1 block text-xs text-fg-muted">{t.connectedSources}</span></button>
              <button type="button" className="rounded-xl border border-edge-subtle bg-surface-panel p-3 text-left hover:bg-surface-hover" onClick={() => openMemorySection('review')}><span className="text-xl font-semibold text-fg">{review.length + reviewClaims.length}</span><span className="mt-1 block text-xs text-fg-muted">{t.waitingReview}</span></button>
            </div>
          </section>

          {data.insights.length > 0 ? <section className="rounded-2xl border border-accent/15 bg-surface-base p-5"><div className="flex flex-wrap items-center gap-2"><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><Lightbulb className="size-4 text-accent" aria-hidden />{t.insightsTitle}</h2><ContextBadge>{t.confirmedContextBadge}</ContextBadge></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{data.insights.map((item) => <article key={item.id} className="rounded-xl border border-edge-subtle bg-surface-panel p-4"><p className="text-sm leading-6 text-fg">{item.insight}</p><p className="mt-2 text-xs text-fg-subtle">{item.evidenceCount > 1 ? replaceCount(t.insightEvidence, item.evidenceCount) : t.insightReason}</p><div className="mt-3 flex justify-end gap-2"><Button type="button" variant="ghost" className="h-8 px-2" disabled={busyId === `insight:${item.id}`} onClick={() => void runInsightAction(item, 'dismiss')}>{t.notNow}</Button><Button type="button" variant="primary" className="h-8 px-2" disabled={busyId === `insight:${item.id}`} onClick={() => void runInsightAction(item, 'apply')}>{t.insightActions[item.action]}</Button></div></article>)}</div></section> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
              <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><CircleUserRound className="size-4 text-accent" aria-hidden />{t.profileTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.profileHint}</p></div><Button type="button" variant="ghost" className="h-8 px-2" onClick={() => openMemorySection('profile')}><ChevronRight className="size-4" aria-hidden /></Button></div>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2"><div><dt className="text-xs text-fg-subtle">{t.callName}</dt><dd className="mt-1 text-sm text-fg">{profile.callName || '—'}</dd></div><div><dt className="text-xs text-fg-subtle">{t.timezone}</dt><dd className="mt-1 text-sm text-fg">{profile.timezone || '—'}</dd></div><div><dt className="text-xs text-fg-subtle">{t.pronouns}</dt><dd className="mt-1 text-sm text-fg">{profile.pronouns || '—'}</dd></div>{profile.notes ? <div className="sm:col-span-2"><dt className="text-xs text-fg-subtle">{t.notes}</dt><dd className="mt-1 line-clamp-2 text-sm leading-6 text-fg">{profile.notes}</dd></div> : null}</dl>
            </section>

            <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><Brain className="size-4 text-accent" aria-hidden />{t.understandingTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.understandingHint}</p></div><Button type="button" variant="ghost" className="h-8 px-2" onClick={() => selectView('memory')}><ChevronRight className="size-4" aria-hidden /></Button></div><div className="mt-4 space-y-2">{active.slice(0, 4).map((item) => <div key={item.id} className="rounded-lg bg-surface-panel px-3 py-2.5 text-sm leading-5 text-fg">{item.statement}</div>)}{active.length === 0 ? <p className="py-5 text-center text-sm text-fg-muted">{t.emptyUnderstanding}</p> : null}</div></section>
          </div>

        </div>
      ) : null}

      {data && view === 'memory' ? (
        <div id="you-panel-memory" role="tabpanel" aria-labelledby="you-tab-memory" className="space-y-6">
          <section>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-fg">{t.memoryTitle}</h2>
              <ContextBadge>{t.sharedAgentsBadge}</ContextBadge>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{t.memoryHint}</p>
          </section>

          <section ref={profileCardRef} id="you-profile-card" className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2"><h2 className="flex items-center gap-2 text-base font-semibold text-fg"><CircleUserRound className="size-4 text-accent" aria-hidden />{t.profileTitle}</h2><ContextBadge>{t.onlyYouEditBadge}</ContextBadge></div>
                <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t.profileHint}</p>
              </div>
              {!profileEditing ? <Button type="button" variant="secondary" onClick={openProfileEditor}><Pencil className="size-3.5" aria-hidden />{t.edit}</Button> : null}
            </div>
            {profileEditing && profileDraft ? (
              <div className="mt-5">
                <UserProfileFieldsEditor value={profileDraft} onChange={setProfileDraft} language={language} inputClassName={inputClass} labels={{ callName: t.callName, callNamePlaceholder: t.meetPlaceholder, pronouns: t.pronouns, pronounsPlaceholder: t.pronounsPlaceholder, timezone: t.timezone, timezoneCustom: t.timezoneCustom, timezoneDetect: t.timezoneDetect, custom: t.custom, notes: t.notes, notesPlaceholder: t.notesPlaceholder }} />
                <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => { setProfileEditing(false); setProfileDraft(null); }}>{t.cancel}</Button><Button type="button" variant="primary" disabled={profileSaving} onClick={() => void saveProfile()}>{profileSaving ? t.saving : t.save}</Button></div>
              </div>
            ) : (
              <dl className="mt-5 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-fg-subtle">{t.callName}</dt><dd className="mt-1 text-sm text-fg">{profile.callName || '—'}</dd></div><div><dt className="text-xs text-fg-subtle">{t.timezone}</dt><dd className="mt-1 text-sm text-fg">{profile.timezone || '—'}</dd></div><div><dt className="text-xs text-fg-subtle">{t.pronouns}</dt><dd className="mt-1 text-sm text-fg">{profile.pronouns || '—'}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-fg-subtle">{t.notes}</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-fg">{profile.notes || '—'}</dd></div></dl>
            )}
          </section>

          <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
            <h2 className="text-base font-semibold text-fg">{t.structuredContextTitle}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <button type="button" aria-pressed={addingUnderstanding && !choosingOtherUnderstanding && understandingKind === 'preference'} className={cn('rounded-xl border bg-surface-panel p-4 text-left transition-colors hover:border-accent/30 hover:bg-surface-hover', addingUnderstanding && !choosingOtherUnderstanding && understandingKind === 'preference' ? 'border-accent/40 bg-accent-soft/20' : 'border-edge-subtle')} onClick={() => startUnderstanding('preference')}><span className="text-sm font-semibold text-fg">{t.addPreference}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{t.addPreferenceHint}</span></button>
              <button type="button" aria-pressed={addingUnderstanding && !choosingOtherUnderstanding && understandingKind === 'boundary'} className={cn('rounded-xl border bg-surface-panel p-4 text-left transition-colors hover:border-accent/30 hover:bg-surface-hover', addingUnderstanding && !choosingOtherUnderstanding && understandingKind === 'boundary' ? 'border-accent/40 bg-accent-soft/20' : 'border-edge-subtle')} onClick={() => startUnderstanding('boundary')}><span className="text-sm font-semibold text-fg">{t.addBoundary}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{t.addBoundaryHint}</span></button>
              <button type="button" aria-pressed={addingUnderstanding && !choosingOtherUnderstanding && understandingKind === 'current_state'} className={cn('rounded-xl border bg-surface-panel p-4 text-left transition-colors hover:border-accent/30 hover:bg-surface-hover', addingUnderstanding && !choosingOtherUnderstanding && understandingKind === 'current_state' ? 'border-accent/40 bg-accent-soft/20' : 'border-edge-subtle')} onClick={() => startUnderstanding('current_state')}><span className="text-sm font-semibold text-fg">{t.addCurrentFocus}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{t.addCurrentFocusHint}</span></button>
              <button type="button" aria-pressed={addingUnderstanding && choosingOtherUnderstanding} className={cn('rounded-xl border bg-surface-panel p-4 text-left transition-colors hover:border-accent/30 hover:bg-surface-hover', addingUnderstanding && choosingOtherUnderstanding ? 'border-accent/40 bg-accent-soft/20' : 'border-edge-subtle')} onClick={() => startUnderstanding('relationship', true)}><span className="text-sm font-semibold text-fg">{t.addOther}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{t.addOtherHint}</span></button>
            </div>
            {addingUnderstanding ? (
              <div className="mt-4 rounded-xl border border-edge bg-surface-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">{choosingOtherUnderstanding ? t.addOther : understandingKind === 'preference' ? t.addPreference : understandingKind === 'boundary' ? t.addBoundary : t.addCurrentFocus}</h3>
                    <p className="mt-1 text-xs leading-5 text-fg-muted">{choosingOtherUnderstanding ? t.addOtherHint : understandingKind === 'preference' ? t.addPreferenceHint : understandingKind === 'boundary' ? t.addBoundaryHint : t.addCurrentFocusHint}</p>
                  </div>
                  {!choosingOtherUnderstanding ? <ContextBadge>{t.understandingKinds[understandingKind]}</ContextBadge> : null}
                </div>
                <textarea className={cn(inputClass, 'mt-3 min-h-24 resize-y')} value={understandingDraft} onChange={(event) => setUnderstandingDraft(event.target.value)} placeholder={t.understandingPlaceholders[understandingKind]} autoFocus />
                <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                  {choosingOtherUnderstanding ? (
                    <label className="grid min-w-48 gap-1 text-xs font-medium text-fg-muted">{t.understandingKind}<Select value={understandingKind} onChange={(event) => setUnderstandingKind(event.target.value as UnderstandingKind)}>{OTHER_UNDERSTANDING_KINDS.map((value) => <SelectOption key={value} value={value}>{t.understandingKinds[value]}</SelectOption>)}</Select></label>
                  ) : <span />}
                  <div className="flex gap-2"><Button type="button" variant="ghost" onClick={cancelUnderstanding}>{t.cancel}</Button><Button type="button" variant="primary" disabled={!understandingDraft.trim() || busyId === 'understanding:new'} onClick={() => void addUnderstanding()}>{t.add}</Button></div>
                </div>
              </div>
            ) : null}
          </section>
          {data.conflictGroups.some((group) => group.unresolved) ? <section><h2 className="text-base font-semibold text-fg">{t.conflictsTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.conflictsHint}</p><div className="mt-3 space-y-3">{data.conflictGroups.filter((group) => group.unresolved).map((group) => <div key={group.id} className="divide-y divide-edge overflow-hidden rounded-xl border border-warning/35 bg-warning-soft/25">{group.records.filter((record) => record.storedStatus !== 'archived' && record.storedStatus !== 'rejected').map((record) => <div key={record.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="text-sm leading-6 text-fg">{record.statement}</p><p className="mt-1 text-xs text-fg-subtle">{originLabel(record, t)} · {formatDateTime(record.updatedAt, language)}</p></div><Button type="button" variant="secondary" className="h-8 shrink-0 px-2.5" disabled={busyId === `conflict:${group.id}`} onClick={() => void resolveConflict(group.id, record.id)}>{t.useThis}</Button></div>)}</div>)}</div></section> : null}
          {data.consentRequests.length > 0 ? <section className="space-y-3"><div><h2 className="text-base font-semibold text-fg">{t.consentTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.consentHint}</p></div>{data.consentRequests.map((request) => <article key={request.id} className="rounded-2xl border border-accent/25 bg-accent-soft/20 p-4"><p className="text-sm leading-6 text-fg">{request.statement}</p><p className="mt-2 text-xs text-fg-muted">{t.consentPurpose.replace('{{purpose}}', request.purpose)}</p><div className="mt-3 flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" disabled={busyId === `consent:${request.id}`} onClick={() => void decideConsent(request.id, 'deny')}>{t.consentDeny}</Button><Button type="button" variant="secondary" disabled={busyId === `consent:${request.id}`} onClick={() => void decideConsent(request.id, 'once')}>{t.consentOnce}</Button><Button type="button" variant="secondary" disabled={busyId === `consent:${request.id}`} onClick={() => void decideConsent(request.id, 'session')}>{t.consentSession}</Button><Button type="button" variant="primary" disabled={busyId === `consent:${request.id}`} onClick={() => void decideConsent(request.id, 'always')}>{t.consentAlways}</Button></div></article>)}</section> : null}
          <div ref={reviewSectionRef} className="space-y-6 scroll-mt-6">
            {visibleClaims.length > 0 ? <section><div><h2 className="text-base font-semibold text-fg">{t.connectedClaimsTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.connectedClaimsHint}</p></div><div className="mt-3 grid gap-3 lg:grid-cols-2">{visibleClaims.map((claim) => <ConnectedClaimCard key={claim.id} claim={claim} language={language} t={t} busy={busyId === `claim:${claim.id}`} onDecision={(action) => void decideConnectedClaim(claim, action)} />)}</div></section> : null}
            {review.length > 0 ? <section><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-fg">{t.reviewTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.reviewHint}</p></div><Button type="button" variant="secondary" disabled={busyId === 'understanding:batch'} onClick={() => void confirmAllReview()}>{t.reviewAll}</Button></div><div className="mt-3 grid gap-3 lg:grid-cols-2">{review.map((item) => <UnderstandingCard key={item.id} item={item} language={language} t={t} busy={busyId === item.id} onConfirm={() => void runUnderstandingAction(item, 'confirm')} onReject={() => void runUnderstandingAction(item, 'reject')} onUpdate={(content) => void runUnderstandingAction(item, 'update', content)} onForget={() => setForgetItem(item)} />)}</div></section> : active.length > 0 || visibleClaims.some((claim) => claim.state === 'active') ? <div className="rounded-2xl border border-success/20 bg-success-soft p-6 text-center"><Check className="mx-auto size-5 text-success" aria-hidden /><h2 className="mt-2 text-sm font-semibold text-fg">{t.nothingToReview}</h2><p className="mt-1 text-sm text-fg-muted">{t.nothingToReviewHint}</p></div> : null}
          </div>
          {FACET_ORDER.map((facet) => { const items = grouped.get(facet) ?? []; if (items.length === 0) return null; return <section key={facet}><h2 className="text-sm font-semibold text-fg">{t.facets[facet]}</h2><div className="mt-3 grid gap-3 lg:grid-cols-2">{items.map((item) => <UnderstandingCard key={item.id} item={item} language={language} t={t} busy={busyId === item.id} onConfirm={() => void runUnderstandingAction(item, 'confirm')} onReject={() => void runUnderstandingAction(item, 'reject')} onUpdate={(content) => void runUnderstandingAction(item, 'update', content)} onForget={() => setForgetItem(item)} />)}</div></section>; })}
          {data.understanding.length === 0 && visibleClaims.length === 0 ? <div className="rounded-2xl border border-dashed border-edge p-10 text-center text-sm text-fg-muted">{t.emptyUnderstanding}</div> : null}
        </div>
      ) : null}

      {data && view === 'collaboration' ? (
        <div id="you-panel-collaboration" role="tabpanel" aria-labelledby="you-tab-collaboration" className="space-y-6">
          <section>
            <h2 className="text-base font-semibold text-fg">{t.collaborationTitle}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{t.collaborationHint}</p>
          </section>

          <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><HeartHandshake className="size-4 text-accent" aria-hidden />{t.supportModeTitle}</h2>
                <p className="mt-1 text-xs leading-5 text-fg-muted">{t.supportModeHint}</p>
              </div>
              <label className="grid min-w-48 gap-1 text-xs font-medium text-fg-muted">
                <span className="sr-only">{t.supportModeTitle}</span>
                <Select value={data.relationship.supportMode} disabled={relationshipSaving} onChange={(event) => void saveRelationship({ supportMode: event.target.value as UserContextResponse['relationship']['supportMode'] })}>
                  {(Object.entries(t.supportModes) as Array<[UserContextResponse['relationship']['supportMode'], string]>).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}
                </Select>
              </label>
            </div>
            <div className="mt-4 grid gap-3 border-t border-edge-subtle pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" checked={data.relationship.proactiveEnabled} disabled={relationshipSaving} onChange={(event) => void saveRelationship({ proactiveEnabled: event.target.checked })} />{t.proactiveEnabled}</label>
              <label className="grid gap-1 text-xs text-fg-muted">{t.quietStart}<TimePicker value={data.relationship.quietStart ?? ''} disabled={relationshipSaving} allowEmpty clearLabel={t.clearTime} ariaLabel={t.quietStart} onChange={(quietStart) => void saveRelationship({ quietStart: quietStart || null })} /></label>
              <label className="grid gap-1 text-xs text-fg-muted">{t.quietEnd}<TimePicker value={data.relationship.quietEnd ?? ''} disabled={relationshipSaving} allowEmpty clearLabel={t.clearTime} ariaLabel={t.quietEnd} onChange={(quietEnd) => void saveRelationship({ quietEnd: quietEnd || null })} /></label>
              <label className="grid gap-1 text-xs text-fg-muted">{t.blockedTopics}<input className={inputClass} defaultValue={data.relationship.blockedTopics.join(', ')} disabled={relationshipSaving} onBlur={(event) => void saveRelationship({ blockedTopics: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
            </div>
            <p className="mt-3 text-right text-xs text-fg-subtle">{relationshipSaving ? t.saving : t.autoSaveHint}</p>
          </section>

          <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
            <div className="flex flex-wrap items-center gap-2"><h2 className="flex items-center gap-2 text-base font-semibold text-fg"><BookOpen className="size-4 text-accent" aria-hidden />{t.playbooksTitle}</h2><ContextBadge>{t.affectsAgentsBadge}</ContextBadge></div>
            {data.playbooks.length > 0 ? <div className="mt-4 grid gap-3 xl:grid-cols-3">{data.playbooks.map((playbook) => <PlaybookCard key={playbook.id} playbook={playbook} busy={busyId === `playbook:${playbook.id}`} t={t} onToggleGroup={() => void togglePlaybook(playbook)} onCreate={(statement) => void mutatePlaybookRule(playbook.id, () => createPersonalPlaybookRule(playbook.id, statement, (playbook.rules.at(-1)?.order ?? 0) + 10))} onUpdate={(ruleId, patch) => void mutatePlaybookRule(playbook.id, () => updatePersonalPlaybookRule(playbook.id, ruleId, patch))} onDelete={(ruleId) => void mutatePlaybookRule(playbook.id, () => deletePersonalPlaybookRule(playbook.id, ruleId))} onRollback={(ruleId, versionId) => void mutatePlaybookRule(playbook.id, () => rollbackPersonalPlaybookRule(playbook.id, ruleId, versionId))} />)}</div> : <p className="mt-4 rounded-xl bg-surface-muted px-4 py-3 text-sm text-fg-muted">{t.emptyPlaybooks}</p>}
          </section>
        </div>
      ) : null}

      {data && view === 'sources' ? (
        <SourcesPanel
          sources={data.sources}
          recommendations={data.sourceRecommendations}
          language={language}
          t={t}
          busyId={busyId}
          onAddSource={() => navigate('/connectors?personalContext=1')}
          onConnectRecommendation={(sourceId) => navigate(`/connectors?personalContext=1&connector=${encodeURIComponent(sourceId)}&returnTo=%2Fyou%3Ftab%3Dsources`)}
          onLearn={(source) => void runSourceLearning(source)}
          onPause={(source) => void pauseSourceLearning(source)}
          onConfigure={openSourceConfiguration}
          onDisconnect={setDisconnectSource}
          onViewUnderstanding={() => selectView('memory')}
        />
      ) : null}

      {data && view === 'dreaming' ? <DreamingPanel language={language} /> : null}

      {data && view === 'privacy' && controls ? (
        <div id="you-panel-privacy" role="tabpanel" aria-labelledby="you-tab-privacy" className="space-y-6">
          <section>
            <h2 className="text-base font-semibold text-fg">{t.privacyTitle}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{t.privacyHint}</p>
          </section>
          <div className="grid gap-6 xl:grid-cols-2">
            <section><h2 className="text-base font-semibold text-fg">{t.controlTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.controlHint}</p><div className="mt-4 space-y-3 rounded-2xl border border-edge-subtle bg-surface-base p-5"><label className="grid gap-1.5 text-sm font-medium text-fg">{t.learningMode}<Select value={controls.mode} disabled={controlsSaving} onChange={(event) => void saveControls({ ...controls, mode: event.target.value as typeof controls.mode })}>{Object.entries(t.learningModes).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label><label className="grid gap-1.5 text-sm font-medium text-fg">{t.sensitive}<Select value={controls.sensitiveWritePolicy} disabled={controlsSaving} onChange={(event) => void saveControls({ ...controls, sensitiveWritePolicy: event.target.value as typeof controls.sensitiveWritePolicy })}>{Object.entries(t.sensitiveOptions).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select><span className="font-normal leading-5 text-fg-subtle">{t.sensitiveOptionHints[controls.sensitiveWritePolicy]}</span></label><p className="text-right text-xs text-fg-subtle">{controlsSaving ? t.saving : t.autoSaveHint}</p></div></section>
            <section><h2 className="text-base font-semibold text-fg">{t.trustTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.trustHint}</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{data.trust.levels.map((level) => <button key={level} type="button" aria-pressed={level === data.trust.defaultActionLevel} disabled={trustSaving} onClick={() => { if (level === data.trust.defaultActionLevel) return; if (level === 'auto') setPendingTrustLevel(level); else void selectTrustLevel(level); }} className={cn('rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-70', level === data.trust.defaultActionLevel ? 'border-accent/35 bg-accent-soft/35' : 'border-edge-subtle bg-surface-panel hover:border-accent/25 hover:bg-surface-hover')}><p className="text-xs font-semibold text-fg">{t.trustLevels[level]}</p><p className="mt-1 text-xs leading-5 text-fg-muted">{t.trustLevelHints[level]}</p>{level === data.trust.defaultActionLevel ? <span className="mt-2 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-fg">{t.defaultTrust}</span> : null}</button>)}</div></section>
          </div>
          <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /><div><h2 className="text-sm font-semibold text-fg">{t.sharingTitle}</h2><p className="mt-1 text-sm leading-6 text-fg-muted">{t.sharingHint}</p></div></div></section>
          <section><h2 className="text-base font-semibold text-fg">{t.grantsTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.grantsHint}</p>{data.referenceGrants.length > 0 ? <div className="mt-3 divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-surface-panel">{data.referenceGrants.map((grant) => <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm text-fg">{grant.statement}</p><p className="mt-1 text-xs text-fg-subtle">{grant.grantScope ? t.grantScopes[grant.grantScope] : ''}{grant.expiresAt ? ` · ${formatDateTime(grant.expiresAt, language)}` : ''}</p></div><Button type="button" variant="ghost" className="h-8 px-2.5" disabled={busyId === `grant:${grant.id}`} onClick={() => void revokeGrant(grant.id)}>{t.revoke}</Button></div>)}</div> : <p className="mt-3 rounded-xl bg-surface-muted px-4 py-3 text-sm text-fg-muted">{t.noGrants}</p>}</section>
          <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5"><h2 className="text-base font-semibold text-fg">{t.transferTitle}</h2><div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={transferBusy !== null} onClick={() => void downloadUserContext()}><Download className="size-4" aria-hidden />{transferBusy === 'export' ? t.exporting : t.exportAction}</Button><Button type="button" variant="secondary" disabled={transferBusy !== null} onClick={() => importInputRef.current?.click()}><Upload className="size-4" aria-hidden />{transferBusy === 'import' ? t.importing : t.importAction}</Button><input ref={importInputRef} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => setPendingImportFile(event.target.files?.[0] ?? null)} /></div></section>
        </div>
      ) : null}

      <ConfirmDialog open={forgetItem !== null} title={t.forgetTitle} description={t.forgetBody} confirmLabel={t.forget} cancelLabel={t.cancel} destructive onConfirm={() => void confirmForget()} onCancel={() => setForgetItem(null)} />
      <ConfirmDialog open={pendingTrustLevel === 'auto'} title={t.autoConfirmTitle} description={t.autoConfirmBody} confirmLabel={t.autoConfirmAction} cancelLabel={t.cancel} onConfirm={() => void selectTrustLevel('auto')} onCancel={() => setPendingTrustLevel(null)} />
      <ConfirmDialog open={pendingImportFile !== null} title={t.importConfirmTitle} description={t.importConfirmBody.replace('{{name}}', pendingImportFile?.name ?? '')} confirmLabel={t.importConfirmAction} cancelLabel={t.cancel} onConfirm={() => { const file = pendingImportFile; setPendingImportFile(null); void uploadUserContext(file); }} onCancel={cancelImport} />
      <SourceDisconnectDialog source={disconnectSource} language={language} busy={disconnecting} onOpenChange={(open) => { if (!open) setDisconnectSource(null); }} onConfirm={(understandingPolicy) => void confirmDisconnectSource(understandingPolicy)} />
      <AboutYouExplainerDialog open={helpOpen} t={t} onOpenChange={setHelpOpen} onNavigate={selectView} />
    </main>
  );
}
