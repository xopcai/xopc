import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, ChevronDown, FileArchive, FolderOpen, Loader2, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkingDirectoryPickerModal } from '@/features/fs/working-directory-picker-modal';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { apiFetch, fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useLocaleStore } from '@/stores/locale-store';
import { getMcpOAuthStatus, startMcpOAuth, disconnectMcpOAuth, type McpOAuthStatus } from '@/features/connectors/mcp/mcp-config-api';
import { reserveOAuthAuthorizationWindow, openOAuthAuthorizationUrl, closeOAuthAuthorizationWindow } from '@/features/settings/oauth-authorization-window';
import type { ExtensionApiRow } from './types';
import type { ExtensionMarketplacePackageDetail } from './extension-marketplace-api';

const fieldClass = 'w-full rounded-lg border border-edge bg-surface-inset px-3 py-2 text-sm text-fg';
type Plan = { manifest: { name: string; version?: string }; reviewHash: string; capabilities: string[]; addedCapabilities: string[]; diagnostics: Array<{ component: string; message: string }>; installed: boolean };

function capabilityLabel(capability: string, zh: boolean): string {
  if (capability.startsWith('content.skills:')) {
    const name = capability.slice('content.skills:'.length);
    return zh ? `提供技能：${name}` : `Add skill: ${name}`;
  }
  if (capability.startsWith('runtime.mcp.stdio:')) {
    const name = capability.slice('runtime.mcp.stdio:'.length).split(':', 1)[0];
    return zh ? `在本机运行工具服务：${name}` : `Run a local tool service: ${name}`;
  }
  if (capability.startsWith('network.mcp:')) {
    const name = capability.slice('network.mcp:'.length).split(':', 1)[0];
    return zh ? `连接外部工具服务：${name}` : `Connect to an external tool service: ${name}`;
  }
  return capability;
}

function planNeedsAuthorization(plan: Plan, marketplace?: ExtensionMarketplacePackageDetail): boolean {
  if (marketplace?.publisher?.verification !== 'verified') return true;
  if (marketplace.latestVersion.riskTier && marketplace.latestVersion.riskTier !== 'content') return true;
  return plan.addedCapabilities.some(capability => !capability.startsWith('content.skills:'));
}
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

export function AgentPluginDialog({
  extension,
  onClose,
  initialSource = '',
  marketplace,
  autoInstall = false,
}: {
  extension?: ExtensionApiRow;
  onClose: () => void;
  initialSource?: string;
  marketplace?: ExtensionMarketplacePackageDetail;
  autoInstall?: boolean;
}) {
  const language = useLocaleStore(s => s.language);
  const zh = language.startsWith('zh');
  const marketplaceLocalization = marketplace?.localizations?.[zh ? 'zh-CN' : 'en'];
  const marketplaceName = marketplaceLocalization?.displayName ?? marketplace?.name;
  const marketplaceDescription = marketplaceLocalization?.description ?? marketplace?.description;
  const sourceInputId = useId();
  const { mutate } = useSWRConfig();
  const [currentExtension, setCurrentExtension] = useState(extension);
  const [source, setSource] = useState(initialSource);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removeData, setRemoveData] = useState(false);
  const [removeCredentials, setRemoveCredentials] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [installComplete, setInstallComplete] = useState(false);
  const autoInstallStarted = useRef(false);
  const base = `/api/extensions/agent-plugins/${encodeURIComponent(currentExtension?.pluginId ?? '')}`;
  const storeSource = source.trim().startsWith('store:');
  const refresh = () => mutate('gateway-extensions-list');
  async function run(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  function updateSource(next: string) {
    setSource(next);
    setPlan(null);
    setError('');
  }
  const desktopFileApi = typeof window !== 'undefined' ? window.electronAPI?.file : undefined;
  const localDefaultPath = /^(?:\/|[A-Za-z]:[\\/])/.test(source.trim()) ? source.trim() : undefined;
  async function pickDirectory() {
    if (!desktopFileApi?.openDirectory) {
      setSourcePickerOpen(true);
      return;
    }
    const picked = await desktopFileApi.openDirectory(localDefaultPath ? { defaultPath: localDefaultPath } : undefined);
    if (picked) updateSource(picked);
  }
  async function pickZip() {
    if (!desktopFileApi?.openFile) {
      setSourcePickerOpen(true);
      return;
    }
    const picked = await desktopFileApi.openFile({ ...(localDefaultPath ? { defaultPath: localDefaultPath } : {}), extensions: ['zip'] });
    if (picked) updateSource(picked);
  }
  function isSupportedDrag(event: ReactDragEvent) {
    return [...event.dataTransfer.types].some(type => type === 'Files' || type === 'text/plain' || type === 'text/uri-list');
  }
  function onSourceDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!isSupportedDrag(event)) return;
    event.preventDefault();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) {
      if (files.length > 1) {
        setError(zh ? '一次只能选择一个插件目录或 ZIP。' : 'Choose one plugin directory or ZIP at a time.');
        return;
      }
      const path = desktopFileApi?.getPathForFile?.(files[0]);
      if (path) {
        updateSource(path);
      } else {
        setError(zh ? '浏览器无法读取本机文件路径，请使用“选择文件或目录”选择安装包。' : 'The browser cannot read local file paths. Use Choose file or folder to select the package.');
      }
      return;
    }
    const text = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
    if (text.trim()) updateSource(text.trim().split(/\r?\n/)[0]);
  }
  async function setActivation(enabled: boolean) {
    const next = await request<ExtensionApiRow>(`${base}/activation`, 'POST', { enabled });
    setCurrentExtension(next);
    await refresh();
  }
  async function installPlan(reviewedPlan: Plan) {
    const installing = !currentExtension;
    let next = await request<ExtensionApiRow>(installing ? '/api/extensions/install' : `${base}/update`, 'POST', {
      source,
      reviewHash: reviewedPlan.reviewHash,
    });
    setCurrentExtension(next);
    await refresh();
    if (installing && !next.activationEligible && next.readiness !== 'blocked' && next.pluginId) {
      next = await request<ExtensionApiRow>(`/api/extensions/agent-plugins/${encodeURIComponent(next.pluginId)}/activation`, 'POST', { enabled: true });
      setCurrentExtension(next);
      await refresh();
    }
    setPlan(null);
    setInstallComplete(installing && next.activationEligible === true);
  }
  async function beginStoreInstall() {
    const inspected = await request<Plan>('/api/extensions/inspect', 'POST', { source });
    if (planNeedsAuthorization(inspected, marketplace)) {
      setPlan(inspected);
      return;
    }
    await installPlan(inspected);
  }
  useEffect(() => {
    if (extension) setCurrentExtension(extension);
  }, [extension]);
  useEffect(() => {
    if (!autoInstall || currentExtension || !storeSource || autoInstallStarted.current) return;
    autoInstallStarted.current = true;
    void run(beginStoreInstall);
  }, [autoInstall, currentExtension, storeSource]);
  const startingAutomatically = autoInstall && !currentExtension && storeSource && !autoInstallStarted.current;
  const components = currentExtension?.components;
  return <Dialog.Root defaultOpen onOpenChange={open => !open && onClose()}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[130] bg-scrim" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] flex h-[min(76vh,30rem)] w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-overlay shadow-popover">
      <div className="flex shrink-0 items-center justify-between border-b border-edge p-4"><Dialog.Title className="font-semibold">{currentExtension?.name ?? marketplaceName ?? (zh ? '安装 Agent Plugin' : 'Install Agent Plugin')}</Dialog.Title><Button variant="ghost" onClick={onClose}>{zh ? '关闭' : 'Close'}</Button></div>
      <Dialog.Description className="sr-only">{zh ? '安装、组件、账号连接和权限' : 'Installation, components, connections and permissions'}</Dialog.Description>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!currentExtension && storeSource ? <section className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-edge bg-surface-base p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium text-fg">{marketplaceName ?? plan?.manifest.name ?? source.slice('store:'.length)}</p>
              {marketplaceDescription ? <p className="mt-1 text-sm leading-relaxed text-fg-muted">{marketplaceDescription}</p> : null}
              <p className="mt-2 text-xs text-fg-muted">
                {marketplace?.publisher?.verification === 'verified'
                  ? (zh ? '已认证发布者 · 安装后自动启用' : 'Verified publisher · enabled automatically after installation')
                  : (zh ? '安装前会检查来源和所需权限' : 'Source and required permissions are checked before installation')}
              </p>
            </div>
          </div>
          {!plan ? <Button
            className="w-full"
            disabled={busy || startingAutomatically}
            onClick={() => void run(beginStoreInstall)}
          >
            {busy || startingAutomatically ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {busy || startingAutomatically ? (zh ? '正在安全检查并安装…' : 'Checking and installing…') : (zh ? '一键安装' : 'Install')}
          </Button> : null}
        </section> : null}
        {currentExtension ? <>
          {installComplete ? <div role="status" className="flex items-start gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <div><p className="font-medium text-fg">{zh ? '插件已安装并启用' : 'Plugin installed and enabled'}</p><p className="mt-1 text-sm text-fg-muted">{zh ? '现在可以直接在对话中使用它。' : 'It is ready to use in your conversations.'}</p></div>
          </div> : null}
          {!currentExtension.activationEligible ? <div role="status" className="space-y-3 rounded-lg border border-accent/25 bg-accent-soft p-4">
            <div><p className="font-medium text-accent-fg">{zh ? '插件已安装，当前尚未启用' : 'Plugin installed. It is not enabled yet.'}</p><p className="mt-1 text-sm text-fg-muted">{zh ? '启用后，Skills 和 MCP 才会加入 Agent 运行时。' : 'Enable it to make its skills and MCP servers available to the Agent runtime.'}</p></div>
            <Button disabled={busy || currentExtension.readiness === 'blocked'} onClick={() => void run(() => setActivation(true))}>{zh ? '启用插件' : 'Enable plugin'}</Button>
          </div> : null}
          <p className="text-sm text-fg-muted">Agent Plugin · {currentExtension.version} · {currentExtension.readiness && ({ ready: zh ? '已就绪' : 'Ready', setup_required: zh ? '待连接' : 'Setup required', degraded: zh ? '部分不可用' : 'Partially available', blocked: zh ? '已阻止' : 'Blocked' })[currentExtension.readiness]}</p>
          {currentExtension.provenance ? <p className="break-words text-xs text-fg-muted">
            {currentExtension.provenance.publisherVerification === 'verified' ? (zh ? '已认证发布者' : 'Verified publisher') : (zh ? '社区发布者' : 'Community publisher')}
            {' · '}{currentExtension.provenance.packageName}@{currentExtension.provenance.version}
            {' · SHA-256 '}{currentExtension.provenance.sha256.slice(0, 12)}…
            {currentExtension.provenance.riskTier ? ` · ${currentExtension.provenance.riskTier}` : ''}
          </p> : null}
          <p className="text-sm">{currentExtension.description}</p>
          {currentExtension.activationEligible ? <Button disabled={busy} variant="secondary" onClick={() => void run(() => setActivation(false))}>{zh ? '停用' : 'Disable'}</Button> : null}
          {currentExtension.canRollback ? <Button disabled={busy} variant="secondary" onClick={() => void run(async () => { setCurrentExtension(await request<ExtensionApiRow>(`${base}/rollback`, 'POST')); await refresh(); })}>{zh ? '回滚上一版本' : 'Roll back'}</Button> : null}
          {components?.skills.length || components?.mcp.length ? <div className="space-y-3 rounded-lg border border-edge p-3">
            <div>
              <p className="text-sm font-medium">{zh ? '此插件提供的能力' : 'Capabilities from this plugin'}</p>
              {components.skills.length ? <p className="mt-1 text-sm text-fg-muted">Skills: {components.skills.map(s => s.name).join(', ')}</p> : null}
              {components.mcp.length ? <p className="mt-1 text-sm text-fg-muted">MCP: {components.mcp.map(server => server.name).join(', ')}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {components.skills.length ? <Button asChild variant="secondary"><Link to="/capabilities/skills?source=plugin">{zh ? '管理技能' : 'Manage skills'}</Link></Button> : null}
              {components.mcp.length ? <Button asChild variant="secondary"><Link to="/capabilities/connectors?tab=connected">{zh ? '管理连接' : 'Manage connections'}</Link></Button> : null}
            </div>
          </div> : null}
          {currentExtension.components?.mcp.length ? <details className="group rounded-lg border border-edge p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <span>{zh ? '连接与密钥（按需）' : 'Connections and API keys (as needed)'}</span>
              <ChevronDown className="size-4 text-fg-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
            </summary>
            <p className="mt-2 text-xs text-fg-muted">{zh ? '仅当工具服务提示登录或缺少密钥时设置。' : 'Only configure this when a tool service asks you to sign in or provide a key.'}</p>
            <div className="mt-3 space-y-3">{currentExtension.components.mcp.map(server => <PluginMcpConnection key={server.id} pluginId={currentExtension.pluginId!} server={server} enabled={currentExtension.active} />)}</div>
          </details> : null}
          {currentExtension.diagnostics?.map((d, i) => <p key={i} className="text-sm text-fg-muted">{d.component}: {d.message}</p>)}
        </> : null}
        {storeSource && currentExtension ? <Button variant="ghost" className="px-0" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(open => !open)}>
          <ChevronDown className={cn('size-4 transition-transform motion-reduce:transition-none', advancedOpen && 'rotate-180')} aria-hidden />
          {zh ? '高级操作' : 'Advanced actions'}
        </Button> : null}
        {(!storeSource || advancedOpen) ? <form className={cn('space-y-3', currentExtension && 'border-t border-edge pt-4')} onSubmit={event => { event.preventDefault(); void run(async () => { setPlan(await request<Plan>('/api/extensions/inspect', 'POST', { source })); }); }}>
          <div
            data-testid="plugin-source-dropzone"
            className={cn(
              'rounded-xl border border-dashed p-3 transition-colors',
              dragActive ? 'border-accent bg-accent-soft' : 'border-edge bg-surface-inset/40',
            )}
            onDragEnter={event => {
              if (!isSupportedDrag(event)) return;
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={event => {
              if (!isSupportedDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setDragActive(true);
            }}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
            }}
            onDrop={onSourceDrop}
          >
            <div className="mb-2 flex items-start gap-2">
              <Upload className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
              <div>
                <label htmlFor={sourceInputId} className="block text-sm font-medium">
                  {currentExtension ? (zh ? '更新包来源' : 'Update package source') : (zh ? '安装包来源' : 'Package source')}
                </label>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {zh ? '拖入插件目录或 ZIP，也可输入 HTTPS ZIP 或 store:包名' : 'Drop a plugin directory or ZIP, or enter an HTTPS ZIP or store:package'}
                </p>
              </div>
            </div>
            <input
              id={sourceInputId}
              className={fieldClass}
              value={source}
              onChange={event => updateSource(event.target.value)}
              placeholder={zh ? '/插件目录/或/插件.zip' : '/plugin/folder/or/plugin.zip'}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {desktopFileApi ? <>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(pickDirectory)}>
                  <FolderOpen className="size-4" aria-hidden />{zh ? '选择目录' : 'Choose directory'}
                </Button>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(pickZip)}>
                  <FileArchive className="size-4" aria-hidden />{zh ? '选择 ZIP' : 'Choose ZIP'}
                </Button>
              </> : <Button type="button" variant="secondary" disabled={busy} onClick={() => setSourcePickerOpen(true)}>
                <FolderOpen className="size-4" aria-hidden />{zh ? '选择文件或目录' : 'Choose file or folder'}
              </Button>}
            </div>
          </div>
          <Button type="submit" variant="secondary" disabled={busy || !source}>{zh ? '检查安装包' : 'Inspect package'}</Button>
        </form> : null}
        {plan ? <div role="region" aria-labelledby="plugin-authorization-title" className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
            <div>
              <p id="plugin-authorization-title" className="font-medium text-fg">{zh ? '需要你的授权' : 'Your authorization is required'}</p>
              <p className="mt-1 text-fg-muted">{zh ? '此插件需要以下新增能力。确认后会自动完成安装并启用。' : 'This plugin requests the capabilities below. After approval, installation and activation continue automatically.'}</p>
            </div>
          </div>
          <ul className="space-y-2 rounded-lg border border-edge bg-surface-panel p-3 break-words">{plan.addedCapabilities.map(c => <li key={c} className="flex gap-2"><span aria-hidden>•</span><span>{capabilityLabel(c, zh)}</span></li>)}</ul>
          {plan.diagnostics.map((d, i) => <p key={i}>{d.component}: {d.message}</p>)}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !!currentExtension && plan.manifest.name !== currentExtension.pluginId} onClick={() => void run(() => installPlan(plan))}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {zh ? '授权并安装' : 'Authorize and install'}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setPlan(null)}>{zh ? '取消' : 'Cancel'}</Button>
          </div>
        </div> : null}
        {currentExtension && (!storeSource || advancedOpen) ? <div className="border-t border-edge pt-4">
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
    {!desktopFileApi ? <WorkingDirectoryPickerModal
      open={sourcePickerOpen}
      onOpenChange={setSourcePickerOpen}
      initialAbsolutePath={localDefaultPath}
      onConfirm={async path => updateSource(path)}
      wd={messages(language).chat.workingDirectory}
      selectKind="file-or-directory"
      fileExtensions={['zip']}
      title={zh ? '选择插件安装包' : 'Choose plugin package'}
      description={zh ? '选择插件目录或 ZIP 文件。' : 'Choose a plugin directory or ZIP file.'}
      confirmLabel={zh ? '使用此来源' : 'Use this source'}
      nested
    /> : null}
  </Dialog.Portal></Dialog.Root>;
}
