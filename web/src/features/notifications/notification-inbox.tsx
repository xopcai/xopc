import * as Popover from '@radix-ui/react-popover';
import { AlertCircle, Bell, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useActivityStore } from '@/stores/activity-store';
import { useLocaleStore } from '@/stores/locale-store';

export function NotificationInbox() {
  const [open, setOpen] = useState(false);
  const zh = useLocaleStore(state => state.language) === 'zh';
  const items = useActivityStore(state => state.items);
  const markRead = useActivityStore(state => state.markRead);
  const markAllRead = useActivityStore(state => state.markAllRead);
  const unread = items.filter(item => !item.read).length;
  const title = zh ? '通知' : 'Notifications';
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><button type="button" aria-label={`${title}${unread ? ` (${unread})` : ''}`} title={title} className="relative flex size-10 shrink-0 items-center justify-center rounded-xl text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent">
      <Bell className="size-[18px]" aria-hidden />{unread ? <span className="absolute right-2 top-2 size-1.5 rounded-full bg-accent" /> : null}
    </button></Popover.Trigger>
    <Popover.Portal><Popover.Content aria-label={title} side="top" align="end" sideOffset={8} collisionPadding={12} className="z-[95] flex max-h-[min(32rem,calc(100dvh-2rem))] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-popover">
      <header className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3"><h2 className="text-sm font-medium">{title}</h2>{unread ? <button type="button" onClick={markAllRead} className="text-xs text-fg-muted hover:text-fg">{zh ? '全部已读' : 'Mark all read'}</button> : null}</header>
      {items.length ? <ul className="min-h-0 overflow-y-auto overscroll-contain p-1">{items.map(item => {
        const Icon = item.tone === 'error' || item.tone === 'warning' ? AlertCircle : CheckCircle2;
        const content = <><Icon className={`mt-0.5 size-4 shrink-0 ${item.tone === 'error' ? 'text-danger' : 'text-fg-muted'}`} aria-hidden /><span className="min-w-0 flex-1"><span className={`block text-sm ${item.read ? 'text-fg-muted' : 'font-medium text-fg'}`}>{item.title}</span>{item.message ? <span className="mt-1 line-clamp-2 block text-xs leading-5 text-fg-muted">{item.message}</span> : null}<time dateTime={new Date(item.createdAt).toISOString()} className="mt-1 block text-xs text-fg-subtle">{new Date(item.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span>{!item.read ? <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" /> : null}</>;
        const className = 'flex w-full gap-3 rounded-lg px-3 py-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent';
        return <li key={item.id}>{item.href?.startsWith('/') && !item.href.startsWith('//') ? <Link className={className} to={item.href} onClick={() => { markRead(item.id); setOpen(false); }}>{content}</Link> : <div className={className}>{content}</div>}</li>;
      })}</ul> : <p className="px-4 py-8 text-center text-sm text-fg-muted">{zh ? '暂无通知' : 'No notifications yet'}</p>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
