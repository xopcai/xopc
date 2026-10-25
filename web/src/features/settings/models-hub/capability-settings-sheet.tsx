import * as Dialog from '@radix-ui/react-dialog';
import { Activity, lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ModelSetupUse } from '@xopcai/gateway-contract';

import { X } from 'lucide-react';
import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { Button } from '@/components/ui/button';
import { SettingsPanelSkeleton } from '@/features/settings/settings-loading-skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { capabilityLabels, parseCapabilityUse } from './capability-navigation';

const Editor = lazy(() => import('./capabilities-settings-panel').then(module => ({ default: module.CapabilitiesSettingsPanel })));

export function CapabilitySettingsSheet() {
  const id = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const isOpen = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [use, setUse] = useState<ModelSetupUse>();
  const [purpose, setPurpose] = useState<'phone' | 'automation'>();
  const [view, setView] = useState<'settings' | 'services'>('settings');
  const [pending, setPending] = useState(false);
  isOpen.current = open;
  const zh = useLocaleStore(state => state.language) === 'zh';
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ use?: string; view?: string; purpose?: string }>).detail;
      const use = parseCapabilityUse(detail?.use ?? null);
      if (use && !pending) { if (!isOpen.current) {
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const nearestDialog = returnFocus.current?.closest<HTMLElement>('[role="dialog"]');
        if (!nearestDialog?.closest('[data-capability-settings-sheet]')) setPortalHost(nearestDialog?.parentElement?.closest<HTMLElement>('[role="dialog"]') ?? nearestDialog ?? null);
      } setUse(use); setPurpose(detail?.purpose === 'phone' || detail?.purpose === 'automation' ? detail.purpose : undefined); setOpen(true); setView(detail?.view === 'services' ? 'services' : 'settings'); }
    };
    window.addEventListener('open-capability-settings', open);
    return () => window.removeEventListener('open-capability-settings', open);
  }, [pending]);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const key = `${use}:${view}`;
    element.scrollTop = scrollPositions.current.get(key) ?? 0;
    return () => { scrollPositions.current.set(key, element.scrollTop); };
  }, [view, use]);
  const changeView = (next: 'settings' | 'services') => {
    if (!pending) setView(next);
  };
  return <Dialog.Root open={open} onOpenChange={value => { if (!pending) setOpen(value); }}><Dialog.Portal forceMount container={portalHost ?? undefined}><div className="contents"><Activity mode={open ? 'visible' : 'hidden'}>
    <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[150] bg-scrim" />
    <Dialog.Content data-capability-settings-sheet aria-describedby={undefined} forceMount onCloseAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => returnFocus.current?.focus()); }} className="xopc-dialog-content fixed inset-x-3 top-1/2 z-[151] mx-auto flex h-[min(48rem,calc(100dvh-2rem))] w-[calc(100%-1.5rem)] max-w-3xl -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay" onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onInteractOutside={event => { if (pending) event.preventDefault(); }}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-5 py-4"><div><Dialog.Title className="text-base font-semibold text-fg">{purpose === 'phone' ? (zh ? '手机模型服务' : 'Phone model services') : purpose === 'automation' ? (zh ? '自动化模型' : 'Automation models') : use ? capabilityLabels[use][zh ? 0 : 1] : ''}</Dialog.Title></div><Button variant="ghost" className="size-11 shrink-0 p-0" aria-label={zh ? '关闭设置' : 'Close settings'} disabled={pending} onClick={() => setOpen(false)}><X className="size-4" aria-hidden /></Button></header>
      <div className="shrink-0 border-b border-edge px-5 py-3"><SlidingTabList role="tablist" aria-label={zh ? '能力配置' : 'Capability configuration'} className="inline-flex gap-1 rounded-xl bg-surface-inset p-1" indicatorClassName="rounded-md bg-surface-panel shadow-sm">{(['settings', 'services'] as const).map(tab => <Button key={tab} id={`${id}-${tab}`} role="tab" aria-selected={view === tab} aria-controls={`${id}-panel`} tabIndex={view === tab ? 0 : -1} variant="ghost" className={view === tab ? 'bg-surface-panel text-fg shadow-sm hover:bg-surface-panel' : ''} disabled={pending} onClick={() => changeView(tab)} onKeyDown={event => {
        if (pending || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'settings' : event.key === 'End' ? 'services' : tab === 'settings' ? 'services' : 'settings';
        changeView(next); document.getElementById(`${id}-${next}`)?.focus();
      }}>{tab === 'settings' ? (zh ? '模型与参数' : 'Model and parameters') : (zh ? '管理服务' : 'Manage services')}</Button>)}</SlidingTabList></div>
      <div ref={body} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${view}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{use ? <Suspense fallback={<SettingsPanelSkeleton />}><Editor key={use} inlineUse={use} inlineView={view} onViewChange={setView} onPendingChange={setPending} /></Suspense> : null}</div>
      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-edge px-5 py-3"><p className="text-xs leading-relaxed text-fg-muted">{pending ? (zh ? '正在保存…' : 'Saving…') : view === 'settings' ? (zh ? '自动保存' : 'Saves automatically') : null}</p><Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>{purpose === 'phone' ? (zh ? '返回手机设置' : 'Back to phone settings') : purpose === 'automation' ? (zh ? '返回自动化' : 'Back to automation') : (zh ? '完成' : 'Done')}</Button></footer>
    </Dialog.Content>
  </Activity></div></Dialog.Portal></Dialog.Root>;
}
