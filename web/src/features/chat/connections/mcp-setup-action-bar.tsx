import { Link, useSearchParams } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import useSWR from 'swr';

import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

const SetupDialog = lazy(() => import('@/features/connectors/mcp/mcp-conversation-setup-page').then(module => ({ default: module.McpConversationSetupDialog })));

type PendingSetup = { setupId: string; serverId: string; displayName?: string; phase: string; expired?: boolean };

/** The host supplies the pending goal; model-authored URLs are never the only entry point. */
export function McpSetupActionBar({ conversationId }: { conversationId: string }) {
  const language = useLocaleStore(state => state.language);
  const [searchParams, setSearchParams] = useSearchParams();
  const openSetupId = searchParams.get('mcpSetup');
  const setOpenSetupId = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('mcpSetup', id); else next.delete('mcpSetup');
    setSearchParams(next, { replace: !id });
  };
  const { data, mutate } = useSWR(`/api/mcp/setup/conversations/${encodeURIComponent(conversationId)}`, async path => {
    try { return { permitted: true, ...(await fetchJson<{ payload: { setup: PendingSetup | null } }>(apiUrl(path))).payload }; }
    catch (error) { if ([403, 404].includes((error as { status?: number }).status ?? 0)) return { permitted: false, setup: null }; throw error; }
  }, { refreshInterval: value => value?.setup ? 5000 : 0, shouldRetryOnError: false });
  useEffect(() => {
    if (data?.permitted === false) return;
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string; key?: string }>).detail;
      if ((detail?.conversationId ?? detail?.key) === conversationId) void mutate();
    };
    const reconnect = () => { void mutate(); };
    window.addEventListener('session-mcp-setup-changed', refresh);
    window.addEventListener('session-transcript-updated', refresh);
    window.addEventListener('gateway-realtime-connected', reconnect);
    return () => {
      window.removeEventListener('session-mcp-setup-changed', refresh);
      window.removeEventListener('session-transcript-updated', refresh);
      window.removeEventListener('gateway-realtime-connected', reconnect);
    };
  }, [conversationId, mutate, data?.permitted]);
  const dialog = openSetupId ? <Suspense fallback={null}><SetupDialog setupId={openSetupId} onClose={() => { setOpenSetupId(null); void mutate(); }} /></Suspense> : null;
  if (!data?.setup) return dialog;
  const setup = data.setup;
  return <><section className="mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-surface-panel px-3 py-2" aria-label={language === 'zh' ? '服务连接' : 'Service connection'}>
    <span className="min-w-0 flex-1 break-all text-sm text-fg" role="status">{setup.expired ? (language === 'zh' ? '连接请求已过期' : 'Connection request expired') : (language === 'zh' ? '连接' : 'Connect')} {setup.displayName || setup.serverId}</span>
    <Link className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-accent-fg hover:bg-surface-hover" to={`/mcp-setup/${encodeURIComponent(setup.setupId)}`} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); setOpenSetupId(setup.setupId);
      }}>
      {language === 'zh' ? '完成连接' : 'Complete connection'}
    </Link>
  </section>{dialog}</>;
}
