import { FolderKanban, Home, MessageSquare, NotebookText } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

export function MobilePrimaryNav() {
  const zh = useLocaleStore((state) => state.language) === 'zh';
  return <nav aria-label={zh ? '主要导航' : 'Primary navigation'} className="flex shrink-0 border-t border-edge bg-surface-panel pb-[env(safe-area-inset-bottom)] md:hidden">
    {[
      { to: '/', label: zh ? '首页' : 'Home', Icon: Home, end: true },
      { to: '/chat', label: zh ? '对话' : 'Chat', Icon: MessageSquare },
      { to: '/projects', label: zh ? '项目' : 'Projects', Icon: FolderKanban },
      { to: '/notes', label: zh ? '笔记' : 'Notes', Icon: NotebookText },
    ].map(({ to, label, Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn('flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-xs', isActive ? 'text-accent' : 'text-fg-muted')}><Icon className="size-4" aria-hidden />{label}</NavLink>)}
  </nav>;
}
