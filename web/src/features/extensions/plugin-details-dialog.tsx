import * as Dialog from '@radix-ui/react-dialog';
import { Package, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CapabilityIcon } from '@/features/capabilities/capability-icon';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { AgentPluginDialog } from './agent-plugin-dialog';
import { pluginDisplayName } from './plugin-presentation';
import { PluginSetupPanel } from './plugin-setup-panel';
import type { ExtensionApiRow } from './types';

export function PluginDetailsDialog({ pluginId, initialConnect = false, onClose }: {
  pluginId: string;
  initialConnect?: boolean;
  onClose: () => void;
}) {
  const zh = useLocaleStore(state => state.language).startsWith('zh');
  const { mutate } = useSWRConfig();
  const [manage, setManage] = useState(false);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const { data, error, mutate: refresh } = useSWR(`plugin-details:${pluginId}`, async () => {
    const result = await fetchJson<{ ok: boolean; payload: ExtensionApiRow; error?: string }>(apiUrl(`/api/extensions/agent-plugins/${encodeURIComponent(pluginId)}`));
    if (!result.ok) throw new Error(result.error ?? 'Plugin not found');
    return result.payload;
  }, { revalidateOnFocus: true });
  const name = data ? pluginDisplayName(data, zh) : (zh ? '插件详情' : 'Plugin details');
  const description = data?.localizations?.[zh ? 'zh-CN' : 'en']?.description ?? data?.description;

  if (manage && data) return <AgentPluginDialog extension={data} onUninstalled={onClose} onClose={() => { setManage(false); void refresh(); }} />;

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[130] bg-scrim" />
    <Dialog.Content onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus({ preventScroll: true }); } }} className="xopc-dialog-content fixed left-1/2 top-1/2 z-[131] flex h-[min(38rem,calc(100dvh-2rem))] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-popover">
      <header className="flex shrink-0 items-center gap-3 border-b border-edge px-5 py-4">
        <CapabilityIcon iconUrl={data?.branding?.iconUrl} fallback={Package} />
        <div className="min-w-0 flex-1">
          <Dialog.Title className="truncate text-base font-semibold text-fg">{name}</Dialog.Title>
          {data ? <p className="mt-0.5 truncate text-xs text-fg-muted">{data.version} · {data.name}</p> : null}
        </div>
        <Dialog.Close asChild><Button variant="ghost" className="size-9 shrink-0 p-0" aria-label={zh ? '关闭插件详情' : 'Close plugin details'}><X className="size-5" aria-hidden /></Button></Dialog.Close>
      </header>
      <Dialog.Description className="sr-only">{zh ? '查看插件能力、管理账号连接与授权。关闭后返回原来的列表。' : 'View plugin capabilities and manage account connections. Close to return to the list.'}</Dialog.Description>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {error ? <p role="alert" className="text-sm text-fg-muted">{String(error)}</p> : !data ? <div className="space-y-4" aria-busy="true"><Skeleton className="h-14 w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-40 w-full" /></div> : <>
          {description ? <p className="text-sm leading-relaxed text-fg-muted">{description}</p> : null}
          <PluginSetupPanel key={pluginId} initialConnect={initialConnect} extension={data} zh={zh} onChanged={async () => { await refresh(); await mutate('gateway-extensions-list'); }} />
          {data.components?.skills.length ? <section className="space-y-3 border-t border-edge pt-5"><h3 className="text-sm font-medium">{zh ? `技能（${data.components.skills.length}）` : `Skills (${data.components.skills.length})`}</h3><div className="flex flex-wrap gap-2">{data.components.skills.map(skill => <Link key={skill.name} onClick={onClose} to={`/capabilities/skills?${new URLSearchParams({ tab: 'installed', source: 'plugin', q: data.dialect === 'portable' ? skill.name : `${pluginId}.${skill.name}` })}`} className="max-w-full break-words rounded-lg border border-edge px-3 py-2 text-sm text-accent hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{skill.name}</Link>)}</div></section> : null}
        </>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-edge px-5 py-4">
        {data ? <Button variant="ghost" onClick={() => setManage(true)}>{zh ? '管理插件' : 'Manage plugin'}</Button> : <span />}
        {data?.active && data.authorizationStatus !== 'required' ? <Button asChild><Link to={`/chat/new?${new URLSearchParams({ draft: zh ? `请帮我使用${name}插件。` : `Help me use the ${name} plugin.`, projectScope: 'none' })}`}>{zh ? '开始使用' : 'Start using'}</Link></Button> : <Dialog.Close asChild><Button variant="secondary">{zh ? '完成' : 'Done'}</Button></Dialog.Close>}
      </footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
