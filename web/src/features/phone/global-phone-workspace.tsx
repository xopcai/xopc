import { Hand, MessageSquare, PanelRight, PictureInPicture2, Smartphone, Unplug, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiUrl } from '@/lib/url';
import { fetchJson } from '@/lib/fetch';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { PhoneLivePanel } from './phone-live-panel';
import { phoneEnded, useConversationPhone, type PhoneLiveState } from './phone-live-api';
import { usePhoneWorkspaceStore } from './phone-workspace-store';
import { usePhoneWindowLayout } from './use-phone-window-layout';
import { PhoneAssistanceActions } from './phone-assistance-card';

type Connection = PhoneLiveState['report'] & { deviceId: string; owner: string; sourceConversationName?: string };
export function phoneOccupancy(report: PhoneLiveState['report'], zh: boolean): string {
  if (phoneEnded(report.status)) return zh ? '已断开' : 'Disconnected';
  if (report.handoff && report.handoff !== 'idle') return zh ? '正在交接控制权' : 'Transferring control';
  if (report.controlOwner === 'human') return zh ? '人工操作中' : 'Manual control';
  if (['paused', 'needs_user', 'failed', 'outcome_unknown'].includes(report.status)) return zh ? '等待检查或接管' : 'Needs inspection';
  if (report.controlOwner === 'agent') return zh ? '聊天任务占用中' : 'In use by a chat';
  return zh ? '已连接 · 空闲' : 'Connected · Idle';
}

export function GlobalPhoneWorkspace() {
  const zh = useLocaleStore(s => s.language) === 'zh';
  const identity = useGatewayStore(s => `${s.baseUrl}:${s.conversationId}`);
  const { activation, open, selected, controlConversationId, displayMode, position, floatingWidth, setDisplayMode, show, hide } = usePhoneWorkspaceStore();
  const floating = displayMode === 'floating';
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => { if (open) setHasOpened(true); }, [open]);
  const scope = useRightWorkspaceStore(state => state.scope);
  const pane = useRightWorkspaceStore(state => state.panes[scope]);
  const workspaceVisible = Boolean(pane?.open && pane.tabs.find(t => t.id === pane.activeId)?.kind === 'phone');
  const fallbackMount = useRef<HTMLDivElement>(null);
  const [host] = useState(() => { const node = document.createElement('div'); node.style.display = 'contents'; return node; });
  useLayoutEffect(() => {
    const target = floating ? document.body : document.getElementById('phone-workspace-slot') ?? fallbackMount.current;
    target?.appendChild(host);
  });
  useEffect(() => () => host.remove(), [host]);
  const { panelRef, startDrag, startResize, moveWithKeyboard } = usePhoneWindowLayout(open, floating);
  const navigate = useNavigate();
  const connections = useSWR(['phone-connections', identity], async () =>
    (await fetchJson<{ payload: Connection[] }>(apiUrl('/api/phone/connections'))).payload,
  { refreshInterval: 1500, shouldRetryOnError: false });
  const reports = connections.data ?? [];
  const assistance = reports.filter(report => report.status === 'needs_user' && report.controlOwner !== 'human');
  const relayed = useRef(new Map<string, string>());
  const active = selected ? reports.find(r => r.deviceId === selected || r.sessionId === selected) : reports[0];
  useEffect(() => {
    if (!open) return;
    const state = useRightWorkspaceStore.getState();
    if (floating) {
      const current = state.panes[state.scope];
      if (current?.tabs.find(t => t.id === current.activeId)?.kind === 'phone') state.setOpen(false);
      return;
    }
    if (active) for (const tab of state.panes[state.scope]?.tabs ?? []) {
      if (tab.kind === 'phone' && (tab.phoneSessionId === active.sessionId && tab.phoneSessionId !== active.deviceId
        || !reports.some(report => tab.phoneSessionId === report.deviceId || tab.phoneSessionId === report.sessionId))) state.remove(tab.id, state.scope);
    }
    state.openPhone(active?.deviceId ?? selected ?? 'connected', active?.deviceName ?? 'Phone', state.scope, true, false);
  }, [activation, open, floating, active?.sessionId, active?.deviceId, active?.deviceName, selected, reports]);
  const canControl = Boolean(active && controlConversationId === active.owner);
  const phoneAddress = active ? canControl ? active.owner : `device:${active.deviceId}` : '';
  const phone = useConversationPhone(phoneAddress, (open || hasOpened) && Boolean(active));
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { hide(); setHasOpened(false); }, [identity, hide]);
  useEffect(() => {
    const pending = reports.find(report => report.status === 'needs_user' && report.controlOwner !== 'human'
      && (report.sourceConversationId ?? report.owner) === scope);
    if (!pending) return;
    const request = `${pending.controlEpoch}:${pending.stopReason}`;
    if (relayed.current.get(pending.sessionId) === request) return;
    relayed.current.set(pending.sessionId, request);
    show(pending.sessionId, true, scope);
  }, [reports, scope, show]);
  useEffect(() => {
    const refresh = () => { void connections.mutate(); };
    window.addEventListener('phone-connections-changed', refresh);
    return () => window.removeEventListener('phone-connections-changed', refresh);
  }, [connections.mutate]);
  useEffect(() => { setConfirmDisconnect(false); setError(''); }, [active?.deviceId, open]);
  const update = (value?: PhoneLiveState) => { void phone.mutate(value, Boolean(!value)); void connections.mutate(); };
  async function disconnect() {
    if (!active) return;
    setDisconnecting(true); setError('');
    try {
      await fetchJson(apiUrl(`/api/phone/devices/${active.deviceId}/disconnect`), { method: 'POST' });
      setConfirmDisconnect(false); await connections.mutate(); await phone.mutate();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setDisconnecting(false); }
  }
  const closeButton = <Button onClick={() => { hide(); if (!floating && workspaceVisible) useRightWorkspaceStore.getState().setOpen(false); }} variant="ghost" className="size-8 rounded-full p-0 text-fg-muted" aria-label={zh ? '收起手机，保持连接' : 'Hide phone, keep connected'}><X className="size-4" /></Button>;
  const windowButtons = <><Button variant="ghost" className="size-8 rounded-full p-0 text-fg-muted" onClick={() => setDisplayMode(floating ? 'docked' : 'floating')} aria-label={floating ? (zh ? '停靠到右侧' : 'Dock to right') : (zh ? '小窗显示' : 'Floating window')} title={floating ? (zh ? '停靠到右侧' : 'Dock to right') : (zh ? '小窗显示' : 'Floating window')}>{floating ? <PanelRight className="size-4" /> : <PictureInPicture2 className="size-4" />}</Button>{closeButton}</>;
  const controlTileClass = 'min-h-14 rounded-2xl text-xs';
  const connectionNotice = <>{confirmDisconnect && <div role="alert" className="shrink-0 space-y-3 border-b border-edge p-4 text-sm"><p>{zh ? '断开会停止此手机上的当前任务。确认断开？' : 'Disconnecting stops the current phone task. Disconnect?'}</p><Button variant="secondary" disabled={disconnecting} onClick={() => void disconnect()}>{zh ? '确认断开' : 'Disconnect'}</Button><Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>{zh ? '保持连接' : 'Keep connected'}</Button></div>}
        {error && <p role="alert" className="px-4 py-2 text-sm text-danger">{error}</p>}</>;
  return <>
    <div ref={fallbackMount} className="hidden" />
    {assistance.length > 0 && <div role="alert" className="fixed bottom-20 right-4 z-[82] max-h-[40dvh] w-[min(22rem,calc(100vw-2rem))] space-y-3 overflow-y-auto rounded-2xl border border-edge bg-surface-panel p-4 text-sm shadow-popover">
      {assistance.map(report => <div key={report.sessionId} className="space-y-2">
        <p className="flex items-center gap-2 font-medium"><Hand className="size-4 shrink-0 text-accent" aria-hidden />{report.deviceName} · {zh ? '需要你操作' : 'Your help is needed'}</p>
        {report.message && <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-fg-muted">{report.message}</p>}
        <p className="text-xs text-fg-muted">{zh ? '任务已暂停。请接管手机完成操作，再点击“恢复 AI 操作”。' : 'The task is paused. Take over, complete the requested action, then hand back control to continue.'}</p>
        <PhoneAssistanceActions conversationId={report.sourceConversationId ?? report.owner} state={{ report, ownControl: false, frame: null }} onChange={() => { void connections.mutate(); void phone.mutate(); }} />
      </div>)}
    </div>}
    {(!open || !floating && !workspaceVisible) && <Button variant="secondary" className="fixed bottom-4 right-4 z-50 gap-2 rounded-full bg-surface-panel" onClick={() => show()} aria-label={zh ? '全局手机连接' : 'Phone connections'}>
      <Smartphone className="size-4" /><span>{zh ? '手机' : 'Phones'} · {reports.length}{reports.some(r => r.controlOwner === 'agent' || r.controlOwner === 'human') ? (zh ? ' · 操作中' : ' · In use') : ''}</span>
      {reports.some(r => r.controlOwner === 'agent') && <span className="size-2 rounded-full bg-accent" aria-label={zh ? '操作中' : 'In use'} />}
    </Button>}
    {createPortal((open || hasOpened) && <aside ref={panelRef} aria-label={zh ? '手机连接' : 'Phone connections'} data-phone-window data-display-mode={displayMode}
      className={cn('flex min-h-0 shrink-0 flex-col overflow-hidden text-fg', !open && 'hidden', floating
        ? 'fixed z-[81] max-h-[calc(100dvh-1.5rem)] w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-edge bg-surface-panel shadow-popover'
        : 'relative h-full max-h-full w-full bg-surface-panel')}
      style={floating ? { width: floatingWidth, height: floatingWidth * 640 / 288, left: position?.x, right: position ? undefined : 16, top: position?.y ?? 80 } : undefined}>
        <p className="sr-only">{canControl ? (zh ? '收起窗口后手机保持连接。接管后可操作手机。' : 'Hiding the window keeps the phone connected. Take over to control the phone.') : (zh ? '收起窗口后手机保持连接。此入口仅查看，操作请前往控制对话。' : 'Hiding the window keeps the phone connected. This view is read only; use the source chat to control it.')}</p>
        {(!active || !phone.data) && <header onPointerDown={floating ? startDrag : undefined} className={cn('flex shrink-0 items-center gap-1 px-5 py-4', floating && 'cursor-grab touch-none')}><span className="min-w-0 flex-1 truncate text-sm font-semibold">{active?.deviceName ?? (zh ? '手机' : 'Phones')}</span>{windowButtons}</header>}
        {reports.length > 1 && <div role="tablist" aria-label={zh ? '已连接手机' : 'Connected phones'} className="flex shrink-0 gap-1 overflow-x-auto px-4 pt-3">
          {reports.map(report => <button role="tab" aria-selected={active?.deviceId === report.deviceId} key={report.deviceId} onClick={() => show(report.deviceId)} className="shrink-0 rounded-full px-3 py-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-hover aria-selected:bg-surface-hover aria-selected:text-fg">
            {report.deviceName}
          </button>)}
        </div>}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {connections.error && !connections.data || phone.error && !phone.data ? <div role="alert" className="space-y-3 p-4 text-sm"><p>{zh ? '无法获取手机状态，请检查 Gateway 连接后重试。' : 'Phone status unavailable. Check the Gateway connection.'}</p><Button variant="secondary" onClick={() => { void connections.mutate(); void phone.mutate(); }}>{zh ? '重试' : 'Retry'}</Button></div>
            : connections.isLoading || active && !phone.data ? <div className="space-y-3 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-96 w-full" /></div>
              : active && phone.data ? <PhoneLivePanel key={`${active.deviceId}:${phoneAddress}`} conversationId={phoneAddress} state={phone.data} onChange={update} readOnly={!canControl} headerActions={windowButtons} onHeaderPointerDown={floating ? startDrag : undefined} onHeaderKeyDown={floating ? moveWithKeyboard : undefined} onControlsClose={() => { setConfirmDisconnect(false); setError(''); }} connectionNotice={connectionNotice} connectionActions={<>
                {!canControl && /^[\da-f]{8}-[\da-f-]{27}$/i.test(active.sourceConversationId ?? active.owner) && <Button variant="secondary" className={controlTileClass} onClick={() => { navigate(`/chat/${active.sourceConversationId ?? active.owner}`); hide(); }}><MessageSquare className="size-4" aria-hidden /><span>{zh ? '前往控制对话' : 'Open source chat'}{active.sourceConversationName && <span className="ml-2 text-xs text-fg-muted">{active.sourceConversationName}</span>}</span></Button>}
                <Button variant="secondary" className={`${controlTileClass} text-danger`} onClick={() => setConfirmDisconnect(true)}><Unplug className="size-4" aria-hidden />{zh ? '断开连接…' : 'Disconnect…'}</Button>
              </>} />
                : <div className="space-y-3 p-4 text-sm text-fg-muted"><p>{zh ? '暂无已连接的手机。可以在聊天中让 Agent 使用手机，或前往手机设置。' : 'No connected phones. Ask an Agent to use a phone, or open phone settings.'}</p><Button variant="secondary" onClick={() => { navigate('/settings/phone-use'); hide(); }}>{zh ? '手机设置' : 'Phone settings'}</Button></div>}
        </div>
        {floating && <button type="button" aria-label={zh ? '等比例调整手机小窗大小' : 'Resize phone window proportionally'} title={zh ? '拖动缩放 · 最小 216px，最大 432px（随屏幕调整）' : 'Drag to resize · 216–432px, limited by screen size'} onPointerDown={startResize} className="absolute bottom-0 right-0 size-6 touch-none cursor-nwse-resize text-fg-muted opacity-50 hover:opacity-100"><svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path d="M12 19l7-7m-2 7l2-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>}
      </aside>, host)}
  </>;
}
