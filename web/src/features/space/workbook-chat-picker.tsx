import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, MessageSquare, Plus, Search, X } from 'lucide-react';
import { useDeferredValue, useRef, useState, type ReactNode } from 'react';
import useSWR from 'swr';

import { Skeleton } from '@/components/ui/skeleton';
import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { usePersonalProfile } from '@/features/personal-agent/use-personal-profile';
import { listSessions } from '@/features/sessions/session-api';
import { useGatewayStore } from '@/stores/gateway-store';
import { cn } from '@/lib/cn';

export type WorkbookChatTarget = { pathname: string; agentId?: string };

const rowClass = 'group flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';

function Destination({ label, detail, onClick }: { label: string; detail?: string; onClick: () => void }) {
  return <button type="button" className={rowClass} onClick={onClick}>
    <MessageSquare className="size-4 shrink-0 text-fg-muted" aria-hidden />
    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{label}</span>
      {detail ? <span className="block truncate text-xs text-fg-muted">{detail}</span> : null}</span>
    <ArrowRight className="size-4 shrink-0 text-fg-muted opacity-60 transition-opacity group-hover:opacity-100" aria-hidden />
  </button>;
}

export function WorkbookChatPicker({ label, zh, sourceConversationId, onClose, onPick, restoreFocus }: {
  label: string;
  zh: boolean;
  sourceConversationId?: string;
  onClose: () => void;
  onPick: (target: WorkbookChatTarget) => void;
  restoreFocus: () => void;
}) {
  const session = useGatewayStore(state => state.conversationId);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'recent' | 'new'>('recent');
  const searchInput = useRef<HTMLInputElement>(null);
  const search = useDeferredValue(query.trim());
  const personal = usePersonalProfile();
  const agents = useSWR(['gateway-chat-agents', session], fetchChatAgents);
  const recent = useSWR(mode === 'recent' ? ['workbook-chats', session, search] : null,
    () => listSessions({ limit: 30, search, sortBy: 'updatedAt', sortOrder: 'desc', rootConversationsOnly: true, excludeAutomationRuns: true }));
  const sessions = (recent.data?.items ?? []).filter(row => row.status !== 'archived' && row.key !== personal.profile?.conversationId);
  const from = sessions.find(row => row.key === sourceConversationId);
  const ordered = from ? [from, ...sessions.filter(row => row !== from)] : sessions;
  const showPersonal = Boolean(personal.profile && (!search || personal.displayName.toLowerCase().includes(search.toLowerCase())));
  let content: ReactNode;
  if (mode === 'new') {
    const options = agents.data?.items.filter(agent => agent.id !== personal.profile?.agentId) ?? [];
    content = options.map(agent => <Destination key={agent.id} label={agent.name ?? agent.id}
      detail={agent.id === agents.data?.defaultId ? (zh ? '默认助手' : 'Default assistant') : agent.description}
      onClick={() => onPick({ pathname: '/chat/new', agentId: agent.id })} />);
  } else {
    content = <>{showPersonal ? <Destination label={personal.displayName} onClick={() => onPick({ pathname: '/personal' })} /> : null}
      {ordered.map(row => <Destination key={row.key} label={row.name || (zh ? '未命名对话' : 'Untitled conversation')}
        detail={row === from ? (zh ? '资料来源对话' : 'Source conversation') : agents.data?.items.find(agent => agent.id === row.agentId)?.name ?? row.agentId}
        onClick={() => onPick({ pathname: `/chat/${encodeURIComponent(row.key)}` })} />)}
      {recent.data && !ordered.length && !showPersonal ? <p className="px-3 py-5 text-center text-sm text-fg-muted">
        {search ? (zh ? '没有匹配的对话' : 'No matching conversations') : (zh ? '暂无近期对话，可以新建对话' : 'No recent conversations. Start a new one.')}
      </p> : null}
    </>;
  }
  const active = mode === 'recent' ? recent : agents;

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[60] bg-scrim" />
      <Dialog.Content onOpenAutoFocus={event => { if (searchInput.current) { event.preventDefault(); searchInput.current.focus(); } }}
        onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}
        className="fixed start-1/2 top-1/2 z-[61] flex h-[min(32rem,calc(100dvh-2rem))] w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-panel text-fg shadow-float">
        <header className="flex shrink-0 items-start gap-3 border-b border-edge-subtle p-4">
          <div className="min-w-0 flex-1">
            <Dialog.Title className="font-semibold">{zh ? '将选区加入对话' : 'Add selection to a conversation'}</Dialog.Title>
            <Dialog.Description className="mt-1 truncate text-sm text-fg-muted" title={label}>{label}</Dialog.Description>
          </div>
          <Dialog.Close className="grid size-9 place-items-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
            aria-label={zh ? '关闭' : 'Close'}><X className="size-4" aria-hidden /></Dialog.Close>
        </header>
        <div className="flex shrink-0 gap-1 px-4 pt-3">
          {([['recent', MessageSquare, zh ? '已有对话' : 'Existing'], ['new', Plus, zh ? '新建对话' : 'New conversation']] as const).map(([id, Icon, text]) =>
            <button type="button" key={id} aria-pressed={mode === id} onClick={() => setMode(id)}
              className={cn('inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent',
                mode === id ? 'bg-surface-active font-medium' : 'text-fg-muted hover:bg-surface-hover')}>
              <Icon className="size-4" aria-hidden />{text}
            </button>)}
        </div>
        {mode === 'recent' ? <label className="mx-4 mt-3 flex h-10 shrink-0 items-center gap-2 rounded-lg border border-edge bg-surface-inset px-3 focus-within:ring-2 focus-within:ring-accent">
          <Search className="size-4 text-fg-muted" aria-hidden />
          <input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} maxLength={160} className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            aria-label={zh ? '搜索对话' : 'Search conversations'} placeholder={zh ? '搜索对话' : 'Search conversations'} />
        </label> : null}
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-3">
          {active.isLoading ? <><Skeleton className="h-12 rounded-lg" /><Skeleton className="h-12 rounded-lg" /></> : content}
          {active.error ? <button type="button" className={rowClass} onClick={() => void active.mutate()}>{zh ? '加载失败，点击重试' : 'Could not load. Try again.'}</button> : null}
        </div>
        <footer className="shrink-0 border-t border-edge-subtle px-4 py-3 text-xs text-fg-muted">{zh ? '选区将加入草稿，你可以检查后再发送。' : 'The selection goes into your draft for review before sending.'}</footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
