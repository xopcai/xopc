import * as Dialog from '@radix-ui/react-dialog';
import { Cable, Package, X } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConnectorDetailDialog } from '@/features/connectors/components/connector-detail-dialog';
import type { ConnectorDefinition } from '@/features/connectors/connectors-api';
import { getExtensionMarketplacePackageDetail } from '@/features/extensions/extension-marketplace-api';
import { PluginScopePreview } from '@/features/extensions/plugin-scope-preview';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import type { CapabilityCatalogItem } from './capability-catalog';
import { CapabilityIcon } from './capability-icon';

export function ServiceRecommendationDetailDialog({ item, definition, busy, onClose, onConnect }: {
  item: CapabilityCatalogItem;
  definition?: ConnectorDefinition;
  busy: boolean;
  onClose: () => void;
  onConnect: () => void;
}) {
  const language = useLocaleStore(state => state.language);
  const zh = language.startsWith('zh');
  const t = messages(language).connectorsSettings;
  const isPlugin = item.service?.source === 'store-plugin';
  const { data, error, isLoading, mutate } = useSWR(
    isPlugin ? ['recommended-service-detail', item.id] : null,
    () => getExtensionMarketplacePackageDetail(item.id),
    { revalidateOnFocus: false },
  );

  if (definition && !isPlugin) {
    return <ConnectorDetailDialog connector={definition} installed={false} onClose={onClose} onInstall={onConnect} t={t} />;
  }

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
    <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-[60] flex h-[min(42rem,calc(100dvh-2rem))] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-float">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge-subtle p-5">
        <div className="flex min-w-0 items-center gap-3">
          <CapabilityIcon iconUrl={item.iconUrl} fallback={isPlugin ? Package : Cable} />
          <Dialog.Title className="min-w-0 break-words text-base font-semibold text-fg">{item.name}</Dialog.Title>
        </div>
        <Dialog.Close asChild><Button variant="ghost" className="size-9 shrink-0 p-0" aria-label={t.modalClose}><X className="size-5" aria-hidden /></Button></Dialog.Close>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <Dialog.Description className="whitespace-pre-wrap break-words text-sm leading-7 text-fg-muted">{data?.localizations?.[zh ? 'zh-CN' : 'en']?.description || data?.description || item.description}</Dialog.Description>
        <p className="break-words text-xs text-fg-subtle">{zh ? '来源：' : 'Source: '}{data?.author.username || item.source}</p>
        {isLoading ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-5 w-32" /><Skeleton className="h-28 w-full rounded-lg" /></div> : null}
        {data ? <PluginScopePreview data={data} zh={zh} /> : null}
        {error ? <p role="status" className="text-sm text-fg-muted">{zh ? '详细信息加载失败。' : 'Could not load additional details.'}{' '}<button type="button" className="text-accent-fg hover:underline" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</button></p> : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-edge-subtle p-4">
        <Dialog.Close asChild><Button variant="secondary">{t.modalClose}</Button></Dialog.Close>
        <Button disabled={busy} onClick={onConnect}>{t.connect}</Button>
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
