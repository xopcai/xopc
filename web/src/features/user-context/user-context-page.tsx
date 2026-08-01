import {
  Brain,
  BookOpen,
  Check,
  ChevronRight,
  CircleUserRound,
  Database,
  Download,
  HeartHandshake,
  History,
  Lightbulb,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageTabs } from '@/components/ui/page-tabs';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { ConnectorLogo } from '@/features/connectors/components/connector-logo';
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
  setPersonalPlaybookEnabled,
  updateInsightSuggestion,
  updatePersonalPlaybookRule,
  updateUnderstanding,
  updateUserContextControls,
  updateUserProfile,
  updateUserProfilePrompt,
  type InsightSuggestion,
  type PersonalContextSource,
  type PersonalPlaybook,
  type UserContextFacet,
  type UserContextResponse,
  type UserProfileFields,
  type UserProfileSetup,
  type UserUnderstanding,
} from './user-context-api';
import { personalContextSourceBranding } from './source-branding';
import { SourceDisconnectDialog } from './source-disconnect-dialog';

type ViewId = 'overview' | 'profile' | 'understanding' | 'sources' | 'controls';

const VIEW_IDS = new Set<ViewId>(['overview', 'profile', 'understanding', 'sources', 'controls']);
const FACET_ORDER: UserContextFacet[] = ['collaboration', 'priorities', 'boundaries', 'people', 'current', 'basics'];
const inputClass = 'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/50 focus:ring-2 focus:ring-accent/20';

function replaceCount(template: string, count: number): string {
  return template.replace('{{count}}', String(count));
}

function formatDateTime(value: string, language: 'en' | 'zh'): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return formatMediumDateTime(timestamp, language);
}

function viewFromSearchParams(value: string | null): ViewId {
  if (value === 'review') return 'understanding';
  if (value === 'privacy') return 'controls';
  return value && VIEW_IDS.has(value as ViewId) ? value as ViewId : 'overview';
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
              <span className="rounded-full bg-surface-hover px-2 py-0.5">{t.stability[item.stability]}</span>
              {item.evidenceCount > 1 ? <span>{replaceCount(t.evidenceCount, item.evidenceCount)}</span> : null}
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
            </dl>
          </details>
          {history ? <div className="mt-2 space-y-2 border-t border-edge pt-2"><p className="text-xs font-medium text-fg-muted">{t.historyTitle}</p>{history.map((version) => <div key={version.id} className="flex items-start justify-between gap-3 text-xs"><p className="min-w-0 text-fg-muted">{version.statement}</p><span className="shrink-0 text-fg-subtle">{formatDateTime(version.updatedAt, language)}</span></div>)}</div> : null}
        </>
      )}
    </article>
  );
}

function SourceCard({ source, language, t, onConfigure, onDisconnect }: { source: PersonalContextSource; language: 'en' | 'zh'; t: ReturnType<typeof messages>['you']; onConfigure: () => void; onDisconnect: () => void }) {
  const status = source.installed ? (source.enabled ? t.connected : t.paused) : t.available;
  const accountLabel = source.accountLabel ?? (
    source.accountCount && source.accountCount > 1 && source.accountOrdinal
      ? t.sourceAccountFallback
        .replace('{{index}}', String(source.accountOrdinal))
        .replace('{{count}}', String(source.accountCount))
      : undefined
  );
  const healthStatus = source.lastHealthStatus
    ? t.sourceHealth.replace('{{status}}', source.lastHealthStatus === 'ok' ? t.healthOk : t.healthIssue)
    : null;
  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`${t.manageSources}: ${source.displayName}`}
      className="cursor-pointer rounded-xl border border-edge-subtle bg-surface-panel p-4 transition-colors hover:border-accent/30 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      onClick={onConfigure}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onConfigure();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <ConnectorLogo connector={{ displayName: source.displayName, branding: personalContextSourceBranding(source) }} size="sm" />
          <div className="min-w-0"><h3 className="text-sm font-semibold text-fg">{source.displayName}</h3>{accountLabel ? <p className="mt-0.5 truncate text-xs font-medium text-fg-muted">{accountLabel}</p> : null}<p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{source.description}</p></div>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-1 text-[11px] font-medium', source.installed && source.enabled ? 'bg-success-soft text-fg' : 'bg-surface-hover text-fg-muted')}>{status}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-fg-subtle">
        {source.access.context ? <span className="rounded-full bg-surface-hover px-2 py-0.5">{t.sourceContext}</span> : null}
        {source.access.memory ? <span className="rounded-full bg-surface-hover px-2 py-0.5">{t.sourceMemory}</span> : null}
        {source.access.read ? <span className="rounded-full bg-surface-hover px-2 py-0.5">{t.sourceRead}</span> : null}
        {source.access.write ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-fg">{t.sourceWrite}</span> : null}
      </div>
      {source.installed ? (
        <div className="mt-3 space-y-1 border-t border-edge-subtle pt-3 text-xs text-fg-muted">
          {healthStatus ? <p>{healthStatus}</p> : null}
          <p>{source.lastActivityAt ? t.sourceLastUsed.replace('{{time}}', formatDateTime(source.lastActivityAt, language)) : t.sourceNeverUsed}</p>
          {source.lastSyncAt ? <p>{t.sourceLastSync.replace('{{time}}', formatDateTime(source.lastSyncAt, language))}</p> : null}
          {source.lastSyncStatus === 'failed' && source.lastSyncError ? (
            <p className="text-danger">{t.sourceSyncFailed.replace('{{error}}', source.lastSyncError)}</p>
          ) : null}
          <p>{t.sourceKnowledgeCount.replace('{{count}}', String(source.knowledgeItemCount))}</p>
          <p>{t.sourceDerivedCount.replace('{{count}}', String(source.derivedUnderstandingCount))}</p>
        </div>
      ) : null}
      {source.installed && source.instanceId ? <div className="mt-3 flex justify-end border-t border-edge-subtle pt-3"><Button type="button" variant="ghost" className="h-8 px-2 text-danger hover:bg-danger-soft hover:text-danger" onClick={(event) => { event.stopPropagation(); onDisconnect(); }}>{t.disconnect}</Button></div> : null}
    </article>
  );
}

function PlaybookCard({ playbook, busy, t, onToggleGroup, onCreate, onUpdate, onDelete }: {
  playbook: PersonalPlaybook;
  busy: boolean;
  t: ReturnType<typeof messages>['you'];
  onToggleGroup: () => void;
  onCreate: (statement: string) => void;
  onUpdate: (ruleId: string, patch: { statement?: string; enabled?: boolean; order?: number }) => void;
  onDelete: (ruleId: string) => void;
}) {
  const [newRule, setNewRule] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  return <article className={cn('rounded-xl border p-4', playbook.enabled ? 'border-edge-subtle bg-surface-panel' : 'border-edge-subtle bg-surface-muted')}>
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-fg">{t.playbookNames[playbook.id]}</h3><p className="mt-1 text-xs text-fg-muted">{replaceCount(t.playbookRuleCount, playbook.rules.filter((rule) => rule.enabled).length)}</p></div><Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onToggleGroup}>{playbook.enabled ? t.pausePlaybook : t.resumePlaybook}</Button></div>
    <ul className="mt-3 space-y-2">{playbook.rules.map((rule, index) => <li key={rule.id} className={cn('rounded-lg border border-edge-subtle p-2.5', !rule.enabled && 'opacity-60')}>
      {editingId === rule.id ? <div className="space-y-2"><textarea className={cn(inputClass, 'min-h-16 resize-y')} value={editingText} onChange={(event) => setEditingText(event.target.value)} /><div className="flex justify-end gap-1"><Button type="button" variant="ghost" className="h-7 px-2" onClick={() => setEditingId(null)}>{t.cancel}</Button><Button type="button" variant="primary" className="h-7 px-2" disabled={!editingText.trim()} onClick={() => { onUpdate(rule.id, { statement: editingText.trim() }); setEditingId(null); }}>{t.save}</Button></div></div> : <><p className="text-xs leading-5 text-fg-muted">{rule.statement}</p><div className="mt-2 flex flex-wrap justify-end gap-1"><Button type="button" variant="ghost" className="h-7 px-2" disabled={busy || index === 0} onClick={() => onUpdate(rule.id, { order: playbook.rules[index - 1].order - 1 })}>{t.moveUp}</Button><Button type="button" variant="ghost" className="h-7 px-2" disabled={busy || index === playbook.rules.length - 1} onClick={() => onUpdate(rule.id, { order: playbook.rules[index + 1].order + 1 })}>{t.moveDown}</Button><Button type="button" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => onUpdate(rule.id, { enabled: !rule.enabled })}>{rule.enabled ? t.disableRule : t.enableRule}</Button><Button type="button" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => { setEditingId(rule.id); setEditingText(rule.statement); }}><Pencil className="size-3" aria-hidden />{t.edit}</Button><Button type="button" variant="ghost" className="h-7 px-2 text-danger" disabled={busy} onClick={() => onDelete(rule.id)}><Trash2 className="size-3" aria-hidden />{t.deleteRule}</Button></div></>}
    </li>)}</ul>
    <div className="mt-3 flex gap-2"><input className={inputClass} value={newRule} onChange={(event) => setNewRule(event.target.value)} placeholder={t.newRulePlaceholder} /><Button type="button" variant="secondary" disabled={busy || !newRule.trim()} onClick={() => { onCreate(newRule.trim()); setNewRule(''); }}>{t.addRule}</Button></div>
  </article>;
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
  const view = viewFromSearchParams(searchParams.get('tab'));
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const { data, error, isLoading, mutate } = useSWR<UserContextResponse>('/api/you', fetchUserContext);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingUnderstanding, setAddingUnderstanding] = useState(false);
  const [understandingDraft, setUnderstandingDraft] = useState('');
  const [understandingKind, setUnderstandingKind] = useState('preference');
  const [forgetItem, setForgetItem] = useState<UserUnderstanding | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState<UserProfileFields | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [callNameDraft, setCallNameDraft] = useState('');
  const [profilePromptSaving, setProfilePromptSaving] = useState(false);
  const [controlsDraft, setControlsDraft] = useState<UserContextResponse['controls'] | null>(null);
  const [controlsSaving, setControlsSaving] = useState(false);
  const [disconnectSource, setDisconnectSource] = useState<PersonalContextSource | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [transferBusy, setTransferBusy] = useState<'export' | 'import' | null>(null);
  const profileCardRef = useRef<HTMLElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const profile = data?.profile ?? { callName: '', pronouns: '', timezone: '', notes: '' };
  const active = useMemo(() => data?.understanding.filter((item) => item.status === 'active') ?? [], [data]);
  const review = useMemo(() => data?.understanding.filter((item) => item.status !== 'active') ?? [], [data]);
  const grouped = useMemo(() => new Map(FACET_ORDER.map((facet) => [facet, active.filter((item) => item.facet === facet)])), [active]);
  const controls = controlsDraft ?? data?.controls ?? null;
  const connectedSources = data?.sources.filter((source) => source.installed && source.enabled) ?? [];
  const unhealthySources = connectedSources.filter((source) => ['failed', 'unauthorized', 'degraded', 'not_configured'].includes(source.status));

  const selectView = (next: ViewId, status?: 'review') => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    if (status) params.set('status', status);
    else params.delete('status');
    setSearchParams(params, { replace: true });
  };

  const openSourceConfiguration = (source: Pick<PersonalContextSource, 'id' | 'instanceId'>) => {
    const params = new URLSearchParams({ connector: source.id });
    if (source.instanceId) params.set('instance', source.instanceId);
    navigate(`/connectors?${params.toString()}`);
  };

  useLayoutEffect(() => {
    setPageHeader({ startExtra: null, main: <div className="min-w-0"><h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1><p className="truncate text-xs text-fg-muted">{t.subtitle}</p></div>, end: null });
    return () => clearPageHeader();
  }, [clearPageHeader, setPageHeader, t.subtitle, t.title]);

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
    selectView('profile');
    requestAnimationFrame(() => profileCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function startUnderstanding(kind: string) {
    setUnderstandingKind(kind);
    setAddingUnderstanding(true);
    selectView('understanding');
  }

  async function saveControls() {
    if (!controls) return;
    setControlsSaving(true);
    try { const saved = await updateUserContextControls(controls); setControlsDraft(saved); await mutate(); showToast({ type: 'success', title: t.title, message: t.saved }); }
    catch { showToast({ type: 'error', title: t.title, message: t.saveError }); }
    finally { setControlsSaving(false); }
  }

  async function confirmDisconnectSource(deleteDerivedUnderstanding: boolean) {
    if (!disconnectSource?.instanceId || disconnecting) return;
    setDisconnecting(true);
    try {
      const result = await disconnectPersonalContextSource(disconnectSource.instanceId, deleteDerivedUnderstanding);
      setDisconnectSource(null);
      await mutate();
      showToast({
        type: 'success',
        title: t.sourcesTitle,
        message: deleteDerivedUnderstanding
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

  async function uploadUserContext(file: File | undefined) {
    if (!file || transferBusy) return;
    setTransferBusy('import');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('file too large');
      const payload = JSON.parse(await file.text()) as unknown;
      const result = await importUserContext(payload);
      await mutate();
      selectView('understanding', 'review');
      showToast({ type: 'success', title: t.transferTitle, message: t.importSuccess.replace('{{count}}', String(result.importedCount)).replace('{{skipped}}', String(result.skippedCount)) });
    } catch {
      showToast({ type: 'error', title: t.transferTitle, message: t.importError });
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
      setTransferBusy(null);
    }
  }

  const tabs = [
    { id: 'overview' as const, label: t.tabs.overview, icon: HeartHandshake },
    { id: 'profile' as const, label: t.tabs.profile, icon: CircleUserRound },
    { id: 'understanding' as const, label: t.tabs.understanding, icon: Brain, count: review.length || undefined },
    { id: 'sources' as const, label: t.tabs.sources, icon: Database },
    { id: 'controls' as const, label: t.tabs.controls, icon: ShieldCheck },
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

          {(review.length > 0 || unhealthySources.length > 0 || !profile.callName) ? (
            <section className="rounded-2xl border border-warning/25 bg-warning-soft/35 p-5">
              <h2 className="text-sm font-semibold text-fg">{t.attentionTitle}</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {review.length > 0 ? <Button type="button" variant="secondary" onClick={() => selectView('understanding', 'review')}>{replaceCount(t.reviewCount, review.length)}<ChevronRight className="size-4" aria-hidden /></Button> : null}
                {unhealthySources.length > 0 ? <Button type="button" variant="secondary" onClick={() => selectView('sources')}>{replaceCount(t.sourceIssues, unhealthySources.length)}<ChevronRight className="size-4" aria-hidden /></Button> : null}
                {!profile.callName ? <Button type="button" variant="secondary" onClick={openProfileEditor}>{t.completeProfile}<ChevronRight className="size-4" aria-hidden /></Button> : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-accent/15 bg-gradient-to-br from-accent-soft/55 via-surface-panel to-surface-panel p-5">
            <h2 className="text-lg font-semibold tracking-tight text-fg">{t.heroTitle}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{t.heroBody}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <button type="button" className="rounded-xl bg-surface-base/80 p-3 text-left" onClick={() => selectView('understanding')}><span className="text-xl font-semibold text-fg">{active.length}</span><span className="mt-1 block text-xs text-fg-muted">{t.knownSummary}</span></button>
              <button type="button" className="rounded-xl bg-surface-base/80 p-3 text-left" onClick={() => selectView('sources')}><span className="text-xl font-semibold text-fg">{connectedSources.length}</span><span className="mt-1 block text-xs text-fg-muted">{t.connectedSources}</span></button>
              <button type="button" className="rounded-xl bg-surface-base/80 p-3 text-left" onClick={() => selectView('understanding', 'review')}><span className="text-xl font-semibold text-fg">{review.length}</span><span className="mt-1 block text-xs text-fg-muted">{t.waitingReview}</span></button>
            </div>
          </section>

          {data.insights.length > 0 ? <section className="rounded-2xl border border-accent/15 bg-surface-base p-5"><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><Lightbulb className="size-4 text-accent" aria-hidden />{t.insightsTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.insightsHint}</p><div className="mt-4 grid gap-3 lg:grid-cols-2">{data.insights.map((item) => <article key={item.id} className="rounded-xl border border-edge-subtle bg-surface-panel p-4"><p className="text-sm leading-6 text-fg">{item.insight}</p><p className="mt-2 text-xs text-fg-subtle">{item.evidenceCount > 1 ? replaceCount(t.insightEvidence, item.evidenceCount) : t.insightReason}</p><div className="mt-3 flex justify-end gap-2"><Button type="button" variant="ghost" className="h-8 px-2" disabled={busyId === `insight:${item.id}`} onClick={() => void runInsightAction(item, 'dismiss')}>{t.notNow}</Button><Button type="button" variant="primary" className="h-8 px-2" disabled={busyId === `insight:${item.id}`} onClick={() => void runInsightAction(item, 'apply')}>{t.insightActions[item.action]}</Button></div></article>)}</div></section> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
              <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><CircleUserRound className="size-4 text-accent" aria-hidden />{t.profileTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.profileHint}</p></div><Button type="button" variant="ghost" className="h-8 px-2" onClick={() => selectView('profile')}><ChevronRight className="size-4" aria-hidden /></Button></div>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2"><div><dt className="text-xs text-fg-subtle">{t.callName}</dt><dd className="mt-1 text-sm text-fg">{profile.callName || '—'}</dd></div><div><dt className="text-xs text-fg-subtle">{t.timezone}</dt><dd className="mt-1 text-sm text-fg">{profile.timezone || '—'}</dd></div><div><dt className="text-xs text-fg-subtle">{t.pronouns}</dt><dd className="mt-1 text-sm text-fg">{profile.pronouns || '—'}</dd></div>{profile.notes ? <div className="sm:col-span-2"><dt className="text-xs text-fg-subtle">{t.notes}</dt><dd className="mt-1 line-clamp-2 text-sm leading-6 text-fg">{profile.notes}</dd></div> : null}</dl>
            </section>

            <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><Brain className="size-4 text-accent" aria-hidden />{t.understandingTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.understandingHint}</p></div><Button type="button" variant="ghost" className="h-8 px-2" onClick={() => selectView('understanding')}><ChevronRight className="size-4" aria-hidden /></Button></div><div className="mt-4 space-y-2">{active.slice(0, 4).map((item) => <div key={item.id} className="rounded-lg bg-surface-panel px-3 py-2.5 text-sm leading-5 text-fg">{item.statement}</div>)}{active.length === 0 ? <p className="py-5 text-center text-sm text-fg-muted">{t.emptyUnderstanding}</p> : null}</div></section>
          </div>

        </div>
      ) : null}

      {data && view === 'profile' ? (
        <div id="you-panel-profile" role="tabpanel" aria-labelledby="you-tab-profile" className="space-y-5">
          <div className="rounded-xl bg-surface-muted px-4 py-3 text-xs leading-5 text-fg-muted">
            {t.profileOwnershipHint}
          </div>
          <section ref={profileCardRef} id="you-profile-card" className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-fg"><CircleUserRound className="size-4 text-accent" aria-hidden />{t.profileTitle}</h2>
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
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">{t.structuredContextHint}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <button type="button" className="rounded-xl border border-edge-subtle bg-surface-panel p-4 text-left hover:border-accent/30 hover:bg-surface-hover" onClick={() => startUnderstanding('preference')}><span className="text-sm font-semibold text-fg">{t.addPreference}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{t.addPreferenceHint}</span></button>
              <button type="button" className="rounded-xl border border-edge-subtle bg-surface-panel p-4 text-left hover:border-accent/30 hover:bg-surface-hover" onClick={() => startUnderstanding('boundary')}><span className="text-sm font-semibold text-fg">{t.addBoundary}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{t.addBoundaryHint}</span></button>
              <button type="button" className="rounded-xl border border-edge-subtle bg-surface-panel p-4 text-left hover:border-accent/30 hover:bg-surface-hover" onClick={() => startUnderstanding('current_state')}><span className="text-sm font-semibold text-fg">{t.addCurrentFocus}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{t.addCurrentFocusHint}</span></button>
            </div>
          </section>

          <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-fg"><BookOpen className="size-4 text-accent" aria-hidden />{t.playbooksTitle}</h2>
            <p className="mt-1 text-sm text-fg-muted">{t.playbooksHint}</p>
            {data.playbooks.length > 0 ? <div className="mt-4 grid gap-3 xl:grid-cols-3">{data.playbooks.map((playbook) => <PlaybookCard key={playbook.id} playbook={playbook} busy={busyId === `playbook:${playbook.id}`} t={t} onToggleGroup={() => void togglePlaybook(playbook)} onCreate={(statement) => void mutatePlaybookRule(playbook.id, () => createPersonalPlaybookRule(playbook.id, statement, (playbook.rules.at(-1)?.order ?? 0) + 10))} onUpdate={(ruleId, patch) => void mutatePlaybookRule(playbook.id, () => updatePersonalPlaybookRule(playbook.id, ruleId, patch))} onDelete={(ruleId) => void mutatePlaybookRule(playbook.id, () => deletePersonalPlaybookRule(playbook.id, ruleId))} />)}</div> : <p className="mt-4 rounded-xl bg-surface-muted px-4 py-3 text-sm text-fg-muted">{t.emptyPlaybooks}</p>}
          </section>
        </div>
      ) : null}

      {data && view === 'understanding' ? (
        <div id="you-panel-understanding" role="tabpanel" aria-labelledby="you-tab-understanding" className="space-y-6">
          <div className="rounded-xl bg-surface-muted px-4 py-3 text-xs text-fg-muted">{t.memoryScope}</div>
          <section className="border-b border-edge pb-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-base font-semibold text-fg">{t.addUnderstanding}</h2><p className="mt-1 text-sm text-fg-muted">{t.addUnderstandingHint}</p></div>
              {!addingUnderstanding ? <Button type="button" variant="secondary" onClick={() => setAddingUnderstanding(true)}><Plus className="size-4" aria-hidden />{t.add}</Button> : null}
            </div>
            {addingUnderstanding ? <div className="mt-3 rounded-xl border border-edge bg-surface-panel p-3"><textarea className={cn(inputClass, 'min-h-24 resize-y')} value={understandingDraft} onChange={(event) => setUnderstandingDraft(event.target.value)} placeholder={t.understandingPlaceholder} /><div className="mt-3 flex flex-wrap items-end justify-between gap-3"><label className="grid min-w-48 gap-1 text-xs font-medium text-fg-muted">{t.understandingKind}<Select value={understandingKind} onChange={(event) => setUnderstandingKind(event.target.value)}>{Object.entries(t.understandingKinds).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label><div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => { setAddingUnderstanding(false); setUnderstandingDraft(''); }}>{t.cancel}</Button><Button type="button" variant="primary" disabled={!understandingDraft.trim() || busyId === 'understanding:new'} onClick={() => void addUnderstanding()}>{t.add}</Button></div></div></div> : null}
          </section>
          {data.conflictGroups.some((group) => group.unresolved) ? <section><h2 className="text-base font-semibold text-fg">{t.conflictsTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.conflictsHint}</p><div className="mt-3 space-y-3">{data.conflictGroups.filter((group) => group.unresolved).map((group) => <div key={group.id} className="divide-y divide-edge overflow-hidden rounded-xl border border-warning/35 bg-warning-soft/25">{group.records.filter((record) => record.storedStatus !== 'archived' && record.storedStatus !== 'rejected').map((record) => <div key={record.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="text-sm leading-6 text-fg">{record.statement}</p><p className="mt-1 text-xs text-fg-subtle">{originLabel(record, t)} · {formatDateTime(record.updatedAt, language)}</p></div><Button type="button" variant="secondary" className="h-8 shrink-0 px-2.5" disabled={busyId === `conflict:${group.id}`} onClick={() => void resolveConflict(group.id, record.id)}>{t.useThis}</Button></div>)}</div>)}</div></section> : null}
          {data.consentRequests.length > 0 ? <section className="space-y-3"><div><h2 className="text-base font-semibold text-fg">{t.consentTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.consentHint}</p></div>{data.consentRequests.map((request) => <article key={request.id} className="rounded-2xl border border-accent/25 bg-accent-soft/20 p-4"><p className="text-sm leading-6 text-fg">{request.statement}</p><p className="mt-2 text-xs text-fg-muted">{t.consentPurpose.replace('{{purpose}}', request.purpose)}</p><div className="mt-3 flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" disabled={busyId === `consent:${request.id}`} onClick={() => void decideConsent(request.id, 'deny')}>{t.consentDeny}</Button><Button type="button" variant="secondary" disabled={busyId === `consent:${request.id}`} onClick={() => void decideConsent(request.id, 'once')}>{t.consentOnce}</Button><Button type="button" variant="secondary" disabled={busyId === `consent:${request.id}`} onClick={() => void decideConsent(request.id, 'session')}>{t.consentSession}</Button><Button type="button" variant="primary" disabled={busyId === `consent:${request.id}`} onClick={() => void decideConsent(request.id, 'always')}>{t.consentAlways}</Button></div></article>)}</section> : null}
          {review.length > 0 ? <section><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-fg">{t.reviewTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.reviewHint}</p></div><Button type="button" variant="secondary" disabled={busyId === 'understanding:batch'} onClick={() => void confirmAllReview()}>{t.reviewAll}</Button></div><div className="mt-3 grid gap-3 lg:grid-cols-2">{review.map((item) => <UnderstandingCard key={item.id} item={item} language={language} t={t} busy={busyId === item.id} onConfirm={() => void runUnderstandingAction(item, 'confirm')} onReject={() => void runUnderstandingAction(item, 'reject')} onUpdate={(content) => void runUnderstandingAction(item, 'update', content)} onForget={() => setForgetItem(item)} />)}</div></section> : active.length > 0 ? <div className="rounded-2xl border border-success/20 bg-success-soft p-6 text-center"><Check className="mx-auto size-5 text-success" aria-hidden /><h2 className="mt-2 text-sm font-semibold text-fg">{t.nothingToReview}</h2><p className="mt-1 text-sm text-fg-muted">{t.nothingToReviewHint}</p></div> : null}
          {FACET_ORDER.map((facet) => { const items = grouped.get(facet) ?? []; if (items.length === 0) return null; return <section key={facet}><h2 className="text-sm font-semibold text-fg">{t.facets[facet]}</h2><div className="mt-3 grid gap-3 lg:grid-cols-2">{items.map((item) => <UnderstandingCard key={item.id} item={item} language={language} t={t} busy={busyId === item.id} onConfirm={() => void runUnderstandingAction(item, 'confirm')} onReject={() => void runUnderstandingAction(item, 'reject')} onUpdate={(content) => void runUnderstandingAction(item, 'update', content)} onForget={() => setForgetItem(item)} />)}</div></section>; })}
          {data.understanding.length === 0 ? <div className="rounded-2xl border border-dashed border-edge p-10 text-center text-sm text-fg-muted">{t.emptyUnderstanding}</div> : null}
        </div>
      ) : null}

      {data && view === 'sources' ? (
        <div id="you-panel-sources" role="tabpanel" aria-labelledby="you-tab-sources" className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-fg">{t.sourcesTitle}</h2><p className="mt-1 max-w-2xl text-sm text-fg-muted">{t.sourcesHint}</p></div><Button type="button" variant="primary" onClick={() => navigate('/connectors?tab=connected&personalContext=1')}>{t.manageSources}<ChevronRight className="size-4" aria-hidden /></Button></div>
          {data.sourceRecommendations.length > 0 ? <section className="rounded-2xl border border-accent/20 bg-accent-soft/25 p-5"><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><Target className="size-4 text-accent" aria-hidden />{t.recommendationsTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.recommendationsHint}</p><div className="mt-3 grid gap-2 lg:grid-cols-3">{data.sourceRecommendations.map((item) => <button key={item.sourceId} type="button" className="rounded-xl border border-edge-subtle bg-surface-panel p-3 text-left hover:border-accent/30 hover:bg-surface-hover" onClick={() => openSourceConfiguration({ id: item.sourceId })}><span className="text-sm font-semibold text-fg">{item.sourceName}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{t.recommendationReason.replace('{{goal}}', item.goalTitle)}</span></button>)}</div></section> : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.sources.map((source) => <SourceCard key={`${source.id}:${source.instanceId ?? 'catalog'}`} source={source} language={language} t={t} onConfigure={() => openSourceConfiguration(source)} onDisconnect={() => setDisconnectSource(source)} />)}</div>
          {data.sources.length === 0 ? <div className="rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-fg-muted">{t.noSources}</div> : null}
        </div>
      ) : null}

      {data && view === 'controls' && controls ? (
        <div id="you-panel-controls" role="tabpanel" aria-labelledby="you-tab-controls" className="space-y-6">
          <section><h2 className="text-base font-semibold text-fg">{t.controlTitle}</h2><p className="mt-1 max-w-2xl text-sm text-fg-muted">{t.controlHint}</p><div className="mt-4 max-w-2xl space-y-3 rounded-2xl border border-edge-subtle bg-surface-base p-5"><label className="grid gap-1.5 text-sm font-medium text-fg">{t.learningMode}<Select value={controls.mode} onChange={(event) => setControlsDraft({ ...controls, mode: event.target.value as typeof controls.mode })}>{Object.entries(t.learningModes).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label><label className="grid gap-1.5 text-sm font-medium text-fg">{t.sensitive}<Select value={controls.sensitiveWritePolicy} onChange={(event) => setControlsDraft({ ...controls, sensitiveWritePolicy: event.target.value as typeof controls.sensitiveWritePolicy })}>{Object.entries(t.sensitiveOptions).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label><div className="flex items-start gap-2 rounded-xl bg-accent-soft/40 p-3 text-xs leading-5 text-fg-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /><span>{t.transientPromise}</span></div><div className="flex justify-end pt-2"><Button type="button" variant="primary" disabled={controlsSaving} onClick={() => void saveControls()}>{controlsSaving ? t.saving : t.save}</Button></div></div></section>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge-subtle bg-surface-base p-5"><div><h2 className="text-base font-semibold text-fg">{t.actionBoundaryMovedTitle}</h2><p className="mt-1 max-w-2xl text-sm text-fg-muted">{t.actionBoundaryMovedHint}</p></div><Button type="button" variant="secondary" onClick={() => navigate('/settings/action-boundary')}>{t.manageActionBoundary}<ChevronRight className="size-4" aria-hidden /></Button></section>
          <section><h2 className="text-base font-semibold text-fg">{t.grantsTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.grantsHint}</p>{data.referenceGrants.length > 0 ? <div className="mt-3 divide-y divide-edge overflow-hidden rounded-xl border border-edge bg-surface-panel">{data.referenceGrants.map((grant) => <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm text-fg">{grant.statement}</p><p className="mt-1 text-xs text-fg-subtle">{grant.grantScope ? t.grantScopes[grant.grantScope] : ''}{grant.expiresAt ? ` · ${formatDateTime(grant.expiresAt, language)}` : ''}</p></div><Button type="button" variant="ghost" className="h-8 px-2.5" disabled={busyId === `grant:${grant.id}`} onClick={() => void revokeGrant(grant.id)}>{t.revoke}</Button></div>)}</div> : <p className="mt-3 rounded-xl bg-surface-muted px-4 py-3 text-sm text-fg-muted">{t.noGrants}</p>}</section>
          <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5"><h2 className="text-base font-semibold text-fg">{t.transferTitle}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-fg-muted">{t.transferHint}</p><div className="mt-4 flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={transferBusy !== null} onClick={() => void downloadUserContext()}><Download className="size-4" aria-hidden />{transferBusy === 'export' ? t.exporting : t.exportAction}</Button><Button type="button" variant="secondary" disabled={transferBusy !== null} onClick={() => importInputRef.current?.click()}><Upload className="size-4" aria-hidden />{transferBusy === 'import' ? t.importing : t.importAction}</Button><input ref={importInputRef} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void uploadUserContext(event.target.files?.[0])} /></div><p className="mt-3 text-xs leading-5 text-fg-subtle">{t.importPromise}</p></section>
        </div>
      ) : null}

      <ConfirmDialog open={forgetItem !== null} title={t.forgetTitle} description={t.forgetBody} confirmLabel={t.forget} cancelLabel={t.cancel} destructive onConfirm={() => void confirmForget()} onCancel={() => setForgetItem(null)} />
      <SourceDisconnectDialog source={disconnectSource} language={language} busy={disconnecting} onOpenChange={(open) => { if (!open) setDisconnectSource(null); }} onConfirm={(deleteDerivedUnderstanding) => void confirmDisconnectSource(deleteDerivedUnderstanding)} />
    </main>
  );
}
