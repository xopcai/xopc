import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUpRight, ListTodo, Phone, Settings2, X } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { VoiceCallPreferences } from '@xopcai/realtime-protocol/voice';

import { Skeleton } from '@/components/ui/skeleton';
import { ChatPage } from '@/features/chat/chat-page';
import { useVoiceCall } from '@/features/voice/realtime/voice-call-context';
import { taskDetailModalHref } from '@/features/tasks/task-detail-route';
import { fetchJson } from '@/lib/fetch';
import { formatMediumDate } from '@/lib/date-formatters';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { PersonalAvatar, type PersonalAppearance } from './personal-avatar';
import { PersonalOnboarding } from './personal-onboarding';
import { PersonalProfileSettings } from './personal-profile-settings';

export type PersonalAgent = {
  agentId: string;
  conversationId: string;
  state: 'provisioning' | 'ready' | 'error';
  displayName: string;
  userCallName?: string | null;
  appearance: PersonalAppearance;
  voiceCallPreferences?: VoiceCallPreferences;
  voicePreference: { provider: string; model: string; voice: string } | null;
  revision: number;
  errorMessage: string | null;
};
type ModelOption = { id: string; name: string };
type ApiResult<T> = { ok: boolean; payload: T };
type Activity = { items: Array<{ id: string; title: string; phase: string; operationalState?: string; runStatus?: string; updatedAt: number }>; total: number };
type ActivityItem = Activity['items'][number];
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

export function PersonalPage() {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const voiceCall = useVoiceCall();
  const voiceCallRef = useRef(voiceCall);
  voiceCallRef.current = voiceCall;
  const zh = useLocaleStore(state => state.language) === 'zh';
  const setPageHeader = usePageHeaderStore(state => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore(state => state.clearPageHeader);
  const [record, setRecord] = useState<PersonalAgent | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avatarUploadFailed, setAvatarUploadFailed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null!);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const profilePopoverRef = useRef<HTMLDivElement>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [activityError, setActivityError] = useState(false);
  const [activityLoadingMore, setActivityLoadingMore] = useState(false);
  const [activityMoreError, setActivityMoreError] = useState(false);
  const [activityLoadedCount, setActivityLoadedCount] = useState(0);
  const activityRequestRef = useRef(0);
  const openSettings = useCallback(() => navigate('/settings/personal', {
    state: { settingsBackPath: `${routerLocation.pathname}${routerLocation.search}${routerLocation.hash}` },
  }), [routerLocation.pathname, routerLocation.search, routerLocation.hash, navigate]);
  const toggleQuickSettings = useCallback(() => {
    setShowActivity(false);
    setShowSettings(open => !open);
  }, []);

  useEffect(() => {
    const updateProfile = (event: Event) => {
      const next = (event as CustomEvent<PersonalAgent | null>).detail;
      if (next) setRecord(next);
    };
    window.addEventListener('personal-agent-updated', updateProfile);
    return () => window.removeEventListener('personal-agent-updated', updateProfile);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [personal, compatible] = await Promise.all([
        fetchJson<ApiResult<PersonalAgent | null>>(apiUrl('/api/personal-agent')),
        fetchJson<ApiResult<ModelOption[]>>(apiUrl('/api/personal-agent/models')),
      ]);
      setRecord(personal.payload);
      window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: personal.payload }));
      if (personal.payload) window.dispatchEvent(new Event('session-updated'));
      setModels(compatible.payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
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

  useLayoutEffect(() => {
    const ready = record?.state === 'ready';
    const callLabel = zh ? '语音通话' : 'Voice call';
    const callClass = 'touch-target rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-50';
    const openCall = () => {
      if (ready) voiceCallRef.current.open({ conversationId: record.conversationId, name: record.displayName });
    };
    const avatar = ready ? record.appearance : 'loopi';
    const title = ready ? record.displayName : 'Ada';
    setPageHeader({
      startExtra: null,
      main: <div className="flex min-w-0 items-center gap-2.5">
        {ready ? (
          <button ref={profileButtonRef} type="button" onClick={toggleQuickSettings} aria-expanded={showSettings} className="touch-target -m-1 shrink-0 rounded-full p-1 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? `编辑${title}的资料` : `Edit ${title}'s profile`} title={zh ? '设置' : 'Settings'}>
            <span className="flex size-8 items-center justify-center"><PersonalAvatar appearance={avatar} agentId={record?.agentId} className="size-8" /></span>
          </button>
        ) : <span className="flex size-8 shrink-0 items-center justify-center"><PersonalAvatar appearance={avatar} agentId={record?.agentId} className="size-8" /></span>}
        <h1 className="min-w-0 truncate text-sm font-semibold text-fg sm:text-base">{title}</h1>
      </div>,
      end: ready ? <div className="flex items-center gap-1">
          <button type="button" disabled={voiceCall.active} onClick={openCall} className={callClass} aria-label={callLabel} title={callLabel}><Phone className="size-5" /></button>
          <Popover.Root open={showActivity} onOpenChange={open => { if (open) void openActivity(); else setShowActivity(false); }}>
            <Popover.Trigger asChild>
              <button type="button" aria-pressed={showActivity} className="touch-target rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={zh ? '正在做的事' : 'Activity'}><ListTodo className="size-5" /></button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content side="bottom" align="end" sideOffset={8} collisionPadding={8} aria-label={zh ? '派发的任务' : 'Delegated tasks'} className="xopc-session-context-popover data-[state=closed]:pointer-events-none z-50 flex h-[min(34rem,calc(100dvh-6rem))] w-[min(22rem,calc(100vw-1rem))] min-h-0 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-xl focus:outline-none">
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
          <button ref={settingsButtonRef} type="button" onClick={toggleQuickSettings} aria-expanded={showSettings} className="touch-target rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label={zh ? 'Ada 设置' : 'Ada settings'}><Settings2 className="size-5" /></button>
        </div> : null,
    });
    return () => clearPageHeader();
  }, [activity, activityError, activityLoadedCount, activityLoadingMore, activityMoreError, clearPageHeader, loadMoreActivity, openActivity, record, setPageHeader, showActivity, showSettings, toggleQuickSettings, voiceCall.active, zh]);

  if (loading) return <div className="mx-auto w-full max-w-2xl space-y-5 px-6 py-12"><Skeleton className="h-20 w-20 rounded-full" /><Skeleton className="h-9 w-72" /><Skeleton className="h-44 w-full rounded-2xl" /></div>;

  if (error && !record) return <div role="alert" className="space-y-3 p-6 text-sm text-danger"><p>{error}</p><button type="button" onClick={() => void refresh()} className="text-accent hover:underline">{zh ? '重试' : 'Retry'}</button></div>;

  if (record?.state === 'ready') return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-panel">
      {avatarUploadFailed && <div role="alert" className="flex shrink-0 items-center justify-between gap-3 border-b border-warning/30 bg-warning/5 px-5 py-3 text-sm text-fg-muted">
        <span>{zh ? '助手已创建，头像上传未完成。可在资料设置中重新上传。' : 'Your assistant is ready. Upload the avatar again in profile settings.'}</span>
        <button type="button" onClick={() => { setAvatarUploadFailed(false); openSettings(); }} className="shrink-0 text-accent hover:underline">{zh ? '打开设置' : 'Open settings'}</button>
      </div>}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1"><ChatPage embedded personal personalWelcome={{ name: record.displayName, addressAs: record.userCallName ?? undefined, avatar: <PersonalAvatar appearance={record.appearance} agentId={record.agentId} className="size-14" />, opening: zh ? '有什么想讨论或推进的事？直接告诉我就好。' : 'What would you like to discuss or move forward? Just tell me what is on your mind.' }} conversationId={record.conversationId} /></div>
      </div>
      <Popover.Root open={showSettings} onOpenChange={setShowSettings}>
        <Popover.Anchor virtualRef={settingsButtonRef} />
        <Popover.Portal>
          <Popover.Content ref={profilePopoverRef} side="bottom" align="end" sideOffset={8} collisionPadding={8}
            aria-label={zh ? 'Ada 快捷设置' : 'Ada quick settings'}
            onInteractOutside={event => {
              if (event.target instanceof Node && (settingsButtonRef.current?.contains(event.target) || profileButtonRef.current?.contains(event.target) || profilePopoverRef.current?.contains(event.target))) event.preventDefault();
            }}
            className="xopc-session-context-popover data-[state=closed]:pointer-events-none z-50 flex max-h-[calc(100dvh-5rem)] w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-xl outline-none">
            <div className="min-h-0 overflow-y-auto p-4">
              <PersonalProfileSettings zh={zh} onOpenVoiceServices={openSettings} />
            </div>
            <button type="button" onClick={openSettings} className="shrink-0 border-t border-edge px-4 py-3 text-left text-sm text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">{zh ? '更多设置' : 'More settings'}</button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );

  return <PersonalOnboarding modelsAvailable={models.length > 0} onCreated={(created, avatarFailed) => {
    setRecord(created);
    setAvatarUploadFailed(avatarFailed);
    window.dispatchEvent(new CustomEvent('personal-agent-updated', { detail: created }));
    window.dispatchEvent(new Event('session-updated'));
  }} />;


}
