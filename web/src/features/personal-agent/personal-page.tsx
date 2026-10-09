import { PersonalProactivitySetting } from './personal-proactivity-setting';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUpRight, ListTodo, Phone, Settings2, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { PopoverSelect } from '@/components/ui/popover-select';
import { ChatPage } from '@/features/chat/chat-page';
import { useVoiceCall } from '@/features/voice/realtime/voice-call-context';
import { bumpAgentAvatarCacheRevision } from '@/features/settings/agents/agent-avatar-cache';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { fetchJson } from '@/lib/fetch';
import { formatMediumDate } from '@/lib/date-formatters';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { PersonalAvatar, type PersonalAppearance } from './personal-avatar';
import { PersonalOnboarding } from './personal-onboarding';
import { PersonalVoiceSetting } from './personal-voice-setting';
import { PersonalModelSetting } from './personal-model-setting';

type Preferences = {
  addressAs?: string;
  warmth?: 'reserved' | 'balanced' | 'gentle';
  humor?: 'none' | 'occasional' | 'playful';
  supportMode?: 'listen' | 'untangle' | 'solutions';
  detailLevel?: 'brief' | 'balanced' | 'detailed';
  proactivity?: 'decisions' | 'important' | 'open';
};
export type PersonalAgent = {
  agentId: string;
  conversationId: string;
  state: 'provisioning' | 'ready' | 'error';
  displayName: string;
  userCallName?: string | null;
  appearance: PersonalAppearance;
  voicePreference: { provider: string; model: string; voice: string } | null;
  preferences: Preferences;
  revision: number;
  errorMessage: string | null;
};
type ModelOption = { id: string; name: string };
type ApiResult<T> = { ok: boolean; payload: T };
type Activity = { items: Array<{ id: string; title: string; phase: string; operationalState?: string; runStatus?: string; updatedAt: number }>; total: number };
type ActivityItem = Activity['items'][number];
type ProfileChanges = {
  displayName?: string;
  appearance?: PersonalAppearance;
  preferences?: Partial<Preferences>;
  voicePreference?: PersonalAgent['voicePreference'];
};
const ACTIVITY_PAGE_SIZE = 5;

function activityTitle(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 58) return normalized;
  const withoutAside = normalized.replace(/（[^）]{1,80}）|\([^)]{1,80}\)/g, '')
    .replace(/([A-Za-z0-9])(?=[\u4e00-\u9fff])/g, '$1 ').replace(/\s+/g, ' ').trim();
  const lead = withoutAside.split(/[。！？；;，]/, 1)[0]?.trim() || withoutAside;
  return lead.length > 58 ? `${lead.slice(0, 57).trimEnd()}…` : lead;
}

function activityStatus(item: ActivityItem, zh: boolean): { label: string; tone: string } {
  if (item.phase === 'closed') return { label: zh ? '已结束' : 'Finished', tone: 'bg-fg-subtle' };
  const state = item.operationalState ?? item.runStatus;
  if (state === 'running') return { label: zh ? '正在执行' : 'Working', tone: 'bg-accent' };
  if (state === 'queued') return { label: zh ? '等待开始' : 'Queued', tone: 'bg-fg-subtle' };
  if (state === 'failed') return { label: zh ? '执行失败' : 'Failed', tone: 'bg-danger' };
  if (state === 'waiting') return { label: zh ? '等待继续' : 'Waiting', tone: 'bg-warning' };
  if (state === 'blocked') return { label: zh ? '已阻塞' : 'Blocked', tone: 'bg-warning' };
  if (state === 'verifying') return { label: zh ? '正在验证' : 'Verifying', tone: 'bg-accent' };
  if (state === 'cancelled') return { label: zh ? '执行已取消' : 'Cancelled', tone: 'bg-fg-subtle' };
  if (item.phase === 'review') return { label: zh ? '等待验收' : 'In review', tone: 'bg-warning' };
  if (item.phase === 'active') return { label: zh ? '正在推进' : 'In progress', tone: 'bg-accent' };
  if (item.phase === 'ready') return { label: zh ? '准备开始' : 'Ready', tone: 'bg-fg-subtle' };
  return { label: zh ? '待处理' : 'Planned', tone: 'bg-fg-subtle' };
}

function ActivityRow({ item, zh }: { item: ActivityItem; zh: boolean }) {
  const status = activityStatus(item, zh);
  return <Link to={taskDetailModalHref('/personal', item.id)} className="group flex min-w-0 items-start gap-3 rounded-2xl bg-surface-panel px-4 py-4 transition-colors duration-150 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
    <span className={`mt-2 size-1.5 shrink-0 rounded-full ${status.tone}`} aria-hidden />
    <span className="min-w-0 flex-1">
      <span className="line-clamp-2 break-words text-sm font-medium leading-5 text-fg">{activityTitle(item.title)}</span>
      <span className="mt-1.5 flex items-center gap-2 text-xs text-fg-muted"><span>{status.label}</span><span className="text-fg-subtle" aria-hidden>·</span><span>{formatMediumDate(item.updatedAt, zh ? 'zh' : 'en')}</span></span>
    </span>
    <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-fg-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
  </Link>;
}

const STYLE_OPTIONS = [
  { id: 'direct', warmth: 'reserved', zh: '直接', en: 'Direct' },
  { id: 'natural', warmth: 'balanced', zh: '自然', en: 'Natural' },
  { id: 'gentle', warmth: 'gentle', zh: '温和', en: 'Gentle' },
] as const;

const APPEARANCES = [
  { id: 'loopi', zh: '小环', en: 'Loopi', color: 'bg-slate-100/50 dark:bg-slate-400/10' },
  { id: 'loopi-curious', zh: '好奇', en: 'Curious', color: 'bg-blue-100/50 dark:bg-blue-400/10' },
  { id: 'loopi-care', zh: '温和', en: 'Gentle', color: 'bg-violet-100/50 dark:bg-violet-400/10' },
] as const;

function openingFor(preferences: Preferences, zh: boolean): string {
  if (preferences.warmth === 'reserved') return zh
    ? '你可以直接说目标或问题。我会先给结论，需要时再展开。'
    : 'Tell me the goal or question. I’ll lead with the answer and expand when useful.';
  if (preferences.warmth === 'gentle') return zh
    ? '想聊一件事，或让我帮你推进工作，都可以从这里开始。我会认真听，也会把下一步说清楚。'
    : 'You can talk something through or ask me to move work forward. I’ll listen carefully and make the next step clear.';
  return zh
    ? '有什么想讨论或推进的事？直接告诉我就好。'
    : 'What would you like to discuss or move forward? Just tell me what is on your mind.';
}

function styleId(preferences: Preferences): string {
  return STYLE_OPTIONS.find(option => option.warmth === preferences.warmth)?.id ?? 'natural';
}

export function PersonalPage() {
  const voiceCall = useVoiceCall();
  const voiceCallRef = useRef(voiceCall);
  voiceCallRef.current = voiceCall;
  const zh = useLocaleStore(state => state.language) === 'zh';
  const setPageHeader = usePageHeaderStore(state => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore(state => state.clearPageHeader);
  const [record, setRecord] = useState<PersonalAgent | null>(null);
  const recordRef = useRef<PersonalAgent | null>(null);
  const profileUpdateQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCount, setSavingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [welcomeDone, setWelcomeDone] = useState(true);
  const [avatarUploadFailed, setAvatarUploadFailed] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState('natural');
  const [appearance, setAppearance] = useState<PersonalAppearance>('loopi');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null!);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const [displayName, setDisplayName] = useState('');
  const [supportMode, setSupportMode] = useState<Preferences['supportMode']>('untangle');
  const [humor, setHumor] = useState<Preferences['humor']>('none');
  const [detailLevel, setDetailLevel] = useState<Preferences['detailLevel']>('balanced');
  const [proactivity, setProactivity] = useState<Preferences['proactivity']>('decisions');
  const [showSettings, setShowSettings] = useState(false);
  const [showAppearanceChoices, setShowAppearanceChoices] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [activityError, setActivityError] = useState(false);
  const [activityLoadingMore, setActivityLoadingMore] = useState(false);
  const [activityMoreError, setActivityMoreError] = useState(false);
  const [activityLoadedCount, setActivityLoadedCount] = useState(0);
  const activityRequestRef = useRef(0);
  const openSettings = useCallback(() => {
    setShowActivity(false);
    setShowAppearanceChoices(false);
    setShowSettings(true);
  }, []);
  const toggleSettings = useCallback(() => {
    setShowActivity(false);
    setShowAppearanceChoices(false);
    setShowSettings(open => !open);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [personal, compatible] = await Promise.all([
        fetchJson<ApiResult<PersonalAgent | null>>(apiUrl('/api/personal-agent')),
        fetchJson<ApiResult<ModelOption[]>>(apiUrl('/api/personal-agent/models')),
      ]);
      recordRef.current = personal.payload;
      setRecord(personal.payload);
      if (personal.payload?.state === 'ready') {
        const onboarding = await fetchJson<ApiResult<{ completed: boolean; welcomeDone: boolean }>>(apiUrl('/api/personal-agent/onboarding'));
        setWelcomeDone(!onboarding.payload.completed || onboarding.payload.welcomeDone);
      }
      window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: personal.payload }));
      if (personal.payload) window.dispatchEvent(new Event('session-updated'));
      setModels(compatible.payload);
      if (personal.payload) {
        setDisplayName(personal.payload.displayName);
        setAppearance(personal.payload.appearance);
        setSelectedStyle(styleId(personal.payload.preferences));
        setSupportMode(personal.payload.preferences.supportMode ?? 'untangle');
        setHumor(personal.payload.preferences.humor ?? 'none');
        setDetailLevel(personal.payload.preferences.detailLevel ?? 'balanced');
        setProactivity(personal.payload.preferences.proactivity ?? 'decisions');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const queueProfileUpdate = useCallback((changes: ProfileChanges): Promise<boolean> => {
    setSavingCount(count => count + 1);
    setError(null);
    const update = profileUpdateQueueRef.current.then(async () => {
      const current = recordRef.current;
      if (!current) return false;
      const displayName = changes.displayName?.trim() || current.displayName;
      const appearance = changes.appearance ?? current.appearance;
      const preferences = { ...current.preferences, ...changes.preferences };
      const voicePreference = changes.voicePreference === undefined ? current.voicePreference : changes.voicePreference;
      if (displayName === current.displayName && appearance === current.appearance
        && JSON.stringify(preferences) === JSON.stringify(current.preferences)
        && JSON.stringify(voicePreference) === JSON.stringify(current.voicePreference)) return true;
      try {
        const response = await fetchJson<ApiResult<PersonalAgent>>(apiUrl('/api/personal-agent/profile'), {
          method: 'PATCH',
          body: JSON.stringify({ revision: current.revision, displayName, appearance, preferences,
            ...(changes.voicePreference !== undefined ? { voicePreference } : {}) }),
        });
        recordRef.current = response.payload;
        setRecord(response.payload);
        window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: response.payload }));
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    }).finally(() => setSavingCount(count => count - 1));
    profileUpdateQueueRef.current = update;
    return update;
  }, []);

  const finishWelcome = async (mode?: 'listen' | 'untangle' | 'solutions') => {
    if (!record) return;
    setError(null);
    try {
      if (mode) {
        const updated = await fetchJson<ApiResult<PersonalAgent>>(apiUrl('/api/personal-agent/profile'), {
          method: 'PATCH',
          body: JSON.stringify({ revision: record.revision, displayName: record.displayName, appearance: record.appearance,
            preferences: { ...record.preferences, supportMode: mode } }),
        });
        recordRef.current = updated.payload;
        setRecord(updated.payload);
      }
      await fetchJson(apiUrl('/api/personal-agent/onboarding/welcome'), { method: 'POST', body: '{}' });
      setWelcomeDone(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const openActivity = useCallback(async () => {
    const request = ++activityRequestRef.current;
    setShowActivity(true);
    setActivity(null);
    setActivityError(false);
    setActivityLoadingMore(false);
    setActivityMoreError(false);
    setActivityLoadedCount(0);
    try {
      const response = await fetchJson<ApiResult<Activity>>(apiUrl(`/api/personal-agent/activity?limit=${ACTIVITY_PAGE_SIZE}&offset=0`));
      if (request !== activityRequestRef.current) return;
      setActivity(response.payload);
      setActivityLoadedCount(response.payload.items.length);
    } catch {
      if (request === activityRequestRef.current) setActivityError(true);
    }
  }, []);

  const loadMoreActivity = useCallback(async () => {
    if (!activity || activityLoadingMore || activityLoadedCount >= activity.total) return;
    const request = activityRequestRef.current;
    setActivityLoadingMore(true);
    setActivityMoreError(false);
    try {
      const response = await fetchJson<ApiResult<Activity>>(apiUrl(`/api/personal-agent/activity?limit=${ACTIVITY_PAGE_SIZE}&offset=${activityLoadedCount}`));
      if (request !== activityRequestRef.current) return;
      setActivity(previous => previous ? {
        total: response.payload.total,
        items: [...previous.items, ...response.payload.items.filter(item => !previous.items.some(existing => existing.id === item.id))],
      } : response.payload);
      setActivityLoadedCount(previous => previous + response.payload.items.length);
    } catch {
      if (request === activityRequestRef.current) setActivityMoreError(true);
    } finally {
      if (request === activityRequestRef.current) setActivityLoadingMore(false);
    }
  }, [activity, activityLoadedCount, activityLoadingMore]);

  useEffect(() => {
    if (!showActivity || !activity || activityLoadingMore) return;
    let timer: number | undefined;
    const refreshActivity = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const request = activityRequestRef.current;
        try {
          const limit = Math.max(ACTIVITY_PAGE_SIZE, Math.min(100, activityLoadedCount));
          const response = await fetchJson<ApiResult<Activity>>(apiUrl(`/api/personal-agent/activity?limit=${limit}&offset=0`));
          if (request !== activityRequestRef.current) return;
          setActivity(response.payload);
          setActivityLoadedCount(response.payload.items.length);
        } catch {
          // Keep the last known activity; the next event or poll can retry.
        }
      }, 120);
    };
    const interval = window.setInterval(refreshActivity, 5_000);
    window.addEventListener('task-changed-v2', refreshActivity);
    window.addEventListener('gateway-realtime-connected', refreshActivity);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener('task-changed-v2', refreshActivity);
      window.removeEventListener('gateway-realtime-connected', refreshActivity);
    };
  }, [activity, activityLoadedCount, activityLoadingMore, showActivity]);

  const uploadAvatar = async (file: File) => {
    if (!record || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError(zh ? '请选择 PNG、JPEG 或 WebP 图片。' : 'Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size === 0 || file.size > 512 * 1024) {
      setError(zh ? '图片大小不能超过 512 KB。' : 'Image must be 512 KB or smaller.');
      return;
    }
    setUploadingAvatar(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await fetchJson<ApiResult<{ agentId: string }>>(apiUrl(`/api/agents/${encodeURIComponent(record.agentId)}/avatar`), {
        method: 'PUT',
        body: JSON.stringify({ base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: file.type }),
      });
      bumpAgentAvatarCacheRevision(record.agentId);
      setAppearance('custom');
      setShowAppearanceChoices(false);
      await queueProfileUpdate({ appearance: 'custom' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploadingAvatar(false);
    }
  };

  useLayoutEffect(() => {
    const ready = record?.state === 'ready';
    const avatar = ready ? record.appearance : appearance;
    const title = ready ? record.displayName : 'Ada';
    setPageHeader({
      startExtra: null,
      main: <div className="flex min-w-0 items-center gap-2.5">
        {ready ? (
          <button ref={profileButtonRef} type="button" onClick={toggleSettings} aria-expanded={showSettings} className="touch-target -m-1 shrink-0 rounded-full p-1 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? `编辑${title}的资料` : `Edit ${title}'s profile`} title={zh ? '资料' : 'Profile'}>
            <span className="flex size-8 items-center justify-center"><PersonalAvatar appearance={avatar} agentId={record?.agentId} className="size-8" /></span>
          </button>
        ) : <span className="flex size-8 shrink-0 items-center justify-center"><PersonalAvatar appearance={avatar} agentId={record?.agentId} className="size-8" /></span>}
        <h1 className="min-w-0 truncate text-sm font-semibold text-fg sm:text-base">{title}</h1>
      </div>,
      end: ready ? <div className="flex items-center gap-1">
          <button type="button" disabled={voiceCall.active} onClick={() => {
            if (record?.state === 'ready') voiceCallRef.current.open({ conversationId: record.conversationId, name: record.displayName, mode: 'assistant' });
          }} className="touch-target rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50" aria-label={zh ? '语音通话' : 'Voice call'} title={zh ? '语音通话' : 'Voice call'}><Phone className="size-5" /></button>
          <Popover.Root open={showActivity} onOpenChange={open => { if (open) void openActivity(); else setShowActivity(false); }}>
            <Popover.Trigger asChild>
              <button type="button" aria-pressed={showActivity} className="touch-target rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={zh ? '正在做的事' : 'Activity'}><ListTodo className="size-5" /></button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content side="bottom" align="end" sideOffset={8} collisionPadding={8} aria-label={zh ? '派发的任务' : 'Delegated tasks'} className="z-50 flex h-[min(34rem,calc(100dvh-6rem))] w-[min(25rem,calc(100vw-1rem))] min-h-0 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-inset shadow-xl focus:outline-none">
                <div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-3 pt-6">
                  <div className="min-w-0"><h2 className="text-base font-semibold tracking-tight text-fg">{zh ? '交给我推进的事' : 'Delegated work'}</h2><p className="mt-1 text-xs text-fg-muted">{activity ? (zh ? `最近更新 · 共 ${activity.total} 项` : `Recently updated · ${activity.total} total`) : (zh ? '查看任务进展与结果' : 'Follow progress and results')}</p></div>
                  <Popover.Close className="touch-target -mr-2 -mt-1 rounded-lg p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? '关闭活动' : 'Close activity'}><X className="size-4" /></Popover.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-3">
                  {!activity && !activityError && <div className="space-y-2"><Skeleton className="h-18 rounded-2xl" /><Skeleton className="h-18 rounded-2xl" /><Skeleton className="h-18 rounded-2xl" /></div>}
                  {activityError && <div className="px-5 py-12 text-center"><p className="text-sm text-fg-muted">{zh ? '暂时无法读取任务' : 'Could not load tasks'}</p><button type="button" onClick={() => void openActivity()} className="mt-3 rounded-lg px-3 py-2 text-sm text-accent hover:bg-surface-hover">{zh ? '重试' : 'Try again'}</button></div>}
                  {activity?.items.length === 0 && <div className="px-5 py-16 text-center"><ListTodo className="mx-auto size-7 text-fg-subtle" aria-hidden /><p className="mt-4 text-sm font-medium text-fg">{zh ? '还没有派发的任务' : 'No delegated work yet'}</p><p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? '你可以在对话里直接告诉我想推进的事。' : 'Tell me what you would like to move forward in chat.'}</p></div>}
                  {activity && activity.items.length > 0 && <div className="space-y-2">{activity.items.map(item => <ActivityRow key={item.id} item={item} zh={zh} />)}</div>}
                  {activity && activityLoadedCount < activity.total && <div className="pt-4 text-center">
                    <button type="button" onClick={() => void loadMoreActivity()} disabled={activityLoadingMore} className="min-h-10 rounded-xl bg-surface-panel px-5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-50">{activityLoadingMore ? (zh ? '正在加载…' : 'Loading…') : (zh ? '加载更多' : 'Load more')}</button>
                    {activityMoreError && <p role="alert" className="mt-2 text-xs text-danger">{zh ? '加载失败，请重试' : 'Could not load more. Try again.'}</p>}
                  </div>}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <button ref={settingsButtonRef} type="button" onClick={toggleSettings} aria-expanded={showSettings} className="touch-target rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={zh ? '回应偏好' : 'Response preferences'}><Settings2 className="size-5" /></button>
        </div> : null,
    });
    return () => clearPageHeader();
  }, [activity, activityError, activityLoadedCount, activityLoadingMore, activityMoreError, appearance, clearPageHeader, loadMoreActivity, openActivity, record, setPageHeader, showActivity, showSettings, toggleSettings, voiceCall.active, zh]);

  function renderSettingsPopover() {
    if (!record) return null;
    return <Popover.Root open={showSettings} onOpenChange={open => { setShowSettings(open); if (!open) setShowAppearanceChoices(false); }}>
      <Popover.Anchor virtualRef={settingsButtonRef} />
      <Popover.Portal>
        <Popover.Content
          side="bottom" align="end" sideOffset={8} collisionPadding={8}
          aria-label={zh ? '编辑 Personal AI' : 'Edit Personal AI'}
          onInteractOutside={event => {
            if (event.target instanceof Node && (settingsButtonRef.current?.contains(event.target) || profileButtonRef.current?.contains(event.target))) event.preventDefault();
          }}
          className="z-50 flex h-[min(38rem,calc(100dvh-6rem))] w-[min(28rem,calc(100vw-1rem))] min-h-0 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-xl outline-none"
        >
          <div className="relative flex shrink-0 flex-col items-center px-5 pt-5 text-center">
            <button type="button" disabled={uploadingAvatar} onClick={() => setShowAppearanceChoices(open => !open)} aria-expanded={showAppearanceChoices} aria-controls="personal-appearance-options" aria-label={zh ? '选择头像' : 'Choose avatar'} className="rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50">
              <PersonalAvatar appearance={appearance} agentId={record.agentId} className="size-20" />
            </button>
            <input id="personal-name" aria-label={zh ? '助手名称' : 'Assistant name'}
              value={displayName} onChange={event => setDisplayName(event.target.value)}
              onBlur={event => {
                const next = event.currentTarget.value.trim();
                if (next) { setDisplayName(next); void queueProfileUpdate({ displayName: next }); }
                else setDisplayName(recordRef.current?.displayName ?? '');
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  event.currentTarget.value = recordRef.current?.displayName ?? '';
                  setDisplayName(event.currentTarget.value);
                  event.currentTarget.blur();
                }
              }} maxLength={60} placeholder="Ada"
              className="mt-3 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 py-1 text-center text-lg font-semibold text-fg outline-none transition-colors hover:border-edge focus:border-edge focus:bg-surface-base focus-visible:ring-2 focus-visible:ring-accent" />
            {savingCount > 0 && <span className="absolute right-4 top-4 text-xs text-fg-muted">{zh ? '正在保存…' : 'Saving…'}</span>}
          </div>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              {showAppearanceChoices && <section id="personal-appearance-options">
                <h3 className="mb-3 text-sm font-medium text-fg">{zh ? '形象' : 'Appearance'}</h3>
                <div className="grid grid-cols-4 gap-2">{APPEARANCES.map(item => <button key={item.id} type="button" onClick={() => { setAppearance(item.id); setShowAppearanceChoices(false); void queueProfileUpdate({ appearance: item.id }); }} aria-pressed={appearance === item.id} className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${appearance === item.id ? 'bg-accent/10 ring-1 ring-accent/40' : 'bg-surface-panel hover:bg-surface-hover'}`}><span className={`flex size-8 items-center justify-center rounded-full ${item.color}`}><PersonalAvatar appearance={item.id} className="size-8" /></span><span className="truncate text-xs text-fg-muted">{zh ? item.zh : item.en}</span></button>)}
                  <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={zh ? '上传头像' : 'Upload avatar'} onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void uploadAvatar(file);
                    event.currentTarget.value = '';
                  }} />
                  <button type="button" disabled={uploadingAvatar} onClick={() => avatarInputRef.current?.click()} aria-pressed={appearance === 'custom'} className={`flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 ${appearance === 'custom' ? 'bg-accent/10 ring-1 ring-accent/40' : 'bg-surface-panel hover:bg-surface-hover'}`}><span className="flex size-8 items-center justify-center rounded-full bg-surface-panel">{appearance === 'custom' ? <PersonalAvatar appearance="custom" agentId={record.agentId} className="size-8" /> : <Upload className="size-4 text-fg-muted" aria-hidden />}</span><span className="truncate text-xs text-fg-muted">{uploadingAvatar ? (zh ? '上传中…' : 'Uploading…') : (zh ? '上传' : 'Upload')}</span></button>
                </div>
              </section>}
              <section>
                <h3 className="mb-3 text-sm font-medium text-fg">{zh ? '语气' : 'Tone'}</h3>
                <div className="grid grid-cols-3 gap-2">
                  {STYLE_OPTIONS.map(option => <button key={option.id} type="button" onClick={() => { setSelectedStyle(option.id); void queueProfileUpdate({ preferences: { warmth: option.warmth } }); }} aria-pressed={selectedStyle === option.id} className={`min-h-10 rounded-xl px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selectedStyle === option.id ? 'bg-accent/10 font-medium text-fg ring-1 ring-accent/40' : 'bg-surface-panel text-fg-muted hover:bg-surface-hover'}`}>{zh ? option.zh : option.en}</button>)}
                </div>
              </section>
              <section>
                <h3 className="mb-3 text-sm font-medium text-fg">{zh ? '棘手时' : 'When things get tricky'}</h3>
                <div className="flex flex-wrap gap-2">{([
                  ['listen', zh ? '先听' : 'Listen'],
                  ['untangle', zh ? '理清' : 'Untangle'],
                  ['solutions', zh ? '给办法' : 'Suggest'],
                ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={supportMode === value} onClick={() => { setSupportMode(value); void queueProfileUpdate({ preferences: { supportMode: value } }); }} className={`min-h-9 rounded-full px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${supportMode === value ? 'bg-accent/10 text-fg ring-1 ring-accent/40' : 'bg-surface-panel text-fg-muted hover:bg-surface-hover'}`}>{label}</button>)}</div>
              </section>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="mb-2 text-sm font-medium text-fg">{zh ? '回答长度' : 'Length'}</p><PopoverSelect value={detailLevel ?? 'balanced'} options={[
                  { value: 'brief', label: zh ? '简短' : 'Brief' },
                  { value: 'balanced', label: zh ? '适中' : 'Balanced' },
                  { value: 'detailed', label: zh ? '详细' : 'Detailed' },
                ]} placeholder={zh ? '选择长度' : 'Choose length'} allowEmpty={false} onChange={value => { const next = value as Preferences['detailLevel']; setDetailLevel(next); void queueProfileUpdate({ preferences: { detailLevel: next } }); }} /></div>
                <div><p className="mb-2 text-sm font-medium text-fg">{zh ? '主动更新' : 'Updates'}</p><PopoverSelect value={proactivity ?? 'decisions'} options={[
                  { value: 'decisions', label: zh ? '结果与决定' : 'Results only' },
                  { value: 'important', label: zh ? '重要进展' : 'Milestones' },
                  { value: 'open', label: zh ? '多提建议' : 'Suggestions' },
                ]} placeholder={zh ? '选择频率' : 'Choose frequency'} allowEmpty={false} onChange={value => { const next = value as Preferences['proactivity']; setProactivity(next); void queueProfileUpdate({ preferences: { proactivity: next } }); }} /></div>
              </div>
              <details className="text-sm text-fg-muted"><summary className="cursor-pointer select-none">{zh ? '更多偏好' : 'More preferences'}</summary><div className="mt-3"><p className="mb-2 font-medium text-fg">{zh ? '轻松程度' : 'Humor'}</p><PopoverSelect value={humor ?? 'none'} options={[
                { value: 'none', label: zh ? '不加玩笑' : 'None' },
                { value: 'occasional', label: zh ? '偶尔轻松' : 'Sometimes' },
                { value: 'playful', label: zh ? '活泼' : 'Playful' },
              ]} placeholder={zh ? '选择程度' : 'Choose level'} allowEmpty={false} onChange={value => { const next = value as Preferences['humor']; setHumor(next); void queueProfileUpdate({ preferences: { humor: next } }); }} /></div></details>
              <PersonalProactivitySetting zh={zh} />
              <PersonalVoiceSetting record={record} zh={zh} onSelectVoice={voicePreference => queueProfileUpdate({ voicePreference })} />
              <div className="border-t border-edge pt-5">
                <PersonalModelSetting conversationId={record.conversationId} zh={zh} onSaved={async () => {
                  const response = await fetchJson<ApiResult<PersonalAgent | null>>(apiUrl('/api/personal-agent'));
                  if (response.ok && response.payload) { recordRef.current = response.payload; setRecord(response.payload); }
                }} />
              </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>;
  }

  if (loading) return <div className="mx-auto w-full max-w-2xl space-y-5 px-6 py-12"><Skeleton className="h-20 w-20 rounded-full" /><Skeleton className="h-9 w-72" /><Skeleton className="h-44 w-full rounded-2xl" /></div>;

  if (record?.state === 'ready') return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-panel">
      {avatarUploadFailed && <div role="alert" className="flex shrink-0 items-center justify-between gap-3 border-b border-warning/30 bg-warning/5 px-5 py-3 text-sm text-fg-muted">
        <span>{zh ? '助手已创建，头像上传未完成。可在资料设置中重新上传。' : 'Your assistant is ready. Upload the avatar again in profile settings.'}</span>
        <button type="button" onClick={() => { setAvatarUploadFailed(false); openSettings(); }} className="shrink-0 text-accent hover:underline">{zh ? '打开设置' : 'Open settings'}</button>
      </div>}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1"><ChatPage embedded personal personalWelcome={{ name: record.displayName, addressAs: record.userCallName ?? undefined, avatar: <PersonalAvatar appearance={record.appearance} agentId={record.agentId} className="size-14" />, opening: openingFor(record.preferences, zh), showSupportChoice: !welcomeDone, onChooseSupport: mode => void finishWelcome(mode), onSkipSupport: () => void finishWelcome(), supportChoiceError: error }} conversationId={record.conversationId} /></div>
      </div>
      {renderSettingsPopover()}
    </div>
  );

  return <PersonalOnboarding modelsAvailable={models.length > 0} onCreated={(created, avatarFailed) => {
    recordRef.current = created;
    setRecord(created);
    setDisplayName(created.displayName);
    setWelcomeDone(false);
    setAvatarUploadFailed(avatarFailed);
    window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: created }));
    window.dispatchEvent(new Event('session-updated'));
  }} />;


}
