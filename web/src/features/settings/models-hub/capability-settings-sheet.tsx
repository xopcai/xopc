import * as Dialog from '@radix-ui/react-dialog';
import { Activity, lazy, Suspense, useEffect, useState } from 'react';
import type { ModelSetupUse } from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { SettingsPanelSkeleton } from '@/features/settings/settings-loading-skeleton';
import { useLocaleStore } from '@/stores/locale-store';
import { capabilityLabels, parseCapabilityUse } from './capability-navigation';

const Editor = lazy(() => import('./capabilities-settings-panel').then(module => ({ default: module.CapabilitiesSettingsPanel })));

export function CapabilitySettingsSheet() {
  const [open, setOpen] = useState(false);
  const [use, setUse] = useState<ModelSetupUse>();
  const [view, setView] = useState<'settings' | 'services'>('settings');
  const [pending, setPending] = useState(false);
  const zh = useLocaleStore(state => state.language) === 'zh';
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ use?: string; view?: string }>).detail;
      const use = parseCapabilityUse(detail?.use ?? null);
      if (use && !pending) { setUse(use); setOpen(true); setView(detail?.view === 'services' ? 'services' : 'settings'); }
    };
    window.addEventListener('open-capability-settings', open);
    return () => window.removeEventListener('open-capability-settings', open);
  }, [pending]);
  return <Dialog.Root open={open} onOpenChange={value => { if (!pending) setOpen(value); }}><Dialog.Portal forceMount><div className="contents"><Activity mode={open ? 'visible' : 'hidden'}>
    <Dialog.Overlay className="fixed inset-0 z-[150] bg-scrim" />
    <Dialog.Content forceMount className="fixed inset-x-3 top-1/2 z-[151] mx-auto flex h-[min(48rem,calc(100dvh-2rem))] w-[calc(100%-1.5rem)] max-w-3xl -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay" onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onInteractOutside={event => { if (pending) event.preventDefault(); }}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-5 py-4"><div><Dialog.Title className="text-base font-semibold text-fg">{use ? capabilityLabels[use][zh ? 0 : 1] : ''}</Dialog.Title><Dialog.Description className="mt-1 text-xs text-fg-muted">{zh ? '调整全局默认设置，关闭后继续当前操作。' : 'Edit global defaults, then continue where you left off.'}</Dialog.Description></div><Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>{zh ? '完成' : 'Done'}</Button></header>
      <nav className="flex shrink-0 gap-1 border-b border-edge px-5 py-2" aria-label={zh ? '能力配置' : 'Capability configuration'}>{(['settings', 'services'] as const).map(tab => <Button key={tab} variant={view === tab ? 'secondary' : 'ghost'} aria-pressed={view === tab} disabled={pending} onClick={() => setView(tab)}>{tab === 'settings' ? (zh ? '模型与参数' : 'Model and parameters') : (zh ? '管理服务' : 'Manage services')}</Button>)}</nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{use ? <Suspense fallback={<SettingsPanelSkeleton />}><Editor key={use} inlineUse={use} inlineView={view} onViewChange={setView} onPendingChange={setPending} /></Suspense> : null}</div>
    </Dialog.Content>
  </Activity></div></Dialog.Portal></Dialog.Root>;
}
