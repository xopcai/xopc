import { ArrowUpRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleStore } from '@/stores/locale-store';

import { fetchMcpDraftTools, fetchMcpTools, type McpToolInfo } from '../mcp/mcp-config-api';
import { connectionUsagePath, type UsageTarget } from '../utils/connection-usage';

type Props = {
  target: UsageTarget;
  serverId?: string;
  draftId?: string;
  tools?: McpToolInfo[];
  skills?: Array<{ name: string; description?: string }>;
  preview?: boolean;
  onStart?: () => void;
};

export function ConnectionUsageGuide({ target, serverId, draftId, tools, skills = [], preview = false, onStart }: Props) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const { data, error, isLoading, mutate } = useSWR(
    tools === undefined && serverId ? ['connection-usage-tools', serverId, draftId] : null,
    ([, id, draft]: [string, string, string | undefined]) => {
      const signal = new AbortController().signal;
      return draft ? fetchMcpDraftTools(draft, signal) : fetchMcpTools(id, signal);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 60_000 },
  );
  const availableTools = (tools ?? data ?? []).filter(tool => tool.exposure !== 'hidden');
  const examples = [
    ...availableTools.map(tool => ({ name: tool.name, description: tool.description })),
    ...skills.map(skill => ({ name: skill.name, description: skill.description ?? '' })),
  ].slice(0, 3);
  return <section className="space-y-3 rounded-xl border border-edge bg-surface-base p-4" aria-label={zh ? '使用推荐' : 'Usage suggestions'}>
    <div className="flex items-center gap-2">
      <Sparkles className="size-4 shrink-0 text-accent-fg" aria-hidden />
      <h3 className="text-sm font-semibold text-fg">{preview ? (zh ? '连接后可以怎么用' : 'What you can try after connecting') : (zh ? '从这里开始使用' : 'Start here')}</h3>
    </div>
    <p className="text-sm leading-6 text-fg-muted">{preview
      ? (zh ? '已发现以下能力。保存并启用连接后，即可在对话中使用。' : 'These capabilities were discovered. Save and enable the connection to use them in chat.')
      : (zh ? '在对话中说出你要完成的事，助手会检查可用能力和权限，再帮你选择用法。' : 'Describe your task in chat. The assistant will check available capabilities and permissions to help you get started.')}</p>
    {isLoading ? <div aria-busy="true" className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : null}
    {error ? <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted"><p>{zh ? '暂时无法读取能力列表。' : 'Unable to load capabilities.'}</p><Button variant="ghost" className="text-xs" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></div> : null}
    {!isLoading && !error && (tools !== undefined || data) && !availableTools.length && !skills.length ? <p className="text-xs text-fg-muted">{zh ? '当前未发现可调用工具，可检查服务配置和授权。' : 'No callable tools found. Check the service configuration and authorization.'}</p> : null}
    {examples.length ? <div className="space-y-2">
      <p className="text-xs font-medium text-fg-muted">{zh ? '你可以从这些能力开始' : 'Capabilities to explore'}</p>
      {examples.map((example, index) => <div key={`${example.name}-${index}`} className="rounded-lg border border-edge-subtle bg-surface-panel p-3">
        <p className="break-words text-sm font-medium text-fg">{example.name.replace(/^mcp__[^ ]+?__/, '').replace(/[_-]+/g, ' ')}</p>
        {example.description ? <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-fg-muted">{example.description}</p> : null}
        {!preview ? <Link onClick={onStart} to={connectionUsagePath(target, zh, example.name)} className="mt-2 inline-flex min-h-9 items-center gap-1 rounded text-xs text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{zh ? '帮我了解这个用法' : 'Explore this capability'}<ArrowUpRight className="size-3.5" aria-hidden /></Link> : null}
      </div>)}
    </div> : null}
    {!preview ? <Button asChild variant="secondary"><Link onClick={onStart} to={connectionUsagePath(target, zh)}><Sparkles className="size-4" aria-hidden />{zh ? '推荐适合我的用法' : 'Suggest ways to use it'}</Link></Button> : null}
    {!preview ? <p className="text-xs leading-5 text-fg-subtle">{zh ? '点击后将预填对话，发送后获取建议。' : 'Opens a draft in chat. Send it to get suggestions.'}</p> : null}
  </section>;
}
