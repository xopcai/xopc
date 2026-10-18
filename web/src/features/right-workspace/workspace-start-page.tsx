import { ArrowUpRight, FileText, FolderOpen, Globe, MessageSquarePlus, Terminal } from 'lucide-react';

import { useLocaleStore } from '@/stores/locale-store';
import type { WorkspaceTab } from '@/stores/right-workspace-store';

export function WorkspaceStartPage({ tabs, canCreateSideChat, creating, onFiles, onSideChat, onActivate, onTerminal, onBrowser }: {
  tabs: WorkspaceTab[];
  canCreateSideChat: boolean;
  creating: boolean;
  onFiles: () => void;
  onSideChat: () => void;
  onActivate: (id: string) => void;
  onTerminal?: () => void;
  onBrowser?: () => void;
}) {
  const zh = useLocaleStore((s) => s.language) === 'zh';
  const recent = tabs.filter((t) => t.kind === 'file' || t.kind === 'sidechat').sort((a, b) => b.visitedAt - a.visitedAt).slice(0, 4);
  const card = 'group flex min-h-16 min-w-0 items-center gap-3 rounded-xl border border-transparent bg-surface-panel px-4 py-3 text-left text-fg transition-colors hover:border-edge hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-45';
  return <div className="min-h-0 flex-1 overflow-y-auto bg-surface-base/70 px-6 py-10 sm:px-8" data-workspace-start>
    <div className="mx-auto max-w-3xl">
      <h2 className="mb-5 text-sm font-medium text-fg">{zh ? '工具' : 'Tools'}</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
        <button className={card} onClick={onFiles}><FolderOpen className="size-5 shrink-0 text-fg-muted" aria-hidden /><span className="flex-1 text-base">{zh ? '文件' : 'Files'}</span><ArrowUpRight className="size-4 text-fg-subtle opacity-0 group-hover:opacity-100" aria-hidden /></button>
        <button className={card} disabled={!canCreateSideChat || creating} onClick={onSideChat}><MessageSquarePlus className="size-5 shrink-0 text-fg-muted" aria-hidden /><span className="flex-1 text-base">{zh ? '侧聊' : 'Side chat'}</span>{creating ? <span className="h-3 w-10 animate-pulse rounded bg-surface-active" /> : <ArrowUpRight className="size-4 text-fg-subtle opacity-0 group-hover:opacity-100" aria-hidden />}</button>
        {onBrowser ? <button className={card} onClick={onBrowser}><Globe className="size-5 shrink-0 text-fg-muted" aria-hidden /><span className="flex-1 text-base">{zh ? '浏览器' : 'Browser'}</span><ArrowUpRight className="size-4 text-fg-subtle" aria-hidden /></button> : null}
        {onTerminal ? <button className={card} onClick={onTerminal} title={zh ? '打开主聊天的终端面板' : 'Open the main chat terminal panel'}><Terminal className="size-5 shrink-0 text-fg-muted" aria-hidden /><span className="flex-1 text-base">{zh ? '终端' : 'Terminal'}</span><ArrowUpRight className="size-4 text-fg-subtle" aria-hidden /></button> : null}
      </div>
      {!canCreateSideChat ? <p className="mt-4 text-xs text-fg-muted">{zh ? '开始主聊天后，可以在这里新建临时侧聊。' : 'Start a main conversation to create a temporary side chat here.'}</p> : null}
      {recent.length ? <section className="mt-12">
        <h2 className="mb-5 text-sm font-medium text-fg">{zh ? '继续查看' : 'Continue with'}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {recent.map((tab) => <button key={tab.id} onClick={() => onActivate(tab.id)} title={tab.kind === 'file' ? tab.path || tab.title : tab.title} className="flex min-w-0 flex-col items-center gap-3 rounded-xl px-2 py-4 text-sm text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <span className="flex size-11 items-center justify-center rounded-xl border border-edge-subtle bg-surface-panel">{tab.kind === 'file' ? <FileText className="size-5 text-fg-muted" aria-hidden /> : <MessageSquarePlus className="size-5 text-fg-muted" aria-hidden />}</span>
            <span className="w-full truncate text-center">{tab.title === 'Side chat' ? (zh ? '侧聊' : 'Side chat') : tab.title}</span>
          </button>)}
        </div>
      </section> : null}
    </div>
  </div>;
}
