import { Check, Cloud, KeyRound, Loader2, Monitor, Pencil, ShieldCheck } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { SecretInput } from '@/components/ui/secret-input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDesktopGatewayConnection } from '@/features/gateway/use-desktop-gateway-connection';
import { useLocaleStore } from '@/stores/locale-store';

function originError(value: string, zh: boolean): string {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return zh ? '请填写服务地址，不包含路径、密码或查询参数。' : 'Use the server address without paths, credentials or query parameters.';
    if (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return '';
    return zh ? '远端服务请使用 HTTPS；SSH 转发可使用本机 HTTP 地址。' : 'Use HTTPS for a remote server, or a loopback HTTP address for an SSH tunnel.';
  } catch { return zh ? '请输入完整地址，例如 https://gateway.example.com。' : 'Enter a full address, such as https://gateway.example.com.'; }
}
function connectionError(value: unknown, zh: boolean): string {
  const raw = value instanceof Error ? value.message : String(value ?? '');
  if (/AUTH_FAILED|credential|access token/i.test(raw)) return zh ? '访问令牌未通过验证，请检查后重试。' : 'The access token was rejected. Check it and try again.';
  if (/INCOMPATIBLE/.test(raw)) return zh ? '此服务与当前客户端版本不兼容，请更新后重试。' : 'This server is incompatible with the client. Update it and try again.';
  if (/IDENTITY_CHANGED/.test(raw)) return zh ? '服务器身份发生变化，请确认地址并重新输入令牌。' : 'The server identity changed. Confirm the address and enter the token again.';
  return zh ? '暂时无法连接，请检查服务地址和网络后重试。' : 'Unable to connect. Check the server address and network, then try again.';
}
function hostLabel(origin: string) { try { return new URL(origin).host; } catch { return origin; } }

export function DesktopGatewayConnection() {
  const api = window.electronAPI?.gateway;
  const zh = useLocaleStore(state => state.language) === 'zh';
  const { data, error: loadError, mutate } = useDesktopGatewayConnection();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<'local' | 'remote' | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [addressError, setAddressError] = useState('');
  if (!api?.connection) return null;
  const selected = mode ?? data?.mode ?? 'local';
  const address = origin ?? data?.remoteOrigin ?? '';
  const currentAddress = data?.origin || (data?.mode === 'remote' ? data.remoteOrigin : '');
  const expanded = editing || Boolean(data && (!data.origin || data.error));
  const savedCredential = data?.hasCredential && address.trim().replace(/\/$/, '') === data.remoteOrigin;
  const changed = selected !== data?.mode || selected === 'remote' && (address.trim().replace(/\/$/, '') !== data?.remoteOrigin || !!credential.trim());
  const reset = () => { setEditing(false); setMode(null); setOrigin(null); setCredential(''); setError(''); setAddressError(''); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (selected === 'remote') {
      const validation = originError(address, zh); setAddressError(validation);
      if (validation) return;
      if (!credential.trim() && !savedCredential) { setError(zh ? '请输入此服务的访问令牌。' : 'Enter the access token for this server.'); return; }
    }
    setBusy(true); setError('');
    try {
      const result = await api.switchConnection({ mode: selected, ...(selected === 'remote' ? { origin: address.trim(), ...(credential.trim() ? { credential: credential.trim() } : {}) } : {}) });
      if (!result.ok) throw new Error(result.error);
      await mutate(); reset();
    } catch (cause) { setError(connectionError(cause, zh)); }
    finally { setBusy(false); }
  };
  const Icon = data?.mode === 'remote' ? Cloud : Monitor;
  return <section className="overflow-hidden rounded-xl border border-edge bg-surface-panel" aria-label={zh ? '桌面 Gateway 连接' : 'Desktop Gateway connection'}>
    <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
      <div className="flex min-w-0 flex-1 gap-3.5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-edge bg-surface-inset text-fg-muted"><Icon className="size-5" strokeWidth={1.75} aria-hidden /></div>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs font-medium text-fg-muted">{zh ? '当前连接' : 'Current connection'}</p>
          {!data && !loadError ? <Skeleton className="h-6 w-48" /> : <>
            <div className="flex flex-wrap items-center gap-2"><h2 className="break-all text-base font-semibold text-fg">{data?.mode === 'remote' ? hostLabel(currentAddress) || (zh ? '远端 Gateway' : 'Remote Gateway') : (zh ? '本地 Gateway' : 'Local Gateway')}</h2><span className="rounded-md bg-surface-hover px-2 py-0.5 text-xs text-fg-muted">{data?.mode === 'remote' ? (zh ? '远端' : 'Remote') : (zh ? '此电脑' : 'This computer')}</span></div>
            {currentAddress && <p className="mt-1 break-all text-xs text-fg-muted">{currentAddress}</p>}
          </>}
        </div>
      </div>
      {data && !expanded ? <Button variant="secondary" onClick={() => setEditing(true)} className="shrink-0 gap-1.5"><Pencil className="size-3.5" aria-hidden />{zh ? '更改连接' : 'Change connection'}</Button> : null}
    </div>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-edge-subtle bg-surface-inset/40 px-5 py-3 text-xs text-fg-muted sm:px-6" role="status">
      <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden />{zh ? '连接选择仅影响此客户端' : 'Connection selection applies to this client'}</span>
      <span className="inline-flex items-center gap-1.5">{data?.endpointConnected ? <Check className="size-3.5 text-accent-fg" aria-hidden /> : <Monitor className="size-3.5" aria-hidden />}{data?.endpointConnected ? (zh ? '本机已授权能力已就绪' : 'Authorized local capabilities ready') : (zh ? '本机能力等待连接' : 'Local capabilities awaiting connection')}</span>
    </div>
    {expanded ? <form onSubmit={event => void save(event)} className="space-y-5 border-t border-edge px-5 py-5 sm:px-6">
      <div><h3 className="text-sm font-semibold text-fg">{zh ? '更改 Gateway 连接' : 'Change Gateway connection'}</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">{zh ? '连接后，聊天和工作数据来自所选服务；本机授权保持不变。' : 'Chats and work come from the selected server. Your local permissions stay in place.'}</p></div>
      <div className="max-w-xs"><label htmlFor={id + '-mode'} className="mb-2 block text-sm font-medium text-fg">{zh ? '连接到' : 'Connect to'}</label><Select id={id + '-mode'} aria-label={zh ? '连接到' : 'Connect to'} value={selected} onChange={event => { setMode(event.target.value as 'local' | 'remote'); setError(''); }} disabled={busy}><SelectOption value="local">{zh ? '本地 Gateway' : 'Local Gateway'}</SelectOption><SelectOption value="remote">{zh ? '远端 Gateway' : 'Remote Gateway'}</SelectOption></Select></div>
      {selected === 'remote' ? <div className="grid gap-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div><label htmlFor={id + '-origin'} className="mb-2 block text-sm font-medium text-fg">{zh ? '服务地址' : 'Server address'}</label><input id={id + '-origin'} aria-invalid={!!addressError} aria-describedby={id + '-origin-help'} value={address} onBlur={() => setAddressError(originError(address, zh))} onChange={event => { setOrigin(event.target.value); setAddressError(''); }} disabled={busy} placeholder="https://gateway.example.com" autoComplete="url" spellCheck={false} className="h-10 w-full rounded-lg border border-edge bg-surface-inset px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent" /><p id={id + '-origin-help'} className={`mt-2 text-xs leading-relaxed ${addressError ? 'text-red-600 dark:text-red-400' : 'text-fg-subtle'}`}>{addressError || (zh ? '使用 HTTPS 地址；SSH 转发可填写本机地址。' : 'Use HTTPS, or a loopback address for an SSH tunnel.')}</p></div>
        <div><label htmlFor={id + '-token'} className="mb-2 block text-sm font-medium text-fg">{zh ? '访问令牌' : 'Access token'}</label><SecretInput id={id + '-token'} value={credential} onChange={setCredential} disabled={busy} hideCopy autoComplete="new-password" placeholder={savedCredential ? (zh ? '已保存，留空继续使用' : 'Saved; leave empty to keep') : (zh ? '输入服务访问令牌' : 'Enter the server access token')} labels={zh ? { show: '显示令牌', hide: '隐藏令牌', copy: '复制', copied: '已复制' } : { show: 'Show token', hide: 'Hide token', copy: 'Copy', copied: 'Copied' }} /><p className="mt-2 flex items-center gap-1.5 text-xs text-fg-subtle"><KeyRound className="size-3" aria-hidden />{zh ? '使用此电脑的系统密钥链加密保存' : 'Encrypted with this computer’s system keychain'}</p></div>
      </div> : <p className="text-sm text-fg-muted">{zh ? '使用此电脑运行的 Gateway 和工作数据。' : 'Use the Gateway and work data on this computer.'}</p>}
      {(error || data?.error || loadError) ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error || connectionError(data?.error || loadError, zh)}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-edge-subtle pt-4">
        {data?.origin ? <Button type="button" variant="secondary" disabled={busy} onClick={reset}>{zh ? '取消' : 'Cancel'}</Button> : null}
        <Button type="submit" variant="primary" disabled={busy || !changed && !!data?.origin && !data.error}>{busy ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : null}{busy ? (zh ? '正在连接…' : 'Connecting…') : (zh ? '连接并切换' : 'Connect and switch')}</Button>
      </div>
    </form> : null}
    {loadError && !expanded ? <div className="px-5 pb-4"><p role="alert" className="text-sm text-red-600 dark:text-red-400">{connectionError(loadError, zh)}</p><Button variant="secondary" className="mt-3" onClick={() => void mutate()}>{zh ? '重试' : 'Retry'}</Button></div> : null}
  </section>;
}
