import { Search, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type {
  AgentDefaults,
  BuiltinToolSummary,
  ToolPolicy,
} from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';

type ToolFilter = 'all' | ToolPolicy['mode'];

function positiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function AgentDefaultsToolsPanel({
  draft,
  setDraft,
  builtinTools,
  zh,
}: {
  draft: AgentDefaults;
  setDraft: (draft: AgentDefaults) => void;
  builtinTools: BuiltinToolSummary[];
  zh: boolean;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ToolFilter>('all');
  const [expandedTool, setExpandedTool] = useState<string>();
  const descriptions = useMemo(
    () => new Map(builtinTools.map((tool) => [tool.id, tool.description])),
    [builtinTools],
  );
  const allTools = useMemo(
    () => [...new Set([...builtinTools.map((tool) => tool.id), ...Object.keys(draft.tools)])].sort(),
    [builtinTools, draft.tools],
  );
  const counts = useMemo(() => ({
    allow: allTools.filter((id) => (draft.tools[id]?.mode ?? 'allow') === 'allow').length,
    ask: allTools.filter((id) => draft.tools[id]?.mode === 'ask').length,
    deny: allTools.filter((id) => draft.tools[id]?.mode === 'deny').length,
  }), [allTools, draft.tools]);
  const visibleTools = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return allTools.filter((id) => {
      const mode = draft.tools[id]?.mode ?? 'allow';
      const description = descriptions.get(id);
      const searchable = `${id} ${description?.en ?? ''} ${description?.zh ?? ''}`.toLowerCase();
      return (!normalizedQuery || searchable.includes(normalizedQuery)) && (filter === 'all' || mode === filter);
    });
  }, [allTools, descriptions, draft.tools, filter, query]);

  const updateTool = (id: string, patch: Partial<ToolPolicy>) => {
    const current = draft.tools[id] ?? { mode: 'allow' };
    setDraft({ ...draft, tools: { ...draft.tools, [id]: { ...current, ...patch } } });
  };

  const filterOptions: Array<{ id: ToolFilter; label: string }> = [
    { id: 'all', label: zh ? `全部 ${allTools.length}` : `All ${allTools.length}` },
    { id: 'allow', label: zh ? `允许 ${counts.allow}` : `Allow ${counts.allow}` },
    { id: 'ask', label: zh ? `询问 ${counts.ask}` : `Ask ${counts.ask}` },
    { id: 'deny', label: zh ? `禁用 ${counts.deny}` : `Deny ${counts.deny}` },
  ];

  return (
    <section className="rounded-2xl border border-edge bg-surface-base p-5">
      <div>
        <h2 className="text-base font-semibold text-fg">{zh ? '默认工具权限' : 'Default tool permissions'}</h2>
        <p className="mt-1 text-sm text-fg-muted">{zh ? '允许：直接执行；询问：执行前确认；禁用：Agent 无法使用。' : 'Allow runs directly, Ask requires confirmation, and Deny makes the tool unavailable.'}</p>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl bg-surface-panel p-1">
          {filterOptions.map((option) => <button key={option.id} type="button" onClick={() => setFilter(option.id)} className={cn('rounded-lg px-3 py-1.5 text-xs font-medium', filter === option.id ? 'bg-surface-base text-fg shadow-surface' : 'text-fg-muted hover:text-fg')}>{option.label}</button>)}
        </div>
        <label className="relative block w-full sm:w-72"><span className="sr-only">{zh ? '搜索工具' : 'Search tools'}</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索工具' : 'Search tools'} className="w-full rounded-lg border border-edge bg-surface-panel py-2 pl-9 pr-3 text-sm text-fg outline-none focus:border-accent" /></label>
      </div>

      <div className="mt-4 max-h-[38rem] divide-y divide-edge overflow-y-auto rounded-xl border border-edge bg-surface-panel">
        {visibleTools.map((id) => {
          const policy = draft.tools[id] ?? { mode: 'allow' as const };
          const description = descriptions.get(id);
          const expanded = expandedTool === id;
          return (
            <div key={id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <code className="text-xs font-medium text-fg">{id}</code>
                  {description ? (
                    <p className="mt-1 text-xs leading-5 text-fg-muted">
                      {zh ? description.zh : description.en}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg bg-surface-base p-1">
                    {(['allow', 'ask', 'deny'] as const).map((mode) => <button key={mode} type="button" onClick={() => updateTool(id, { mode })} className={cn('rounded-md px-2.5 py-1 text-xs font-medium capitalize', policy.mode === mode ? 'bg-accent text-white' : 'text-fg-muted hover:text-fg')}>{mode === 'allow' ? (zh ? '允许' : 'Allow') : mode === 'ask' ? (zh ? '询问' : 'Ask') : (zh ? '禁用' : 'Deny')}</button>)}
                  </div>
                  <Button variant="ghost" className="px-2 py-1" aria-label={zh ? `${id} 调用限制` : `${id} call limits`} onClick={() => setExpandedTool(expanded ? undefined : id)}><SlidersHorizontal className="size-4" /></Button>
                </div>
              </div>
              {expanded ? (
                <div className="mt-3 grid gap-3 rounded-lg bg-surface-base p-3 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-fg-muted">{zh ? '每轮最多调用次数' : 'Maximum calls per turn'}<input type="number" min={1} value={policy.maxCallsPerTurn ?? ''} placeholder={zh ? '不限制' : 'Unlimited'} onChange={(event) => updateTool(id, { maxCallsPerTurn: positiveInt(event.target.value) })} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent" /></label>
                  <label className="block text-xs font-medium text-fg-muted">{zh ? '单次超时（毫秒）' : 'Call timeout (ms)'}<input type="number" min={1} value={policy.timeoutMs ?? ''} placeholder={zh ? '使用系统默认值' : 'Use system default'} onChange={(event) => updateTool(id, { timeoutMs: positiveInt(event.target.value) })} className="mt-2 w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg outline-none focus:border-accent" /></label>
                </div>
              ) : null}
            </div>
          );
        })}
        {visibleTools.length === 0 ? <p className="px-4 py-10 text-center text-sm text-fg-muted">{zh ? '没有匹配的工具。' : 'No matching tools.'}</p> : null}
      </div>
    </section>
  );
}
