import { PanelRight, PictureInPicture2, Unplug, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
import { phoneAttentionKey, usePhoneAttention } from './phone-attention';

export function phoneOccupancy(report: PhoneLiveState['report'], zh: boolean): string {
  if (phoneEnded(report.status)) return zh ? '已断开' : 'Disconnected';
  if (report.handoff && report.handoff !== 'idle') return zh ? '正在交接控制权' : 'Transferring control';
  if (report.controlOwner === 'human') return zh ? '人工操作中' : 'Manual control';
  if (['paused', 'needs_user', 'failed', 'outcome_unknown'].includes(report.status)) return zh ? '等待检查或接管' : 'Needs inspection';
  if (report.controlOwner === 'agent') return zh ? '聊天任务占用中' : 'In use by a chat';
  return zh ? '已连接 · 空闲' : 'Connected · Idle';
}

export function GlobalPhoneWorkspace({ conversationId }: { conversationId?: string | null }) {
  const identity = useGatewayStore(s => `${s.baseUrl}:${s.conversationId}`);
  // Mounting per conversation also releases pending/manual control on navigation.
  return conversationId ? <SessionPhoneWorkspace key={`${identity}:${conversationId}`} conversationId={conversationId} /> : null;
}

function SessionPhoneWorkspace({ conversationId }: { conversationId: string }) {
  const zh = useLocaleStore(s => s.language) === 'zh';
  const { activation, open: requestedOpen, controlConversationId, displayMode, position, floatingWidth, setDisplayMode, hide } = usePhoneWorkspaceStore();
  const floating = displayMode === 'floating';
  const pane = useRightWorkspaceStore(state => state.panes[conversationId]);
  const workspaceVisible = Boolean(pane?.open && pane.tabs.find(t => t.id === pane.activeId)?.kind === 'phone');
  const phone = useConversationPhone(conversationId);
  const active = phone.data?.report;
  const open = requestedOpen && controlConversationId === conversationId && Boolean(active && !phoneEnded(active.status));
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => { if (open) setHasOpened(true); }, [open]);
  const fallbackMount = useRef<HTMLDivElement>(null);
  const [host] = useState(() => { const node = document.createElement('div'); node.style.display = 'contents'; return node; });
  useLayoutEffect(() => {
    const slot = document.getElementById('phone-workspace-slot');
    const target = floating ? document.body : slot?.dataset.phoneConversationId === conversationId ? slot : fallbackMount.current;
    target?.appendChild(host);
  });
  useEffect(() => () => host.remove(), [host]);
  const { panelRef, startDrag, startResize, moveWithKeyboard } = usePhoneWindowLayout(open, floating);
  useEffect(() => {
    if (!open || !active) return;
    const state = useRightWorkspaceStore.getState();
    if (floating) {
      const current = state.panes[conversationId];
      if (current?.tabs.find(t => t.id === current.activeId)?.kind === 'phone') state.setOpen(false, conversationId);
      return;
    }
    const phoneId = active.deviceId ?? active.sessionId;
    for (const tab of state.panes[conversationId]?.tabs ?? []) {
      if (tab.kind === 'phone' && tab.phoneSessionId !== phoneId) state.remove(tab.id, conversationId);
    }
    state.openPhone(phoneId, active.deviceName, conversationId, true, false);
  }, [activation, open, floating, active?.sessionId, active?.deviceId, active?.deviceName, conversationId]);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !floating && !workspaceVisible || !phone.data || phone.error || document.visibilityState !== 'visible') return;
    const key = phoneAttentionKey(conversationId, phone.data.report);
    if (key) usePhoneAttention.getState().markSeen(key);
  }, [open, floating, workspaceVisible, phone.data, phone.error, conversationId]);
  useEffect(() => { setConfirmDisconnect(false); setError(''); }, [active?.deviceId, open]);
  const update = (value?: PhoneLiveState) => { void phone.mutate(value, Boolean(!value)); };
  async function disconnect() {
    if (!active) return;
    setDisconnecting(true); setError('');
    try {
      await fetchJson(apiUrl(`/api/phone/devices/${active.deviceId}/disconnect`), { method: 'POST' });
      setConfirmDisconnect(false); await phone.mutate();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setDisconnecting(false); }
  }
  const closeButton = <Button onClick={() => { hide(); if (!floating && workspaceVisible) useRightWorkspaceStore.getState().setOpen(false, conversationId); }} variant="ghost" className="size-8 rounded-full p-0 text-fg-muted" aria-label={zh ? '收起手机，保持连接' : 'Hide phone, keep connected'}><X className="size-4" /></Button>;
  const windowButtons = <><Button variant="ghost" className="size-8 rounded-full p-0 text-fg-muted" onClick={() => setDisplayMode(floating ? 'docked' : 'floating')} aria-label={floating ? (zh ? '停靠到右侧' : 'Dock to right') : (zh ? '小窗显示' : 'Floating window')} title={floating ? (zh ? '停靠到右侧' : 'Dock to right') : (zh ? '小窗显示' : 'Floating window')}>{floating ? <PanelRight className="size-4" /> : <PictureInPicture2 className="size-4" />}</Button>{closeButton}</>;
  const controlTileClass = 'min-h-14 rounded-2xl text-xs';
  const connectionNotice = <>{confirmDisconnect && <div role="alert" className="shrink-0 space-y-3 border-b border-edge p-4 text-sm"><p>{zh ? '断开会停止此手机上的当前任务。确认断开？' : 'Disconnecting stops the current phone task. Disconnect?'}</p><Button variant="secondary" disabled={disconnecting} onClick={() => void disconnect()}>{zh ? '确认断开' : 'Disconnect'}</Button><Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>{zh ? '保持连接' : 'Keep connected'}</Button></div>}
        {error && <p role="alert" className="px-4 py-2 text-sm text-danger">{error}</p>}</>;
  return <>
    <div ref={fallbackMount} className="hidden" />
    {createPortal(active && !phoneEnded(active.status) && (open || hasOpened) && <aside ref={panelRef} aria-label={zh ? '手机连接' : 'Phone connections'} data-phone-window data-display-mode={displayMode}
      className={cn('flex min-h-0 shrink-0 flex-col overflow-hidden text-fg', !open && 'hidden', floating
        ? 'fixed z-[81] max-h-[calc(100dvh-1.5rem)] w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-edge bg-surface-panel shadow-popover'
        : 'relative h-full max-h-full w-full bg-surface-panel')}
      style={floating ? { width: floatingWidth, height: floatingWidth * 640 / 288, left: position?.x, right: position ? undefined : 16, top: position?.y ?? 80 } : undefined}>
        <p className="sr-only">{zh ? '此手机属于当前对话。收起窗口后手机保持连接，人工控制结束并保持暂停。' : 'This phone belongs to the current chat. Hiding keeps the connection and leaves manual control paused.'}</p>
        {(!active || !phone.data) && <header onPointerDown={floating ? startDrag : undefined} className={cn('flex shrink-0 items-center gap-1 px-5 py-4', floating && 'cursor-grab touch-none')}><span className="min-w-0 flex-1 truncate text-sm font-semibold">{active?.deviceName ?? (zh ? '手机' : 'Phones')}</span>{windowButtons}</header>}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {phone.error && !phone.data ? <div role="alert" className="space-y-3 p-4 text-sm"><p>{zh ? '无法获取手机状态，请检查 Gateway 连接后重试。' : 'Phone status unavailable. Check the Gateway connection.'}</p><Button variant="secondary" onClick={() => { void phone.mutate(); }}>{zh ? '重试' : 'Retry'}</Button></div>
            : phone.isLoading ? <div className="space-y-3 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-96 w-full" /></div>
              : active && phone.data ? <PhoneLivePanel key={active.sessionId} conversationId={conversationId} state={phone.data} onChange={update} active={open && (floating || workspaceVisible)} headerActions={windowButtons} onHeaderPointerDown={floating ? startDrag : undefined} onHeaderKeyDown={floating ? moveWithKeyboard : undefined} onControlsClose={() => { setConfirmDisconnect(false); setError(''); }} connectionNotice={connectionNotice} connectionActions={<>

                <Button variant="secondary" className={`${controlTileClass} text-danger`} onClick={() => setConfirmDisconnect(true)}><Unplug className="size-4" aria-hidden />{zh ? '断开连接…' : 'Disconnect…'}</Button>
              </>} />
                : null}
        </div>
        {floating && <button type="button" aria-label={zh ? '等比例调整手机小窗大小' : 'Resize phone window proportionally'} title={zh ? '拖动缩放 · 最小 216px，最大 432px（随屏幕调整）' : 'Drag to resize · 216–432px, limited by screen size'} onPointerDown={startResize} className="absolute bottom-0 right-0 size-6 touch-none cursor-nwse-resize text-fg-muted opacity-50 hover:opacity-100"><svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path d="M12 19l7-7m-2 7l2-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>}
      </aside>, host)}
  </>;
}
