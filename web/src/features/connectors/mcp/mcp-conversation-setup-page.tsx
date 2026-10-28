import * as Dialog from '@radix-ui/react-dialog';
import { Check, KeyRound, Link2, Loader2, LockKeyhole, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { SecretInput } from '@/components/ui/secret-input';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

type Setup = { setupId: string; serverId: string; conversationId: string; version: number;
  displayName?: string; returnChannel?: string; approval?: { accountId: string; peerId: string; endpoint: string; purpose: string };
  endpointOrigin: string;
  canReplaceToken?: boolean; canProvideToken?: boolean;
  secretFields?: Array<{ id: string; label: string }>; helpUrl?: string; nextRetryAt?: number;
  diagnosis?: { recovery?: { reason?: string } };
  planApproval?: { sources: Array<{ url: string }>; execution?: { command: string; args: string[]; cwd?: string; sourceUrl: string }; endpoint?: string; purpose: string };
  phase: string; expired: boolean; requiresRecheck?: boolean; authorizationUrl?: string; authState?: string;
  errorCode?: string; replyDelivery?: string; reloadRequired?: boolean };
const copy = {
  zh: { title: '连接服务', secret: '访问密钥', hint: '仅保存到凭据服务，不进入聊天或模型。',
    invalidToken: '密钥未被接受，请核对后重新输入。',
    submit: '保存并连接', login: '继续登录', waiting: '在服务页面完成授权，这里会自动继续。',
    check: '重新检查', checking: '正在验证连接', cancel: '取消连接', back: '返回对话', close: '暂时关闭', later: '稍后继续', done: '完成',
    failed: '暂时无法连接，请检查服务地址或权限后重试。', expired: '请求已过期，请回到对话重新发起。',
    cancelled: '此连接请求已取消。', reload: '配置已保存。重启 Gateway 后，连接才能生效。',
    details: '连接详情', approve: '允许这次连接', approval: '确认连接到这个服务', shared: '连接将供此网关的助手使用，不会授予微信用户管理权限。',
    identity: '来自微信私聊', endpoint: '服务地址', purpose: '要完成的事',
    tokenDescription: '输入服务提供的访问密钥，即可继续原来的任务。',
    accessDeniedToken: '服务拒绝了当前访问。若此服务需要 Token，请在这里输入；账号或服务权限也可能需要检查。',
    connected: '已连接', continuing: '正在原微信对话中继续处理，无需发送“继续”。', delivered: '结果已发送到原微信对话。',
    returnWeixin: '现在可以关闭此页，返回微信。', closed: '返回微信即可继续对话', reopen: '继续配置',
    deliveryFailed: '连接已完成，结果暂未发送到微信。重发不会重新执行任务。', retryDelivery: '重试发送结果',
    secure: '安全连接', loading: '正在准备连接', checkingDescription: '正在检查服务和所需权限。' },
  en: { title: 'Connect service', secret: 'Access key', hint: 'Saved to credential storage, never chat or the model.',
    invalidToken: 'This key was rejected. Check it and try again.',
    submit: 'Save and connect', login: 'Continue sign-in', waiting: 'Finish authorizing on the service page. This will continue automatically.',
    check: 'Check again', checking: 'Verifying connection', cancel: 'Cancel connection', back: 'Return to chat', close: 'Close for now', later: 'Continue later', done: 'Done',
    failed: 'Unable to connect. Check the service address or permissions and try again.', expired: 'This request expired. Return to chat to start again.',
    cancelled: 'This connection request was cancelled.', reload: 'Configuration is saved. Restart the Gateway to activate the connection.',
    details: 'Connection details', approve: 'Approve this connection', approval: 'Confirm this service connection', shared: 'The connection is shared with this Gateway’s assistants. It grants no administration rights to Weixin users.',
    identity: 'From a Weixin chat', endpoint: 'Service address', purpose: 'Your request',
    tokenDescription: 'Enter the access key from your service to continue your task.',
    accessDeniedToken: 'The service refused access. If it requires a Token, enter it here. Account or service permissions may also need attention.',
    connected: 'Connected', continuing: 'Continuing in the original Weixin chat. No follow-up message needed.', delivered: 'The result was sent to your original Weixin chat.',
    returnWeixin: 'You can close this page and return to Weixin.', closed: 'Return to Weixin to continue chatting', reopen: 'Continue setup',
    deliveryFailed: 'Connected, but the result could not be sent to Weixin. Resending will not run the task again.', retryDelivery: 'Retry result delivery',
    secure: 'Secure connection', loading: 'Preparing connection', checkingDescription: 'Checking the service and required permissions.' },
};

/** Both chat entry and authenticated deep links share the same credential-only dialog. */
export function McpConversationSetupDialog({ setupId, onClose }: { setupId: string; onClose: (setup?: Setup) => void }) {
  const language = useLocaleStore(state => state.language);
  const t = copy[language];
  const path = `/api/mcp/setup/${encodeURIComponent(setupId)}`;
  const { data, error, mutate } = useSWR(path, async url => (await fetchJson<{ payload: Setup }>(apiUrl(url))).payload,
    { refreshInterval: value => value && (value.returnChannel === 'weixin' && value.phase === 'ready' && !['delivered', 'failed'].includes(value.replyDelivery ?? '') || !['ready', 'cancelled'].includes(value.phase)) ? 1000 : 0 });
  const [token, setToken] = useState('');
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const automatic = useRef('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const act = async (action: string, value?: string | Record<string, string>) => {
    if (!data || busy) return;
    setBusy(true); setActionError(false);
    try {
      await fetchJson(apiUrl(path), { method: 'POST', body: JSON.stringify({ action, expectedVersion: data.version, ...(value ? { value } : {}) }) });
      await mutate();
    } catch { setActionError(true); await mutate(); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!data || busy || data.expired || data.phase === 'cancelled') return;
    if (data.phase === 'ready' && !data.reloadRequired && data.returnChannel !== 'weixin') { onClose(data); return; }
    if (actionError) return;
    const action = data.requiresRecheck || data.phase === 'planned' || ['connected', 'error', 'cancelled'].includes(data.authState ?? '') ? 'advance'
      : data.phase === 'oauth_required' ? 'authorize' : undefined;
    const key = `${setupId}:${data.version}:${action}`;
    if (action && automatic.current !== key) { automatic.current = key; void act(action); }
    // Automatic transitions stay version-bound; the host verifies identity and cancellation.
  }, [data, busy, actionError, onClose, setupId]);

  const terminal = Boolean(data?.expired || data?.phase === 'cancelled');
  const fields = data?.secretFields?.length ? data.secretFields : [{ id: 'token', label: t.secret }];
  const hasSecret = Boolean(token || Object.values(secrets).some(Boolean));
  const waitingRetry = Boolean(data?.nextRetryAt && data.nextRetryAt > Date.now());
  const fieldsReady = fields.every(field => (field.id === 'token' ? token : secrets[field.id] ?? '').trim());
  const connected = data?.phase === 'ready' && !data.reloadRequired && !terminal;
  const approval = data?.phase === 'approval_required' && !terminal ? data.approval : undefined;
  const planApproval = data?.phase === 'approval_required' && !terminal ? data.planApproval : undefined;
  const needsApproval = Boolean(approval || planApproval);
  const tokenRequired = data && (data.phase === 'token_required' || data.phase === 'auth_unknown' && data.canProvideToken || data.phase === 'blocked' && (data.canReplaceToken || data.canProvideToken)) && !data.requiresRecheck && !terminal && !data.reloadRequired;
  const authorizing = data?.phase === 'authorizing' && !terminal && !data.reloadRequired;
  const deliveryFailed = connected && data?.returnChannel === 'weixin' && data.replyDelivery === 'failed';
  const blocked = (data?.phase === 'blocked' || data?.phase === 'auth_unknown') && !tokenRequired && !terminal;
  const description = data?.expired ? t.expired : data?.phase === 'cancelled' ? t.cancelled : data?.reloadRequired ? t.reload
    : connected ? deliveryFailed ? t.deliveryFailed : data?.replyDelivery === 'delivered' ? t.delivered : t.continuing
      : needsApproval ? t.approval : waitingRetry ? (language === 'zh' ? `服务要求等待，将在 ${new Date(data!.nextRetryAt!).toLocaleTimeString()} 后有限重试。` : `Waiting until ${new Date(data!.nextRetryAt!).toLocaleTimeString()} before a bounded retry.`)
      : data?.phase === 'auth_unknown' ? (language === 'zh' ? '认证方式尚未确定。若服务提供 Token，可在此输入；如需 OAuth，请核实接入资料后重新检查。' : 'Authentication is not yet determined. Enter a Token only if your service provides one; for OAuth, verify the integration guide and recheck.')
      : tokenRequired ? data.canProvideToken ? t.accessDeniedToken : t.tokenDescription : authorizing ? t.waiting : error || blocked || actionError ? t.failed : t.checkingDescription;
  const dismiss = () => { if (!busy) { setToken(''); setSecrets({}); onClose(data); } };
  const primaryClass = 'min-h-12 w-full rounded-xl text-[15px]';
  const Icon = connected ? Check : tokenRequired ? KeyRound : LockKeyhole;
  return <Dialog.Root open onOpenChange={open => { if (!open) dismiss(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[70] bg-scrim backdrop-blur-sm" />
    <Dialog.Content
      onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}
      onPointerDownOutside={event => { if (busy || hasSecret) event.preventDefault(); }}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
      className="fixed inset-x-0 bottom-0 z-[70] flex h-[min(36rem,calc(100dvh-1rem))] flex-col overflow-hidden rounded-t-3xl border border-edge bg-surface-overlay text-fg shadow-elevated sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:h-[min(36rem,calc(100dvh-3rem))] sm:w-[28rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl">
      <header className="relative shrink-0 px-6 pb-5 pt-8 text-center sm:px-8">
        <Button variant="ghost" className="absolute right-2 top-2 size-11 rounded-full p-0" aria-label={t.close} disabled={busy} onClick={dismiss}><X className="size-4" aria-hidden /></Button>
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-surface-hover"><Icon className="size-6 text-accent-fg" strokeWidth={1.6} aria-hidden /></div>
        <Dialog.Title ref={titleRef} tabIndex={-1} className="break-words text-xl font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {connected ? t.connected : data?.displayName || t.title}
        </Dialog.Title>
        {data ? <p className="mt-1 truncate text-[13px] text-fg-muted" title={data.endpointOrigin}>{data.endpointOrigin}</p> : null}
        <Dialog.Description role={!tokenRequired && (error || actionError || blocked || data?.expired || data?.reloadRequired) ? 'alert' : undefined} className="mt-3 text-sm leading-relaxed text-fg-muted">{description}</Dialog.Description>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-4 sm:px-8" aria-busy={busy}>
        {!data && !error ? <div role="status" aria-label={t.loading} className="space-y-3"><Skeleton className="h-12 w-full rounded-xl" /><Skeleton className="h-4 w-3/4" /></div> : null}
        {approval ? <section className="space-y-3">
          <dl className="space-y-3 rounded-2xl bg-surface-base p-4 text-sm">
            <div><dt className="mb-1 text-xs text-fg-muted">{t.identity}</dt><dd className="break-all">{approval.accountId} / {approval.peerId}</dd></div>
            <div><dt className="mb-1 text-xs text-fg-muted">{t.endpoint}</dt><dd className="break-all">{approval.endpoint}</dd></div>
            <div><dt className="mb-1 text-xs text-fg-muted">{t.purpose}</dt><dd className="break-words leading-relaxed">{approval.purpose}</dd></div>
          </dl>
          <p className="text-xs leading-relaxed text-fg-muted">{t.shared}</p>
          {planApproval ? <div className="space-y-2 rounded-xl bg-surface-base p-3 text-xs"><p>{language === 'zh' ? '同时审阅本次来源与执行计划：' : 'Also review this source and execution plan:'}</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(planApproval, null, 2)}</pre></div> : null}
        </section> : planApproval ? <section className="space-y-3 text-sm">
          <p className="break-all">{planApproval.endpoint}</p><p>{planApproval.purpose}</p>
          {planApproval.execution ? <><p>{language === 'zh' ? '将在 Gateway 主机运行以下程序，可能下载指定依赖，并按该主机的进程权限访问文件和网络。' : 'This program runs on the Gateway host, may download the specified dependency and can access files and network with that process’s permissions.'}</p><pre className="whitespace-pre-wrap break-all rounded-xl bg-surface-base p-3 text-xs">{JSON.stringify(planApproval.execution, null, 2)}</pre></> : <p>{language === 'zh' ? '来源归属尚未独立核实。请确认服务和以下资料来源后连接。' : 'Publisher ownership has not been independently verified. Review the service and sources before connecting.'}</p>}
          {planApproval.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="block break-all text-accent-fg">{source.url}</a>)}
        </section> : tokenRequired ? <form id="mcp-setup-secret-form" className="space-y-3" onSubmit={event => { event.preventDefault(); const value = data.secretFields?.length ? Object.fromEntries(fields.map(field => [field.id, field.id === 'token' ? token : secrets[field.id] ?? ''])) : token; setToken(''); setSecrets({}); void act('token', value); }}>
          {fields.map(field => <div key={field.id} className="space-y-2"><label htmlFor={`mcp-setup-${field.id}`} className="block text-sm font-medium">{field.label}</label>
            <SecretInput id={`mcp-setup-${field.id}`} value={field.id === 'token' ? token : secrets[field.id] ?? ''} onChange={value => { if (field.id === 'token') setToken(value); else setSecrets(previous => ({ ...previous, [field.id]: value })); setActionError(false); }} disabled={busy || waitingRetry} autoComplete="off" hideCopy className="[&_button]:size-11 [&_button]:p-3"
            ariaDescribedBy="mcp-secret-hint" ariaInvalid={data.errorCode === 'credential_rejected' || actionError}
            inputClassName="min-h-12 rounded-xl pr-14 text-base" labels={messages(language).connectorsSettings.secretInputLabels} /></div>)}
          {data.helpUrl ? <a href={data.helpUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-accent-fg">{language === 'zh' ? '获取访问密钥' : 'Get an access key'}</a> : null}
          <p id="mcp-secret-hint" className="flex items-start gap-1.5 text-xs leading-relaxed text-fg-muted"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t.hint}</p>
          {data.errorCode === 'credential_rejected' || actionError || data.phase === 'blocked' && !data.canProvideToken ? <p role="alert" className="text-sm text-danger">{data.errorCode === 'credential_rejected' ? t.invalidToken : t.failed}</p> : null}
        </form> : connected && data?.returnChannel === 'weixin' ? <p role="status" className="py-5 text-center text-sm text-fg-muted">{t.returnWeixin}</p>
          : error || actionError || blocked || data?.expired || data?.reloadRequired ? null
            : !terminal && !authorizing ? <div role="status" aria-label={t.checking} className="space-y-3"><Skeleton className="h-12 w-full rounded-xl" /><Skeleton className="h-4 w-2/3" /></div> : null}
        {data && !terminal && !connected ? <details className="mt-5 text-sm text-fg-muted">
          <summary className="min-h-11 cursor-pointer py-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{t.details}</summary>
          <div className="space-y-2 pb-2">
            {!approval ? <p className="break-all text-xs">{data.endpointOrigin}</p> : null}
            {data.phase !== 'approval_required' ? <Button variant="ghost" className="min-h-11 w-full justify-start text-xs" disabled={busy || waitingRetry} onClick={() => { automatic.current = ''; void act('advance'); }}>{t.check}</Button> : null}
            <Button variant="ghost" className="min-h-11 w-full justify-start text-xs" disabled={busy} onClick={() => void act('cancel')}>{t.cancel}</Button>
          </div>
        </details> : null}
      </div>
      <footer className="shrink-0 space-y-2 border-t border-edge/60 px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-8">
        {needsApproval ? <Button variant="primary" className={primaryClass} disabled={busy} onClick={() => void act('approve')}>{busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}{t.approve}</Button>
          : tokenRequired ? <Button variant="primary" className={primaryClass} form="mcp-setup-secret-form" type="submit" disabled={busy || !fieldsReady}>{busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}{busy ? t.checking : t.submit}</Button>
            : authorizing && data?.authorizationUrl ? <Button asChild variant="primary" className={primaryClass}><a href={data.authorizationUrl} target="_blank" rel="noopener noreferrer">{t.login}</a></Button>
              : deliveryFailed ? <Button variant="primary" className={primaryClass} disabled={busy} onClick={() => void act('retry_delivery')}>{t.retryDelivery}</Button>
                : blocked || data?.reloadRequired || error ? <Button variant="primary" className={primaryClass} disabled={busy || waitingRetry} onClick={() => { automatic.current = ''; if (data) void act('advance'); else void mutate(); }}>{t.check}</Button>
                  : connected || terminal ? <Button variant="primary" className={primaryClass} onClick={dismiss}>{data?.returnChannel === 'weixin' ? t.done : t.back}</Button> : null}
        {!connected && !terminal ? <Button variant="ghost" className="min-h-11 w-full rounded-xl text-sm" disabled={busy} onClick={dismiss}>{t.later}</Button> : null}
      </footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function McpConversationSetupPage() {
  const { setupId = '' } = useParams();
  const navigate = useNavigate();
  const language = useLocaleStore(state => state.language);
  const [closed, setClosed] = useState(false);
  useEffect(() => setClosed(false), [setupId]);
  return <main className="flex h-full min-h-0 items-center justify-center bg-surface-base p-6">
    {closed ? <section className="max-w-xs space-y-4 text-center"><Link2 className="mx-auto size-6 text-fg-muted" aria-hidden /><h1 className="text-lg font-medium text-fg">{copy[language].closed}</h1><Button onClick={() => setClosed(false)}>{copy[language].reopen}</Button></section> : <McpConversationSetupDialog setupId={setupId} onClose={setup => {
      if (setup?.returnChannel === 'weixin') setClosed(true);
      else navigate(setup ? `/chat/${setup.conversationId}` : '/chat', { replace: true });
    }} />}
  </main>;
}
