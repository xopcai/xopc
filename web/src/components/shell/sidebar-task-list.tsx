import { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import useSWR from 'swr';

import { isWebUiSessionKey } from '@/features/chat/session-manager';
import { listSessions } from '@/features/sessions/session-api';
import type { SessionMetadata } from '@/features/sessions/session.types';
import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { cn } from '@/lib/cn';

function sessionTitle(s: SessionMetadata): string {
  return s.name?.trim() || s.key;
}

function taskLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex w-full min-w-0 items-center rounded-xl px-4 py-2 text-left text-sm font-medium leading-6 transition-colors duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
    isActive
      ? 'bg-surface-active text-fg'
      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
  );
}

export function SidebarTaskList({ onNavigate }: { onNavigate?: () => void }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const token = useGatewayStore((s) => s.token);
  const openTokenDialog = useGatewayStore((s) => s.openTokenDialog);
  const { pathname } = useLocation();

  const { data, mutate } = useSWR(
    token ? ['sidebar-tasks', token] : null,
    async () => {
      const result = await listSessions({ limit: 20, offset: 0 });
      return result.items.filter((s) => isWebUiSessionKey(s.key));
    },
    { revalidateOnFocus: true },
  );

  useEffect(() => {
    if (!token) return;
    const url = new URL('/api/events', window.location.origin);
    url.searchParams.set('token', token);
    let es: EventSource;
    try {
      es = new EventSource(url.toString());
    } catch {
      return;
    }
    const onSessionUpdated = () => {
      void mutate();
    };
    es.addEventListener('session.updated', onSessionUpdated);
    es.addEventListener('session.created', onSessionUpdated);
    return () => {
      es.close();
    };
  }, [token, mutate]);

  if (!token) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="px-4 text-xs font-normal leading-5 text-fg-subtle">{m.sidebar.tasksHeading}</div>
        <div className="rounded-xl border border-edge bg-surface-panel px-3 py-3 dark:border-edge">
          <p className="text-xs leading-relaxed text-fg-muted">{m.sidebar.taskListNeedToken}</p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3 h-8 w-full text-xs font-medium"
            onClick={() => {
              openTokenDialog();
              onNavigate?.();
            }}
          >
            {m.sidebar.taskListAddToken}
          </Button>
        </div>
      </div>
    );
  }

  const items = data ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-4 text-xs font-normal leading-5 text-fg-subtle">{m.sidebar.tasksHeading}</div>
      <div className="flex flex-col gap-0.5">
        {items.length === 0 ? (
          <div className="px-4 py-2">
            <p className="text-xs leading-relaxed text-fg-subtle">{m.sidebar.taskListEmpty}</p>
            <Link
              to="/chat/new"
              className="mt-2 inline-flex text-xs font-medium text-accent-fg hover:underline"
              onClick={() => onNavigate?.()}
            >
              {m.sidebar.taskListStartChat}
            </Link>
          </div>
        ) : (
          items.map((session) => (
            <NavLink
              key={session.key}
              to={`/chat/${encodeURIComponent(session.key)}`}
              className={taskLinkClass}
              title={sessionTitle(session)}
              onClick={() => onNavigate?.()}
            >
              <span className="min-w-0 truncate">{sessionTitle(session)}</span>
            </NavLink>
          ))
        )}
        <Link
          to="/sessions"
          className={cn(
            'px-4 pt-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-accent-fg',
            pathname === '/sessions' && 'text-accent-fg',
          )}
          onClick={() => onNavigate?.()}
        >
          {m.sidebar.viewAllSessions}
        </Link>
      </div>
    </div>
  );
}
