import { useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, ListFilter, Search, X } from 'lucide-react';

import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

type Status = 'all' | 'active' | 'paused' | 'completed' | 'running' | 'attention';
type Source = 'all' | 'agent' | 'task_command' | 'browser_automation';
const itemClass = 'relative flex min-h-9 cursor-pointer items-center rounded-md py-2 pl-3 pr-8 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover';
const menuClass = 'z-70 max-h-[min(32rem,calc(100dvh-2rem))] min-w-52 overflow-y-auto rounded-xl border border-edge bg-surface-overlay p-1.5 shadow-popover';

function Choice({ value, children }: { value: string; children: ReactNode }) {
  return <DropdownMenu.RadioItem value={value} className={itemClass}>
    <DropdownMenu.ItemIndicator className="absolute right-2.5"><Check className="size-3.5" aria-hidden /></DropdownMenu.ItemIndicator>{children}
  </DropdownMenu.RadioItem>;
}

export function AutomationListToolbar({ language, labels, filter, ownership, source, projectId, projects, projectLocked, query, unreadCount, markReadBusy, onFilter, onOwnership, onSource, onProject, onQuery, onClear, onMarkAllRead }: {
  language: 'zh' | 'en'; labels: MessageBundle['automations'];
  filter: Status; ownership: 'user' | 'system'; source: Source; projectId: string;
  projects: { id: string; name: string }[]; projectLocked: boolean; query: string;
  unreadCount: number; markReadBusy: boolean;
  onFilter: (value: Status) => void; onOwnership: (value: 'user' | 'system') => void;
  onSource: (value: Source) => void; onProject: (value: string) => void;
  onQuery: (value: string) => void; onClear: () => void; onMarkAllRead: () => void;
}) {
  const zh = language === 'zh';
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchVisible = expanded || Boolean(query);
  const filtered = filter !== 'all' || source !== 'all' || ownership !== 'user' || (!projectLocked && Boolean(projectId));
  const closeSearch = () => { onQuery(''); setExpanded(false); searchButton.current?.focus(); };
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2 px-1">
      <h2 className="min-w-0 truncate text-sm font-semibold text-fg">{zh ? '定时任务' : 'Scheduled tasks'}</h2>
      <div className="flex shrink-0 items-center gap-0.5">
        <DropdownMenu.Root><DropdownMenu.Trigger asChild>
          <button type="button" aria-label={zh ? '筛选任务' : 'Filter tasks'} title={zh ? '筛选任务' : 'Filter tasks'} className={cn('relative rounded-md p-2 text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-hover', filtered && 'text-accent-fg')}><ListFilter className="size-4" aria-hidden />{filtered ? <span className="absolute right-1.5 top-1.5 size-1 rounded-full bg-accent"><span className="sr-only">{zh ? '已应用筛选' : 'Filters applied'}</span></span> : null}</button>
        </DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className={menuClass}>
          <DropdownMenu.Label className="px-3 py-1.5 text-xs text-fg-subtle">{zh ? '状态' : 'Status'}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={filter} onValueChange={value => onFilter(value as Status)}>
            <Choice value="all">{zh ? '全部状态' : 'All statuses'}</Choice><Choice value="active">{labels.filters.active}</Choice><Choice value="paused">{labels.paused}</Choice><Choice value="completed">{zh ? '已完成' : 'Completed'}</Choice><Choice value="running">{labels.metrics.running}</Choice><Choice value="attention">{labels.dashboard.needsAttention}</Choice>
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 border-t border-edge" />
          <DropdownMenu.Label className="px-3 py-1.5 text-xs text-fg-subtle">{zh ? '归属' : 'Owner'}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={ownership} onValueChange={value => onOwnership(value as 'user' | 'system')}><Choice value="user">{zh ? '我的任务' : 'My tasks'}</Choice><Choice value="system">{zh ? '系统任务' : 'System tasks'}</Choice></DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 border-t border-edge" />
          {!projectLocked ? <DropdownMenu.Sub><DropdownMenu.SubTrigger className="flex min-h-9 cursor-pointer items-center justify-between gap-4 rounded-md px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover">{zh ? '项目' : 'Project'}<span className="ml-auto max-w-28 truncate text-xs text-fg-muted">{projects.find(project => project.id === projectId)?.name ?? labels.filters.allProjects}</span><ChevronRight className="size-3.5 text-fg-subtle" aria-hidden /></DropdownMenu.SubTrigger><DropdownMenu.Portal><DropdownMenu.SubContent sideOffset={4} className={menuClass}><DropdownMenu.RadioGroup value={projectId} onValueChange={onProject}><Choice value="">{labels.filters.allProjects}</Choice>{projects.map(project => <Choice key={project.id} value={project.id}><span className="max-w-56 truncate">{project.name}</span></Choice>)}</DropdownMenu.RadioGroup></DropdownMenu.SubContent></DropdownMenu.Portal></DropdownMenu.Sub> : null}
          <DropdownMenu.Sub><DropdownMenu.SubTrigger className="flex min-h-9 cursor-pointer items-center justify-between gap-4 rounded-md px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover">{zh ? '任务类型' : 'Task type'}<ChevronRight className="size-3.5 text-fg-subtle" aria-hidden /></DropdownMenu.SubTrigger><DropdownMenu.Portal><DropdownMenu.SubContent sideOffset={4} className={menuClass}><DropdownMenu.RadioGroup value={source} onValueChange={value => onSource(value as Source)}><Choice value="all">{zh ? '全部类型' : 'All types'}</Choice><Choice value="agent">{labels.sources.agent}</Choice><Choice value="task_command">{labels.sources.task}</Choice><Choice value="browser_automation">{labels.sources.browser}</Choice></DropdownMenu.RadioGroup></DropdownMenu.SubContent></DropdownMenu.Portal></DropdownMenu.Sub>
          {filtered || query ? <><DropdownMenu.Separator className="my-1 border-t border-edge" /><DropdownMenu.Item className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg-muted outline-none data-[highlighted]:bg-surface-hover" onSelect={onClear}>{zh ? '重置筛选' : 'Reset filters'}</DropdownMenu.Item></> : null}
          {unreadCount > 0 ? <><DropdownMenu.Separator className="my-1 border-t border-edge" /><DropdownMenu.Item disabled={markReadBusy} className="cursor-pointer rounded-md px-3 py-2 text-sm text-fg-muted outline-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50" onSelect={onMarkAllRead}>{labels.filters.markAllRead}</DropdownMenu.Item></> : null}
        </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
        <button ref={searchButton} type="button" aria-label={zh ? '搜索任务' : 'Search tasks'} title={zh ? '搜索任务' : 'Search tasks'} aria-expanded={searchVisible} onClick={() => { if (searchVisible) closeSearch(); else { setExpanded(true); requestAnimationFrame(() => input.current?.focus()); } }} className={cn('rounded-md p-2 text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent', searchVisible && 'bg-surface-hover text-fg')}><Search className="size-4" aria-hidden /></button>
      </div>
    </div>
    {searchVisible ? <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface-panel px-2.5 focus-within:border-accent"><Search className="size-3.5 shrink-0 text-fg-subtle" aria-hidden /><input ref={input} value={query} onChange={event => onQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeSearch(); } }} aria-label={zh ? '搜索任务名称或内容' : 'Search task names or content'} placeholder={zh ? '搜索任务…' : 'Search tasks…'} className="min-h-10 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle" /><button type="button" aria-label={zh ? '关闭搜索' : 'Close search'} onClick={closeSearch} className="rounded-md p-1 text-fg-muted hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"><X className="size-3.5" aria-hidden /></button></div> : null}
  </div>;
}
