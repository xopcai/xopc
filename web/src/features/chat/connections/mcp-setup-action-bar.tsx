import { Link, useSearchParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import useSWR from 'swr';
import { Check, Link2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

const SetupDialog = lazy(() => import('@/features/connectors/mcp/mcp-conversation-setup-page').then(module => ({ default: module.McpConversationSetupDialog })));

type PendingSetup = { setupId: string; version: number; serverId: string; displayName?: string; phase: string;
  purpose?: string; canProvideToken?: boolean; approveWithToken?: boolean; expired?: boolean; errorCode?: string; helpUrl?: string; reloadRequired?: boolean };
const copy = {
  zh: { connection: '服务连接', cancel: '取消连接请求', close: '关闭', finish: '检查连接', source: '查看来源', enter: '填写访问密钥', login: '登录并继续', waiting: '等待完成登录', review: '查看连接', reconnect: '更新密钥',
    configureToken: '配置 MCP Token', tokenPrepared: '连接已准备好，填写 Token 即可连接',
    expired: '连接请求已过期', rejected: '服务未接受当前密钥', token: '需要访问密钥', oauth: '需要登录授权', unknown: '无法确认认证方式',
    failed: '连接检查未通过', planned: '正在检查连接', approval: '请确认服务和资料来源', reload: '配置已保存，重启 Gateway 后生效',
    help: '获取访问密钥', connected: '连接已完成', continuing: '连接已完成，原任务将自动继续', cancelFailed: '暂时无法取消连接，请重试。' },
  en: { connection: 'Service connection', cancel: 'Cancel connection request', close: 'Close', finish: 'Check connection', source: 'Review source', enter: 'Enter access key', login: 'Sign in and continue', waiting: 'Waiting for sign-in', review: 'View connection', reconnect: 'Update key',
    configureToken: 'Set up MCP Token', tokenPrepared: 'Connection prepared. Add your Token to connect.',
    expired: 'Connection request expired', rejected: 'The service rejected the current key', token: 'Access key required', oauth: 'Sign-in required', unknown: 'Could not verify the authentication method',
    failed: 'Connection check failed', planned: 'Checking the connection', approval: 'Review the service and its sources', reload: 'Settings saved. Restart the Gateway to apply them.',
    help: 'Get an access key', connected: 'Connection complete', continuing: 'Connection complete. Your task will resume automatically.', cancelFailed: 'Could not cancel the connection. Try again.' },
};

/** The host supplies the pending goal; model-authored URLs are never the only entry point. */
export function McpSetupActionBar({ conversationId }: { conversationId: string }) {
  const language = useLocaleStore(state => state.language);
  const [searchParams, setSearchParams] = useSearchParams();
  const [cancelling, setCancelling] = useState(false);
  const [cancelErrorFor, setCancelErrorFor] = useState<string>();
  const [completed, setCompleted] = useState<{ conversationId: string; label: string; continuing: boolean }>();
  const t = copy[language];
  useEffect(() => {
    if (!completed) return;
    const timer = window.setTimeout(() => setCompleted(undefined), 8000);
    return () => window.clearTimeout(timer);
  }, [completed]);
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
  const dialog = openSetupId ? <Suspense fallback={null}><SetupDialog setupId={openSetupId} onClose={result => {
    if (result?.phase === 'ready' && !result.reloadRequired && result.conversationId === conversationId) {
      setCompleted({ conversationId, label: result.displayName || result.serverId,
        continuing: result.continuationQueued === true && result.objective !== 'connect_only' });
    }
    setOpenSetupId(null);
    void mutate();
  }} /></Suspense> : null;
  if (!data?.setup) return <>
    {completed?.conversationId === conversationId ? <section className="mb-2 flex items-center gap-3 rounded-xl border border-edge bg-success-soft px-3 py-2 text-sm text-fg">
      <Check className="size-4 shrink-0" aria-hidden />
      <p role="status" className="min-w-0 flex-1 break-words">{completed.label} · {completed.continuing ? t.continuing : t.connected}</p>
      <Button variant="ghost" className="size-11 shrink-0 p-0" aria-label={t.close} onClick={() => setCompleted(undefined)}><X className="size-4" aria-hidden /></Button>
    </section> : null}
    {dialog}
  </>;
  const setup = data.setup;
  const cancel = async () => {
    setCancelling(true);
    setCancelErrorFor(undefined);
    try {
      await fetchJson(apiUrl(`/api/mcp/setup/${encodeURIComponent(setup.setupId)}`), {
        method: 'POST', body: JSON.stringify({ action: 'cancel', expectedVersion: setup.version }),
      });
      if (openSetupId === setup.setupId) setOpenSetupId(null);
      await mutate(current => current?.setup?.setupId === setup.setupId ? { ...current, setup: null } : current);
    } catch {
      setCancelErrorFor(setup.setupId);
      void mutate();
    } finally {
      setCancelling(false);
    }
  };
  const rejected = setup.errorCode === 'credential_rejected';
  const status = setup.expired ? t.expired : setup.reloadRequired ? t.reload : rejected ? t.rejected
    : setup.approveWithToken ? t.tokenPrepared : setup.phase === 'token_required' ? t.token : ['oauth_required', 'authorizing'].includes(setup.phase) ? t.oauth
      : setup.phase === 'auth_unknown' ? t.unknown : setup.phase === 'blocked' ? t.failed
        : setup.phase === 'approval_required' ? t.approval : setup.phase === 'ready' ? t.connected : t.planned;
  const action = setup.expired || setup.reloadRequired ? t.review
    : rejected ? t.reconnect
      : setup.approveWithToken ? t.configureToken : setup.phase === 'approval_required' ? t.source
        : setup.phase === 'token_required' || setup.canProvideToken ? t.enter
          : setup.phase === 'oauth_required' ? t.login
            : setup.phase === 'authorizing' ? t.waiting
              : ['blocked', 'auth_unknown', 'ready'].includes(setup.phase) ? t.review : t.finish;
  return <><section className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-surface-panel px-3 py-2" aria-label={t.connection}>
    <Link2 className="size-4 shrink-0 text-accent" aria-hidden />
    <div className="min-w-0 flex-1 break-words text-sm" role="status">
      <p className="font-medium text-fg">{setup.displayName || setup.serverId}</p>
      {setup.purpose && !setup.approveWithToken ? <p className="mt-0.5 break-words text-sm text-fg-muted">{setup.purpose}</p> : null}
      <p className="mt-0.5 text-xs text-fg-muted">{status}</p>
    </div>
    <Button asChild variant="primary" className="min-h-11 shrink-0 rounded-lg"><Link to={`/mcp-setup/${encodeURIComponent(setup.setupId)}`} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); setOpenSetupId(setup.setupId);
      }}>
      {action}
    </Link></Button>
    <Button variant="ghost" className="size-11 shrink-0 p-0" aria-label={t.cancel} title={t.cancel} disabled={cancelling} onClick={() => void cancel()}>
      <X className="size-4" aria-hidden />
    </Button>
    {!setup.expired && setup.phase === 'token_required' && setup.helpUrl ?
      <div className="basis-full pl-6"><a href={setup.helpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-accent-fg hover:underline">{t.help} ↗</a></div> : null}
    {cancelErrorFor === setup.setupId ? <span role="alert" className="basis-full text-sm text-fg-muted">{t.cancelFailed}</span> : null}
  </section>{dialog}</>;
}
