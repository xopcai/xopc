import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { PluginAccountEditor, PluginCredentialFields } from './plugin-account-editor';
import type { PluginAccount, PluginAuthorizationAttempt, PluginSetupJob } from './plugin-setup-types';
import type { ExtensionApiRow } from './types';

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const result = await fetchJson<{ ok: boolean; payload: T; error?: string }>(apiUrl(path), { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!result.ok) throw new Error(result.error ?? 'Request failed');
  return result.payload;
}
export function PluginSetupPanel({ extension, zh, onChanged, onStart, onInstalled }: { extension: ExtensionApiRow; zh: boolean; onChanged: () => Promise<unknown>; onStart?: () => void; onInstalled?: () => void }) {
  const base = `/api/extensions/agent-plugins/${encodeURIComponent(extension.pluginId!)}`;
  const [job, setJob] = useState<PluginSetupJob | null>();
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reusable, setReusable] = useState<Record<string, Array<{ id: string; name: string }>>>({});
  const [auth, setAuth] = useState<PluginAuthorizationAttempt | null>(null);
  const [authServer, setAuthServer] = useState('');
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState(false);
  const automatic = useRef(new Set<string>());
  const openedAccounts = useRef(new Set<string>());
  const accountOpeningRevision = useRef<number | undefined>(undefined);
  const signInWindow = useRef<Window | null>(null);
  const t = (cn: string, en: string) => zh ? cn : en;
  const declared = extension.setup?.authorizations ?? [];
  const covered = new Set(declared.flatMap(value => value.servers));
  const accounts: PluginAccount[] = [...declared, ...(job?.connections ?? []).filter(server => !covered.has(server.name) && (extension.components?.mcp.find(value => value.name === server.name)?.type !== 'stdio' || server.state === 'token_required')).map(server => {
    const token = server.state === 'token_required' || extension.components?.mcp.find(value => value.name === server.name)?.connectionAuth?.mode === 'api-key';
    return { id: server.name, title: server.name, servers: [server.name], methods: [{ id: token ? 'api-key' : 'oauth', title: token ? t('访问令牌', 'Access token') : t('浏览器登录', 'Browser sign-in'), type: token ? 'form' as const : 'oauth' as const, ...(token ? { fields: ['__apiKey'] } : { server: server.name }) }] };
  })];
  const connected = (account: PluginAccount) => account.servers.every(name => job?.connections.find(value => value.name === name)?.state === 'connected') && (!declared.some(value => value.id === account.id) || job?.authorizations?.find(value => value.id === account.id)?.state === 'connected');
  const unresolved = accounts.filter(account => !connected(account));
  const installed = job?.installed || job?.state === 'completed';
  const fields = extension.setup?.userConfig ?? {};
  const accountFields = new Set(declared.flatMap(account => account.methods.flatMap(method => method.fields ?? [])));
  const globalFields = Object.fromEntries(Object.entries(fields).filter(([key]) => !accountFields.has(key)));
  const jobError = job?.error === 'Connection verification failed. Check the credentials or login status and try again.' ? t('连接验证未通过，请检查凭据或登录状态后重试。', job.error) : job?.error;
  const missingFields = Object.fromEntries(Object.entries(fields).filter(([key]) => job?.missingConfig?.includes(key)));
  const preparing = busy || job?.state === 'running';
  const currentAccount = accounts.find(account => account.id === activeAccount);
  useEffect(() => {
    let stopped = false;
    void request<PluginSetupJob | null>(`${base}/setup`).then(next => { if (!stopped) setJob(next); }).catch(e => { if (!stopped) { setJob(null); setError(String(e)); } });
    return () => { stopped = true; };
  }, [base]);
  useEffect(() => {
    if (job?.state !== 'running') return;
    let stopped = false; let polling = false;
    const timer = setInterval(() => {
      if (polling) return; polling = true;
      void request<PluginSetupJob | null>(`${base}/setup`).then(next => { if (!stopped) { setJob(next); if (next?.state !== 'running') void onChanged(); } }).catch(e => { if (!stopped) setError(String(e)); }).finally(() => { polling = false; });
    }, 750);
    return () => { stopped = true; clearInterval(timer); };
  }, [base, job?.state]);
  useEffect(() => {
    if (!job || !job.connections.some(server => ['oauth_required', 'error'].includes(server.state))) return;
    let stopped = false;
    void request<Record<string, Array<{ id: string; name: string }>>>(`${base}/setup/reusable`).then(value => { if (!stopped) setReusable(value); }).catch(() => { if (!stopped) setReusable({}); });
    return () => { stopped = true; };
  }, [base, job?.revision]);
  useEffect(() => {
    if (!authServer || job?.state === 'completed') return;
    let stopped = false; let polling = false;
    const poll = async () => {
      if (polling) return; polling = true;
      try { const value = await request<PluginAuthorizationAttempt | null>(`${base}/setup/auth/${encodeURIComponent(authServer)}`); if (!stopped) setAuth(value); }
      catch (e) { if (!stopped) setError(String(e)); }
      finally { polling = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 1500);
    const focus = () => void poll(); window.addEventListener('focus', focus);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [base, authServer, job?.state]);
  useEffect(() => {
    const url = auth?.authorizationUrl ?? (auth?.challenge?.type === 'url' ? auth.challenge.url : undefined);
    if (!url || auth?.error || !signInWindow.current) return;
    const popup = signInWindow.current; signInWindow.current = null;
    if (!popup.closed) popup.location.replace(url);
  }, [auth]);
  async function act(action: string, values: Record<string, unknown> = {}, expectedRevision = job?.revision) {
    setBusy(true); setError('');
    try {
      let next = await request<PluginSetupJob>(`${base}/setup`, 'POST', { action, expectedRevision, ...(action !== 'start' ? { idempotencyKey: crypto.randomUUID() } : {}), ...values });
      if (['configure', 'reuse', 'start'].includes(action)) {
        setConfig({}); setEditConfig(false);
        next = await request<PluginSetupJob>(`${base}/setup`, 'POST', { action: 'prepare', expectedRevision: next.revision, idempotencyKey: crypto.randomUUID() });
      }
      setJob(next); await onChanged();
      if (['complete', 'defer'].includes(action)) { setActiveAccount(null); setAuth(null); setAuthServer(''); signInWindow.current?.close(); signInWindow.current = null; onInstalled?.(); }
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      try { setJob(await request<PluginSetupJob | null>(`${base}/setup`)); } catch { /* Keep the actionable error. */ }
      return null;
    } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!job || preparing || error || ['cancelled', 'running', 'failed'].includes(job.state)) return;
    if (job.state === 'completed') return;
    let action: string | undefined; let key = '';
    if (job.state === 'pending') { action = 'prepare'; key = `prepare:${base}:${job.revision}`; }
    else if (auth?.state === 'connected') { action = 'prepare'; key = `auth:${base}:${auth.id}`; }
    if (action && !automatic.current.has(key)) { automatic.current.add(key); void act(action); return; }
    if (job.resources === 'ready' && !job.missingConfig?.length && !job.partial && job.connections.every(c => c.state === 'connected') && (job.authorizations ?? []).every(value => value.state === 'connected')) {
      key = `complete:${base}:${job.revision}`;
      if (!automatic.current.has(key)) { automatic.current.add(key); void act('complete'); }
    }
  }, [job, auth, preparing, error, base]);
  useEffect(() => {
    if (preparing || !job || job.state === 'cancelled') return;
    if (currentAccount && job.revision !== accountOpeningRevision.current && connected(currentAccount)) { setActiveAccount(null); setAuth(null); setAuthServer(''); }
    else if (!installed && job.resources === 'ready' && !job.missingConfig?.length && !activeAccount && unresolved[0] && !openedAccounts.current.has(unresolved[0].id)) { openedAccounts.current.add(unresolved[0].id); accountOpeningRevision.current = job.revision; setActiveAccount(unresolved[0].id); }
  }, [job, preparing, installed, activeAccount]);
  function connect(account: PluginAccount, method: string) {
    const selected = account.methods.find(value => value.id === method);
    const popup = selected?.type === 'oauth' ? window.open('about:blank', '_blank') : null;
    if (popup) popup.opener = null;
    signInWindow.current = popup; setAuth(null);
    void act('authorize', { server: account.id, ...(declared.some(value => value.id === account.id) ? { method } : {}) }).then(next => {
      if (next) setAuthServer(account.id); else { popup?.close(); signInWindow.current = null; }
    });
  }
  async function save(account: PluginAccount, method: string, values: Record<string, unknown>) {
    if (method === 'api-key' && !declared.some(value => value.id === account.id)) {
      setBusy(true); setError('');
      try { const server = extension.components?.mcp.find(value => value.name === account.id)!;
        await request(`${base}/mcp/${encodeURIComponent(account.id)}/auth`, 'PUT', { mode: 'api-key', secrets: [{ target: server.type === 'stdio' ? 'env' : 'headers', key: server.connectionAuth?.headerName ?? (server.type === 'stdio' ? 'API_KEY' : 'Authorization'), prefix: server.connectionAuth?.prefix ?? (server.type === 'stdio' ? '' : 'Bearer '), value: values.__apiKey }] });
        const next = await request<PluginSetupJob>(`${base}/setup`); setJob(next);
        setBusy(false); await act('prepare', {}, next.revision); return;
      } catch (e) { setError(String(e)); setBusy(false); return; }
      setBusy(false);
    } else {
      const selected = account.methods.find(value => value.id === method);
      if (selected?.type === 'cli') {
        const next = await act('configure', { authorization: account.id, method, values }, job?.revision);
        if (next) { const authorized = await act('authorize', { server: account.id, method }, next.revision); if (authorized) setAuthServer(account.id); }
      } else await act('configure', { authorization: account.id, method, values });
    }
  }
  if (job === undefined) return <Skeleton className="h-40 w-full" />;
  const skip = () => { void act('defer'); };
  if (currentAccount) return <div className="space-y-3"><PluginAccountEditor key={currentAccount.id} account={currentAccount} fields={{ ...fields, __apiKey: { type: 'string', title: t('访问令牌', 'Access token'), required: true, sensitive: true } }} zh={zh} busy={preparing} attempt={auth} onBack={() => setActiveAccount(null)} onConnect={method => connect(currentAccount, method)} onSave={(method, values) => void save(currentAccount, method, values)} onRedirect={url => { setBusy(true); void request(`${base}/setup/auth/${encodeURIComponent(authServer)}/redirect`, 'POST', { url }).catch(e => setError(String(e))).finally(() => setBusy(false)); }} onSkip={skip} />{reusable[currentAccount.id]?.map(candidate => <Button key={candidate.id} disabled={preparing} variant="secondary" onClick={() => void act('reuse', { server: currentAccount.id, sourceServerId: candidate.id })}>{t('使用已登录账号：', 'Use signed-in account: ')}{candidate.name}</Button>)}{error || jobError && currentAccount.servers.some(name => job?.connections.find(value => value.name === name)?.state === 'error') ? <p role="alert" className="text-sm text-fg-muted">{error || jobError}</p> : null}</div>;
  return <section className="space-y-5" aria-label={t('插件安装与授权', 'Plugin setup')}>
    {!installed ? <div className="rounded-xl border border-edge p-4"><h3 className="font-medium">{t('安装准备', 'Installation setup')}</h3><ol className="mt-4 space-y-4 text-sm" aria-live="polite">{[
      { name: t('准备资源', 'Prepare resources'), done: job?.resources === 'ready', running: preparing && job?.resources !== 'ready' },
      { name: t('授权账号', 'Authorize accounts'), done: job?.resources === 'ready' && !job?.missingConfig?.length && unresolved.length === 0, running: false },
      { name: t('加载可用工具', 'Load available tools'), done: false, running: preparing && job?.resources === 'ready' },
    ].map(step => <li key={step.name} className="flex items-center gap-3">{step.done ? <CheckCircle2 className="size-5 text-accent" aria-hidden /> : step.running ? <Loader2 className="size-5 animate-spin text-accent" aria-hidden /> : <Circle className="size-5 text-fg-muted" aria-hidden />}{step.name}</li>)}</ol><p className="mt-4 text-xs text-fg-muted">{t('安装后所有 Agent 均可使用，可在各自的设置中调整。', 'Available to all agents after installation. Customize individual agents in Agent settings.')}</p></div> : <div><h3 className="font-medium">{t('安装完成', 'Installation complete')}</h3><p role="status" className="mt-1 text-sm text-fg-muted">{extension.activationEligible === false ? t('插件已停用。', 'Plugin is disabled.') : job?.partial || unresolved.length || job?.missingConfig?.length ? t('插件已安装，部分功能仍需要授权。', 'Plugin installed. Some features still need authorization.') : t('所有 Agent 均可使用。可在 Agent 设置中单独调整。', 'Available to all agents. Customize individual agents in Agent settings.')}</p></div>}
    {!job || job.state === 'cancelled' ? <Button disabled={busy || extension.readiness === 'blocked'} onClick={() => void act('start')}>{t('继续安装', 'Continue installation')}</Button> : <>
      {job.missingConfig?.length || editConfig ? <form className="space-y-4 rounded-xl border border-edge p-4" onSubmit={event => { event.preventDefault(); void act('configure', { values: config }); }}><h4 className="font-medium">{t('补充配置', 'Required configuration')}</h4><PluginCredentialFields fields={editConfig ? globalFields : missingFields} values={config} onChange={setConfig} /><Button type="submit" disabled={preparing || !Object.keys(config).length}>{t('继续', 'Continue')}</Button></form> : null}
      {installed && (unresolved.length || job.missingConfig?.length) ? <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"><AlertCircle className="mt-0.5 size-5 shrink-0" aria-hidden /><div><p className="font-medium">{t('需要授权', 'Authorization required')}</p><p className="mt-1 text-fg-muted">{t('授权后即可使用相关功能。已就绪的功能可继续使用。', 'Connect these accounts to use their features. Ready features remain available.')}</p></div></div> : null}
      {accounts.length ? <div className="space-y-2"><h4 className="text-sm font-medium">{t('账号与连接', 'Accounts and connections')}</h4>{accounts.map(account => <div key={account.id} role="group" aria-label={account.title} className="flex items-center justify-between gap-3 rounded-lg border border-edge p-3"><div className="min-w-0"><p className="text-sm font-medium">{account.title}</p><p className="mt-1 text-xs text-fg-muted">{connected(account) ? t('已连接', 'Connected') : t('需要授权', 'Authorization required')}</p></div><Button variant={connected(account) ? 'secondary' : 'primary'} disabled={preparing || job.resources !== 'ready'} onClick={() => { setAuth(null); setAuthServer(''); accountOpeningRevision.current = job.revision; setActiveAccount(account.id); }}>{connected(account) ? t('重新授权', 'Reconnect') : t('连接账号', 'Connect account')}</Button></div>)}</div> : null}
      {!installed && job.resources === 'ready' ? <div><Button variant="secondary" disabled={preparing} onClick={skip}>{t('暂时跳过', 'Skip for now')}</Button><p className="mt-2 text-xs text-fg-muted">{t('先完成安装，稍后在详情页授权。未授权的功能暂不可用。', 'Finish installation and connect later in plugin details. Unauthenticated features remain unavailable.')}</p></div> : null}
      {installed && Object.keys(globalFields).length && !editConfig ? <Button variant="ghost" disabled={preparing} onClick={() => setEditConfig(true)}>{t('修改插件配置', 'Edit plugin configuration')}</Button> : null}
      {!preparing && (error || ['failed', 'interrupted'].includes(job.state) || job.connections.some(value => value.state === 'error')) ? <Button variant="secondary" onClick={() => void act('prepare')}>{t('重试检查', 'Retry checks')}</Button> : null}
      {!installed ? <Button variant="ghost" disabled={busy} onClick={() => void act('cancel')}>{t('取消安装', 'Cancel installation')}</Button> : null}
      {installed && !unresolved.length && !job.missingConfig?.length ? extension.setup?.tasks?.map(task => <div key={task} className="space-y-3 rounded-lg bg-surface-inset p-4 text-sm"><p>{task}</p><Button asChild disabled={!extension.active}><Link to={`/chat/new?${new URLSearchParams({ draft: task, projectScope: 'none' })}`} state={{ forceNewChat: true }} onClick={event => { if (!extension.active) event.preventDefault(); else onStart?.(); }}>{t('开始这个任务', 'Start this task')}</Link></Button></div>) : null}
    </>}
    {preparing ? <p role="status" className="text-sm text-fg-muted">{t('正在准备，可关闭后继续。', 'Preparing. You can close this window and resume.')}</p> : null}
    {job?.error && !job.deferred && !job.missingConfig?.length ? <p className="text-sm text-fg-muted">{jobError}</p> : null}{error ? <p role="alert" className="text-sm text-fg-muted">{error}</p> : null}
  </section>;
}
