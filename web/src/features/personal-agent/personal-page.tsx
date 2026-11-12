import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Phone, Settings2, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { VoiceCallPreferences } from '@xopcai/realtime-protocol/voice';

import { Skeleton } from '@/components/ui/skeleton';
import { ChatPage } from '@/features/chat/chat-page';
import { useVoiceCall } from '@/features/voice/realtime/voice-call-context';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { PERSONAL_TASKS_TAB_ID, useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { PersonalAvatar, type PersonalAppearance } from './personal-avatar';
import { PersonalOnboarding } from './personal-onboarding';
import { PersonalProfileSettings } from './personal-profile-settings';
import { usePersonalWorkOverview, useRefreshPersonalWork } from './use-personal-work';

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
  const headerActionsRef = useRef<HTMLDivElement>(null!);
  const [headerBoundary, setHeaderBoundary] = useState<HTMLElement | null>(null);
  const registerHeaderActions = useCallback((element: HTMLDivElement | null) => {
    headerActionsRef.current = element!;
    setHeaderBoundary(element?.closest<HTMLElement>('[data-app-chat-shell]') ?? null);
  }, []);
  const tasksButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPopoverRef = useRef<HTMLDivElement>(null);
  const conversationId = record?.state === 'ready' ? record.conversationId : undefined;
  const taskPanelOpen = useRightWorkspaceStore(state => {
    const pane = conversationId ? state.panes[conversationId] : undefined;
    const active = pane?.tabs.find(tab => tab.id === pane.activeId);
    return pane?.open === true && (pane.activeId === PERSONAL_TASKS_TAB_ID
      || (pane.personalDetailsOpen === true && (active?.kind === 'file' || active?.kind === 'browser')));
  });
  const { avatarState, summary, refreshWork, refreshPrompt } = usePersonalWorkOverview(conversationId, zh);
  useRefreshPersonalWork(conversationId, refreshWork, refreshPrompt);
  const openSettings = useCallback(() => navigate('/settings/personal', {
    state: { settingsBackPath: `${routerLocation.pathname}${routerLocation.search}${routerLocation.hash}` },
  }), [routerLocation.pathname, routerLocation.search, routerLocation.hash, navigate]);

  const setSettingsAnchor = useCallback((element: HTMLDivElement | null) => {
    settingsPopoverRef.current = element;
    voiceCallRef.current.setMiniAnchor(element);
  }, []);
  const closeTasks = useCallback(() => {
    if (conversationId && taskPanelOpen) useRightWorkspaceStore.getState().closePersonalTasks(conversationId);
  }, [conversationId, taskPanelOpen]);
  const toggleQuickSettings = useCallback(() => {
    voiceCallRef.current.minimize();
    setShowSettings(open => !open);
  }, []);
  const toggleTasks = useCallback(() => {
    if (!conversationId) return;
    voiceCallRef.current.minimize();
    setShowSettings(false);
    if (taskPanelOpen) closeTasks();
    else useRightWorkspaceStore.getState().openPersonalTasks(conversationId);
  }, [closeTasks, conversationId, taskPanelOpen]);

  useEffect(() => {
    if (voiceCall.expanded) setShowSettings(false);
  }, [voiceCall.expanded]);

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
  useLayoutEffect(() => {
    const ready = record?.state === 'ready';
    const callLabel = zh ? '语音通话' : 'Voice call';
    const callClass = 'touch-target inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-surface-hover/90 px-3.5 text-sm font-medium text-fg transition-colors hover:bg-surface-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-expanded:bg-surface-active';
    const openCall = () => {
      setShowSettings(false);
      if (!ready) return;
      if (voiceCallRef.current.expanded) {
        voiceCallRef.current.minimize();
        return;
      }
      const anchor = headerActionsRef.current;
      voiceCallRef.current.open({ conversationId: record.conversationId, name: record.displayName }, anchor ? {
        anchor,
        avatar: <PersonalAvatar appearance={record.appearance} agentId={record.agentId} className="size-full" />,
      } : undefined);
    };
    const avatar = ready ? record.appearance : 'loopi';
    const title = ready ? record.displayName : 'Ada';
    setPageHeader({
      startExtra: null,
      personalChat: ready ? (taskPanelOpen ? 'controls' : 'identity') : undefined,
      main: <div className="flex min-w-0 justify-center">
        <h1 className="sr-only">{title}</h1>
        {taskPanelOpen ? null : ready ? <button ref={tasksButtonRef} type="button" data-personal-tasks-trigger
          aria-controls="app-workspace-panel" aria-expanded={taskPanelOpen}
          aria-describedby={summary ? 'personal-work-status' : undefined}
          aria-label={zh ? `${title} 的任务` : `${title}'s tasks`}
          title={summary || title} onClick={toggleTasks}
          className="group/identity flex min-w-0 max-w-full flex-col items-center gap-1 rounded-2xl px-1.5 pb-0.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:gap-1.5">
          <span className="relative grid size-16 shrink-0 place-items-center rounded-full border border-edge-subtle bg-surface-base transition-colors group-hover/identity:border-edge sm:size-20 @max-[26rem]/personal-chat:size-14">
            <PersonalAvatar appearance={avatar} agentId={record.agentId} activity={avatarState} className="size-full" />
          </span>
          <span className="personal-identity-label max-w-full min-w-0 rounded-2xl px-3 py-1">
            <span className="block truncate text-[0.9375rem] leading-5 font-semibold text-fg sm:text-base">{title}</span>
            {summary ? <span id="personal-work-status" role="status" className="flex min-w-0 items-center justify-center gap-1.5 text-xs leading-4 text-fg-muted">
              {avatarState !== 'idle' ? <span className={`size-1.5 shrink-0 rounded-full ${avatarState === 'waiting' ? 'bg-warning' : 'bg-accent'}`} aria-hidden /> : null}
              <span className="truncate">{summary}</span>
            </span> : null}
          </span>
        </button> : <div className="flex items-center gap-2"><PersonalAvatar appearance={avatar} className="size-8" /><span className="text-sm font-semibold">{title}</span></div>}
      </div>,
      end: ready ? <div ref={registerHeaderActions} className="flex items-center gap-1.5 sm:gap-2">
        <button type="button" aria-haspopup="dialog" aria-expanded={voiceCall.expanded} onClick={openCall} className={callClass} aria-label={callLabel} title={callLabel}><Phone className="size-4" strokeWidth={1.75} aria-hidden /><span className="hidden @min-[32rem]/personal-header:inline">{zh ? '通话' : 'Call'}</span></button>
        <button ref={settingsButtonRef} type="button" onClick={toggleQuickSettings} aria-haspopup="dialog" aria-expanded={showSettings} className={callClass} aria-label={zh ? `${title} 设置` : `${title} settings`}><Settings2 className="size-4" strokeWidth={1.75} aria-hidden /><span className="hidden @min-[32rem]/personal-header:inline">{zh ? '设置' : 'Settings'}</span></button>
      </div> : null,
    });
    return () => clearPageHeader();
  }, [avatarState, clearPageHeader, record, registerHeaderActions, setPageHeader, showSettings, summary, taskPanelOpen, toggleQuickSettings, toggleTasks, voiceCall.expanded, zh]);

  if (loading) return <div className="mx-auto w-full max-w-2xl space-y-5 px-6 py-12"><Skeleton className="h-20 w-20 rounded-full" /><Skeleton className="h-9 w-72" /><Skeleton className="h-44 w-full rounded-2xl" /></div>;

  if (error && !record) return <div role="alert" className="space-y-3 p-6 text-sm text-danger"><p>{error}</p><button type="button" onClick={() => void refresh()} className="text-accent hover:underline">{zh ? '重试' : 'Retry'}</button></div>;

  if (record?.state === 'ready') return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-surface-panel">
      {avatarUploadFailed && <div role="alert" className="flex shrink-0 items-center justify-between gap-3 border-b border-warning/30 bg-warning/5 px-5 py-3 text-sm text-fg-muted">
        <span>{zh ? '助手已创建，头像上传未完成。可在资料设置中重新上传。' : 'Your assistant is ready. Upload the avatar again in profile settings.'}</span>
        <button type="button" onClick={() => { setAvatarUploadFailed(false); openSettings(); }} className="shrink-0 text-accent hover:underline">{zh ? '打开设置' : 'Open settings'}</button>
      </div>}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1"><ChatPage embedded personal personalWelcome={{ name: record.displayName, addressAs: record.userCallName ?? undefined, opening: zh ? '有什么想讨论或推进的事？直接告诉我就好。' : 'What would you like to discuss or move forward? Just tell me what is on your mind.' }} conversationId={record.conversationId} /></div>
      </div>
      <Popover.Root open={showSettings} onOpenChange={setShowSettings}>
        <Popover.Anchor virtualRef={headerActionsRef} />
        <Popover.Portal>
          <Popover.Content ref={setSettingsAnchor} side="bottom" align="end" sideOffset={12} collisionPadding={12} collisionBoundary={headerBoundary ?? undefined}
            aria-label={zh ? `${record.displayName} 快捷设置` : `${record.displayName} quick settings`}
            onInteractOutside={event => {
              if (event.target instanceof Node && (settingsButtonRef.current?.contains(event.target) || tasksButtonRef.current?.contains(event.target) || settingsPopoverRef.current?.contains(event.target) || (event.target instanceof Element && event.target.closest('[data-voice-call-mini]')))) event.preventDefault();
            }}
            className={`xopc-session-context-popover data-[state=closed]:pointer-events-none z-50 flex h-[min(34rem,calc(100dvh-6rem))] ${voiceCall.active ? 'max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-12rem))]' : 'max-h-[var(--radix-popover-content-available-height)]'} min-h-0 w-[min(27rem,calc(100vw-1.5rem))] max-w-[var(--radix-popover-content-available-width)] flex-col overflow-hidden rounded-[1.75rem] border border-edge-subtle bg-surface-overlay shadow-float outline-none`}>
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4">
              <h2 className="text-base font-semibold text-fg">{zh ? '快捷设置' : 'Quick settings'}</h2>
              <Popover.Close className="touch-target -mr-2 rounded-lg p-2 text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={zh ? '关闭设置' : 'Close settings'}><X className="size-4" /></Popover.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-2">
              <PersonalProfileSettings zh={zh} onOpenVoiceServices={openSettings} />
            </div>
            <div className="shrink-0 border-t border-edge-subtle p-3">
              <button type="button" onClick={openSettings} className="w-full rounded-full bg-surface-hover px-4 py-2.5 text-center text-sm font-medium text-fg hover:bg-surface-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{zh ? '更多设置' : 'More settings'}</button>
            </div>
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
