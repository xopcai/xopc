import {
  Brain,
  BookOpen,
  Check,
  ChevronRight,
  CircleUserRound,
  HeartHandshake,
  Lightbulb,
  Pencil,
  Plug,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageTabs } from '@/components/ui/page-tabs';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { detectBrowserTimezone } from '@/features/settings/agents/agent-profile-markdown';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { showToast } from '@/lib/toast';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import {
  fetchUserContext,
  forgetUnderstanding,
  updateUnderstanding,
  updateInsightSuggestion,
  updateUserProfile,
  updateUserProfilePrompt,
  updateUserTrust,
  setPersonalPlaybookEnabled,
  updateUserContextControls,
  type PersonalContextSource,
  type InsightSuggestion,
  type PersonalPlaybook,
  type UserContextFacet,
  type UserContextResponse,
  type UserProfileFields,
  type UserProfileSetup,
  type UserTrustLevel,
  type UserUnderstanding,
} from './user-context-api';

type ViewId = 'overview' | 'review' | 'privacy';

const FACET_ORDER: UserContextFacet[] = [
  'collaboration',
  'priorities',
  'boundaries',
  'people',
  'current',
  'basics',
];

const inputClass = 'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent/50 focus:ring-2 focus:ring-accent/20';

function replaceCount(template: string, count: number): string {
  return template.replace('{{count}}', String(count));
}

function UserContextSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-36 rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}

function originLabel(item: UserUnderstanding, t: ReturnType<typeof messages>['you']): string {
  if (item.origin === 'connected_source') {
    return t.origins.connected_source.replace('{{source}}', item.sourceName);
  }
  return t.origins[item.origin];
}

function UnderstandingCard({
  item,
  t,
  busy,
  onConfirm,
  onReject,
  onUpdate,
  onForget,
}: {
  item: UserUnderstanding;
  t: ReturnType<typeof messages>['you'];
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onUpdate: (content: string) => void;
  onForget: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.statement);
  const needsReview = item.status === 'candidate' || item.status === 'needs_review';
  return (
    <article className={cn(
      'rounded-xl border p-3.5',
      needsReview ? 'border-warning/35 bg-warning-soft/35' : 'border-edge-subtle bg-surface-panel',
    )}>
      {editing ? (
        <div className="space-y-2">
          <textarea
            className={cn(inputClass, 'min-h-20 resize-y')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t.updatePlaceholder}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => {
              setDraft(item.statement);
              setEditing(false);
            }}>
              {t.cancel}
            </Button>
            <Button type="button" variant="primary" className="h-8 px-2" disabled={busy || !draft.trim()} onClick={() => {
              onUpdate(draft.trim());
              setEditing(false);
            }}>
              {t.save}
            </Button>
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
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {needsReview ? (
                <>
                  <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onConfirm}>
                    <Check className="size-3.5" aria-hidden />
                    {t.confirm}
                  </Button>
                  <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onReject}>
                    <X className="size-3.5" aria-hidden />
                    {t.notTrue}
                  </Button>
                </>
              ) : null}
              <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" aria-hidden />
                {t.change}
              </Button>
              <Button type="button" variant="ghost" className="h-8 px-2" disabled={busy} onClick={onForget}>
                <Trash2 className="size-3.5" aria-hidden />
                {t.forget}
              </Button>
            </div>
          </div>
        </>
      )}
    </article>
  );
}

function SourceCard({ source, t }: { source: PersonalContextSource; t: ReturnType<typeof messages>['you'] }) {
  const status = source.installed ? (source.enabled ? t.connected : t.paused) : t.available;
  return (
    <article className="rounded-xl border border-edge-subtle bg-surface-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-fg">
            <Plug className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">{source.displayName}</h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">{source.description}</p>
          </div>
        </div>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-1 text-[11px] font-medium',
          source.installed && source.enabled ? 'bg-success-soft text-fg' : 'bg-surface-hover text-fg-muted',
        )}>
          {status}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-fg-subtle">
        {source.capabilities.includes('context') ? <span>{t.sourceContext}</span> : null}
        {source.capabilities.includes('memory_source') ? <span>{t.sourceMemory}</span> : null}
      </div>
    </article>
  );
}

function FirstMeetingCard({
  suggestion,
  draft,
  busy,
  onDraftChange,
  onSave,
  onLater,
  t,
}: {
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
      <div className="absolute -right-10 -top-12 size-40 rounded-full bg-accent/10 blur-3xl" aria-hidden />
      <div className="relative max-w-2xl">
        <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-accent text-white shadow-sm">
          <HeartHandshake className="size-5" aria-hidden />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-fg">
          {suggestion ? t.meetSuggestedTitle.replace('{{name}}', suggestion.value) : t.meetTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">
          {suggestion ? t.meetSuggestedBody : t.meetBody}
        </p>
        <div className="mt-5 flex max-w-xl flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="you-call-name">{t.callName}</label>
          <input
            id="you-call-name"
            value={draft}
            maxLength={80}
            autoFocus
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draft.trim() && !busy) onSave();
            }}
            placeholder={t.meetPlaceholder}
            className={cn(inputClass, 'h-10 flex-1 bg-surface-base/90')}
          />
          <Button type="button" variant="primary" className="h-10 shrink-0" disabled={busy || !draft.trim()} onClick={onSave}>
            {busy ? t.meetSaving : t.meetSave}
          </Button>
        </div>
        {suggestion ? (
          <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-fg-subtle">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            <span>{t.meetSource}</span>
          </p>
        ) : null}
        <button type="button" disabled={busy} className="mt-3 text-xs font-medium text-fg-muted hover:text-fg hover:underline disabled:opacity-60" onClick={onLater}>
          {t.meetLater}
        </button>
      </div>
    </section>
  );
}

export function UserContextPage() {
  const language = useLocaleStore((state) => state.language);
  const t = messages(language).you;
  const navigate = useNavigate();
  const setPageHeader = usePageHeaderStore((state) => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore((state) => state.clearPageHeader);
  const { data, error, isLoading, mutate } = useSWR<UserContextResponse>('/api/you', fetchUserContext);
  const [view, setView] = useState<ViewId>('overview');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [forgetItem, setForgetItem] = useState<UserUnderstanding | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState<UserProfileFields | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [callNameDraft, setCallNameDraft] = useState('');
  const [profilePromptSaving, setProfilePromptSaving] = useState(false);
  const [controlsDraft, setControlsDraft] = useState<UserContextResponse['controls'] | null>(null);
  const [controlsSaving, setControlsSaving] = useState(false);
  const [trustSaving, setTrustSaving] = useState(false);
  const [showAllUnderstanding, setShowAllUnderstanding] = useState(false);

  const profile = data?.profile ?? { callName: '', pronouns: '', timezone: '', notes: '' };
  const active = useMemo(() => data?.understanding.filter((item) => item.status === 'active') ?? [], [data]);
  const review = useMemo(() => data?.understanding.filter((item) => item.status !== 'active') ?? [], [data]);
  const grouped = useMemo(() => new Map(FACET_ORDER.map((facet) => [
    facet,
    active.filter((item) => item.facet === facet),
  ])), [active]);
  const controls = controlsDraft ?? data?.controls ?? null;
  const strongCount = active.filter((item) => item.stability === 'strong').length;
  const connectedSourceCount = data?.sources.filter((source) => source.installed && source.enabled).length ?? 0;

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{t.title}</h1>
          <p className="truncate text-xs text-fg-muted">{t.subtitle}</p>
        </div>
      ),
      end: null,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, setPageHeader, t.subtitle, t.title]);

  useEffect(() => {
    if (!data || data.profile.callName) return;
    setCallNameDraft(data.profileSetup.callNameSuggestion?.value ?? '');
  }, [data?.profile.callName, data?.profileSetup.callNameSuggestion?.id]);

  async function runUnderstandingAction(item: UserUnderstanding, action: 'confirm' | 'reject' | 'update', content?: string) {
    setBusyId(item.id);
    try {
      await updateUnderstanding(item.id, { action, content });
      await mutate();
    } catch {
      showToast({ type: 'error', title: t.title, message: t.saveError });
    } finally {
      setBusyId(null);
    }
  }

  async function runInsightAction(item: InsightSuggestion, action: 'apply' | 'dismiss') {
    setBusyId(`insight:${item.id}`);
    try {
      const result = await updateInsightSuggestion(item.id, { action, uiLocale: language });
      await mutate();
      if (action === 'apply' && result.href) navigate(result.href);
    } catch {
      showToast({ type: 'error', title: t.insightsTitle, message: t.saveError });
    } finally {
      setBusyId(null);
    }
  }

  async function togglePlaybook(item: PersonalPlaybook) {
    setBusyId(`playbook:${item.id}`);
    try {
      await setPersonalPlaybookEnabled(item.id, !item.enabled);
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
      setForgetItem(null);
      await mutate();
    } catch {
      showToast({ type: 'error', title: t.title, message: t.saveError });
    } finally {
      setBusyId(null);
    }
  }

  async function saveProfile() {
    if (!profileDraft) return;
    setProfileSaving(true);
    try {
      const saved = await updateUserProfile(profileDraft);
      setProfileEditing(false);
      setProfileDraft(null);
      await mutate((current) => current ? { ...current, ...saved } : current, { revalidate: false });
    } catch {
      showToast({ type: 'error', title: t.title, message: t.saveError });
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveCallName() {
    const callName = callNameDraft.trim();
    if (!callName || profilePromptSaving) return;
    setProfilePromptSaving(true);
    try {
      const saved = await updateUserProfile({
        callName,
        timezone: profile.timezone || detectBrowserTimezone(),
      });
      await mutate((current) => current ? { ...current, ...saved } : current, { revalidate: false });
    } catch {
      showToast({ type: 'error', title: t.title, message: t.saveError });
    } finally {
      setProfilePromptSaving(false);
    }
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

  async function saveControls() {
    if (!controls) return;
    setControlsSaving(true);
    try {
      const saved = await updateUserContextControls(controls);
      setControlsDraft(saved);
      await mutate();
    } catch {
      showToast({ type: 'error', title: t.title, message: t.saveError });
    } finally {
      setControlsSaving(false);
    }
  }

  async function selectTrustLevel(level: UserTrustLevel) {
    if (trustSaving || level === data?.trust.defaultActionLevel) return;
    setTrustSaving(true);
    try {
      const trust = await updateUserTrust(level);
      await mutate((current) => current ? { ...current, trust } : current, { revalidate: false });
    } catch {
      showToast({ type: 'error', title: t.trustTitle, message: t.saveError });
    } finally {
      setTrustSaving(false);
    }
  }

  const tabs = [
    { id: 'overview' as const, label: t.tabs.overview, icon: HeartHandshake },
    { id: 'review' as const, label: t.tabs.review, icon: Brain, count: review.length || undefined },
    { id: 'privacy' as const, label: t.tabs.privacy, icon: ShieldCheck },
  ];

  return (
    <main className="flex w-full flex-1 flex-col gap-5 px-3 py-6 sm:px-5 xl:px-6">
      <PageTabs items={tabs} activeTab={view} onChange={setView} ariaLabel={t.title} tabIdPrefix="you-tab" panelIdPrefix="you-panel" />

      {isLoading ? <UserContextSkeleton /> : error || !data ? (
        <div className="rounded-2xl border border-danger/25 bg-danger-soft p-5 text-sm text-danger">{t.loadError}</div>
      ) : null}

      {data && view === 'overview' ? (
        <div id="you-panel-overview" role="tabpanel" aria-labelledby="you-tab-overview" className="space-y-4">
          {!profile.callName && data.profileSetup.shouldPrompt ? (
            <FirstMeetingCard
              suggestion={data.profileSetup.callNameSuggestion}
              draft={callNameDraft}
              busy={profilePromptSaving}
              onDraftChange={setCallNameDraft}
              onSave={() => void saveCallName()}
              onLater={() => void snoozeProfilePrompt()}
              t={t}
            />
          ) : (
            <section className="relative overflow-hidden rounded-2xl border border-accent/15 bg-gradient-to-br from-accent-soft/70 via-surface-panel to-surface-panel p-5 sm:p-6">
              <div className="absolute -right-10 -top-12 size-40 rounded-full bg-accent/10 blur-3xl" aria-hidden />
              <div className="relative max-w-2xl">
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-accent text-white shadow-sm"><HeartHandshake className="size-5" aria-hidden /></div>
                <h2 className="text-xl font-semibold tracking-tight text-fg">{t.heroTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-fg-muted">{t.heroBody}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full bg-surface-panel/80 px-3 py-1.5 text-xs font-medium text-fg-muted">{replaceCount(t.knownCount, active.length)}</span>
                  {review.length > 0 ? <button type="button" className="rounded-full bg-warning-soft px-3 py-1.5 text-xs font-medium text-fg hover:underline" onClick={() => setView('review')}>{replaceCount(t.reviewCount, review.length)}</button> : <span className="rounded-full bg-success-soft px-3 py-1.5 text-xs font-medium text-fg">{t.upToDate}</span>}
                </div>
              </div>
            </section>
          )}

          {data.insights.length > 0 ? (
            <section className="rounded-2xl border border-accent/15 bg-surface-base p-5">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><Lightbulb className="size-4 text-accent" aria-hidden />{t.insightsTitle}</h2>
                <p className="mt-1 text-xs text-fg-muted">{t.insightsHint}</p>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {data.insights.map((item) => (
                  <article key={item.id} className="rounded-xl border border-edge-subtle bg-surface-panel p-4">
                    <p className="text-sm leading-6 text-fg">{item.insight}</p>
                    <p className="mt-2 text-xs text-fg-subtle">{item.evidenceCount > 1 ? replaceCount(t.insightEvidence, item.evidenceCount) : t.insightReason}</p>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button type="button" variant="ghost" className="h-8 px-2" disabled={busyId === `insight:${item.id}`} onClick={() => void runInsightAction(item, 'dismiss')}>{t.notNow}</Button>
                      <Button type="button" variant="primary" className="h-8 px-2" disabled={busyId === `insight:${item.id}`} onClick={() => void runInsightAction(item, 'apply')}>{t.insightActions[item.action]}</Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {data.playbooks.length > 0 ? (
            <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><BookOpen className="size-4 text-accent" aria-hidden />{t.playbooksTitle}</h2>
                <p className="mt-1 text-xs text-fg-muted">{t.playbooksHint}</p>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {data.playbooks.map((playbook) => (
                  <article key={playbook.id} className={cn('rounded-xl border p-4', playbook.enabled ? 'border-edge-subtle bg-surface-panel' : 'border-edge-subtle bg-surface-muted opacity-75')}>
                    <div className="flex items-start justify-between gap-3">
                      <div><h3 className="text-sm font-semibold text-fg">{t.playbookNames[playbook.id]}</h3><p className="mt-1 text-xs text-fg-muted">{replaceCount(t.playbookRuleCount, playbook.rules.length)}</p></div>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px]', playbook.enabled ? 'bg-success-soft text-fg' : 'bg-surface-hover text-fg-muted')}>{playbook.enabled ? t.playbookActive : t.playbookPaused}</span>
                    </div>
                    <ul className="mt-3 space-y-2">{playbook.rules.slice(0, 4).map((rule) => <li key={rule.id} className="text-xs leading-5 text-fg-muted">• {rule.statement}</li>)}</ul>
                    <div className="mt-3 flex justify-end"><Button type="button" variant="ghost" className="h-8 px-2" disabled={busyId === `playbook:${playbook.id}`} onClick={() => void togglePlaybook(playbook)}>{playbook.enabled ? t.pausePlaybook : t.resumePlaybook}</Button></div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><CircleUserRound className="size-4 text-accent" aria-hidden />{t.profileTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.profileHint}</p></div>
                {!profileEditing ? <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => { setProfileDraft(profile); setProfileEditing(true); }}><Pencil className="size-3.5" aria-hidden />{t.edit}</Button> : null}
              </div>
              {profileEditing && profileDraft ? (
                <div className="mt-4 space-y-3">
                  <label className="block text-xs font-medium text-fg-muted">{t.callName}<input className={cn(inputClass, 'mt-1')} value={profileDraft.callName} onChange={(event) => setProfileDraft({ ...profileDraft, callName: event.target.value })} /></label>
                  <label className="block text-xs font-medium text-fg-muted">{t.timezone}<input className={cn(inputClass, 'mt-1')} value={profileDraft.timezone} onChange={(event) => setProfileDraft({ ...profileDraft, timezone: event.target.value })} /></label>
                  <label className="block text-xs font-medium text-fg-muted">{t.notes}<textarea className={cn(inputClass, 'mt-1 min-h-24 resize-y')} value={profileDraft.notes} placeholder={t.notesPlaceholder} onChange={(event) => setProfileDraft({ ...profileDraft, notes: event.target.value })} /></label>
                  <div className="flex justify-end gap-2"><Button type="button" variant="ghost" className="h-8 px-2" onClick={() => { setProfileEditing(false); setProfileDraft(null); }}>{t.cancel}</Button><Button type="button" variant="primary" className="h-8 px-2" disabled={profileSaving} onClick={() => void saveProfile()}>{profileSaving ? t.saving : t.save}</Button></div>
                </div>
              ) : (
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-xs text-fg-subtle">{t.callName}</dt><dd className="mt-1 text-sm text-fg">{profile.callName || '—'}</dd></div>
                  <div><dt className="text-xs text-fg-subtle">{t.timezone}</dt><dd className="mt-1 text-sm text-fg">{profile.timezone || '—'}</dd></div>
                  {profile.notes ? <div className="sm:col-span-2"><dt className="text-xs text-fg-subtle">{t.notes}</dt><dd className="mt-1 line-clamp-3 text-sm leading-6 text-fg">{profile.notes}</dd></div> : null}
                </dl>
              )}
            </section>

            <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><Brain className="size-4 text-accent" aria-hidden />{t.understandingTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.understandingHint}</p></div>
                <Button type="button" variant="ghost" className="h-8 px-2" onClick={() => setView('review')} aria-label={t.tabs.review}><ChevronRight className="size-4" aria-hidden /></Button>
              </div>
              <div className="mt-4 space-y-2">{active.slice(0, 4).map((item) => <div key={item.id} className="rounded-lg bg-surface-panel px-3 py-2.5 text-sm leading-5 text-fg">{item.statement}</div>)}{active.length === 0 ? <p className="py-5 text-center text-sm text-fg-muted">{t.emptyUnderstanding}</p> : null}</div>
            </section>
          </div>

          <section className="rounded-2xl border border-edge-subtle bg-surface-base p-5">
            <div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-fg"><ShieldCheck className="size-4 text-accent" aria-hidden />{t.trustTitle}</h2><p className="mt-1 text-xs text-fg-muted">{t.trustHint}</p></div><Button type="button" variant="ghost" className="h-8 px-2" onClick={() => setView('privacy')} aria-label={t.tabs.privacy}><ChevronRight className="size-4" aria-hidden /></Button></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-surface-panel p-3"><p className="text-xl font-semibold text-fg">{strongCount}</p><p className="mt-1 text-xs text-fg-muted">{t.stableUnderstandings}</p></div>
              <div className="rounded-xl bg-surface-panel p-3"><p className="text-xl font-semibold text-fg">{connectedSourceCount}</p><p className="mt-1 text-xs text-fg-muted">{t.connectedSources}</p></div>
              <div className="rounded-xl bg-surface-panel p-3"><p className="text-xl font-semibold text-fg">{review.length}</p><p className="mt-1 text-xs text-fg-muted">{t.waitingReview}</p></div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              {data.trust.levels.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={level === data.trust.defaultActionLevel}
                  disabled={trustSaving}
                  onClick={() => void selectTrustLevel(level)}
                  className={cn(
                    'rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-70',
                    level === data.trust.defaultActionLevel
                      ? 'border-accent/35 bg-accent-soft/35'
                      : 'border-edge-subtle bg-surface-panel hover:border-accent/25 hover:bg-surface-hover',
                  )}
                >
                  <p className="text-xs font-semibold text-fg">{t.trustLevels[level]}</p>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">{t.trustLevelHints[level]}</p>
                  {level === data.trust.defaultActionLevel ? <span className="mt-2 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent-fg">{t.defaultTrust}</span> : null}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-fg-subtle">{t.autoOptInPromise}</p>
          </section>
        </div>
      ) : null}

      {data && view === 'review' ? (
        <div id="you-panel-review" role="tabpanel" aria-labelledby="you-tab-review" className="space-y-5">
          {review.length > 0 ? <section><h2 className="text-base font-semibold text-fg">{t.reviewTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.reviewHint}</p><div className="mt-3 grid gap-3 lg:grid-cols-2">{review.map((item) => <UnderstandingCard key={item.id} item={item} t={t} busy={busyId === item.id} onConfirm={() => void runUnderstandingAction(item, 'confirm')} onReject={() => void runUnderstandingAction(item, 'reject')} onUpdate={(content) => void runUnderstandingAction(item, 'update', content)} onForget={() => setForgetItem(item)} />)}</div></section> : active.length > 0 ? <div className="rounded-2xl border border-success/20 bg-success-soft p-6 text-center"><Check className="mx-auto size-5 text-success" aria-hidden /><h2 className="mt-2 text-sm font-semibold text-fg">{t.nothingToReview}</h2><p className="mt-1 text-sm text-fg-muted">{t.nothingToReviewHint}</p></div> : null}
          {active.length > 0 ? <section className="border-t border-edge-subtle pt-4"><Button type="button" variant="ghost" className="px-2" onClick={() => setShowAllUnderstanding((value) => !value)}>{showAllUnderstanding ? t.hideAll : t.showAll}<ChevronRight className={cn('size-4 transition-transform', showAllUnderstanding && 'rotate-90')} aria-hidden /></Button>{showAllUnderstanding ? <div className="mt-4 space-y-5">{FACET_ORDER.map((facet) => { const items = grouped.get(facet) ?? []; if (items.length === 0) return null; return <section key={facet}><h2 className="text-sm font-semibold text-fg">{t.facets[facet]}</h2><div className="mt-3 grid gap-3 lg:grid-cols-2">{items.map((item) => <UnderstandingCard key={item.id} item={item} t={t} busy={busyId === item.id} onConfirm={() => void runUnderstandingAction(item, 'confirm')} onReject={() => void runUnderstandingAction(item, 'reject')} onUpdate={(content) => void runUnderstandingAction(item, 'update', content)} onForget={() => setForgetItem(item)} />)}</div></section>; })}</div> : null}</section> : null}
          {data.understanding.length === 0 ? <div className="rounded-2xl border border-dashed border-edge p-10 text-center text-sm text-fg-muted">{t.emptyUnderstanding}</div> : null}
        </div>
      ) : null}

      {data && view === 'privacy' && controls ? (
        <div id="you-panel-privacy" role="tabpanel" aria-labelledby="you-tab-privacy" className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
          <section><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-fg">{t.sourcesTitle}</h2><p className="mt-1 max-w-2xl text-sm text-fg-muted">{t.sourcesHint}</p></div><Button type="button" variant="secondary" onClick={() => navigate('/connectors')}>{t.manageSources}<ChevronRight className="size-4" aria-hidden /></Button></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{data.sources.map((source) => <SourceCard key={source.id} source={source} t={t} />)}</div>{data.sources.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-edge p-8 text-center text-sm text-fg-muted">{t.noSources}</div> : null}</section>
          <section><h2 className="text-base font-semibold text-fg">{t.controlTitle}</h2><p className="mt-1 text-sm text-fg-muted">{t.controlHint}</p><div className="mt-4 space-y-3 rounded-2xl border border-edge-subtle bg-surface-base p-5"><label className="grid gap-1.5 text-sm font-medium text-fg">{t.learningMode}<Select value={controls.mode} onChange={(event) => setControlsDraft({ ...controls, mode: event.target.value as typeof controls.mode })}>{Object.entries(t.learningModes).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label><label className="grid gap-1.5 text-sm font-medium text-fg">{t.sensitive}<Select value={controls.sensitiveWritePolicy} onChange={(event) => setControlsDraft({ ...controls, sensitiveWritePolicy: event.target.value as typeof controls.sensitiveWritePolicy })}>{Object.entries(t.sensitiveOptions).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label><label className="grid gap-1.5 text-sm font-medium text-fg">{t.sharing}<Select value={controls.crossAgentSharing} onChange={(event) => setControlsDraft({ ...controls, crossAgentSharing: event.target.value as typeof controls.crossAgentSharing })}>{Object.entries(t.sharingOptions).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}</Select></label><div className="flex items-start gap-2 rounded-xl bg-accent-soft/40 p-3 text-xs leading-5 text-fg-muted"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /><span>{t.transientPromise}</span></div><div className="flex justify-end pt-2"><Button type="button" variant="primary" disabled={controlsSaving} onClick={() => void saveControls()}>{controlsSaving ? t.saving : t.save}</Button></div></div></section>
        </div>
      ) : null}

      <ConfirmDialog open={forgetItem !== null} title={t.forgetTitle} description={t.forgetBody} confirmLabel={t.forget} cancelLabel={t.cancel} destructive onConfirm={() => void confirmForget()} onCancel={() => setForgetItem(null)} />
    </main>
  );
}
