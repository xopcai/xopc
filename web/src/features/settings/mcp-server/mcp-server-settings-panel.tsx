import { Check, Copy, Globe, KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { SettingsPanelSkeleton } from '@/features/settings/settings-loading-skeleton';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';
import {
  createLocalMcpGrant,
  deleteOAuthClientApi,
  fetchMcpServerAudit,
  fetchMcpServerOverview,
  revokeLocalMcpGrant,
  revokeRemoteMcpGrantApi,
  saveRemoteMcpConfig,
  type CreatedLocalGrantDto,
} from './mcp-server-api';

function fieldClassName(): string {
  return 'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent';
}

function formatTime(ts?: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

export function McpServerSettingsPanel() {
  const language = useLocaleStore(s => s.language);
  const zh = language === 'zh';

  const { data: overview, error: overviewError, isLoading, mutate: reloadOverview } = useSWR(
    'mcp-server-overview',
    fetchMcpServerOverview,
  );
  const { data: audit, mutate: reloadAudit } = useSWR(
    'mcp-server-audit',
    () => fetchMcpServerAudit(undefined, 30),
  );

  // Remote config form state
  const [remoteEnabled, setRemoteEnabled] = useState(false);
  const [remoteMode, setRemoteMode] = useState<'builtin' | 'external'>('builtin');
  const [resourceUrl, setResourceUrl] = useState('');
  const [issuerUrl, setIssuerUrl] = useState('');
  const [jwksUrl, setJwksUrl] = useState('');
  const [allowedOriginsText, setAllowedOriginsText] = useState('');
  const [rateLimitMax, setRateLimitMax] = useState('120');
  const [allowLegacyJwt, setAllowLegacyJwt] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // New local grant form state
  const [grantName, setGrantName] = useState('');
  const [grantToolset, setGrantToolset] = useState('core-read');
  const [grantProjectId, setGrantProjectId] = useState('');
  const [grantExpiryDays, setGrantExpiryDays] = useState('');
  const [grantMaxRuns, setGrantMaxRuns] = useState('10');
  const [creatingGrant, setCreatingGrant] = useState(false);
  const [createdGrant, setCreatedGrant] = useState<CreatedLocalGrantDto | null>(null);

  // Client snippet tab & feedback
  const [snippetTab, setSnippetTab] = useState<'claudeDesktop' | 'cursor' | 'codexToml' | 'claudeCodeCli'>('claudeDesktop');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!overview) return;
    if (overview.remote.enabled) {
      setRemoteEnabled(true);
      setRemoteMode(overview.remote.mode);
      setResourceUrl(overview.remote.resource);
      setIssuerUrl(overview.remote.mode === 'external' ? overview.remote.issuer : '');
      setJwksUrl(overview.remote.jwksUrl ?? '');
      setAllowedOriginsText(overview.remote.allowedOrigins.join('\n'));
      setRateLimitMax(String(overview.remote.rateLimitMax));
      setAllowLegacyJwt(overview.remote.acceptedTokenTypes.includes('JWT'));
    } else {
      setRemoteEnabled(false);
      setRemoteMode('builtin');
      setResourceUrl(overview.suggestedRemoteResource);
      setIssuerUrl('');
      setJwksUrl('');
      setAllowedOriginsText('');
      setRateLimitMax('120');
      setAllowLegacyJwt(false);
    }
  }, [overview]);

  const copyText = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(current => (current === key ? null : current)), 1800);
    } catch {
      setActionError(zh ? '无法写入剪贴板' : 'Failed to copy to clipboard');
    }
  }, [zh]);

  const handleSaveRemote = async () => {
    setActionError(null);
    setActionSuccess(null);
    setSavingConfig(true);
    try {
      const origins = allowedOriginsText
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(Boolean);
      const parsedLimit = Number(rateLimitMax);
      await saveRemoteMcpConfig(
        remoteEnabled
          ? {
              enabled: true,
              config: {
                mode: remoteMode,
                resource: resourceUrl.trim(),
                ...(remoteMode === 'external' ? { issuer: issuerUrl.trim(), jwksUrl: jwksUrl.trim() || undefined } : {}),
                ...(origins.length ? { allowedOrigins: origins } : {}),
                ...(remoteMode === 'external' && allowLegacyJwt
                  ? { acceptedTokenTypes: ['at+jwt', 'JWT'], clientIdClaims: ['client_id', 'azp'], requireJti: false }
                  : {}),
                ...(Number.isInteger(parsedLimit) && parsedLimit >= 1 ? { rateLimitMax: parsedLimit } : {}),
              },
            }
          : { enabled: false },
      );
      await reloadOverview();
      setActionSuccess(zh ? '远程 MCP 服务配置已保存。' : 'Remote MCP server settings saved.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingConfig(false);
    }
  };

  const handleCreateLocalGrant = async () => {
    setActionError(null);
    setActionSuccess(null);
    setCreatingGrant(true);
    try {
      const expiresInDays = grantExpiryDays.trim() ? Number(grantExpiryDays) : undefined;
      const maxConcurrentRuns = grantMaxRuns.trim() ? Number(grantMaxRuns) : undefined;
      const created = await createLocalMcpGrant({
        name: grantName.trim() || undefined,
        toolset: grantToolset,
        projectIds: grantProjectId ? [grantProjectId] : undefined,
        expiresInDays: Number.isInteger(expiresInDays) ? expiresInDays : undefined,
        maxConcurrentRuns: Number.isInteger(maxConcurrentRuns) ? maxConcurrentRuns : undefined,
      });
      setCreatedGrant(created);
      setGrantName('');
      await reloadOverview();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingGrant(false);
    }
  };

  const handleRevokeLocal = async (connectionId: string) => {
    setActionError(null);
    try {
      await revokeLocalMcpGrant(connectionId);
      await reloadOverview();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRevokeRemote = async (connectionId: string) => {
    setActionError(null);
    try {
      await revokeRemoteMcpGrantApi(connectionId);
      await reloadOverview();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteClient = async (clientId: string) => {
    setActionError(null);
    try {
      await deleteOAuthClientApi(clientId);
      await reloadOverview();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  if (isLoading) {
    return <SettingsPanelSkeleton rows={5} />;
  }

  if (overviewError || !overview) {
    return (
      <div className="space-y-3 rounded-xl border border-edge bg-surface-panel p-4">
        <p className="text-sm text-fg-muted">
          {overviewError instanceof Error ? overviewError.message : (zh ? '无法加载 MCP 服务配置。' : 'Failed to load MCP server settings.')}
        </p>
        <Button type="button" variant="secondary" onClick={() => void reloadOverview()}>
          {zh ? '重试' : 'Retry'}
        </Button>
      </div>
    );
  }

  const activeSnippets = createdGrant?.snippets ?? overview.snippets;
  const activeSnippetText = activeSnippets[snippetTab];

  return (
    <div className="space-y-6">
      {actionError ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
          {actionError}
        </div>
      ) : null}
      {actionSuccess ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {actionSuccess}
        </div>
      ) : null}

      {/* Section 1: Remote Streamable HTTP & Built-in OAuth 2.1 */}
      <div className="space-y-4 rounded-xl border border-edge bg-surface-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Globe className="size-4 text-accent" />
              <h3 className="text-sm font-semibold text-fg">
                {zh ? '远程 Streamable HTTP MCP 服务 (/mcp)' : 'Remote Streamable HTTP MCP Server (/mcp)'}
              </h3>
            </div>
            <p className="text-xs text-fg-muted">
              {zh
                ? '让 Claude、ChatGPT、Cursor、Codex 等外部 AI 产品通过标准 OAuth 2.1 + Streamable HTTP 直接感知并调用你的 xopc 能力（Tools、Resources、Prompts 与 Tasks）。'
                : 'Expose xopc tools, resources, prompts, and tasks over Streamable HTTP with OAuth 2.1 so external AI products can discover and invoke your workspace.'}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-fg">
            <input
              type="checkbox"
              className="accent-accent"
              checked={remoteEnabled}
              onChange={e => setRemoteEnabled(e.target.checked)}
            />
            {zh ? '启用远程 /mcp' : 'Enable remote /mcp'}
          </label>
        </div>

        {remoteEnabled ? (
          <div className="space-y-3 border-t border-edge pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-remote-mode">
                  {zh ? 'OAuth 认证模式' : 'OAuth mode'}
                </label>
                <Select
                  id="mcp-remote-mode"
                  value={remoteMode}
                  onChange={e => setRemoteMode(e.target.value as 'builtin' | 'external')}
                  className={fieldClassName()}
                >
                  <SelectOption value="builtin">
                    {zh ? '内置 OAuth 2.1 + 动态注册（推荐，无需外部 IdP）' : 'Built-in OAuth 2.1 + DCR (Recommended)'}
                  </SelectOption>
                  <SelectOption value="external">
                    {zh ? '外部 OAuth Authorization Server' : 'External OAuth Authorization Server'}
                  </SelectOption>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-rate-limit">
                  {zh ? '单连接限流（次/分钟）' : 'Per-connection rate limit (req/min)'}
                </label>
                <input
                  id="mcp-rate-limit"
                  type="number"
                  min={1}
                  max={10000}
                  className={fieldClassName()}
                  value={rateLimitMax}
                  onChange={e => setRateLimitMax(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-resource-url">
                {zh ? '对外规范地址（需以 /mcp 结尾，可配合 Tunnel / Tailscale）' : 'Canonical Resource URL (ending in /mcp)'}
              </label>
              <div className="flex gap-2">
                <input
                  id="mcp-resource-url"
                  className={cn(fieldClassName(), 'font-mono text-xs')}
                  value={resourceUrl}
                  onChange={e => setResourceUrl(e.target.value)}
                  placeholder="https://gateway.example.com/mcp"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => void copyText('remote-url', resourceUrl)}
                >
                  {copiedKey === 'remote-url' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
            </div>

            {remoteMode === 'external' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-issuer-url">Issuer URL</label>
                  <input
                    id="mcp-issuer-url"
                    className={cn(fieldClassName(), 'font-mono text-xs')}
                    value={issuerUrl}
                    onChange={e => setIssuerUrl(e.target.value)}
                    placeholder="https://login.example.com/"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-jwks-url">JWKS URL</label>
                  <input
                    id="mcp-jwks-url"
                    className={cn(fieldClassName(), 'font-mono text-xs')}
                    value={jwksUrl}
                    onChange={e => setJwksUrl(e.target.value)}
                    placeholder="https://login.example.com/.well-known/jwks.json"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-fg sm:col-span-2">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={allowLegacyJwt}
                    onChange={e => setAllowLegacyJwt(e.target.checked)}
                  />
                  {zh ? '兼容通用 IdP（允许 typ=JWT、azp 作为 client_id、可选 jti）' : 'Compat mode for mainstream IdPs (accept typ=JWT, azp client_id, optional jti)'}
                </label>
              </div>
            ) : null}

            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-allowed-origins">
                {zh ? '允许的浏览器 Origin（用于 Claude Web / ChatGPT Web / MCP Inspector，每行一个）' : 'Allowed browser origins (for web AI clients / MCP Inspector, one per line)'}
              </label>
              <textarea
                id="mcp-allowed-origins"
                rows={2}
                className={cn(fieldClassName(), 'font-mono text-xs')}
                value={allowedOriginsText}
                onChange={e => setAllowedOriginsText(e.target.value)}
                placeholder={'https://claude.ai\nhttp://localhost:6274'}
              />
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="primary" disabled={savingConfig} onClick={() => void handleSaveRemote()}>
            {savingConfig ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            {zh ? '保存远程 MCP 配置' : 'Save remote MCP config'}
          </Button>
        </div>
      </div>

      {/* Section 2: Quick Connect Client Snippets */}
      <div className="space-y-3 rounded-xl border border-edge bg-surface-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-fg">
              {zh ? '外部 AI 客户端一键接入配置' : 'Quick Connect Snippets'}
            </h3>
            <p className="text-xs text-fg-muted">
              {createdGrant
                ? (zh ? '已自动填入刚生成的连接凭据（此 Token 仅展示一次，请立即保存）。' : 'Pre-filled with your newly created token (shown once — copy now).')
                : (zh ? '先在下方创建一个本机连接凭据，或复制模板配置到 Claude Desktop / Cursor / Codex / Claude Code。' : 'Create a local grant below or copy the template into Claude Desktop, Cursor, Codex, or Claude Code.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {([
              ['claudeDesktop', 'Claude Desktop'],
              ['cursor', 'Cursor'],
              ['codexToml', 'Codex'],
              ['claudeCodeCli', 'Claude Code CLI'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSnippetTab(key)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                  snippetTab === key
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-edge bg-surface-panel text-fg-muted hover:text-fg',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <pre className="overflow-x-auto rounded-lg border border-edge bg-surface-hover p-3 font-mono text-xs text-fg">
            {activeSnippetText}
          </pre>
          <Button
            type="button"
            variant="secondary"
            className="absolute right-2 top-2 h-7 px-2 text-xs"
            onClick={() => void copyText(`snippet-${snippetTab}`, activeSnippetText)}
          >
            {copiedKey === `snippet-${snippetTab}` ? <Check className="mr-1 size-3" /> : <Copy className="mr-1 size-3" />}
            {copiedKey === `snippet-${snippetTab}` ? (zh ? '已复制' : 'Copied') : (zh ? '复制' : 'Copy')}
          </Button>
        </div>
      </div>

      {/* Section 3: Local Stdio Grants */}
      <div className="space-y-4 rounded-xl border border-edge bg-surface-panel p-4">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-accent" />
          <h3 className="text-sm font-semibold text-fg">
            {zh ? '本机 stdio 连接授权' : 'Local stdio Connections'}
          </h3>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-grant-name">
              {zh ? '连接名称' : 'Connection label'}
            </label>
            <input
              id="mcp-grant-name"
              className={fieldClassName()}
              value={grantName}
              onChange={e => setGrantName(e.target.value)}
              placeholder={zh ? '如：Cursor / Claude Desktop' : 'e.g. Cursor / Claude Desktop'}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-grant-toolset">
              {zh ? '能力组合（Toolset）' : 'Capability toolset'}
            </label>
            <Select
              id="mcp-grant-toolset"
              value={grantToolset}
              onChange={e => setGrantToolset(e.target.value)}
              className={fieldClassName()}
            >
              {overview.toolsets.map(ts => (
                <SelectOption key={ts.id} value={ts.id}>
                  {ts.label} ({ts.capabilityIds.length})
                </SelectOption>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-grant-project">
              {zh ? '项目范围隔离' : 'Project scope'}
            </label>
            <Select
              id="mcp-grant-project"
              value={grantProjectId}
              onChange={e => setGrantProjectId(e.target.value)}
              className={fieldClassName()}
            >
              <SelectOption value="">{zh ? '整个个人工作区' : 'Entire workspace'}</SelectOption>
              {overview.projects.map(p => (
                <SelectOption key={p.id} value={p.id}>{p.name}</SelectOption>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-grant-expiry">
                {zh ? '有效期（天）' : 'Expiry (days)'}
              </label>
              <input
                id="mcp-grant-expiry"
                type="number"
                min={1}
                max={3650}
                className={fieldClassName()}
                value={grantExpiryDays}
                onChange={e => setGrantExpiryDays(e.target.value)}
                placeholder={zh ? '永久' : 'Never'}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-fg-muted" htmlFor="mcp-grant-max-runs">
                {zh ? '并发上限' : 'Max runs'}
              </label>
              <input
                id="mcp-grant-max-runs"
                type="number"
                min={1}
                max={50}
                className={fieldClassName()}
                value={grantMaxRuns}
                onChange={e => setGrantMaxRuns(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="primary" disabled={creatingGrant} onClick={() => void handleCreateLocalGrant()}>
            {creatingGrant ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Plus className="mr-1.5 size-3.5" />}
            {zh ? '签发连接凭据' : 'Create connection grant'}
          </Button>
        </div>

        <div className="space-y-2 border-t border-edge pt-3">
          {overview.localGrants.length === 0 ? (
            <p className="text-xs text-fg-muted">{zh ? '尚无本机 MCP 连接授权。' : 'No local MCP connection grants yet.'}</p>
          ) : (
            overview.localGrants.map(grant => (
              <div key={grant.connectionId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge px-3 py-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-fg">
                    <span>{grant.name ?? grant.connectionId.slice(0, 8)}</span>
                    {grant.toolset ? (
                      <span className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">{grant.toolset}</span>
                    ) : null}
                    <span className="text-fg-muted">{grant.capabilityIds.length} {zh ? '项能力' : 'tools'}</span>
                    {grant.projectIds?.length ? (
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">
                        {zh ? `限定 ${grant.projectIds.length} 个项目` : `${grant.projectIds.length} project(s)`}
                      </span>
                    ) : null}
                    {grant.expired ? (
                      <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] text-red-600 dark:text-red-400">
                        {zh ? '已过期' : 'Expired'}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-fg-subtle">
                    ID: <span className="font-mono">{grant.connectionId}</span>
                    {grant.stats ? ` · ${grant.stats.totalCalls} ${zh ? '次调用' : 'calls'} (${grant.stats.errorCount} ${zh ? '错误' : 'errors'})` : ''}
                    {grant.stats?.lastUsedAt ? ` · ${zh ? '最近使用' : 'Last used'}: ${formatTime(grant.stats.lastUsedAt)}` : ''}
                  </div>
                </div>
                <Button type="button" variant="secondary" className="h-7 px-2 text-xs" onClick={() => void handleRevokeLocal(grant.connectionId)}>
                  <Trash2 className="mr-1 size-3" />
                  {zh ? '吊销' : 'Revoke'}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Section 4: Remote OAuth Grants & DCR Clients */}
      <div className="space-y-3 rounded-xl border border-edge bg-surface-panel p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-accent" />
          <h3 className="text-sm font-semibold text-fg">
            {zh ? '远程 OAuth 授权连接与客户端' : 'Remote OAuth Grants & Registered Clients'}
          </h3>
        </div>
        {overview.remoteGrants.length === 0 ? (
          <p className="text-xs text-fg-muted">{zh ? '尚无远程 OAuth 连接授权。' : 'No active remote OAuth grants.'}</p>
        ) : (
          <div className="space-y-2">
            {overview.remoteGrants.map(grant => (
              <div key={grant.connectionId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge px-3 py-2">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-fg">
                    <span>{grant.name ?? grant.clientId}</span>
                    <span className="font-mono text-[11px] text-fg-muted">{grant.subject}</span>
                    <span className="text-fg-muted">{grant.capabilityIds.length} {zh ? '项能力' : 'tools'}</span>
                  </div>
                  <div className="text-[11px] text-fg-subtle">
                    Client: <span className="font-mono">{grant.clientId}</span>
                    {grant.stats ? ` · ${grant.stats.totalCalls} ${zh ? '次调用' : 'calls'}` : ''}
                  </div>
                </div>
                <Button type="button" variant="secondary" className="h-7 px-2 text-xs" onClick={() => void handleRevokeRemote(grant.connectionId)}>
                  <Trash2 className="mr-1 size-3" />
                  {zh ? '吊销' : 'Revoke'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {overview.oauthClients.length > 0 ? (
          <div className="space-y-2 border-t border-edge pt-3">
            <p className="text-xs font-medium text-fg-muted">{zh ? '内置 OAuth 动态注册客户端' : 'Built-in OAuth Registered Clients'}</p>
            {overview.oauthClients.map(client => (
              <div key={client.clientId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge px-3 py-2">
                <div className="min-w-0 space-y-0.5 text-xs">
                  <div className="font-medium text-fg">{client.clientName}</div>
                  <div className="font-mono text-[11px] text-fg-subtle">{client.clientId} · {client.redirectUris.join(', ')}</div>
                </div>
                <Button type="button" variant="secondary" className="h-7 px-2 text-xs" onClick={() => void handleDeleteClient(client.clientId)}>
                  <Trash2 className="mr-1 size-3" />
                  {zh ? '删除' : 'Remove'}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Section 5: Recent MCP Call Audit */}
      <div className="space-y-3 rounded-xl border border-edge bg-surface-panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">
            {zh ? '近期外部 MCP 调用审计' : 'Recent MCP Call Audit'}
          </h3>
          <Button type="button" variant="secondary" className="h-7 px-2 text-xs" onClick={() => void reloadAudit()}>
            <RefreshCw className="mr-1 size-3" />
            {zh ? '刷新' : 'Refresh'}
          </Button>
        </div>
        {!audit || audit.entries.length === 0 ? (
          <p className="text-xs text-fg-muted">{zh ? '暂无外部 MCP 调用记录。' : 'No MCP calls recorded yet.'}</p>
        ) : (
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {audit.entries.map(entry => (
              <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-edge px-2.5 py-1.5 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] uppercase text-fg-muted">{entry.transport}</span>
                  <span className="truncate font-mono text-fg">{entry.capabilityId}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                  <span className={entry.status === 'succeeded' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                    {entry.status}
                  </span>
                  <span>{entry.durationMs}ms</span>
                  <span className="text-fg-subtle">{formatTime(entry.at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
