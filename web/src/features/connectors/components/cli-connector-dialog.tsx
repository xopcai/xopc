import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';

import { installConnector, removeConnector, setConnectorEnabled, testConnector, type ConnectorDefinition, type ConnectorInstance } from '../connectors-api';

type Authorization = { id: string; status: string; error?: string; accountId?: string; challenge?: ({ type: 'open_url'; url: string } | { type: 'qr_code'; artifactId: string }) & { step: number; totalSteps: number } };
type Account = { id: string; label?: string; identity: Record<string, unknown>; status: string; enabled: boolean };
type Accounts = { authorization?: Authorization; accounts: Account[]; policy?: { maxScope: 'read' | 'write' } };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetchJson<{ ok: boolean; payload: T; error?: string }>(apiUrl(path), options);
  if (!response.ok) throw new Error(response.error ?? 'Connection request failed.');
  return response.payload;
}

export function CliConnectorDialog({ definition, instance: initialInstance, onClose, onChanged }: {
  definition: ConnectorDefinition; instance?: ConnectorInstance; onClose: () => void; onChanged: (instance: ConnectorInstance) => Promise<void>;
}) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const [instance, setInstance] = useState(initialInstance);
  const [accounts, setAccounts] = useState<Accounts>();
  const [authorization, setAuthorization] = useState<Authorization>();
  const [imageUrl, setImageUrl] = useState<string>();
  const [health, setHealth] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const id = instance?.instanceId ?? definition.id;
  const refresh = useCallback(async () => { const value = await request<Accounts>(`/api/connectors/${encodeURIComponent(id)}/accounts`); setAccounts(value); if (value.authorization) setAuthorization(value.authorization); }, [id]);
  useEffect(() => { if (instance) void refresh().catch(e => setError(String(e))); }, [instance, refresh]);
  const pending = authorization && ['preparing', 'awaiting_user', 'verifying'].includes(authorization.status);
  useEffect(() => {
    if (!pending || !authorization) return;
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await request<{ authorization: Authorization }>(`/api/connectors/authorizations/${authorization.id}`);
        if (cancelled) return;
        setAuthorization(result.authorization);
        if (result.authorization.status === 'succeeded') { await refresh(); if (instance) await onChanged(instance); }
      } catch (e) { if (!cancelled) setError(String(e)); }
      finally { polling = false; }
    };
    const check = () => { void poll(); };
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    check();
    const timer = setInterval(check, 1500);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', visible);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', visible); };
  }, [pending, authorization?.id, instance, onChanged, refresh]);
  const artifactId = authorization?.challenge?.type === 'qr_code' ? authorization.challenge.artifactId : undefined;
  useEffect(() => {
    if (!artifactId) { setImageUrl(undefined); return; }
    let cancelled = false; let blobUrl: string | undefined;
    void apiFetch(apiUrl(`/api/connectors/authorizations/${artifactId}/artifact`)).then(async response => {
      if (!response.ok) throw new Error('QR code unavailable.');
      const blob = await response.blob();
      if (cancelled) return;
      blobUrl = URL.createObjectURL(blob); setImageUrl(blobUrl);
    }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [artifactId]);
  const connect = async (accountId?: string) => {
    setBusy(true); setError(undefined);
    try {
      const installed = instance ?? await installConnector(definition.id, {});
      setInstance(installed);
      const response = await request<{ authorization: Authorization }>(`/api/connectors/${encodeURIComponent(installed.instanceId)}/authorizations`, { method: 'POST', body: JSON.stringify({ accountId }) });
      setAuthorization(response.authorization);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const updateScope = async (maxScope: string) => {
    setBusy(true); setError(undefined);
    try { await request(`/api/connectors/${encodeURIComponent(id)}/policy`, { method: 'PATCH', body: JSON.stringify({ maxScope }) }); await refresh(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const disconnect = async (accountId: string) => {
    setBusy(true); setError(undefined);
    try { await request(`/api/connectors/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' }); await refresh(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const manage = async (action: 'toggle' | 'test' | 'remove') => {
    if (!instance) return;
    setBusy(true); setError(undefined);
    try {
      if (action === 'remove') { await removeConnector(id); await onChanged(instance); onClose(); }
      else if (action === 'toggle') { const updated = await setConnectorEnabled(id, !instance.enabled); setInstance(updated); await onChanged(updated); }
      else { const result = await testConnector(id); setHealth(result.ok ? (zh ? `验证通过，可用操作：${result.toolCount}` : `Verified: ${result.toolCount} actions`) : result.error ?? result.action ?? result.status); }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const close = () => { if (instance) void onChanged(instance); onClose(); };
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(38rem,calc(100dvh-2rem))] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel text-fg">
      <div className="flex items-center justify-between border-b border-edge p-5"><div><Dialog.Title className="font-semibold">{definition.displayName}</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-fg-muted">{zh ? '连接账号并设置允许的操作。' : 'Connect an account and choose allowed actions.'}</Dialog.Description></div>
        <Button variant="ghost" onClick={close} aria-label={zh ? '关闭' : 'Close'}><X className="size-4" /></Button></div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
        {instance && !accounts ? <Skeleton className="h-24 w-full" /> : null}
        {instance ? <div className="flex flex-wrap gap-2">
          <Button disabled={busy || Boolean(pending)} onClick={() => void manage('toggle')}>{instance.enabled ? (zh ? '停用' : 'Disable') : (zh ? '启用' : 'Enable')}</Button>
          <Button disabled={busy || Boolean(pending) || !instance.enabled} onClick={() => void manage('test')}>{zh ? '检查连接' : 'Check connection'}</Button>
          <Button variant="ghost" disabled={busy || Boolean(pending)} onClick={() => void manage('remove')}>{zh ? '移除连接器' : 'Remove connector'}</Button>
        </div> : null}
        {health ? <p className="text-sm text-fg-muted">{health}</p> : null}
        {accounts?.accounts.map(account => <div key={account.id} className="space-y-2 rounded-lg border border-edge p-3">
          <p className="text-sm font-medium">{account.label ?? account.id}</p><p className="break-all text-xs text-fg-muted">{String(account.identity.openId ?? account.identity.botId ?? account.id)}</p>
          <p className="text-xs text-fg-muted">{account.enabled && account.status === 'active' ? (zh ? '已连接' : 'Connected') : (zh ? '已断开' : 'Disconnected')}</p>
          <div className="flex gap-2"><Button variant="secondary" disabled={busy || Boolean(pending) || instance?.enabled === false} onClick={() => void connect(account.id)}>{zh ? '重新连接' : 'Reconnect'}</Button>
          <Button variant="ghost" disabled={busy || Boolean(pending) || !account.enabled} onClick={() => void disconnect(account.id)}>{zh ? '断开本地连接' : 'Disconnect locally'}</Button></div>
        </div>)}
        {accounts?.policy ? <div className="space-y-2"><p className="text-sm">{zh ? '允许的操作' : 'Allowed actions'}</p>
          <Select value={accounts.policy.maxScope} onChange={event => void updateScope(event.target.value)} disabled={busy}>
            <SelectOption value="read">{zh ? '仅查看' : 'Read only'}</SelectOption><SelectOption value="write">{zh ? '查看并执行操作' : 'Read and write'}</SelectOption>
          </Select><p className="text-xs text-fg-muted">{zh ? '写入操作需要确认。断开本地连接不会撤销第三方授权。' : 'Writes require confirmation. Local disconnection does not revoke provider authorization.'}</p></div> : null}
        {authorization ? <div className="space-y-3 rounded-lg border border-edge p-4" aria-live="polite">
          <p className="text-sm">{authorization.status === 'succeeded' ? (zh ? '账号验证成功' : 'Account verified') : authorization.status === 'preparing' ? (zh ? '正在准备授权…' : 'Preparing authorization…') : authorization.status === 'verifying' ? (zh ? '授权已完成，正在验证账号…' : 'Authorization complete. Verifying account…') : pending ? (zh ? '请完成当前步骤，返回后会自动检查结果。' : 'Complete this step. We will check the result when you return.') : authorization.error ?? (zh ? '授权已结束，请重新连接。' : 'Authorization ended. Connect again.')}</p>
          {pending && authorization.challenge && authorization.challenge.totalSteps > 1 ? <p className="text-sm font-medium">
            {zh ? `第 ${authorization.challenge.step} / ${authorization.challenge.totalSteps} 步` : `Step ${authorization.challenge.step} of ${authorization.challenge.totalSteps}`}
            {authorization.challenge.step > 1 ? (zh ? '：上一步已完成，请打开新的授权页面继续。' : ': Previous step complete. Open the new authorization page to continue.') : (zh ? '：完成后还需要继续授权账号。' : ': Account authorization follows this step.')}
          </p> : null}
          {pending && authorization.challenge?.type === 'open_url' ? <a key={authorization.challenge.url} href={authorization.challenge.url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent underline">{zh ? '打开授权页面' : 'Open authorization page'}</a> : null}
          {pending && artifactId ? imageUrl ? <img src={imageUrl} alt={zh ? '授权二维码' : 'Authorization QR code'} className="mx-auto size-56 bg-white object-contain" /> : <Skeleton className="mx-auto size-56" /> : null}
          {pending ? <Button variant="secondary" onClick={() => { void request(`/api/connectors/authorizations/${authorization.id}/cancel`, { method: 'POST' }).then(() => setAuthorization({ ...authorization, status: 'cancelled', challenge: undefined })).catch(e => setError(String(e))); }}>{zh ? '取消授权' : 'Cancel authorization'}</Button> : null}
        </div> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-edge p-4"><Button variant="secondary" onClick={close}>{zh ? '关闭' : 'Close'}</Button>
        <Button disabled={busy || Boolean(pending) || instance?.enabled === false} onClick={() => void connect()}>{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}{zh ? '连接账号' : 'Connect account'}</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
