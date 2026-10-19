import { Link } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import { Package } from 'lucide-react';
import { CapabilityIcon } from '@/features/capabilities/capability-icon';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { PluginSetupPanel } from './plugin-setup-panel';
import { AgentPluginDialog } from './agent-plugin-dialog';
import { useState } from 'react';
import type { ExtensionApiRow } from './types';

export function PluginDetailsPage({ pluginId }: { pluginId: string }) {
  const zh = useLocaleStore(state => state.language).startsWith('zh');
  const { mutate } = useSWRConfig();
  const [manage, setManage] = useState(false);
  const { data, error, mutate: refresh } = useSWR(`plugin-details:${pluginId}`, async () => {
    const result = await fetchJson<{ ok: boolean; payload: ExtensionApiRow; error?: string }>(apiUrl(`/api/extensions/agent-plugins/${encodeURIComponent(pluginId)}`));
    if (!result.ok) throw new Error(result.error ?? 'Plugin not found');
    return result.payload;
  }, { revalidateOnFocus: true });
  return <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
    <nav aria-label={zh ? '面包屑' : 'Breadcrumb'} className="flex gap-2 text-sm text-fg-muted"><Link to="/capabilities/extensions" className="hover:text-accent">{zh ? '扩展' : 'Extensions'}</Link><span aria-hidden>/</span><span>{data?.name ?? pluginId}</span></nav>
    {error ? <p role="alert" className="text-sm text-fg-muted">{String(error)}</p> : !data ? <div className="space-y-4"><Skeleton className="h-12 w-72" /><Skeleton className="h-28 w-full" /><Skeleton className="h-72 w-full" /></div> : <>
      <header className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-3"><CapabilityIcon iconUrl={data.branding?.iconUrl} fallback={Package} className="size-14 [&_img]:size-11" /><h2 className="break-words text-xl font-semibold">{data.name}</h2></div><p className="mt-3 text-sm leading-relaxed text-fg-muted">{data.description}</p><p className="mt-2 text-xs text-fg-muted">{data.version} · {data.dialect ?? 'portable'}</p></div><Button variant="ghost" onClick={() => setManage(true)}>{zh ? '管理插件' : 'Manage plugin'}</Button></header>
      <PluginSetupPanel extension={data} zh={zh} onChanged={async () => { await refresh(); await mutate('gateway-extensions-list'); }} />
      {data.components?.skills.length ? <section className="space-y-3 border-t border-edge pt-5"><h3 className="text-sm font-medium">{zh ? `技能（${data.components.skills.length}）` : `Skills (${data.components.skills.length})`}</h3><div className="flex flex-wrap gap-2">{data.components.skills.map(skill => <span key={skill.name} className="rounded-lg border border-edge px-3 py-2 text-sm">{skill.name}</span>)}</div></section> : null}
      <p className="text-xs text-fg-muted">{zh ? '默认对所有 Agent 可用，特殊配置请在 Agent 设置中调整。' : 'Available to all agents by default. Adjust individual preferences in Agent settings.'}</p>
    </>}
    {manage && data ? <AgentPluginDialog extension={data} onClose={() => { setManage(false); void refresh(); }} /> : null}
  </div></div>;
}
