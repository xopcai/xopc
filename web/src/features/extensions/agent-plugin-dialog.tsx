import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { getMcpOAuthStatus, startMcpOAuth, disconnectMcpOAuth, type McpOAuthStatus } from '@/features/connectors/mcp/mcp-config-api';
import { reserveOAuthAuthorizationWindow, openOAuthAuthorizationUrl, closeOAuthAuthorizationWindow } from '@/features/settings/oauth-authorization-window';
import type { ExtensionApiRow } from './types';

const fieldClass = 'w-full rounded-lg border border-edge bg-surface-inset px-3 py-2 text-sm text-fg';
type Plan = { manifest: { name: string; version?: string }; reviewHash: string; capabilities: string[]; addedCapabilities: string[]; diagnostics: Array<{ component: string; message: string }>; installed: boolean };
async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const result = await fetchJson<{ ok: boolean; payload: T; error?: string }>(apiUrl(path), { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!result.ok) throw new Error(result.error ?? 'Request failed');
  return result.payload;
}

export function PluginMcpConnection({ pluginId, server, enabled }: { pluginId: string; server: { id: string; name: string; type: string }; enabled: boolean }) {
  const { mutate } = useSWRConfig();
  const zh = useLocaleStore(s => s.language).startsWith('zh');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<McpOAuthStatus | null>(null);
  const [message, setMessage] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [secret, setSecret] = useState('');
  const [key, setKey] = useState(server.type === 'stdio' ? 'API_KEY' : 'Authorization');
  const [prefix, setPrefix] = useState(server.type === 'stdio' ? '' : 'Bearer ');
  const [loaded, setLoaded] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState('');
  const path = `/api/mcp/servers/${encodeURIComponent(server.id)}`;
  async function test() {
    const response = await apiFetch(apiUrl(`${path}/test`), { method: 'POST', body: '{}' });
    const result = await response.json();
    void mutate('gateway-extensions-list');
    setAuthRequired(result.code === 'MCP_AUTHORIZATION_REQUIRED');
    if (!response.ok || !result.ok) throw new Error(result.error ?? 'Connection failed');
    setMessage(zh ? `连接成功 · ${result.payload.toolCount} 个工具` : `Connected · ${result.payload.toolCount} tools`);
  }
  useEffect(() => {
    if (!enabled || server.type !== 'streamable-http') return;
    let cancelled = false;
    void getMcpOAuthStatus(server.id).then(value => { if (!cancelled) { setStatus(value); setLoaded(true); } }).catch(error => { if (!cancelled) { setMessage(String(error)); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [enabled, server.id, server.type]);
  useEffect(() => {
    if (status?.status !== 'authorizing') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getMcpOAuthStatus(server.id).then(next => {
        if (cancelled) return;
        setStatus(next);
        if (next.status === 'connected') { setAuthRequired(false); setMessage(zh ? '已连接，可以重试原任务' : 'Connected. Retry your task.'); void mutate('gateway-extensions-list'); }
        if (next.status === 'error') setMessage(next.session?.error ?? 'Authorization failed');
      }).catch(error => { if (!cancelled) setMessage(String(error)); });
    }, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [status?.status, server.id, zh, mutate]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setMessage('');
    try { await fn(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="rounded-lg border border-edge p-3 text-sm">
    <div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-medium">{server.name}</span><span className="text-xs text-fg-muted">{pluginId} · {server.type}</span></div>
    {!enabled ? <p className="text-fg-muted">{zh ? '启用插件后连接服务' : 'Enable the plugin to connect'}</p> : <>
      {server.type === 'streamable-http' && !loaded ? <Skeleton className="mb-2 h-4 w-24" /> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void run(test)}>{zh ? '测试连接' : 'Test connection'}</Button>
        {server.type === 'streamable-http' && status?.status !== 'connected' ? <Button variant={authRequired ? 'primary' : 'secondary'} disabled={busy} onClick={() => {
          const popup = reserveOAuthAuthorizationWindow();
          void run(async () => {
            try {
              const next = await startMcpOAuth(server.id); setStatus(next);
              if (next.session?.authorizationUrl) {
                if (!await openOAuthAuthorizationUrl(next.session.authorizationUrl, popup)) throw new Error(zh ? '无法打开授权页面' : 'Could not open authorization page');
              } else { closeOAuthAuthorizationWindow(popup); if (next.session?.error) throw new Error(next.session.error); }
            } catch (error) { closeOAuthAuthorizationWindow(popup); throw error; }
          });
        }}>{zh ? '连接账号' : 'Connect account'}</Button> : null}
        {status?.status === 'connected' ? <Button variant="secondary" disabled={busy} onClick={() => void run(async () => { setStatus(await disconnectMcpOAuth(server.id)); void mutate('gateway-extensions-list'); })}>{zh ? '断开连接' : 'Disconnect'}</Button> : null}
        <Button variant="ghost" disabled={busy} onClick={() => setShowSecret(!showSecret)}>{zh ? '设置密钥' : 'Set API key'}</Button>
      </div>
      {showSecret ? <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); void run(async () => {
        await request(`/api/extensions/agent-plugins/${encodeURIComponent(pluginId)}/mcp/${encodeURIComponent(server.name)}/auth`, 'PUT', {
          mode: 'api-key', secrets: [{ target: server.type === 'stdio' ? 'env' : 'headers', key, value: secret, prefix }],
        }); setSecret(''); setShowSecret(false); setStatus(null); setAuthRequired(false); await test();
      }); }}>
        <label className="block">{zh ? '字段名' : 'Field name'}<input className={fieldClass} value={key} onChange={e => setKey(e.target.value)} required /></label>
        <label className="block">{zh ? '前缀（可选）' : 'Prefix (optional)'}<input className={fieldClass} value={prefix} onChange={e => setPrefix(e.target.value)} /></label>
        <label className="block">{zh ? '密钥' : 'Secret'}<input className={fieldClass} type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} required /></label>
        <Button type="submit" disabled={busy || !secret}>{zh ? '保存并测试' : 'Save and test'}</Button>
      </form> : null}
    </>}
    {status?.status === 'authorizing' ? <div className="mt-2 space-y-2 text-fg-muted">
      <p>{zh ? '请在浏览器完成授权' : 'Complete authorization in your browser'}</p>
      <details><summary>{zh ? '使用远程 Gateway？' : 'Using a remote Gateway?'}</summary>
        <form className="mt-2 space-y-2" onSubmit={event => { event.preventDefault(); void run(async () => {
          setStatus(await request<McpOAuthStatus>(`${path}/oauth/callback`, 'POST', { callbackUrl })); setCallbackUrl('');
        }); }}>
          <label>{zh ? '如果浏览器跳转后无法连接，请粘贴地址栏中的完整回调 URL' : 'If the browser cannot reach the callback, paste its full address-bar URL'}<input type="password" autoComplete="off" className={fieldClass} value={callbackUrl} onChange={e => setCallbackUrl(e.target.value)} /></label>
          <Button type="submit" disabled={busy || !callbackUrl}>{zh ? '完成连接' : 'Complete connection'}</Button>
        </form>
      </details>
    </div> : null}
    {message ? <p role="status" className="mt-2 break-words text-fg-muted">{message}</p> : null}
  </div>;
}

export function AgentPluginDialog({ extension, onClose, initialSource = '' }: { extension?: ExtensionApiRow; onClose: () => void; initialSource?: string }) {
  const zh = useLocaleStore(s => s.language).startsWith('zh');
  const { mutate } = useSWRConfig();
  const [currentExtension, setCurrentExtension] = useState(extension);
  const [source, setSource] = useState(initialSource);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removeData, setRemoveData] = useState(false);
  const [removeCredentials, setRemoveCredentials] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const base = `/api/extensions/agent-plugins/${encodeURIComponent(currentExtension?.pluginId ?? '')}`;
  const refresh = () => mutate('gateway-extensions-list');
  async function run(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function setActivation(enabled: boolean) {
    const next = await request<ExtensionApiRow>(`${base}/activation`, 'POST', { enabled });
    setCurrentExtension(next);
    await refresh();
  }
  useEffect(() => {
    if (extension) setCurrentExtension(extension);
  }, [extension]);
  return <Dialog.Root defaultOpen onOpenChange={open => !open && onClose()}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[130] bg-scrim" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] flex h-[min(85vh,44rem)] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay">
      <div className="flex shrink-0 items-center justify-between border-b border-edge p-4"><Dialog.Title className="font-semibold">{currentExtension?.name ?? (zh ? '安装 Agent Plugin' : 'Install Agent Plugin')}</Dialog.Title><Button variant="ghost" onClick={onClose}>{zh ? '关闭' : 'Close'}</Button></div>
      <Dialog.Description className="sr-only">{zh ? '安装、组件、账号连接和权限' : 'Installation, components, connections and permissions'}</Dialog.Description>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {currentExtension ? <>
          {!currentExtension.activationEligible ? <div role="status" className="space-y-3 rounded-lg border border-accent/25 bg-accent-soft p-4">
            <div><p className="font-medium text-accent-fg">{zh ? '插件已安装，当前尚未启用' : 'Plugin installed. It is not enabled yet.'}</p><p className="mt-1 text-sm text-fg-muted">{zh ? '启用后，Skills 和 MCP 才会加入 Agent 运行时。' : 'Enable it to make its skills and MCP servers available to the Agent runtime.'}</p></div>
            <Button disabled={busy || currentExtension.readiness === 'blocked'} onClick={() => void run(() => setActivation(true))}>{zh ? '启用插件' : 'Enable plugin'}</Button>
          </div> : null}
          <p className="text-sm text-fg-muted">Agent Plugin · {currentExtension.version} · {currentExtension.readiness && ({ ready: zh ? '已就绪' : 'Ready', setup_required: zh ? '待连接' : 'Setup required', degraded: zh ? '部分不可用' : 'Partially available', blocked: zh ? '已阻止' : 'Blocked' })[currentExtension.readiness]}</p>
          <p className="text-sm">{currentExtension.description}</p>
          {currentExtension.activationEligible ? <Button disabled={busy} variant="secondary" onClick={() => void run(() => setActivation(false))}>{zh ? '停用' : 'Disable'}</Button> : null}
          {currentExtension.canRollback ? <Button disabled={busy} variant="secondary" onClick={() => void run(async () => { setCurrentExtension(await request<ExtensionApiRow>(`${base}/rollback`, 'POST')); await refresh(); })}>{zh ? '回滚上一版本' : 'Roll back'}</Button> : null}
          {currentExtension.components?.skills.length ? <p className="text-sm">Skills: {currentExtension.components.skills.map(s => s.name).join(', ')}</p> : null}
          {currentExtension.components?.mcp.map(server => <PluginMcpConnection key={server.id} pluginId={currentExtension.pluginId!} server={server} enabled={currentExtension.active} />)}
          {currentExtension.diagnostics?.map((d, i) => <p key={i} className="text-sm text-fg-muted">{d.component}: {d.message}</p>)}
        </> : null}
        <form className="space-y-3 border-t border-edge pt-4" onSubmit={event => { event.preventDefault(); void run(async () => { setPlan(await request<Plan>('/api/extensions/inspect', 'POST', { source })); }); }}>
          <label className="block text-sm">{currentExtension ? (zh ? '更新包来源' : 'Update package source') : (zh ? 'Gateway 本地路径、HTTPS ZIP 或 store:包名' : 'Gateway local path, HTTPS ZIP or store:package')}<input className={`${fieldClass} mt-1`} value={source} onChange={e => { setSource(e.target.value); setPlan(null); }} required /></label>
          <Button type="submit" variant="secondary" disabled={busy || !source}>{zh ? '检查安装包' : 'Inspect package'}</Button>
        </form>
        {plan ? <div className="space-y-3 rounded-lg border border-edge p-3 text-sm">
          <p className="font-medium">{plan.manifest.name} {plan.manifest.version}</p>
          <p className="text-fg-muted">{zh ? '此包将提供以下能力。本地 MCP 会在你的主机上运行程序。' : 'This package provides the capabilities below. Local MCP servers execute programs on your host.'}</p>
          <ul className="space-y-1 break-words">{plan.capabilities.map(c => <li key={c}>{plan.addedCapabilities.includes(c) ? '+ ' : ''}{c}</li>)}</ul>
          {plan.diagnostics.map((d, i) => <p key={i}>{d.component}: {d.message}</p>)}
          <Button disabled={busy || !!currentExtension && plan.manifest.name !== currentExtension.pluginId} onClick={() => void run(async () => {
            const installing = !currentExtension;
            const next = await request<ExtensionApiRow>(installing ? '/api/extensions/install' : `${base}/update`, 'POST', { source, reviewHash: plan.reviewHash });
            setCurrentExtension(next); setPlan(null); await refresh();
          })}>{zh ? '确认能力并安装' : 'Accept capabilities and install'}</Button>
        </div> : null}
        {currentExtension ? <div className="border-t border-edge pt-4">
          {!confirmRemove ? <Button variant="ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>{zh ? '卸载插件' : 'Uninstall'}</Button> : <div className="space-y-3 text-sm">
            <p>{zh ? '卸载保留账号凭据；服务端授权需到相应服务撤销。' : 'Credentials are retained. Revoke provider authorization in the service itself.'}</p>
            <label className="flex gap-2"><input type="checkbox" checked={removeData} onChange={e => setRemoveData(e.target.checked)} />{zh ? '同时删除插件数据' : 'Also delete plugin data'}</label>
            <label className="flex gap-2"><input type="checkbox" checked={removeCredentials} onChange={e => setRemoveCredentials(e.target.checked)} />{zh ? '同时删除本地凭据' : 'Also delete local credentials'}</label>
            <Button disabled={busy} onClick={() => void run(async () => { await request(base, 'DELETE', { removeData, removeCredentials }); await refresh(); onClose(); })}>{zh ? '确认卸载' : 'Confirm uninstall'}</Button>
          </div>}
        </div> : null}
        {error ? <p role="alert" className="break-words text-sm text-fg-muted">{error}</p> : null}
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
